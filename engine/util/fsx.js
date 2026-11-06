// @ts-check
/** Small filesystem helpers shared by the engine and the server. */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {string} target
 * @returns {Promise<boolean>}
 */
export async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} target
 * @returns {Promise<import('node:fs').Stats|null>}
 */
export async function statSafe(target) {
  try {
    return await stat(target);
  } catch {
    return null;
  }
}

/**
 * Resolve a path case-insensitively. Warband asset names are case-insensitive
 * on Windows and the module folder casing is not stable across installs.
 * @param {string} directory
 * @param {string} name
 * @returns {Promise<string|null>}
 */
export async function resolveCaseInsensitive(directory, name) {
  const direct = path.join(directory, name);
  if (await exists(direct)) return direct;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }
  const lower = name.toLowerCase();
  const match = entries.find((entry) => entry.name.toLowerCase() === lower);
  return match ? path.join(directory, match.name) : null;
}

/**
 * @param {string} directory
 * @returns {Promise<import('node:fs').Dirent[]>}
 */
export async function listDir(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * List files recursively, returning absolute paths. `extensions` is a list of
 * lowercase extensions including the dot, e.g. ['.brf', '.dds'].
 * @param {string} directory
 * @param {{ extensions?: string[], maxDepth?: number }} [options]
 * @returns {Promise<string[]>}
 */
export async function listFiles(directory, options = {}) {
  const { extensions = null, maxDepth = 8 } = options;
  /** @type {string[]} */
  const output = [];

  /** @param {string} dir @param {number} depth */
  async function walk(dir, depth) {
    if (depth > maxDepth) return;
    for (const entry of await listDir(dir)) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        if (!extensions || extensions.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
          output.push(full);
        }
      }
    }
  }

  await walk(directory, 0);
  return output;
}

/**
 * @param {string} filePath
 * @returns {Promise<any>}
 */
export async function readJson(filePath) {
  const text = await readFile(filePath, 'utf8');
  return JSON.parse(text);
}

/**
 * Write JSON atomically (temp file + rename) so a crash cannot truncate a
 * project or cache file.
 * @param {string} filePath
 * @param {any} value
 */
export async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(temp, filePath);
}

/**
 * @param {string} filePath
 */
export async function sha256File(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', resolve);
  });
  return hash.digest('hex');
}

/**
 * @param {string} filePath
 */
export async function ensureDir(filePath) {
  await mkdir(filePath, { recursive: true });
}
