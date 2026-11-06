// @ts-check
/**
 * WARBand Engine — public facade.
 *
 * This layer knows about Mount & Blade: Warband and must stay UI-independent.
 * The HTTP server and any future CLI consume the same API.
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { listModules, findModule } from './modules/moduleRegistry.js';
import { detectInstallation, describeInstallation } from './installation/detect.js';
import { ProfileStore } from './installation/profileStore.js';
import { parseItemKindsFile } from './items/itemKinds.js';
import { decodeItemFlags, decodeCapabilities } from './items/itemFlags.js';
import { createBrfIndex } from './resources/brfIndex.js';
import { createTextureResolver } from './resources/textureResolver.js';
import { parseBrf, serializeBrf, updateMesh } from './resources/brf.js';
import { readMeshGeometry } from './resources/geometry.js';
import { resolveTextureDetails } from './resources/textureDetails.js';
import { WorkspaceStore } from './resources/workspace.js';
import { parseDdsFile } from './textures/dds.js';
import { resolveItemChain, validateItems } from './validation/validate.js';
import { ProjectStore } from './projects/projectStore.js';
import { resolveCaseInsensitive } from './util/fsx.js';

/**
 * @typedef {Object} ModuleData
 * @property {import('./modules/moduleRegistry.js').WarbandModule} module
 * @property {import('./items/itemKinds.js').ItemDocument} items
 * @property {Map<string, import('./items/itemKinds.js').ItemRecord>} itemsById
 * @property {any} brfIndex
 * @property {any} textures
 * @property {Map<string, any>} ddsCache
 * @property {number} buildMs
 */

/**
 * @param {any} array Typed array.
 */
function encodeTypedArray(array) {
  let type = 'Uint8Array';
  if (array instanceof Float32Array) type = 'Float32Array';
  else if (array instanceof Uint32Array) type = 'Uint32Array';
  else if (array instanceof Int32Array) type = 'Int32Array';
  return {
    type,
    count: array.length,
    data: Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString('base64'),
  };
}

/**
 * @param {any} entry MeshEntry from the BRF index.
 */
function summarizeMeshEntry(entry) {  return {
    name: entry.name,
    brf: entry.brf,
    material: entry.material,
    vertexVersion: entry.vertexVersion,
    vertexCount: entry.vertexCount,
    faceCount: entry.faceCount,
    frameCount: entry.frameCount,
    rigged: entry.rigged,
    lodLevel: entry.nameInfo.lodLevel,
    pieceIndex: entry.nameInfo.pieceIndex,
  };
}

export class WarbandEngine {
  /** @param {{ projectRoot: string, installationPath?: string, cache?: boolean }} options */
  constructor(options) {
    this.projectRoot = options.projectRoot;
    this.installationPath = options.installationPath;
    this.useCache = options.cache !== false;
    /** @type {import('./installation/detect.js').WarbandInstallation|null} */
    this.installation = null;
    /** @type {import('./modules/moduleRegistry.js').WarbandModule[]} */
    this.modules = [];
    /** @type {any[]} */
    this.candidates = [];
    /** @type {Map<string, Promise<ModuleData>>} */
    this.moduleData = new Map();
    this.projects = new ProjectStore({ rootDir: options.projectRoot });
    this.workspaces = new WorkspaceStore({ rootDir: options.projectRoot });
    this.profiles = new ProfileStore({ rootDir: options.projectRoot });
    this.initialized = false;
    this.initMs = 0;
  }

  async init() {
    const started = performance.now();
    await this.profiles.init();

    let active = this.profiles.active();
    if (!active) {
      const detection = await detectInstallation({
        projectRoot: this.projectRoot,
        explicitPath: this.installationPath,
      });
      this.candidates = detection.candidates;
      if (detection.installation) {
        const { profile } = await this.profiles.add(detection.installation.rootPath, 'Warband');
        await this.profiles.activate(profile.id);
        active = this.profiles.active();
      }
    } else {
      this.candidates = this.profiles.list().map((profile) => ({ path: profile.path, valid: profile.valid }));
    }

    if (active) {
      const installation = await describeInstallation(active.path);
      if (installation) {
        this.installation = installation;
        this.modules = await listModules(installation);
      } else {
        await this.profiles.validateAll();
        this.candidates = this.profiles.list().map((profile) => ({ path: profile.path, valid: profile.valid }));
      }
    }

    await this.projects.init();
    await this.workspaces.init();
    this.initMs = Math.round(performance.now() - started);
    this.initialized = true;
    return this;
  }

  /* ---------------------------------------------------------------- */
  /* Installation profiles                                             */
  /* ---------------------------------------------------------------- */

  getProfiles() {
    return {
      activeId: this.profiles.doc.activeId,
      profiles: this.profiles.list(),
    };
  }

  /** @param {{ path: string, label?: string }} input */
  async addProfile(input) {
    const result = await this.profiles.add(input.path, input.label ?? '');
    if (this.profiles.doc.activeId === result.profile.id) {
      await this.activateProfile(result.profile.id);
    }
    return { ...result, profiles: this.getProfiles() };
  }

  /** @param {string} id */
  async activateProfile(id) {
    const profile = await this.profiles.activate(id);
    const installation = await describeInstallation(profile.path);
    if (!installation) {
      // @ts-expect-error machine-readable
      const error = new Error(`Profile '${profile.label}' no longer points to a valid installation.`);
      error.code = 'INVALID_INSTALLATION';
      throw error;
    }
    this.installation = installation;
    this.modules = await listModules(installation);
    this.moduleData.clear();
    return { profile, installation, modules: this.modules.length };
  }

  /**
   * @param {string} id
   * @param {string} confirm
   */
  async removeProfile(id, confirm) {
    const result = await this.profiles.remove(id, confirm);
    const active = this.profiles.active();
    if (active) {
      const installation = await describeInstallation(active.path);
      this.installation = installation;
      this.modules = installation ? await listModules(installation) : [];
    } else {
      this.installation = null;
      this.modules = [];
    }
    this.moduleData.clear();
    return { ...result, profiles: this.getProfiles() };
  }

  async validateProfiles() {
    const profiles = await this.profiles.validateAll();
    const active = this.profiles.active();
    if (active) {
      const installation = await describeInstallation(active.path);
      this.installation = installation;
      this.modules = installation ? await listModules(installation) : [];
      this.moduleData.clear();
    }
    return { activeId: this.profiles.doc.activeId, profiles };
  }

  requireInstallation() {
    if (!this.installation) {
      const error = new Error('No Mount & Blade: Warband installation was detected.');
      // @ts-expect-error attach machine-readable code
      error.code = 'INSTALLATION_NOT_FOUND';
      // @ts-expect-error attach diagnostic payload
      error.details = { candidates: this.candidates };
      throw error;
    }
    return this.installation;
  }

  requireModule(moduleId) {
    this.requireInstallation();
    const module = findModule(this.modules, moduleId);
    if (!module) {
      const error = new Error(`Module '${moduleId}' was not found.`);
      // @ts-expect-error attach machine-readable code
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    }
    return module;
  }

  /**
   * Lazily parse items and build the BRF/texture index for one module.
   * Concurrent callers share the same promise.
   * @param {string} moduleId
   * @returns {Promise<ModuleData>}
   */
  getModuleData(moduleId) {
    const module = this.requireModule(moduleId);
    const existing = this.moduleData.get(module.id);
    if (existing) return existing;

    const promise = (async () => {
      const started = performance.now();
      const itemPath = await resolveCaseInsensitive(module.path, 'item_kinds1.txt');
      if (!itemPath) throw new Error(`Module '${module.id}' has no item_kinds1.txt (not a playable module?)`);

      const items = await parseItemKindsFile(itemPath);
      const brfIndex = await createBrfIndex({
        installation: /** @type {any} */ (this.installation),
        module,
        cacheDir: path.join(this.projectRoot, 'cache'),
        useCache: this.useCache,
      });
      const textures = await createTextureResolver(module.path, /** @type {any} */ (this.installation));

      return {
        module,
        items,
        itemsById: new Map(items.items.map((item) => [item.id.toLowerCase(), item])),
        brfIndex,
        textures,
        ddsCache: new Map(),
        buildMs: Math.round(performance.now() - started),
      };
    })();

    this.moduleData.set(module.id, promise);
    promise.catch(() => this.moduleData.delete(module.id));
    return promise;
  }

  /**
   * @param {string} moduleId
   * @param {{ slot?:string, category?:string, q?:string, wearable?:boolean, limit?:number, offset?:number }} [filter]
   */
  async listItems(moduleId, filter = {}) {
    const data = await this.getModuleData(moduleId);
    const needle = (filter.q ?? '').trim().toLowerCase();
    const wearablesOnly = filter.wearable !== false;
    const limit = Math.min(Math.max(Number(filter.limit ?? 100), 1), 1000);
    const offset = Math.max(Number(filter.offset ?? 0), 0);

    const matches = data.items.items.filter((item) => {
      if (wearablesOnly && !item.isArmor) return false;
      if (filter.slot && item.slot !== filter.slot) return false;
      if (filter.category && item.category !== filter.category) return false;
      if (needle && !item.id.toLowerCase().includes(needle) && !item.name.toLowerCase().includes(needle)) return false;
      return true;
    });

    return {
      total: matches.length,
      offset,
      limit,
      items: matches.slice(offset, offset + limit).map((item) => ({
        id: item.id,
        name: item.name,
        slot: item.slot,
        category: item.category,
        value: item.value,
        weight: item.weight,
        difficulty: item.difficulty,
        armor: { head: item.headArmor, body: item.bodyArmor, leg: item.legArmor },
        meshes: item.meshes.map((mesh) => mesh.name),
        line: item.line,
      })),
    };
  }

  /**
   * @param {string} moduleId
   * @param {string} itemId
   */
  async getItemDetail(moduleId, itemId) {
    const data = await this.getModuleData(moduleId);
    const item = data.itemsById.get(itemId.toLowerCase());
    if (!item) {
      const error = new Error(`Item '${itemId}' not found in module '${moduleId}'.`);
      // @ts-expect-error machine-readable code
      error.code = 'ITEM_NOT_FOUND';
      throw error;
    }
    const chain = await resolveItemChain({
      item,
      index: data.brfIndex,
      textures: data.textures,
      ddsCache: data.ddsCache,
      readDds: parseDdsFile,
    });
    return {
      item,
      chain,
      flags: decodeItemFlags(item.flags),
      capabilities: decodeCapabilities(item.capabilities),
    };
  }

  /**
   * Read the geometry of one mesh on demand.
   *
   * @param {string} moduleId
   * @param {string} meshName
   * @param {{ limits?: Partial<import('./resources/geometry.js').GeometryLimits> }} [options]
   */
  async getMeshGeometry(moduleId, meshName, options = {}) {
    const data = await this.getModuleData(moduleId);
    const resolution = data.brfIndex.resolveMesh(meshName);
    const entry = resolution.direct[0] ?? resolution.base[0] ?? resolution.pieces[0];
    if (!entry) {
      const error = new Error(`Mesh '${meshName}' was not found in module '${moduleId}'.`);
      // @ts-expect-error machine-readable code
      error.code = 'MESH_NOT_FOUND';
      throw error;
    }

    const source = await readFile(entry.brf);
    const geometry = readMeshGeometry(source, entry, {
      file: entry.brf,
      limits: options.limits,
    });
    return {
      mesh: {
        name: entry.name,
        brf: entry.brf,
        material: entry.material,
        flags: entry.flags,
        vertexVersion: entry.vertexVersion,
        vertexCount: entry.vertexCount,
        faceCount: entry.faceCount,
        rigged: entry.rigged,
        nameInfo: entry.nameInfo,
      },
      geometry,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Asset index (meshes / materials / textures / shaders)             */
  /* ---------------------------------------------------------------- */

  /** @param {string} moduleId @param {{ type?: string, q?: string, limit?: number, offset?: number }} [filter] */
  async listResources(moduleId, filter = {}) {
    const data = await this.getModuleData(moduleId);
    const type = filter.type ?? 'mesh';
    const needle = (filter.q ?? '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number(filter.limit ?? 100), 1), 500);
    const offset = Math.max(Number(filter.offset ?? 0), 0);

    /** @type {Array<{ key:string, name:string, entries:any[] }>} */
    let groups = [];
    if (type === 'mesh' || type === 'material' || type === 'texture') {
      const map = type === 'mesh' ? data.brfIndex.meshes : type === 'material' ? data.brfIndex.materials : data.brfIndex.textures;
      groups = [...map.entries()].map(([key, entries]) => ({
        key,
        name: entries[0].name,
        entries,
      }));
    } else if (type === 'shader') {
      groups = [...data.brfIndex.shaders.entries()].map(([key, files]) => ({
        key,
        name: key,
        entries: files.map((file) => ({ brf: file })),
      }));
    } else {
      const error = new Error(`Unknown resource type '${type}'.`);
      // @ts-expect-error machine-readable
      error.code = 'BAD_REQUEST';
      throw error;
    }

    if (needle) groups = groups.filter((group) => group.name.toLowerCase().includes(needle));
    groups.sort((a, b) => a.name.localeCompare(b.name));

    const page = groups.slice(offset, offset + limit).map((group) => {
      const sources = [...new Set(group.entries.map((entry) => entry.brf))];
      if (type === 'mesh') {
        const mesh = group.entries[0];
        return {
          name: mesh.name,
          base: mesh.nameInfo.base,
          lodLevel: mesh.nameInfo.lodLevel,
          pieceIndex: mesh.nameInfo.pieceIndex,
          material: mesh.material,
          vertexVersion: mesh.vertexVersion,
          vertexCount: mesh.vertexCount,
          faceCount: mesh.faceCount,
          rigged: mesh.rigged,
          sources,
        };
      }
      if (type === 'material') {
        const material = group.entries[0];
        return {
          name: material.name,
          shader: material.shader,
          diffuseA: material.diffuseA,
          bump: material.bump,
          sources,
        };
      }
      if (type === 'texture') {
        const texture = group.entries[0];
        const file = data.textures.resolve(texture.name);
        return {
          name: texture.name,
          frames: texture.frames,
          exists: file.exists,
          sources,
        };
      }
      return { name: group.name, sources };
    });

    return { type, total: groups.length, offset, limit, items: page };
  }

  /**
   * @param {string} moduleId
   * @param {string} type
   * @param {string} name
   */
  async getResourceDetail(moduleId, type, name) {
    const data = await this.getModuleData(moduleId);
    const context = { brfIndex: data.brfIndex, textures: data.textures, ddsCache: data.ddsCache };

    if (type === 'mesh') {
      const resolution = data.brfIndex.resolveMesh(name);
      if (!resolution.exists) {
        const error = new Error(`Mesh '${name}' was not found.`);
        // @ts-expect-error machine-readable
        error.code = 'MESH_NOT_FOUND';
        throw error;
      }
      const primary = resolution.direct[0] ?? resolution.base[0] ?? resolution.pieces[0];
      const materialEntries = data.brfIndex.resolveMaterial(primary.material);
      const material = materialEntries[0] ?? null;
      const textures = {};
      if (material) {
        for (const role of ['diffuseA', 'diffuseB', 'bump', 'enviro', 'spec']) {
          const value = material[role];
          if (value && value !== 'none') textures[role] = await resolveTextureDetails(context, value);
        }
      }
      const base = resolution.info.base.toLowerCase();
      const usedByItems = data.items.items
        .filter((item) => item.meshes.some((ref) => {
          const lower = ref.name.toLowerCase();
          return lower === base || lower.startsWith(`${base}.`);
        }))
        .slice(0, 100)
        .map((item) => ({ id: item.id, name: item.name, slot: item.slot }));

      return {
        type,
        name,
        detail: {
          family: {
            base: resolution.base.map(summarizeMeshEntry),
            lods: resolution.lods.map(summarizeMeshEntry),
            pieces: resolution.pieces.map(summarizeMeshEntry),
          },
          primary: summarizeMeshEntry(primary),
          material: material
            ? {
                name: material.name,
                shader: material.shader,
                flags: material.flags,
                specular: material.specular,
                color: [material.r, material.g, material.b],
                brf: material.brf,
              }
            : null,
          textures,
          usedByItems,
        },
      };
    }

    if (type === 'material') {
      const entries = data.brfIndex.resolveMaterial(name);
      if (entries.length === 0) {
        const error = new Error(`Material '${name}' was not found.`);
        // @ts-expect-error machine-readable
        error.code = 'MATERIAL_NOT_FOUND';
        throw error;
      }
      const material = entries[0];
      const textures = {};
      for (const role of ['diffuseA', 'diffuseB', 'bump', 'enviro', 'spec']) {
        const value = material[role];
        if (value && value !== 'none') textures[role] = await resolveTextureDetails(context, value);
      }
      const meshes = [];
      for (const list of data.brfIndex.meshes.values()) {
        for (const mesh of list) {
          if (mesh.material.toLowerCase() === name.toLowerCase()) meshes.push(summarizeMeshEntry(mesh));
        }
      }
      return {
        type,
        name,
        detail: {
          material: {
            name: material.name,
            shader: material.shader,
            flags: material.flags,
            specular: material.specular,
            color: [material.r, material.g, material.b],
            brf: material.brf,
            sources: [...new Set(entries.map((entry) => entry.brf))],
          },
          textures,
          meshes: meshes.slice(0, 200),
        },
      };
    }

    if (type === 'texture') {
      const details = await resolveTextureDetails(context, name);
      if (!details.declared && !details.file.exists) {
        const error = new Error(`Texture '${name}' was not found.`);
        // @ts-expect-error machine-readable
        error.code = 'TEXTURE_NOT_FOUND';
        throw error;
      }
      const base = name.replace(/\.dds$/i, '').toLowerCase();
      const materials = [];
      for (const list of data.brfIndex.materials.values()) {
        for (const material of list) {
          const referenced = ['diffuseA', 'diffuseB', 'bump', 'enviro', 'spec'].some(
            (role) => String(material[role]).replace(/\.dds$/i, '').toLowerCase() === base,
          );
          if (referenced) {
            materials.push({ name: material.name, shader: material.shader, brf: material.brf });
          }
        }
      }
      return { type, name, detail: { ...details, materials: materials.slice(0, 200) } };
    }

    if (type === 'shader') {
      const files = data.brfIndex.shaders.get(name.toLowerCase());
      if (!files) {
        const error = new Error(`Shader '${name}' was not found.`);
        // @ts-expect-error machine-readable
        error.code = 'SHADER_NOT_FOUND';
        throw error;
      }
      const materials = [];
      for (const list of data.brfIndex.materials.values()) {
        for (const material of list) {
          if (material.shader.toLowerCase() === name.toLowerCase()) {
            materials.push({ name: material.name, brf: material.brf });
          }
        }
      }
      return { type, name, detail: { sources: [...new Set(files)], materials: materials.slice(0, 200) } };
    }

    const error = new Error(`Unknown resource type '${type}'.`);
    // @ts-expect-error machine-readable
    error.code = 'BAD_REQUEST';
    throw error;
  }

  /**
   * Render-ready mesh data for the viewport. Positions/normals/UVs are
   * expanded per vertex (BRF faces index the vertex list; each vertex stores an
   * index into the position array). Arrays are base64-encoded typed arrays.
   *
   * @param {string} moduleId
   * @param {string} meshName
   * @param {{ limits?: Partial<import('./resources/geometry.js').GeometryLimits> }} [options]
   */
  async getMeshRenderData(moduleId, meshName, options = {}) {
    const { mesh, geometry } = await this.getMeshGeometry(moduleId, meshName, options);
    const count = geometry.vertexCount;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);

    for (let v = 0; v < count; v += 1) {
      const positionIndex = geometry.vertices.index[v];
      if (positionIndex < 0 || positionIndex >= geometry.positionCount) {
        throw new Error(`Mesh '${meshName}' vertex ${v} references position ${positionIndex}`);
      }
      positions[v * 3] = geometry.positions[positionIndex * 3];
      positions[v * 3 + 1] = geometry.positions[positionIndex * 3 + 1];
      positions[v * 3 + 2] = geometry.positions[positionIndex * 3 + 2];
      normals[v * 3] = geometry.vertices.normal[v * 3];
      normals[v * 3 + 1] = geometry.vertices.normal[v * 3 + 1];
      normals[v * 3 + 2] = geometry.vertices.normal[v * 3 + 2];
      uvs[v * 2] = geometry.vertices.uv[v * 2];
      uvs[v * 2 + 1] = geometry.vertices.uv[v * 2 + 1];
    }

    return {
      mesh,
      layout: geometry.layout,
      uvFlip: 'v', // OpenBRF flips V for GL/Warband display
      bbox: geometry.bbox,
      counts: { vertices: count, faces: geometry.faceCount, positions: geometry.positionCount },
      arrays: {
        positions: encodeTypedArray(positions),
        normals: encodeTypedArray(normals),
        uvs: encodeTypedArray(uvs),
        indices: encodeTypedArray(geometry.faces),
      },
    };
  }

  /**
   * Raw texture bytes for the viewport (DDS decoded client-side).
   * @param {string} moduleId
   * @param {string} name
   */
  async getTextureFile(moduleId, name) {
    const installation = this.requireInstallation();
    const data = await this.getModuleData(moduleId);
    const hit = data.textures.resolve(name);
    if (!hit.exists || !hit.filePath) {
      const error = new Error(`Texture '${name}' was not found on disk.`);
      // @ts-expect-error machine-readable
      error.code = 'TEXTURE_NOT_FOUND';
      throw error;
    }
    const root = path.resolve(installation.rootPath);
    const file = path.resolve(hit.filePath);
    if (file !== root && !file.startsWith(root + path.sep)) {
      const error = new Error('Texture path must be inside the Warband installation.');
      // @ts-expect-error machine-readable
      error.code = 'PATH_OUTSIDE_INSTALLATION';
      throw error;
    }
    const buffer = await readFile(file);
    return { buffer, filePath: file, fileName: path.basename(file), name: hit.name };
  }

  /* ---------------------------------------------------------------- */
  /* Workspaces (the only write target)                                */
  /* ---------------------------------------------------------------- */

  /** @param {string} label @param {{ reuse?: boolean, moduleId?: string }} [options] */
  async createWorkspace(label, options = {}) {
    this.requireInstallation();
    if (options.reuse) return this.workspaces.ensure(label);
    return this.workspaces.create({ label, moduleId: options.moduleId });
  }

  /** @param {string} id @param {string} confirm */
  async removeWorkspace(id, confirm) {
    return this.workspaces.remove(id, confirm);
  }

  async listWorkspaces() {
    return this.workspaces.list();
  }

  /* ---------------------------------------------------------------- */
  /* Backups (project + workspace)                                     */
  /* ---------------------------------------------------------------- */

  async listBackups() {
    const [projects, workspaces] = await Promise.all([
      this.projects.listBackups(),
      this.workspaces.listBackups(),
    ]);
    return { projects, workspaces };
  }

  /**
   * @param {string} backupPath
   * @param {string} confirm
   */
  async restoreProjectBackup(backupPath, confirm) {
    return this.projects.restoreBackup(backupPath, confirm);
  }

  /**
   * @param {string} workspaceId
   * @param {string} backupPath
   * @param {string} confirm
   */
  async restoreWorkspaceBackup(workspaceId, backupPath, confirm) {
    return this.workspaces.restoreBackup(workspaceId, backupPath, confirm);
  }

  /**
   * Locate a BRF by file name in `CommonRes` or the module `Resource` folder.
   * @param {string} moduleId
   * @param {string} fileName
   */
  async findBrf(moduleId, fileName) {
    const installation = this.requireInstallation();
    const module = this.requireModule(moduleId);
    const base = path.basename(fileName);
    const candidates = [
      installation.commonResDir,
      path.join(module.path, 'Resource'),
    ].filter(Boolean);
    for (const directory of candidates) {
      const found = await resolveCaseInsensitive(/** @type {string} */ (directory), base);
      if (found) return found;
    }
    const error = new Error(`BRF '${fileName}' was not found in CommonRes or module '${moduleId}'.`);
    // @ts-expect-error machine-readable code
    error.code = 'BRF_NOT_FOUND';
    throw error;
  }

  /**
   * Serialize a BRF into a workspace, optionally patching mesh materials.
   * The installation is only read; every byte written goes to `workspace/`.
   *
   * @param {string} workspaceId
   * @param {string} brfPath
   * @param {{ relativePath?: string, meshPatches?: Array<{mesh:string, material?:string, flags?:number}> }} [options]
   */
  async exportBrf(workspaceId, brfPath, options = {}) {
    const installation = this.requireInstallation();
    const absolute = path.resolve(brfPath);
    const root = path.resolve(installation.rootPath);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      const error = new Error('BRF source must be inside the Warband installation');
      // @ts-expect-error machine-readable code
      error.code = 'PATH_OUTSIDE_INSTALLATION';
      throw error;
    }

    const source = await readFile(absolute);
    const doc = parseBrf(source, { file: absolute });

    for (const patch of options.meshPatches ?? []) {
      const mesh = doc.meshes.find((candidate) => candidate.name === patch.mesh);
      if (!mesh) {
        const error = new Error(`Mesh '${patch.mesh}' not found in ${path.basename(absolute)}.`);
        // @ts-expect-error machine-readable code
        error.code = 'MESH_NOT_FOUND';
        throw error;
      }
      updateMesh(doc, mesh, { material: patch.material, flags: patch.flags }, source);
    }

    const relativePath = options.relativePath ?? path.basename(absolute);
    const buffer = serializeBrf(doc, source);
    const result = await this.workspaces.writeFile(workspaceId, relativePath, buffer);
    return {
      ...result,
      sourceBrf: absolute,
      relativePath,
      meshes: doc.meshes.length,
      materials: doc.materials.length,
      patchedMeshes: (options.meshPatches ?? []).length,
      serializedBytes: buffer.length,
    };
  }

  /**
   * @param {string} moduleId
   * @param {string[]} ids
   */
  async validate(moduleId, ids) {
    const data = await this.getModuleData(moduleId);
    const result = await validateItems({
      items: data.items.items,
      index: data.brfIndex,
      textures: data.textures,
      ids,
      ddsCache: data.ddsCache,
      readDds: parseDdsFile,
    });
    return result;
  }

  /**
   * @param {string} moduleId
   */
  async getModuleSummary(moduleId) {
    const data = await this.getModuleData(moduleId);
    const bySlot = {};
    const byCategory = {};
    for (const item of data.items.items) {
      bySlot[item.slot] = (bySlot[item.slot] ?? 0) + 1;
      byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
    }
    return {
      module: {
        id: data.module.id,
        name: data.module.moduleName,
        version: data.module.version,
        operationSetVersion: data.module.operationSetVersion,
        capabilities: data.module.capabilities,
        unknownIniKeys: data.module.unknownKeys,
      },
      items: {
        total: data.items.items.length,
        armor: data.items.items.filter((item) => item.isArmor).length,
        declared: data.items.declaredCount,
        bySlot,
        byCategory,
      },
      resources: data.brfIndex.stats,
      textures: { indexed: data.textures.size },
      timing: { buildMs: data.buildMs },
      counts: data.brfIndex.files.length,
    };
  }

  getStatus() {
    const installation = this.installation;
    return {
      ok: Boolean(installation),
      engine: 'warband-engine',
      initialized: this.initialized,
      initMs: this.initMs,
      installation: installation
        ? {
            id: installation.id,
            rootPath: installation.rootPath,
            executablePath: installation.executablePath,
            version: installation.version,
            versionSource: installation.versionSource,
            moduleCount: installation.moduleCount,
            commonResDir: installation.commonResDir,
            diagnostics: installation.diagnostics,
          }
        : null,
      candidates: this.candidates,
      profiles: this.getProfiles(),
      modules: this.modules.map((module) => ({
        id: module.id,
        slug: module.slug,
        name: module.moduleName,
        version: module.version,
        operationSetVersion: module.operationSetVersion,
        capabilities: module.capabilities,
        unknownIniKeys: module.unknownKeys,
      })),
      projects: { root: path.join(this.projectRoot, 'projects') },
    };
  }

  /** Forget parsed module data (files changed on disk). */
  refresh(moduleId) {
    if (moduleId) this.moduleData.delete(this.requireModule(moduleId).id);
    else this.moduleData.clear();
  }
}

/**
 * @param {{ projectRoot: string, installationPath?: string, cache?: boolean }} options
 */
export async function createEngine(options) {
  const engine = new WarbandEngine(options);
  await engine.init();
  return engine;
}
