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
import { ensureDir, exists, listDir, readJson, sha256File, statSafe, writeJsonAtomic } from '../util/fsx.js';
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
 * @property {any[]} meshes
 * @property {any[]} materials
 * @property {any[]} textures
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
      meshes: [],
      materials: [],
      textures: [],
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
    project.meshes = project.meshes ?? [];
    project.items = project.items ?? [];
    project.outfits = project.outfits ?? [];
    project.materials = project.materials ?? [];
    project.textures = project.textures ?? [];
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

  /* ---------------------------------------------------------------- */
  /* Mesh overrides (Phase 4)                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Save or replace a mesh override in a project.
   * @param {string} projectId
   * @param {any} override
   */
  async saveMeshOverride(projectId, override) {
    if (!override?.id || !override?.source?.mesh) {
      throw new Error('Override must contain id and source.mesh');
    }
    const project = await this.load(projectId);
    const index = project.meshes.findIndex((entry) => entry.id === override.id);
    if (index >= 0) project.meshes[index] = override;
    else project.meshes.push(override);
    project.updatedAt = new Date().toISOString();
    await this.save(project);
    return override;
  }

  /** @param {string} projectId */
  async listMeshOverrides(projectId) {
    const project = await this.load(projectId);
    return project.meshes.map((entry) => ({
      id: entry.id,
      source: entry.source,
      layout: entry.layout,
      editedAt: entry.editedAt,
      stats: entry.stats,
    }));
  }

  /**
   * @param {string} projectId
   * @param {string} meshId
   */
  async getMeshOverride(projectId, meshId) {
    const project = await this.load(projectId);
    const override = project.meshes.find((entry) => entry.id === meshId);
    if (!override) {
      const error = new Error(`Mesh override '${meshId}' was not found in project '${projectId}'.`);
      // @ts-expect-error machine-readable
      error.code = 'MESH_OVERRIDE_NOT_FOUND';
      throw error;
    }
    return override;
  }

  /**
   * @param {string} projectId
   * @param {string} meshId
   * @param {string} confirm Must equal the mesh id.
   */
  async removeMeshOverride(projectId, meshId, confirm) {
    if (confirm !== meshId) {
      const error = new Error('Confirmation required: pass the mesh id as confirm.');
      // @ts-expect-error machine-readable
      error.code = 'CONFIRMATION_REQUIRED';
      throw error;
    }
    const project = await this.load(projectId);
    const before = project.meshes.length;
    project.meshes = project.meshes.filter((entry) => entry.id !== meshId);
    if (project.meshes.length === before) {
      const error = new Error(`Mesh override '${meshId}' was not found.`);
      // @ts-expect-error machine-readable
      error.code = 'MESH_OVERRIDE_NOT_FOUND';
      throw error;
    }
    await this.save(project);
    return { removed: meshId };
  }

  /* ---------------------------------------------------------------- */
  /* Item overrides (Phase 7)                                          */
  /* ---------------------------------------------------------------- */

  /** @param {string} projectId @param {any} override */
  async saveItemOverride(projectId, override) {
    const project = await this.load(projectId);
    const index = project.items.findIndex((entry) => entry.id === override.id);
    if (index >= 0) project.items[index] = override;
    else project.items.push(override);
    await this.save(project);
    return override;
  }

  /** @param {string} projectId */
  async listItemOverrides(projectId) {
    const project = await this.load(projectId);
    return project.items.map((entry) => ({
      id: entry.id,
      baseItemId: entry.baseItemId ?? null,
      name: entry.fields?.name ?? entry.id,
      mode: entry.baseItemId ? 'edit' : 'create',
      moduleId: entry.moduleId,
      updatedAt: entry.updatedAt,
    }));
  }

  /** @param {string} projectId @param {string} itemId */
  async getItemOverride(projectId, itemId) {
    const project = await this.load(projectId);
    const override = project.items.find((entry) => entry.id === itemId);
    if (!override) {
      const error = new Error(`Item override '${itemId}' was not found.`);
      // @ts-expect-error machine-readable
      error.code = 'ITEM_OVERRIDE_NOT_FOUND';
      throw error;
    }
    return override;
  }

  /** @param {string} projectId @param {string} itemId @param {string} confirm */
  async removeItemOverride(projectId, itemId, confirm) {
    if (confirm !== itemId) {
      const error = new Error('Confirmation required: pass the item id as confirm.');
      // @ts-expect-error machine-readable
      error.code = 'CONFIRMATION_REQUIRED';
      throw error;
    }
    const project = await this.load(projectId);
    const before = project.items.length;
    project.items = project.items.filter((entry) => entry.id !== itemId);
    if (project.items.length === before) {
      const error = new Error(`Item override '${itemId}' was not found.`);
      // @ts-expect-error machine-readable
      error.code = 'ITEM_OVERRIDE_NOT_FOUND';
      throw error;
    }
    await this.save(project);
    return { removed: itemId };
  }

  /* ---------------------------------------------------------------- */
  /* Outfits (Phase 6)                                                 */
  /* ---------------------------------------------------------------- */

  /** @param {string} projectId @param {any} outfit */
  async saveOutfit(projectId, outfit) {
    const project = await this.load(projectId);
    const index = project.outfits.findIndex((entry) => entry.id === outfit.id);
    if (index >= 0) project.outfits[index] = outfit;
    else project.outfits.push(outfit);
    await this.save(project);
    return outfit;
  }

  /** @param {string} projectId */
  async listOutfits(projectId) {
    const project = await this.load(projectId);
    return project.outfits.map((entry) => ({
      id: entry.id,
      name: entry.name,
      moduleId: entry.moduleId,
      bodySkin: entry.bodySkin,
      entries: entry.entries,
      updatedAt: entry.updatedAt,
    }));
  }

  /** @param {string} projectId @param {string} outfitId */
  async getOutfit(projectId, outfitId) {
    const project = await this.load(projectId);
    const outfit = project.outfits.find((entry) => entry.id === outfitId);
    if (!outfit) {
      const error = new Error(`Outfit '${outfitId}' was not found.`);
      // @ts-expect-error machine-readable
      error.code = 'OUTFIT_NOT_FOUND';
      throw error;
    }
    return outfit;
  }

  /** @param {string} projectId @param {string} outfitId @param {string} confirm */
  async removeOutfit(projectId, outfitId, confirm) {
    if (confirm !== outfitId) {
      const error = new Error('Confirmation required: pass the outfit id as confirm.');
      // @ts-expect-error machine-readable
      error.code = 'CONFIRMATION_REQUIRED';
      throw error;
    }
    const project = await this.load(projectId);
    const before = project.outfits.length;
    project.outfits = project.outfits.filter((entry) => entry.id !== outfitId);
    if (project.outfits.length === before) {
      const error = new Error(`Outfit '${outfitId}' was not found.`);
      // @ts-expect-error machine-readable
      error.code = 'OUTFIT_NOT_FOUND';
      throw error;
    }
    await this.save(project);
    return { removed: outfitId };
  }

  /* ---------------------------------------------------------------- */
  /* Material & texture overrides (Phase 5)                            */
  /* ---------------------------------------------------------------- */

  /** @param {string} projectId @param {any} override */
  async saveMaterialOverride(projectId, override) {
    if (!override?.id || !override?.source?.material) {
      throw new Error('Material override must contain id and source.material');
    }
    const project = await this.load(projectId);
    const index = project.materials.findIndex((entry) => entry.id === override.id);
    if (index >= 0) project.materials[index] = override;
    else project.materials.push(override);
    await this.save(project);
    return override;
  }

  /** @param {string} projectId */
  async listMaterialOverrides(projectId) {
    const project = await this.load(projectId);
    return project.materials.map((entry) => ({
      id: entry.id,
      source: entry.source,
      editedAt: entry.editedAt,
      fields: entry.fields,
    }));
  }

  /** @param {string} projectId @param {string} materialId */
  async getMaterialOverride(projectId, materialId) {
    const project = await this.load(projectId);
    const override = project.materials.find((entry) => entry.id === materialId);
    if (!override) {
      const error = new Error(`Material override '${materialId}' was not found.`);
      // @ts-expect-error machine-readable
      error.code = 'MATERIAL_OVERRIDE_NOT_FOUND';
      throw error;
    }
    return override;
  }

  /** @param {string} projectId @param {string} materialId @param {string} confirm */
  async removeMaterialOverride(projectId, materialId, confirm) {
    if (confirm !== materialId) {
      const error = new Error('Confirmation required: pass the material id as confirm.');
      // @ts-expect-error machine-readable
      error.code = 'CONFIRMATION_REQUIRED';
      throw error;
    }
    const project = await this.load(projectId);
    const before = project.materials.length;
    project.materials = project.materials.filter((entry) => entry.id !== materialId);
    if (project.materials.length === before) {
      const error = new Error(`Material override '${materialId}' was not found.`);
      // @ts-expect-error machine-readable
      error.code = 'MATERIAL_OVERRIDE_NOT_FOUND';
      throw error;
    }
    await this.save(project);
    return { removed: materialId };
  }

  /** @param {string} projectId @param {any} texture */
  async saveTexture(projectId, texture) {
    if (!texture?.name || !texture?.workspaceId) {
      throw new Error('Texture must contain name and workspaceId');
    }
    const project = await this.load(projectId);
    const index = project.textures.findIndex((entry) => entry.name.toLowerCase() === texture.name.toLowerCase());
    if (index >= 0) project.textures[index] = texture;
    else project.textures.push(texture);
    await this.save(project);
    return texture;
  }

  /** @param {string} projectId */
  async listTextures(projectId) {
    const project = await this.load(projectId);
    return project.textures;
  }

  /** @param {string} projectId @param {string} name */
  async getTexture(projectId, name) {
    const project = await this.load(projectId);
    const texture = project.textures.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
    if (!texture) {
      const error = new Error(`Texture '${name}' is not registered in the project.`);
      // @ts-expect-error machine-readable
      error.code = 'PROJECT_TEXTURE_NOT_FOUND';
      throw error;
    }
    return texture;
  }

  /** @param {string} projectId @param {string} name @param {string} confirm */
  async removeTexture(projectId, name, confirm) {
    if (confirm !== name) {
      const error = new Error('Confirmation required: pass the texture name as confirm.');
      // @ts-expect-error machine-readable
      error.code = 'CONFIRMATION_REQUIRED';
      throw error;
    }
    const project = await this.load(projectId);
    const before = project.textures.length;
    project.textures = project.textures.filter(
      (entry) => entry.name.toLowerCase() !== name.toLowerCase(),
    );
    if (project.textures.length === before) {
      const error = new Error(`Texture '${name}' was not found.`);
      // @ts-expect-error machine-readable
      error.code = 'PROJECT_TEXTURE_NOT_FOUND';
      throw error;
    }
    await this.save(project);
    return { removed: name };
  }

  /**
   * @param {string} sourceFile
   * @param {string} destinationFile
   */  async copyRaw(sourceFile, destinationFile) {
    await ensureDir(path.dirname(destinationFile));
    await copyFile(sourceFile, destinationFile);
  }

  /** List every project backup with metadata and hash. */
  async listBackups() {
    const entries = await listDir(this.backupDir);
    /** @type {any[]} */
    const backups = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const filePath = path.join(this.backupDir, entry.name);
      try {
        const project = await readJson(filePath);
        const stat = await statSafe(filePath);
        backups.push({
          kind: 'project',
          id: project.id,
          name: project.name,
          updatedAt: project.updatedAt,
          target: project.target,
          path: filePath,
          bytes: stat?.size ?? 0,
          createdAt: stat ? new Date(stat.mtimeMs).toISOString() : null,
          sha256: await sha256File(filePath),
        });
      } catch {
        /* ignore corrupt backups, do not hide the rest */
      }
    }
    backups.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return backups;
  }

  /**
   * Restore a project backup over the live project, backing up the current
   * revision first.
   * @param {string} backupPath
   * @param {string} confirm Must equal the project id.
   */
  async restoreBackup(backupPath, confirm) {
    const root = path.resolve(this.backupDir);
    const source = path.resolve(backupPath);
    if (source !== root && !source.startsWith(root + path.sep)) {
      const error = new Error('Backup path is outside the project backup directory.');
      // @ts-expect-error machine-readable
      error.code = 'PATH_OUTSIDE_BACKUP';
      throw error;
    }

    const project = await readJson(source);
    if (project.schemaVersion !== PROJECT_SCHEMA_VERSION) {
      throw new Error(`Unsupported project schema ${project.schemaVersion}`);
    }
    if (project.id !== confirm) {
      const error = new Error('Confirmation required: pass the project id as confirm.');
      // @ts-expect-error machine-readable
      error.code = 'CONFIRMATION_REQUIRED';
      throw error;
    }

    const target = this.fileFor(project.id);
    let previousBackup = null;
    if (await exists(target)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      previousBackup = path.join(this.backupDir, `${project.id}.${stamp}.json`);
      await copyFile(target, previousBackup);
    }
    await writeJsonAtomic(target, project);
    return { project, restoredFrom: source, previousBackup };
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
