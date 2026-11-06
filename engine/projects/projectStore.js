// @ts-check
/**
 * Project storage.
 *
 * Projects are plain JSON files under `projects/`. Nothing is ever written to
 * the game installation. Every save of an existing project first copies the
 * previous revision to `backups/projects/` (§10 safety requirements).
 */

import path from 'node:path';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { ensureDir, exists, listDir, readJson, writeJsonAtomic } from '../util/fsx.js';
import { slugify as baseSlugify } from '../util/slug.js';

export const PROJECT_SCHEMA_VERSION = 1;

/**
 * @typedef {Object} WarbandProject
 * @property {number} schemaVersion
 * @property {string} id
 * @property {string} name
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {{installationId:string,installationPath:string,moduleId:string}} target
 * @property {{id:string,kind:'mesh'|'material'|'texture'|'item',name:string,notes:string}[]} assets
 * @property {{id:string,baseItemId:string,notes:string,overrides:Record<string,unknown>}[]} items
 * @property {{id:string,name:string,slot:string,itemIds:string[]}[]} outfits
 * @property {{lastRunAt:string|null,summary:{errors:number,warnings:number,infos:number}} } validation
 * @property {string} notes
 */

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * @param {string} value
 */
export function slugify(value) {
  return baseSlugify(value, 'project');
}

export class ProjectStore {
  /** @param {{ rootDir: string }} options */
  constructor(options) {
    this.rootDir = path.join(options.rootDir, 'projects');
    this.backupDir = path.join(options.rootDir, 'backups', 'projects');
  }

  async init() {
    await ensureDir(this.rootDir);
    await ensureDir(this.backupDir);
  }

  /** @param {string} id */
  fileFor(id) {
    if (!ID_PATTERN.test(id)) throw new Error(`Invalid project id '${id}'`);
    return path.join(this.rootDir, `${id}.json`);
  }

  async list() {
    const entries = await listDir(this.rootDir);
    /** @type {any[]} */
    const projects = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const project = await readJson(path.join(this.rootDir, entry.name));
        projects.push({
          id: project.id,
          name: project.name,
          updatedAt: project.updatedAt,
          createdAt: project.createdAt,
          target: project.target,
          counts: {
            assets: project.assets?.length ?? 0,
            items: project.items?.length ?? 0,
            outfits: project.outfits?.length ?? 0,
          },
        });
      } catch {
        /* ignore unreadable project files */
      }
    }
    projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return projects;
  }

  /**
   * @param {{ name:string, installationId:string, installationPath:string, moduleId:string, notes?:string }} input
   * @returns {Promise<WarbandProject>}
   */
  async create(input) {
    const base = slugify(input.name);
    let id = base;
    let counter = 1;
    while (await exists(this.fileFor(id))) {
      id = `${base}-${counter++}`;
    }
    const now = new Date().toISOString();
    /** @type {WarbandProject} */
    const project = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id,
      name: input.name.trim() || id,
      createdAt: now,
      updatedAt: now,
      target: {
        installationId: input.installationId,
        installationPath: input.installationPath,
        moduleId: input.moduleId,
      },
      assets: [],
      items: [],
      outfits: [],
      validation: { lastRunAt: null, summary: { errors: 0, warnings: 0, infos: 0 } },
      notes: input.notes ?? '',
    };
    await this.save(project, { backup: false });
    return project;
  }

  /**
   * @param {string} id
   * @returns {Promise<WarbandProject>}
   */
  async load(id) {
    const file = this.fileFor(id);
    const project = await readJson(file);
    if (project.schemaVersion !== PROJECT_SCHEMA_VERSION) {
      throw new Error(`Unsupported project schema ${project.schemaVersion}`);
    }
    if (project.id !== id) throw new Error('Project id does not match its file name');
    return project;
  }

  /**
   * @param {WarbandProject} project
   * @param {{ backup?: boolean }} [options]
   */
  async save(project, options = {}) {
    const file = this.fileFor(project.id);
    const backup = options.backup !== false;
    if (backup && (await exists(file))) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(this.backupDir, `${project.id}.${stamp}.json`);
      await copyFile(file, backupFile);
    }
    project.updatedAt = new Date().toISOString();
    await writeJsonAtomic(file, project);
    return project;
  }

  /**
   * @param {string} sourceFile
   * @param {string} destinationFile
   */
  async copyRaw(sourceFile, destinationFile) {
    await ensureDir(path.dirname(destinationFile));
    await copyFile(sourceFile, destinationFile);
  }

  /** @param {string} filePath @param {string} contents */
  async writeText(filePath, contents) {
    await ensureDir(path.dirname(filePath));
    await writeFile(filePath, contents, 'utf8');
  }

  /** @param {string} filePath */
  async readText(filePath) {
    return readFile(filePath, 'utf8');
  }
}
