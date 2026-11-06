// @ts-check
/**
 * WARBand Engine — public facade.
 *
 * This layer knows about Mount & Blade: Warband and must stay UI-independent.
 * The HTTP server and any future CLI consume the same API.
 */

import path from 'node:path';
import { listModules, findModule } from './modules/moduleRegistry.js';
import { detectInstallation } from './installation/detect.js';
import { parseItemKindsFile } from './items/itemKinds.js';
import { createBrfIndex } from './resources/brfIndex.js';
import { createTextureResolver } from './resources/textureResolver.js';
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
    this.initialized = false;
    this.initMs = 0;
  }

  async init() {
    const started = performance.now();
    const detection = await detectInstallation({
      projectRoot: this.projectRoot,
      explicitPath: this.installationPath,
    });
    this.installation = detection.installation;
    this.candidates = detection.candidates;
    this.modules = detection.installation ? await listModules(detection.installation) : [];
    await this.projects.init();
    this.initMs = Math.round(performance.now() - started);
    this.initialized = true;
    return this;
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
    return { item, chain };
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
