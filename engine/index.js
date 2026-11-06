// @ts-check
/**
 * WARBand Engine — public facade.
 *
 * This layer knows about Mount & Blade: Warband and must stay UI-independent.
 * The HTTP server and any future CLI consume the same API.
 */

import path from 'node:path';
import { readFile, cp, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { listModules, findModule } from './modules/moduleRegistry.js';
import { detectInstallation, describeInstallation } from './installation/detect.js';
import { ProfileStore } from './installation/profileStore.js';
import { parseSkinsFile } from './skins/skins.js';
import { analyzeOutfitClipping } from './outfit/clipping.js';
import { parseItemKindsFile, renderItemHeader, serializeItemDocument } from './items/itemKinds.js';
import { decodeItemFlags, decodeCapabilities, getItemSchema } from './items/itemFlags.js';
import { createBrfIndex } from './resources/brfIndex.js';
import { createTextureResolver } from './resources/textureResolver.js';
import { parseBrf, serializeBrf, updateMesh } from './resources/brf.js';
import { readMeshGeometry } from './resources/geometry.js';
import { resolveTextureDetails } from './resources/textureDetails.js';
import { applyOverride, buildGeometryFromOverride } from './resources/meshOverride.js';
import {
  applyMaterialOverrideToBrf, referencedTextures, validateMaterialOverride,
} from './resources/materialOverride.js';
import { parseDds, parseDdsFile } from './textures/dds.js';
import { WorkspaceStore } from './resources/workspace.js';
import { resolveItemChain, validateItems } from './validation/validate.js';
import { ProjectStore } from './projects/projectStore.js';
import { exists, resolveCaseInsensitive } from './util/fsx.js';

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
 * Multiply two row-major 4x4 matrices.
 * @param {Float64Array} a
 * @param {Float64Array} b
 */
function multiplyMatrices(a, b) {
  const out = new Float64Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      let value = 0;
      for (let k = 0; k < 4; k += 1) value += a[row * 4 + k] * b[k * 4 + col];
      out[row * 4 + col] = value;
    }
  }
  return out;
}

/** @param {any} bone */
function boneLocalMatrix(bone) {
  return new Float64Array([
    bone.x[0], bone.y[0], bone.z[0], bone.t[0],
    bone.x[1], bone.y[1], bone.z[1], bone.t[1],
    bone.x[2], bone.y[2], bone.z[2], bone.t[2],
    0, 0, 0, 1,
  ]);
}

/** @param {Buffer} buffer */
function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

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

const ITEM_TEXT_FIELDS = ['name', 'plural'];
const ITEM_STAT_FIELDS = [
  'flags', 'value', 'modifierBits', 'weight', 'abundance', 'headArmor',
  'bodyArmor', 'legArmor', 'difficulty', 'hitPoints', 'speedRating',
  'missileSpeed', 'weaponLength', 'maxAmmo', 'thrustDamage', 'swingDamage',
];

/** @param {any} base @param {any} override */
function mergeItemOverride(base, override) {
  const fields = override.fields ?? {};
  const factions = Array.isArray(override.factions)
    ? override.factions
    : [...(base?.factions ?? [])];
  const triggers = Array.isArray(override.triggers)
    ? override.triggers
    : [...(base?.triggers ?? [])];
  const merged = {
    ...(base ?? {}),
    ...fields,
    id: override.id,
    capabilities: String(fields.capabilities ?? base?.capabilities ?? '0'),
    meshes: (override.meshes ?? []).map((mesh) => ({
      name: mesh.name,
      modifierBits: Number(mesh.modifierBits ?? 0),
    })),
    factions: factions.map(Number),
    triggers: triggers.map(String),
    raw: base
      ? { ...base.raw }
      : {
        header: '',
        factionsCount: String(factions.length),
        factionIds: factions.join(' '),
        triggersCount: String(triggers.length),
        triggers: triggers.map(String),
        separator: '',
      },
  };
  if (!base) merged.raw.header = renderItemHeader(merged);
  if (base) {
    if (Array.isArray(override.factions)) {
      merged.raw.factionsCount = String(merged.factions.length);
      merged.raw.factionIds = merged.factions.join(' ');
    }
    if (Array.isArray(override.triggers)) {
      merged.raw.triggersCount = String(merged.triggers.length);
      merged.raw.triggers = merged.triggers;
    }
  }
  return merged;
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
    /** @type {Map<string, {bones:Map<string,Float64Array>, applied:number}>} */
    this.skeletonMatrixCache = new Map();
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

  /** Symbol table for the item editor. */
  getItemSchema() {
    return getItemSchema();
  }

  /**
   * Full editable item record plus decoded flags/capabilities.
   * @param {string} moduleId
   * @param {string} itemId
   */
  async getItemEditable(moduleId, itemId) {
    const data = await this.getModuleData(moduleId);
    const item = data.itemsById.get(itemId.toLowerCase());
    if (!item) {
      const error = new Error(`Item '${itemId}' was not found.`);
      // @ts-expect-error machine-readable
      error.code = 'ITEM_NOT_FOUND';
      throw error;
    }
    return {
      item: {
        ...item,
        meshes: item.meshes.map((mesh) => ({ ...mesh })),
        factions: [...item.factions],
        triggers: [...item.triggers],
      },
      flags: decodeItemFlags(item.flags),
      capabilities: decodeCapabilities(item.capabilities),
    };
  }

  /**
   * @param {string} moduleId
   * @param {any} override
   * @param {string} [projectId]
   */
  async validateItemOverride(moduleId, override, projectId) {
    /** @type {string[]} */
    const issues = [];
    const data = await this.getModuleData(moduleId);
    const id = typeof override?.id === 'string' ? override.id.trim() : '';
    const baseId = typeof override?.baseItemId === 'string' && override.baseItemId
      ? override.baseItemId.toLowerCase()
      : null;
    const base = baseId ? data.itemsById.get(baseId) : null;

    if (!/^itm_[a-z0-9_]+$/.test(id)) {
      issues.push('id must match ^itm_[a-z0-9_]+$');
    }
    if (baseId && !base) issues.push(`base item '${override.baseItemId}' does not exist`);
    if (base && id !== base.id) issues.push('an existing item id cannot be changed');
    if (!base && data.itemsById.has(id.toLowerCase())) {
      issues.push(`item '${id}' already exists in the module`);
    }

    if (projectId) {
      try {
        const project = await this.projects.load(projectId);
        for (const other of project.items) {
          if (other.id === id && (other.baseItemId ?? null) !== baseId) {
            issues.push(`another project override already uses id '${id}'`);
          }
          if (baseId && other.baseItemId === baseId && other.id !== id) {
            issues.push(`another project override already edits '${baseId}'`);
          }
        }
      } catch (error) {
        issues.push(`cannot read project: ${error.message}`);
      }
    }

    const fields = override?.fields ?? {};
    for (const key of ITEM_TEXT_FIELDS) {
      const value = fields[key];
      if (typeof value !== 'string' || !value.trim() || /\s/.test(value)) {
        issues.push(`${key} must be a non-empty token without whitespace`);
      }
    }
    for (const key of ITEM_STAT_FIELDS) {
      const value = Number(fields[key]);
      if (!Number.isFinite(value)) issues.push(`${key} must be numeric`);
      if (['flags', 'value', 'modifierBits', 'abundance', 'headArmor', 'bodyArmor',
        'legArmor', 'difficulty', 'hitPoints', 'maxAmmo', 'thrustDamage', 'swingDamage'].includes(key)
        && Number.isFinite(value) && value < 0) {
        issues.push(`${key} must be non-negative`);
      }
      if (['flags', 'value', 'modifierBits', 'abundance', 'headArmor', 'bodyArmor',
        'legArmor', 'difficulty', 'hitPoints', 'maxAmmo', 'thrustDamage', 'swingDamage'].includes(key)
        && Number.isFinite(value) && !Number.isInteger(value)) {
        issues.push(`${key} must be an integer`);
      }
    }
    if (Number(fields.flags) > 0xFFFFFFFF) issues.push('flags must fit in 32 bits');
    const types = new Set(getItemSchema().types.map((entry) => Number(entry.value)));
    if (!types.has(Number(fields.flags) & 0x1F)) issues.push('flags has an unknown item type');

    if (!/^(0|[1-9][0-9]*)$/.test(String(fields.capabilities ?? ''))) {
      issues.push('capabilities must be a non-negative decimal string');
    } else {
      try {
        const capabilities = BigInt(fields.capabilities);
        if (capabilities > 0xFFFFFFFFFFFFFFFFn) issues.push('capabilities must fit in 64 bits');
      } catch {
        issues.push('capabilities must be a non-negative decimal string');
      }
    }

    if (!Array.isArray(override?.meshes)) {
      issues.push('meshes must be an array');
    } else {
      if (override.meshes.length > 64) issues.push('at most 64 meshes are supported');
      for (const mesh of override.meshes) {
        if (!mesh || typeof mesh.name !== 'string' || !mesh.name || /\s/.test(mesh.name)) {
          issues.push('mesh names must be non-empty tokens without whitespace');
          continue;
        }
        if (!Number.isInteger(Number(mesh.modifierBits)) || Number(mesh.modifierBits) < 0) {
          issues.push(`mesh '${mesh.name}' modifierBits must be a non-negative integer`);
        }
        const resolution = data.brfIndex.resolveMesh(mesh.name);
        if (resolution.direct.length === 0 && resolution.base.length === 0 && resolution.pieces.length === 0) {
          issues.push(`mesh '${mesh.name}' does not exist in the module`);
        }
      }
    }

    if (override?.factions !== undefined) {
      if (!Array.isArray(override.factions) || override.factions.some((value) => !Number.isInteger(Number(value)) || Number(value) < 0)) {
        issues.push('factions must be an array of non-negative integers');
      }
    }
    if (override?.triggers !== undefined) {
      if (!Array.isArray(override.triggers) || override.triggers.some((value) => typeof value !== 'string' || value.includes('\n'))) {
        issues.push('triggers must be an array of single-line strings');
      }
    }

    return issues;
  }

  /** @param {string} projectId @param {any} override */
  async saveItemOverride(projectId, override) {
    const moduleId = override?.moduleId ?? (await this.projects.load(projectId)).target.moduleId;
    const issues = await this.validateItemOverride(moduleId, override, projectId);
    if (issues.length > 0) {
      const error = new Error(`Item override is invalid: ${issues.join('; ')}`);
      // @ts-expect-error machine-readable
      error.code = 'INVALID_ITEM';
      throw error;
    }
    const saved = {
      ...override,
      moduleId,
      updatedAt: new Date().toISOString(),
    };
    return this.projects.saveItemOverride(projectId, saved);
  }

  /** @param {string} projectId */
  async listItemOverrides(projectId) {
    return this.projects.listItemOverrides(projectId);
  }

  /** @param {string} projectId @param {string} itemId */
  async getItemOverride(projectId, itemId) {
    return this.projects.getItemOverride(projectId, itemId);
  }

  /** @param {string} projectId @param {string} itemId @param {string} confirm */
  async removeItemOverride(projectId, itemId, confirm) {
    return this.projects.removeItemOverride(projectId, itemId, confirm);
  }

  /**
   * Merge every project item override into `item_kinds1.txt` and write a
   * workspace copy. The game installation is never modified.
   * @param {string} projectId
   * @param {{ workspaceLabel?: string }} [options]
   */
  async buildItemOverridesArtifact(projectId) {
    const project = await this.projects.load(projectId);
    if (!project.items.length) {
      const error = new Error('The project has no item overrides.');
      // @ts-expect-error machine-readable
      error.code = 'NO_ITEM_OVERRIDES';
      throw error;
    }
    const moduleId = project.items[0]?.moduleId ?? project.target.moduleId;
    const data = await this.getModuleData(moduleId);
    for (const override of project.items) {
      const issues = await this.validateItemOverride(moduleId, override);
      if (issues.length > 0) {
        const error = new Error(`Cannot export invalid override '${override.id}': ${issues.join('; ')}`);
        // @ts-expect-error machine-readable
        error.code = 'INVALID_ITEM';
        throw error;
      }
    }

    const byBase = new Map();
    const created = [];
    for (const override of project.items) {
      if (override.baseItemId) byBase.set(override.baseItemId.toLowerCase(), override);
      else created.push(override);
    }
    const items = data.items.items.map((base) => {
      const override = byBase.get(base.id.toLowerCase());
      return override ? mergeItemOverride(base, override) : base;
    });
    for (const override of created) items.push(mergeItemOverride(null, override));
    const rerender = new Set(project.items.map((override) => override.id));
    const text = serializeItemDocument({ ...data.items, items }, {
      rerender: (item) => rerender.has(item.id),
    });
    return { moduleId, text, items: items.length, overrides: project.items.length };
  }

  async exportItemOverrides(projectId, options = {}) {
    const artifact = await this.buildItemOverridesArtifact(projectId);
    const workspace = await this.createWorkspace(options.workspaceLabel ?? 'item-edits', {
      reuse: true,
      moduleId: artifact.moduleId,
    });
    const result = await this.workspaces.writeFile(workspace.id, 'item_kinds1.txt', artifact.text);
    return {
      ...result,
      workspaceId: workspace.id,
      items: artifact.items,
      overrides: artifact.overrides,
    };
  }

  /**
   * Build a project into a workspace overlay (or a full module copy).
   *
   * The game installation is only read. Overlay mode writes changed assets at
   * their in-module paths plus a manifest; a full copy first mirrors the whole
   * module, then applies the same overlay, producing a deployable module tree
   * inside the workspace.
   *
   * @param {string} projectId
   * @param {{ copyModule?: boolean, label?: string }} [options]
   */
  async buildProject(projectId, options = {}) {
    const project = await this.projects.load(projectId);
    const moduleId = project.target.moduleId;
    const module = this.requireModule(moduleId);
    await this.getModuleData(moduleId);
    const moduleRoot = `Modules/${path.basename(module.path)}`;
    const copyModule = Boolean(options.copyModule);

    /** @type {Array<{kind:string, source:string, target:string, buffer:Buffer, sha256?:string}>} */
    const artifacts = [];
    /** @type {string[]} */
    const errors = [];
    /** @type {string[]} */
    const warnings = [];

    const installationRoot = path.resolve(this.requireInstallation().rootPath);
    const meshGroups = new Map();
    for (const override of project.meshes) {
      const sourcePath = path.resolve(override.source.brf);
      const key = sourcePath.toLowerCase();
      if (!meshGroups.has(key)) meshGroups.set(key, { sourcePath, overrides: [] });
      meshGroups.get(key).overrides.push(override);
    }
    for (const group of meshGroups.values()) {
      try {
        if (group.sourcePath !== installationRoot && !group.sourcePath.startsWith(installationRoot + path.sep)) {
          throw new Error('BRF source is outside the installation');
        }
        const source = await readFile(group.sourcePath);
        let buffer = source;
        const meshes = [];
        for (const override of group.overrides) {
          const result = applyOverride(buffer, override, { file: group.sourcePath });
          buffer = result.buffer;
          meshes.push(result.mesh.name);
        }
        artifacts.push({
          kind: 'mesh',
          source: path.relative(installationRoot, group.sourcePath).replace(/\\/g, '/'),
          target: `${moduleRoot}/Resource/${path.basename(group.sourcePath)}`,
          buffer,
        });
      } catch (error) {
        errors.push(`mesh group '${group.overrides.map((override) => override.id).join(', ')}': ${error.message}`);
      }
    }

    const materialGroups = new Map();
    for (const override of project.materials) {
      const sourcePath = path.resolve(override.source.brf);
      const key = sourcePath.toLowerCase();
      if (!materialGroups.has(key)) materialGroups.set(key, { sourcePath, overrides: [] });
      materialGroups.get(key).overrides.push(override);
    }
    const data = await this.getModuleData(moduleId);
    for (const group of materialGroups.values()) {
      try {
        if (group.sourcePath !== installationRoot && !group.sourcePath.startsWith(installationRoot + path.sep)) {
          throw new Error('BRF source is outside the installation');
        }
        const source = await readFile(group.sourcePath);
        let buffer = source;
        for (const override of group.overrides) {
          buffer = applyMaterialOverrideToBrf(buffer, override, { file: group.sourcePath }).buffer;
        }
        artifacts.push({
          kind: 'material',
          source: path.relative(installationRoot, group.sourcePath).replace(/\\/g, '/'),
          target: `${moduleRoot}/Resource/${path.basename(group.sourcePath)}`,
          buffer,
        });
        for (const override of group.overrides) {
          for (const textureName of referencedTextures(override.fields)) {
            const normalized = textureName.toLowerCase().endsWith('.dds') ? textureName : `${textureName}.dds`;
            const projectTexture = project.textures.find(
              (entry) => entry.name.toLowerCase() === normalized.toLowerCase(),
            );
            let textureBuffer;
            let sourceKind;
            if (projectTexture) {
              textureBuffer = await this.workspaces.readFile(projectTexture.workspaceId, projectTexture.path);
              sourceKind = 'project';
            } else {
              const hit = data.textures.resolve(textureName);
              if (!hit.exists || !hit.filePath) {
                throw new Error(`texture '${textureName}' was not found`);
              }
              textureBuffer = await readFile(hit.filePath);
              sourceKind = 'game';
            }
            artifacts.push({
              kind: 'texture',
              source: sourceKind,
              target: `${moduleRoot}/Textures/${normalized}`,
              buffer: textureBuffer,
            });
          }
        }
      } catch (error) {
        errors.push(`material group '${group.overrides.map((override) => override.id).join(', ')}': ${error.message}`);
      }
    }

    if (project.items.length > 0) {
      try {
        const artifact = await this.buildItemOverridesArtifact(projectId);
        artifacts.push({
          kind: 'items',
          source: `${moduleRoot}/item_kinds1.txt`,
          target: `${moduleRoot}/item_kinds1.txt`,
          buffer: Buffer.from(artifact.text, 'utf8'),
        });
      } catch (error) {
        errors.push(`items: ${error.message}`);
      }
    }

    // Ensure the module loads every changed BRF by basename. This is needed
    // when a CommonRes pack is overridden inside the module Resource folder.
    const requiredResources = new Set(
      artifacts
        .filter((artifact) => artifact.kind === 'mesh' || artifact.kind === 'material')
        .map((artifact) => path.basename(artifact.target).replace(/\.brf$/i, '').toLowerCase()),
    );
    const loadedResources = new Set(
      [...(module.commonResources ?? []), ...(module.moduleResources ?? [])]
        .map((name) => String(name).replace(/\.brf$/i, '').toLowerCase()),
    );
    const missingResources = [...requiredResources].filter((name) => !loadedResources.has(name));
    if (missingResources.length > 0) {
      try {
        const iniSource = await readFile(module.moduleIniPath);
        const eol = iniSource.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
        let prefix = '';
        if (iniSource.length > 0 && iniSource[iniSource.length - 1] !== 0x0a) prefix = eol;
        const addition = missingResources
          .map((name) => `load_resource = ${name}`)
          .join(eol);
        const iniBuffer = Buffer.concat([
          iniSource,
          Buffer.from(`${prefix}${addition}${eol}`, 'utf8'),
        ]);
        artifacts.push({
          kind: 'config',
          source: path.relative(installationRoot, module.moduleIniPath).replace(/\\/g, '/'),
          target: `${moduleRoot}/module.ini`,
          buffer: iniBuffer,
        });
      } catch (error) {
        errors.push(`module.ini: ${error.message}`);
      }
    }

    const targets = new Map();
    const uniqueArtifacts = [];
    for (const artifact of artifacts) {
      const existing = targets.get(artifact.target);
      if (existing) {
        if (artifact.kind === 'texture' && artifact.buffer.equals(existing.buffer)) continue;
        errors.push(`two build artifacts target '${artifact.target}'`);
        continue;
      }
      targets.set(artifact.target, artifact);
      uniqueArtifacts.push(artifact);
    }
    if (uniqueArtifacts.length === 0 && !copyModule) {
      errors.push('the project has no mesh, material or item overrides to build');
    }
    if (!project.meshes.length && !project.materials.length && !project.items.length) {
      warnings.push('project contains no game-asset overrides; only a module copy will be produced');
    }
    if (errors.length > 0) {
      const error = new Error(`Build validation failed: ${errors.join('; ')}`);
      // @ts-expect-error machine-readable
      error.code = 'BUILD_VALIDATION_FAILED';
      // @ts-expect-error machine-readable
      error.details = { errors, warnings };
      throw error;
    }

    const label = options.label ?? `build-${project.id}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const workspace = await this.createWorkspace(label, { moduleId });
    const moduleTarget = this.workspaces.resolve(workspace.id, moduleRoot);
    if (copyModule) {
      await mkdir(path.dirname(moduleTarget), { recursive: true });
      await cp(module.path, moduleTarget, { recursive: true, force: true });
    }

    /** @type {Array<{kind:string, source:string, target:string, bytes:number, sha256:string}>} */
    const files = [];
    for (const artifact of uniqueArtifacts) {
      const written = await this.workspaces.writeFile(workspace.id, artifact.target, artifact.buffer);
      files.push({
        kind: artifact.kind,
        source: artifact.source,
        target: artifact.target,
        bytes: written.bytes,
        sha256: written.sha256,
      });
    }

    await this.workspaces.writeFile(
      workspace.id,
      'project.json',
      JSON.stringify(project, null, 2),
    );
    const manifest = {
      schemaVersion: 1,
      id: workspace.id,
      projectId: project.id,
      projectName: project.name,
      moduleId,
      moduleRoot,
      mode: copyModule ? 'module' : 'overlay',
      createdAt: new Date().toISOString(),
      sourceInstallation: this.requireInstallation().rootPath,
      projectSnapshot: 'project.json',
      overrides: {
        meshes: project.meshes.length,
        materials: project.materials.length,
        items: project.items.length,
      },
      summary: {
        files: files.length,
        meshes: project.meshes.length,
        materials: project.materials.length,
        items: project.items.length,
      },
      warnings,
      errors,
      files,
    };
    const manifestResult = await this.workspaces.writeFile(
      workspace.id,
      'build.json',
      JSON.stringify(manifest, null, 2),
    );
    const log = [
      `Build ${workspace.id}`,
      `Project: ${project.id} (${project.name})`,
      `Module: ${moduleId}`,
      `Mode: ${manifest.mode}`,
      `Created: ${manifest.createdAt}`,
      `Overrides: ${project.meshes.length} mesh, ${project.materials.length} material, ${project.items.length} item`,
      '',
      'Files:',
      ...files.map((file) => `  ${file.kind.padEnd(8)} ${file.target} (${file.bytes} B, ${file.sha256})`),
      '',
      warnings.length ? `Warnings:\n${warnings.map((warning) => `  - ${warning}`).join('\n')}` : 'Warnings: none',
      '',
    ].join('\n');
    await this.workspaces.writeFile(workspace.id, 'build.log', log);
    return {
      buildId: workspace.id,
      workspaceId: workspace.id,
      moduleRoot,
      mode: manifest.mode,
      manifest,
      manifestFile: manifestResult.file,
      files,
      warnings,
      errors,
    };
  }

  async listBuilds() {
    const builds = [];
    for (const workspace of await this.workspaces.list()) {
      try {
        const raw = await this.workspaces.readFile(workspace.id, 'build.json');
        const manifest = JSON.parse(raw.toString('utf8'));
        builds.push({
          id: workspace.id,
          label: workspace.label,
          projectId: manifest.projectId,
          projectName: manifest.projectName,
          moduleId: manifest.moduleId,
          mode: manifest.mode,
          createdAt: manifest.createdAt,
          summary: manifest.summary,
        });
      } catch {
        /* not a build workspace */
      }
    }
    builds.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return { builds };
  }

  /** @param {string} buildId */
  async getBuild(buildId) {
    try {
      const manifest = JSON.parse((await this.workspaces.readFile(buildId, 'build.json')).toString('utf8'));
      const log = (await this.workspaces.readFile(buildId, 'build.log')).toString('utf8');
      return { buildId, manifest, log };
    } catch {
      const error = new Error(`Build '${buildId}' was not found.`);
      // @ts-expect-error machine-readable
      error.code = 'BUILD_NOT_FOUND';
      throw error;
    }
  }

  /** @param {string} projectId @param {string} buildId @param {string} confirm */
  async rollbackBuild(projectId, buildId, confirm) {
    if (confirm !== buildId) {
      const error = new Error('Confirmation required: pass the build id as confirm.');
      // @ts-expect-error machine-readable
      error.code = 'CONFIRMATION_REQUIRED';
      throw error;
    }
    const { manifest } = await this.getBuild(buildId);
    if (manifest.projectId !== projectId) {
      const error = new Error(`Build '${buildId}' belongs to project '${manifest.projectId}'.`);
      // @ts-expect-error machine-readable
      error.code = 'BUILD_PROJECT_MISMATCH';
      throw error;
    }
    const raw = await this.workspaces.readFile(buildId, manifest.projectSnapshot ?? 'project.json');
    const snapshot = JSON.parse(raw.toString('utf8'));
    if (snapshot.id !== projectId) {
      const error = new Error('Build project snapshot id does not match the project.');
      // @ts-expect-error machine-readable
      error.code = 'BUILD_PROJECT_MISMATCH';
      throw error;
    }
    await this.projects.save(snapshot);
    return { projectId, restoredFrom: buildId, name: snapshot.name };
  }

  /**
   * Delete all but the newest `keep` build workspaces.
   * @param {number} keep
   * @param {string} confirm Must equal `PRUNE_BUILDS`.
   */
  async pruneBuilds(keep = 5, confirm = '') {
    if (confirm !== 'PRUNE_BUILDS') {
      const error = new Error('Confirmation required: pass confirm=PRUNE_BUILDS.');
      // @ts-expect-error machine-readable
      error.code = 'CONFIRMATION_REQUIRED';
      throw error;
    }
    const count = Math.max(1, Math.min(1000, Number(keep) || 5));
    const { builds } = await this.listBuilds();
    const removed = [];
    for (const build of builds.slice(count)) {
      await this.workspaces.remove(build.id, build.id);
      removed.push(build.id);
    }
    return { keep: count, removed, remaining: builds.length - removed.length };
  }

  /**
   * Prune old project and workspace backups.
   * @param {number} keep
   * @param {string} confirm Must equal `PRUNE_BACKUPS`.
   */
  async pruneBackups(keep = 5, confirm = '') {
    if (confirm !== 'PRUNE_BACKUPS') {
      const error = new Error('Confirmation required: pass confirm=PRUNE_BACKUPS.');
      // @ts-expect-error machine-readable
      error.code = 'CONFIRMATION_REQUIRED';
      throw error;
    }
    const projects = await this.projects.pruneBackups(keep);
    const workspaces = await this.workspaces.pruneBackups(keep);
    return {
      keep: Math.max(1, Math.min(1000, Number(keep) || 5)),
      projects,
      workspaces,
    };
  }

  /** @param {string} buildId */
  async diffBuild(buildId) {
    const { manifest } = await this.getBuild(buildId);
    const root = path.resolve(this.requireInstallation().rootPath);
    const files = [];
    let changed = 0;
    let added = 0;
    let unchanged = 0;
    let unavailable = 0;

    for (const file of manifest.files ?? []) {
      const builtBuffer = await this.workspaces.readFile(buildId, file.target);
      const builtHash = sha256Buffer(builtBuffer);
      const source = String(file.source ?? '');
      const comparable = !['game', 'project'].includes(source);
      let sourceExists = false;
      let sourceBytes = null;
      let sourceHash = null;
      if (comparable) {
        const sourcePath = path.resolve(root, source);
        if (sourcePath === root || sourcePath.startsWith(root + path.sep)) {
          try {
            const sourceBuffer = await readFile(sourcePath);
            sourceExists = true;
            sourceBytes = sourceBuffer.length;
            sourceHash = sha256Buffer(sourceBuffer);
          } catch {
            /* added file */
          }
        }
      }
      if (!comparable) unavailable += 1;
      else if (!sourceExists) {
        changed += 1;
        added += 1;
      } else if (sourceHash !== builtHash) changed += 1;
      else unchanged += 1;
      files.push({
        kind: file.kind,
        source: file.source,
        target: file.target,
        comparable,
        sourceExists,
        sourceBytes,
        builtBytes: builtBuffer.length,
        sourceSha256: sourceHash,
        builtSha256: builtHash,
        changed: comparable && (!sourceExists || sourceHash !== builtHash),
      });
    }

    return {
      buildId,
      summary: { files: files.length, changed, added, unchanged, unavailable },
      files,
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
   * @param {{ limits?: Partial<import('./resources/geometry.js').GeometryLimits>, rigidBone?: string|null }} [options]
   */
  async getMeshRenderData(moduleId, meshName, options = {}) {
    const { mesh, geometry } = await this.getMeshGeometry(moduleId, meshName, options);
    const count = geometry.vertexCount;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);

    /** @type {Float64Array|null} */
    let rigid = null;
    if (options.rigidBone && geometry.rigging.length === 0) {
      const skeleton = await this.getSkeletonMatrices(moduleId);
      rigid = skeleton.bones.get(options.rigidBone) ?? null;
    }

    for (let v = 0; v < count; v += 1) {
      const positionIndex = geometry.vertices.index[v];
      if (positionIndex < 0 || positionIndex >= geometry.positionCount) {
        throw new Error(`Mesh '${meshName}' vertex ${v} references position ${positionIndex}`);
      }
      const px = geometry.positions[positionIndex * 3];
      const py = geometry.positions[positionIndex * 3 + 1];
      const pz = geometry.positions[positionIndex * 3 + 2];
      if (rigid) {
        positions[v * 3] = rigid[0] * px + rigid[1] * py + rigid[2] * pz + rigid[3];
        positions[v * 3 + 1] = rigid[4] * px + rigid[5] * py + rigid[6] * pz + rigid[7];
        positions[v * 3 + 2] = rigid[8] * px + rigid[9] * py + rigid[10] * pz + rigid[11];
      } else {
        positions[v * 3] = px;
        positions[v * 3 + 1] = py;
        positions[v * 3 + 2] = pz;
      }

      const nx = geometry.vertices.normal[v * 3];
      const ny = geometry.vertices.normal[v * 3 + 1];
      const nz = geometry.vertices.normal[v * 3 + 2];
      if (rigid) {
        normals[v * 3] = rigid[0] * nx + rigid[1] * ny + rigid[2] * nz;
        normals[v * 3 + 1] = rigid[4] * nx + rigid[5] * ny + rigid[6] * nz;
        normals[v * 3 + 2] = rigid[8] * nx + rigid[9] * ny + rigid[10] * nz;
      } else {
        normals[v * 3] = nx;
        normals[v * 3 + 1] = ny;
        normals[v * 3 + 2] = nz;
      }
      uvs[v * 2] = geometry.vertices.uv[v * 2];
      uvs[v * 2 + 1] = geometry.vertices.uv[v * 2 + 1];
    }

    let posedBbox = geometry.bbox;
    if (rigid) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v < count; v += 1) {
        for (let axis = 0; axis < 3; axis += 1) {
          const value = positions[v * 3 + axis];
          if (value < min[axis]) min[axis] = value;
          if (value > max[axis]) max[axis] = value;
        }
      }
      if (Number.isFinite(min[0])) posedBbox = { min, max };
    }

    return {
      mesh,
      layout: geometry.layout,
      uvFlip: 'v', // OpenBRF flips V for GL/Warband display
      bbox: posedBbox,
      posed: { bone: options.rigidBone ?? null, applied: Boolean(rigid) },
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
   * Global bind-pose matrices for the human skeleton. Rigid meshes (heads,
   * helmets, gloves, body parts) are authored in a bone-local space; the
   * matrix moves them back into the character's bind pose. Skinned meshes
   * already store bind-pose positions and are left untouched.
   * @param {string} moduleId
   * @param {string} [skeletonName]
   */
  async getSkeletonMatrices(moduleId, skeletonName = 'skel_human') {
    const key = `${moduleId}:${skeletonName}`;
    if (this.skeletonMatrixCache.has(key)) return this.skeletonMatrixCache.get(key);
    const installation = this.requireInstallation();
    const file = await resolveCaseInsensitive(path.join(installation.rootPath, 'CommonRes'), 'skeletons.brf');
    if (!file) {
      const error = new Error('CommonRes/skeletons.brf was not found.');
      // @ts-expect-error machine-readable
      error.code = 'SKELETON_NOT_FOUND';
      throw error;
    }
    const doc = parseBrf(await readFile(file), { file });
    const skeleton = doc.skeletons.find((candidate) => candidate.name === skeletonName);
    if (!skeleton) {
      const error = new Error(`Skeleton '${skeletonName}' was not found.`);
      // @ts-expect-error machine-readable
      error.code = 'SKELETON_NOT_FOUND';
      throw error;
    }
    /** @type {Map<string, Float64Array>} */
    const bones = new Map();
    for (let i = 0; i < skeleton.bones.length; i += 1) {
      const bone = skeleton.bones[i];
      const local = boneLocalMatrix(bone);
      const parent = bone.attach >= 0 ? skeleton.bones[bone.attach] : null;
      bones.set(bone.name, parent ? multiplyMatrices(bones.get(parent.name), local) : local);
    }
    const result = { bones, applied: 0 };
    this.skeletonMatrixCache.set(key, result);
    return result;
  }

  /**
   * @param {string} moduleId
   * @param {string} meshName
   * @param {{ slot?: string, role?: string, bone?: string|null }} [options]
   */
  async getOutfitMeshRenderData(moduleId, meshName, options = {}) {
    let bone = options.bone ?? null;
    if (!bone && options.role) {
      const roles = {
        calf_l: 'calf.L',
        calf_r: 'calf.R',
        hand_l: 'hand.L',
        hand_r: 'hand.R',
        head: 'head',
      };
      bone = roles[options.role] ?? null;
    }
    if (!bone && options.slot === 'head') bone = 'head';
    if (!bone && options.slot === 'hand') {
      if (/_L$/i.test(meshName)) bone = 'hand.L';
      else if (/_R$/i.test(meshName)) bone = 'hand.R';
    }
    if (!bone && options.slot === 'foot') {
      if (/_L$/i.test(meshName)) bone = 'foot.L';
      else if (/_R$/i.test(meshName)) bone = 'foot.R';
    }
    return this.getMeshRenderData(moduleId, meshName, { rigidBone: bone });
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

  /**
   * Editable mesh data for Phase 4. Includes the raw position array and the
   * per-vertex position index, plus rigging and every vertex attribute needed
   * to rebuild the BRF.
   *
   * @param {string} moduleId
   * @param {string} meshName
   * @param {{ limits?: Partial<import('./resources/geometry.js').GeometryLimits> }} [options]
   */
  async getMeshEditable(moduleId, meshName, options = {}) {
    const { mesh, geometry } = await this.getMeshGeometry(moduleId, meshName, options);
    return {
      mesh,
      layout: geometry.layout,
      uvFlip: 'v',
      bbox: geometry.bbox,
      counts: {
        vertices: geometry.vertexCount,
        faces: geometry.faceCount,
        positions: geometry.positionCount,
      },
      frameCount: geometry.frames.length,
      rigged: geometry.rigging.some((entry) => entry.pairs.length > 0),
      arrays: {
        positions: encodeTypedArray(geometry.positions),
        vertexPosition: encodeTypedArray(geometry.vertices.index),
        normals: encodeTypedArray(geometry.vertices.normal),
        uvs: encodeTypedArray(geometry.vertices.uv),
        indices: encodeTypedArray(geometry.faces),
        color: encodeTypedArray(geometry.vertices.color),
        tangent: geometry.vertices.tangent ? encodeTypedArray(geometry.vertices.tangent) : null,
        textureIndex: geometry.vertices.textureIndex ? encodeTypedArray(geometry.vertices.textureIndex) : null,
        uv2: geometry.vertices.uv2 ? encodeTypedArray(geometry.vertices.uv2) : null,
      },
      rigging: geometry.rigging,
      frames: geometry.frames.map((frame) => ({
        time: frame.time,
        positions: encodeTypedArray(frame.positions),
        normals: encodeTypedArray(frame.normals),
      })),
      source: { moduleId, mesh: mesh.name, brf: mesh.brf },
    };
  }

  /* ---------------------------------------------------------------- */
  /* Mesh overrides (Phase 4)                                          */
  /* ---------------------------------------------------------------- */

  /**
   * @param {string} projectId
   * @param {any} override
   */
  async saveMeshOverride(projectId, override) {
    const { issues } = buildGeometryFromOverride(override);
    if (issues.length > 0) {
      const error = new Error(`Override is invalid: ${issues.join('; ')}`);
      // @ts-expect-error machine-readable
      error.code = 'INVALID_OVERRIDE';
      throw error;
    }
    return this.projects.saveMeshOverride(projectId, override);
  }

  /** @param {string} projectId */
  async listMeshOverrides(projectId) {
    return this.projects.listMeshOverrides(projectId);
  }

  /** @param {string} projectId @param {string} meshId */
  async getMeshOverride(projectId, meshId) {
    return this.projects.getMeshOverride(projectId, meshId);
  }

  /** @param {string} projectId @param {string} meshId @param {string} confirm */
  async removeMeshOverride(projectId, meshId, confirm) {
    return this.projects.removeMeshOverride(projectId, meshId, confirm);
  }

  /**
   * Merge an override into a copy of its source BRF and write it to a
   * workspace. The installation is only read.
   * @param {string} projectId
   * @param {string} meshId
   * @param {{ workspaceLabel?: string }} [options]
   */
  async buildMeshOverrideArtifact(projectId, meshId) {
    const installation = this.requireInstallation();
    const override = await this.projects.getMeshOverride(projectId, meshId);
    const sourcePath = path.resolve(override.source.brf);
    const root = path.resolve(installation.rootPath);
    if (sourcePath !== root && !sourcePath.startsWith(root + path.sep)) {
      const error = new Error('Override source BRF must be inside the Warband installation.');
      // @ts-expect-error machine-readable
      error.code = 'PATH_OUTSIDE_INSTALLATION';
      throw error;
    }

    const source = await readFile(sourcePath);
    const { buffer, mesh } = applyOverride(source, override, { file: sourcePath });
    return {
      override,
      sourcePath,
      sourceRelative: path.relative(root, sourcePath).replace(/\\/g, '/'),
      buffer,
      mesh,
    };
  }

  async exportMeshOverride(projectId, meshId, options = {}) {
    const artifact = await this.buildMeshOverrideArtifact(projectId, meshId);
    const workspace = await this.createWorkspace(options.workspaceLabel ?? 'mesh-edits', {
      reuse: true,
      moduleId: artifact.override.source.moduleId,
    });
    const fileName = `${artifact.mesh.name.replace(/[^A-Za-z0-9._-]+/g, '_')}.brf`;
    const result = await this.workspaces.writeFile(workspace.id, fileName, artifact.buffer);
    return {
      ...result,
      workspaceId: workspace.id,
      sourceBrf: artifact.sourcePath,
      mesh: artifact.mesh.name,
      bytes: artifact.buffer.length,
      vertices: artifact.mesh.vertexCount,
      faces: artifact.mesh.faceCount,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Materials & textures (Phase 5)                                    */
  /* ---------------------------------------------------------------- */

  /** @param {string} moduleId @param {string} name */
  async getMaterialEditable(moduleId, name) {
    const data = await this.getModuleData(moduleId);
    const entries = data.brfIndex.resolveMaterial(name);
    if (entries.length === 0) {
      const error = new Error(`Material '${name}' was not found.`);
      // @ts-expect-error machine-readable
      error.code = 'MATERIAL_NOT_FOUND';
      throw error;
    }
    const material = entries[0];
    const context = { brfIndex: data.brfIndex, textures: data.textures, ddsCache: data.ddsCache };
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
      material: {
        name: material.name,
        brf: material.brf,
        sources: [...new Set(entries.map((entry) => entry.brf))],
      },
      fields: {
        shader: material.shader,
        diffuseA: material.diffuseA,
        diffuseB: material.diffuseB,
        bump: material.bump,
        enviro: material.enviro,
        spec: material.spec,
        specPresent: material.specPresent,
        specular: material.specular,
        r: material.r,
        g: material.g,
        b: material.b,
        flags: material.flags,
      },
      textures,
      shaders: [...data.brfIndex.shaders.keys()].sort(),
      meshes: meshes.slice(0, 200),
    };
  }

  /** @param {string} projectId @param {any} override */
  async saveMaterialOverride(projectId, override) {
    const issues = validateMaterialOverride(override);
    if (issues.length > 0) {
      const error = new Error(`Material override is invalid: ${issues.join('; ')}`);
      // @ts-expect-error machine-readable
      error.code = 'INVALID_MATERIAL_OVERRIDE';
      throw error;
    }
    return this.projects.saveMaterialOverride(projectId, override);
  }

  /** @param {string} projectId */
  async listMaterialOverrides(projectId) {
    return this.projects.listMaterialOverrides(projectId);
  }

  /** @param {string} projectId @param {string} materialId */
  async getMaterialOverride(projectId, materialId) {
    return this.projects.getMaterialOverride(projectId, materialId);
  }

  /** @param {string} projectId @param {string} materialId @param {string} confirm */
  async removeMaterialOverride(projectId, materialId, confirm) {
    return this.projects.removeMaterialOverride(projectId, materialId, confirm);
  }

  /**
   * @param {string} workspaceId
   * @param {string} fileName
   * @param {Buffer} buffer
   */
  async importTexture(workspaceId, fileName, buffer) {
    const installation = this.requireInstallation();
    const base = path.basename(fileName).replace(/[^A-Za-z0-9._-]+/g, '_');
    const name = base.toLowerCase().endsWith('.dds') ? base : `${base}.dds`;
    let info;
    try {
      info = parseDds(buffer, { file: name });
    } catch (error) {
      const wrapped = new Error(`Invalid DDS file: ${error instanceof Error ? error.message : String(error)}`);
      // @ts-expect-error machine-readable
      wrapped.code = 'INVALID_DDS';
      throw wrapped;
    }
    const result = await this.workspaces.writeFile(workspaceId, `Textures/${name}`, buffer);
    return {
      name,
      workspaceId,
      path: `Textures/${name}`,
      width: info.width,
      height: info.height,
      format: info.format,
      mipmaps: info.mipmaps,
      sha256: result.sha256,
      bytes: result.bytes,
      source: 'imported',
      installationId: installation.id,
    };
  }

  /**
   * @param {string} projectId
   * @param {string} materialId
   * @param {{ workspaceLabel?: string }} [options]
   */
  async buildMaterialOverrideArtifacts(projectId, materialId) {
    const installation = this.requireInstallation();
    const project = await this.projects.load(projectId);
    const override = project.materials.find((entry) => entry.id === materialId);
    if (!override) {
      const error = new Error(`Material override '${materialId}' was not found.`);
      // @ts-expect-error machine-readable
      error.code = 'MATERIAL_OVERRIDE_NOT_FOUND';
      throw error;
    }

    const sourcePath = path.resolve(override.source.brf);
    const root = path.resolve(installation.rootPath);
    if (sourcePath !== root && !sourcePath.startsWith(root + path.sep)) {
      const error = new Error('Override source BRF must be inside the Warband installation.');
      // @ts-expect-error machine-readable
      error.code = 'PATH_OUTSIDE_INSTALLATION';
      throw error;
    }

    const source = await readFile(sourcePath);
    const { buffer, material } = applyMaterialOverrideToBrf(source, override, { file: sourcePath });
    const textures = [];
    const data = await this.getModuleData(override.source.moduleId);
    for (const textureName of referencedTextures(override.fields)) {
      const normalized = textureName.toLowerCase().endsWith('.dds') ? textureName : `${textureName}.dds`;
      const projectTexture = project.textures.find(
        (entry) => entry.name.toLowerCase() === normalized.toLowerCase(),
      );
      let textureBuffer;
      let sourceKind;
      if (projectTexture) {
        textureBuffer = await this.workspaces.readFile(projectTexture.workspaceId, projectTexture.path);
        sourceKind = 'project';
      } else {
        const hit = data.textures.resolve(textureName);
        if (!hit.exists || !hit.filePath) {
          const error = new Error(`Texture '${textureName}' was not found in the project or the game.`);
          // @ts-expect-error machine-readable
          error.code = 'MISSING_TEXTURE';
          throw error;
        }
        textureBuffer = await readFile(hit.filePath);
        sourceKind = 'game';
      }
      textures.push({ name: normalized, buffer: textureBuffer, source: sourceKind });
    }

    return {
      override,
      sourcePath,
      sourceRelative: path.relative(root, sourcePath).replace(/\\/g, '/'),
      material,
      buffer,
      textures,
    };
  }

  async exportMaterialOverride(projectId, materialId, options = {}) {
    const artifact = await this.buildMaterialOverrideArtifacts(projectId, materialId);
    const workspace = await this.createWorkspace(options.workspaceLabel ?? 'materials', {
      reuse: true,
      moduleId: artifact.override.source.moduleId,
    });
    const brfName = `${artifact.material.name.replace(/[^A-Za-z0-9._-]+/g, '_')}.brf`;
    const brfResult = await this.workspaces.writeFile(workspace.id, brfName, artifact.buffer);

    const textureResults = [];
    for (const texture of artifact.textures) {
      const written = await this.workspaces.writeFile(workspace.id, `Textures/${texture.name}`, texture.buffer);
      textureResults.push({
        name: texture.name,
        path: written.file,
        source: texture.source,
        sha256: written.sha256,
      });
    }

    return {
      workspaceId: workspace.id,
      material: artifact.material.name,
      sourceBrf: artifact.sourcePath,
      file: brfResult.file,
      bytes: artifact.buffer.length,
      textures: textureResults,
    };
  }

  /** @param {string} projectId @param {string} name */
  async getProjectTextureFile(projectId, name) {
    const texture = await this.projects.getTexture(projectId, name);
    const buffer = await this.workspaces.readFile(texture.workspaceId, texture.path);
    return { buffer, texture };
  }

  /** @param {string} projectId @param {any} texture */
  async saveProjectTexture(projectId, texture) {
    return this.projects.saveTexture(projectId, texture);
  }

  /** @param {string} projectId */
  async listProjectTextures(projectId) {
    return this.projects.listTextures(projectId);
  }

  /** @param {string} projectId @param {string} name @param {string} confirm */
  async removeProjectTexture(projectId, name, confirm) {
    return this.projects.removeTexture(projectId, name, confirm);
  }

  /* ---------------------------------------------------------------- */
  /* Character bodies & outfits (Phase 6)                              */
  /* ---------------------------------------------------------------- */

  /** @param {string} moduleId */
  async getSkins(moduleId) {
    const module = this.requireModule(moduleId);
    const file = await resolveCaseInsensitive(module.path, 'skins.txt');
    if (!file) {
      const error = new Error(`Module '${moduleId}' has no skins.txt.`);
      // @ts-expect-error machine-readable
      error.code = 'SKINS_NOT_FOUND';
      throw error;
    }
    const parsed = await parseSkinsFile(file);
    return {
      file,
      skins: parsed.skins.map((skin) => ({
        name: skin.name,
        flags: skin.flags,
        skeleton: skin.skeleton,
        scale: skin.scale,
      })),
    };
  }

  /**
   * Resolve the meshes that form a character body.
   * @param {string} moduleId
   * @param {string} [skinName]
   */
  async getCharacter(moduleId, skinName = 'man') {
    const data = await this.getModuleData(moduleId);
    const module = this.requireModule(moduleId);
    const file = await resolveCaseInsensitive(module.path, 'skins.txt');
    if (!file) {
      const error = new Error(`Module '${moduleId}' has no skins.txt.`);
      // @ts-expect-error machine-readable
      error.code = 'SKINS_NOT_FOUND';
      throw error;
    }
    const parsed = await parseSkinsFile(file);
    const skin = parsed.skins.find((candidate) => candidate.name === skinName);
    if (!skin) {
      const error = new Error(`Skin '${skinName}' was not found.`);
      // @ts-expect-error machine-readable
      error.code = 'SKIN_NOT_FOUND';
      throw error;
    }

    /** @type {Array<{role:string,name:string,material:string,brf:string}>} */
    const parts = [];
    const add = (role, name) => {
      if (!name) return;
      const resolution = data.brfIndex.resolveMesh(name);
      const entry = resolution.direct[0] ?? resolution.base[0] ?? resolution.pieces[0];
      if (!entry) return;
      parts.push({ role, name: entry.name, material: entry.material, brf: entry.brf });
    };

    add('body', skin.body);
    add('calf_l', skin.calf);
    add('calf_r', skin.calf.replace(/_l$/i, '_r'));
    add('hand_l', skin.hand);
    add('hand_r', skin.hand.replace(/L$/i, 'R'));
    add('head', skin.headMesh);

    return {
      skin: {
        name: skin.name,
        flags: skin.flags,
        skeleton: skin.skeleton,
        scale: skin.scale,
      },
      skins: parsed.skins.map((candidate) => candidate.name),
      parts,
    };
  }

  /**
   * Meshes that visually compose an item (base + pieces, gloves L/R), without
   * LODs.
   * @param {string} moduleId
   * @param {string} itemId
   */
  async getOutfitItemMeshes(moduleId, itemId) {
    const data = await this.getModuleData(moduleId);
    const item = data.itemsById.get(itemId.toLowerCase());
    if (!item) {
      const error = new Error(`Item '${itemId}' was not found.`);
      // @ts-expect-error machine-readable
      error.code = 'ITEM_NOT_FOUND';
      throw error;
    }
    /** @type {Array<{name:string,material:string,brf:string}>} */
    const meshes = [];
    const seen = new Set();
    const addMesh = (name) => {
      if (!name || seen.has(name.toLowerCase())) return;
      const resolution = data.brfIndex.resolveMesh(name);
      const entry = resolution.direct[0] ?? resolution.base[0] ?? resolution.pieces[0];
      if (!entry) return;
      seen.add(entry.name.toLowerCase());
      meshes.push({ name: entry.name, material: entry.material, brf: entry.brf });
    };
    const addFamily = (name) => {
      const resolution = data.brfIndex.resolveMesh(name);
      const base = resolution.base[0];
      if (base) addMesh(base.name);
      for (const piece of resolution.pieces) {
        if (piece.nameInfo.lodLevel === 0) addMesh(piece.name);
      }
      if (!base && resolution.pieces.length > 0) {
        for (const piece of resolution.pieces) if (piece.nameInfo.lodLevel === 0) addMesh(piece.name);
      }
    };

    for (const ref of item.meshes) {
      addFamily(ref.name);
      if (/_L$/i.test(ref.name)) addFamily(ref.name.replace(/_L$/i, '_R'));
    }
    return { item: { id: item.id, name: item.name, slot: item.slot, category: item.category }, meshes };
  }

  /** @param {string} projectId @param {any} outfit */
  async saveOutfit(projectId, outfit) {
    const issues = await this.validateOutfitInternal(outfit);
    if (issues.length > 0) {
      const error = new Error(`Outfit is invalid: ${issues.join('; ')}`);
      // @ts-expect-error machine-readable
      error.code = 'INVALID_OUTFIT';
      throw error;
    }
    return this.projects.saveOutfit(projectId, outfit);
  }

  /** @param {string} projectId */
  async listOutfits(projectId) {
    return this.projects.listOutfits(projectId);
  }

  /** @param {string} projectId @param {string} outfitId */
  async getOutfit(projectId, outfitId) {
    return this.projects.getOutfit(projectId, outfitId);
  }

  /** @param {string} projectId @param {string} outfitId @param {string} confirm */
  async removeOutfit(projectId, outfitId, confirm) {
    return this.projects.removeOutfit(projectId, outfitId, confirm);
  }

  /** @param {any} outfit */
  async validateOutfitInternal(outfit) {
    /** @type {string[]} */
    const issues = [];
    if (!outfit?.id) issues.push('id is required');
    if (!outfit?.name) issues.push('name is required');
    if (!outfit?.moduleId) issues.push('moduleId is required');
    if (outfit?.bodySkin) {
      try {
        const skins = await this.getSkins(outfit.moduleId);
        if (!skins.skins.some((skin) => skin.name === outfit.bodySkin)) {
          issues.push(`body skin '${outfit.bodySkin}' does not exist`);
        }
      } catch (error) {
        issues.push(`cannot resolve skins: ${error.message}`);
      }
    }
    const slots = ['body', 'head', 'hand', 'foot'];
    const entries = outfit?.entries ?? {};
    for (const slot of slots) {
      const itemId = entries[slot];
      if (!itemId) continue;
      const data = await this.getModuleData(outfit.moduleId);
      const item = data.itemsById.get(String(itemId).toLowerCase());
      if (!item) {
        issues.push(`item '${itemId}' (${slot}) does not exist`);
        continue;
      }
      if (item.slot !== slot) issues.push(`item '${itemId}' is slot '${item.slot}', expected '${slot}'`);
    }
    for (const [slot, transform] of Object.entries(outfit?.transforms ?? {})) {
      if (!slots.includes(slot)) issues.push(`unknown transform slot '${slot}'`);
      for (const key of ['x', 'y', 'z', 'scale']) {
        if (transform[key] !== undefined && !Number.isFinite(Number(transform[key]))) {
          issues.push(`transform ${slot}.${key} must be numeric`);
        }
      }
    }
    return issues;
  }

  /** @param {any} payload */
  analyzeOutfit(payload) {
    return analyzeOutfitClipping(payload);
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

  async getDiagnostics() {
    const status = this.getStatus();
    const paths = {
      projectRoot: this.projectRoot,
      projects: path.join(this.projectRoot, 'projects'),
      workspaces: path.join(this.projectRoot, 'workspace'),
      backups: path.join(this.projectRoot, 'backups'),
      cache: path.join(this.projectRoot, 'cache'),
      log: path.join(this.projectRoot, 'cache', 'logs', 'server.log'),
    };
    const directoryChecks = [];
    for (const key of ['projects', 'workspaces', 'backups', 'cache']) {
      directoryChecks.push({
        id: `dir-${key}`,
        label: key,
        ok: await exists(paths[key]),
        detail: paths[key],
      });
    }
    const major = Number(process.versions.node.split('.')[0]);
    const checks = [
      { id: 'node', label: 'Node.js 22+', ok: major >= 22, detail: process.version },
      { id: 'installation', label: 'Instalación Warband', ok: Boolean(this.installation), detail: this.installation?.rootPath ?? 'no detectada' },
      { id: 'modules', label: 'Módulos', ok: this.modules.length > 0, detail: this.modules.map((module) => module.id).join(', ') || 'ninguno' },
      ...directoryChecks,
    ];
    return {
      ok: checks.every((check) => check.ok),
      version: '0.12.0',
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      uptimeSeconds: Math.round(process.uptime()),
      memory: process.memoryUsage(),
      initMs: this.initMs,
      status,
      checks,
      paths,
      recovery: [
        'Errores de proyecto: usa Copias para restaurar una revisión anterior.',
        'Errores de workspace: usa Copias → restaurar archivo; la copia actual se guarda antes.',
        'Builds: usa Ver diff o Rollback al proyecto desde la vista Build.',
        'Instalación: abre ⚙ y registra la carpeta que contiene mb_warband.exe.',
      ],
    };
  }

  async getLogTail(lines = 200) {
    const count = Math.max(1, Math.min(2000, Number(lines) || 200));
    const file = path.join(this.projectRoot, 'cache', 'logs', 'server.log');
    try {
      const text = await readFile(file, 'utf8');
      const all = text.split(/\r?\n/).filter(Boolean);
      return { file, lines: all.slice(-count), total: all.length };
    } catch {
      return { file, lines: [], total: 0 };
    }
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
