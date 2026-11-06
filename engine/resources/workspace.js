// @ts-check
/**
 * Workspace store — the only place where the studio writes derived game data.
 *
 * Layout:
 *   workspace/<id>/.workspace.json        metadata + file hashes
 *   workspace/<id>/.backups/<stamp>/...   previous revisions, byte-copied
 *   workspace/<id>/<relative path>        working files
 *
 * Safety rules (VERIFIED by tests):
 *   - paths are relative and cannot escape the workspace
 *   - absolute paths and `..` segments are rejected
 *   - overwriting a file backs it up and records its SHA-256 first
 *   - writes are atomic (temp file + rename)
 *   - the game installation is never used as a destination
 */

import path from 'node:path';
import { copyFile, readFile, rename, writeFile as fsWriteFile } from 'node:fs/promises';
import { ensureDir, exists, listDir, readJson, sha256File, statSafe, writeJsonAtomic } from '../util/fsx.js';
import { slugify } from '../util/slug.js';

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const METADATA = '.workspace.json';

/**
 * @typedef {Object} WorkspaceFile
 * @property {number} bytes
 * @property {string} sha256
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} WorkspaceMetadata
 * @property {number} schemaVersion
 * @property {string} id
 * @property {string} label
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {Record<string, WorkspaceFile>} files
 */

export class WorkspaceStore {
  /** @param {{ rootDir: string }} options */
  constructor(options) {
    this.rootDir = path.join(options.rootDir, 'workspace');
  }

  async init() {
    await ensureDir(this.rootDir);
  }

  /** @param {string} id */
  dirFor(id) {
    if (!ID_PATTERN.test(id)) throw new Error(`Invalid workspace id '${id}'`);
    return path.join(this.rootDir, id);
  }

  /**
   * Resolve a relative path inside a workspace, rejecting escapes.
   * @param {string} id
   * @param {string} relativePath
   */
  resolve(id, relativePath) {
    if (typeof relativePath !== 'string' || relativePath.trim() === '') {
      throw new Error('workspace path must be a non-empty string');
    }
    if (relativePath.includes('\0')) throw new Error('workspace path contains a NUL byte');
    const normalized = relativePath.replace(/\\/g, '/');
    if (path.posix.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) {
      throw new Error('workspace path must be relative');
    }
    const segments = normalized.split('/');
    if (segments.some((segment) => segment === '..' || segment === '.')) {
      throw new Error('workspace path cannot contain . or .. segments');
    }
    const root = this.dirFor(id);
    const target = path.resolve(root, ...segments);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error('workspace path escapes the workspace');
    }
    return target;
  }

  /** @param {string} id @returns {Promise<WorkspaceMetadata>} */
  async get(id) {
    const file = path.join(this.dirFor(id), METADATA);
    const metadata = await readJson(file);
    if (metadata.id !== id) throw new Error('workspace id does not match its metadata');
    return metadata;
  }

  async list() {
    const entries = await listDir(this.rootDir);
    /** @type {any[]} */
    const workspaces = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const metadata = await this.get(entry.name);
        workspaces.push({
          id: metadata.id,
          label: metadata.label,
          createdAt: metadata.createdAt,
          updatedAt: metadata.updatedAt,
          files: Object.keys(metadata.files).length,
        });
      } catch {
        /* ignore directories without metadata */
      }
    }
    workspaces.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return workspaces;
  }

  /**
   * @param {{ label: string, id?: string }} input
   * @returns {Promise<WorkspaceMetadata>}
   */
  async create(input) {
    const base = slugify(input.id ?? input.label, 'workspace');
    let id = base;
    let counter = 1;
    while (await exists(this.dirFor(id))) id = `${base}-${counter++}`;

    const now = new Date().toISOString();
    /** @type {WorkspaceMetadata} */
    const metadata = {
      schemaVersion: 1,
      id,
      label: input.label.trim() || id,
      createdAt: now,
      updatedAt: now,
      files: {},
    };
    await ensureDir(this.dirFor(id));
    await writeJsonAtomic(path.join(this.dirFor(id), METADATA), metadata);
    return metadata;
  }

  /**
   * Write a file into a workspace. Existing files are backed up first.
   * @param {string} id
   * @param {string} relativePath
   * @param {Buffer|Uint8Array|string} data
   * @param {{ backup?: boolean }} [options]
   * @returns {Promise<{ file: string, backup: string|null, sha256: string, bytes: number }>}
   */
  async writeFile(id, relativePath, data, options = {}) {
    const metadata = await this.get(id);
    const target = this.resolve(id, relativePath);
    const relative = path.relative(this.dirFor(id), target).replace(/\\/g, '/');
    await ensureDir(path.dirname(target));

    let backup = null;
    const existing = await statSafe(target);
    if (existing?.isFile() && options.backup !== false) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      backup = path.join(this.dirFor(id), '.backups', stamp, relative);
      await ensureDir(path.dirname(backup));
      await copyFile(target, backup);
      await writeJsonAtomic(`${backup}.json`, {
        workspace: id,
        file: relative,
        backedUpAt: new Date().toISOString(),
        sha256: await sha256File(target),
        bytes: existing.size,
      });
    }

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fsWriteFile(temp, buffer);
    await rename(temp, target);

    metadata.files[relative] = {
      bytes: buffer.length,
      sha256: await sha256File(target),
      updatedAt: new Date().toISOString(),
    };
    metadata.updatedAt = new Date().toISOString();
    await writeJsonAtomic(path.join(this.dirFor(id), METADATA), metadata);

    return { file: target, backup, sha256: metadata.files[relative].sha256, bytes: buffer.length };
  }

  /**
   * Serialize a BRF document into a workspace.
   * @param {string} id
   * @param {import('./brf.js').BrfDocument} doc
   * @param {Buffer} source
   * @param {string} relativePath
   */
  async writeBrf(id, doc, source, relativePath) {
    const { serializeBrf } = await import('./brf.js');
    const buffer = serializeBrf(doc, source);
    const result = await this.writeFile(id, relativePath, buffer);
    return { ...result, serializedBytes: buffer.length };
  }

  /** @param {string} id @param {string} relativePath */
  async readFile(id, relativePath) {
    return readFile(this.resolve(id, relativePath));
  }
}
