// @ts-check
/**
 * Module discovery and metadata. Read-only.
 */

import path from 'node:path';
import { listDir, resolveCaseInsensitive, statSafe } from '../util/fsx.js';
import { parseModuleIniFile } from './moduleIni.js';

/**
 * @typedef {Object} WarbandModule
 * @property {string} id            Directory name (stable identity on disk).
 * @property {string} slug          Lowercase URL-safe identifier.
 * @property {string} dirName
 * @property {string} path
 * @property {string} moduleName
 * @property {string} moduleIniPath
 * @property {string|null} version
 * @property {string|null} operationSetVersion
 * @property {{singlePlayer:boolean,multiplayer:boolean}} capabilities
 * @property {string[]} commonResources
 * @property {string[]} moduleResources
 * @property {string[]} duplicates
 * @property {string[]} unknownKeys
 * @property {number} iniBytes
 */

/**
 * @param {string} name
 */
export function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * List every valid module in an installation.
 * @param {import('../installation/detect.js').WarbandInstallation} installation
 * @returns {Promise<WarbandModule[]>}
 */
export async function listModules(installation) {
  const entries = await listDir(installation.modulesDir);
  /** @type {WarbandModule[]} */
  const modules = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const modulePath = path.join(installation.modulesDir, entry.name);
    const iniPath = await resolveCaseInsensitive(modulePath, 'module.ini');
    if (!iniPath) continue;

    try {
      const ini = await parseModuleIniFile(iniPath);
      const iniStat = await statSafe(iniPath);
      modules.push({
        id: entry.name,
        slug: toSlug(entry.name),
        dirName: entry.name,
        path: modulePath,
        moduleName: ini.moduleName ?? entry.name,
        moduleIniPath: iniPath,
        version: ini.versions.module,
        operationSetVersion: ini.versions.operationSet,
        capabilities: ini.capabilities,
        commonResources: ini.commonResources,
        moduleResources: ini.moduleResources,
        duplicates: ini.duplicates,
        unknownKeys: ini.unknownKeys,
        iniBytes: iniStat?.size ?? 0,
      });
    } catch (error) {
      modules.push({
        id: entry.name,
        slug: toSlug(entry.name),
        dirName: entry.name,
        path: modulePath,
        moduleName: entry.name,
        moduleIniPath: iniPath,
        version: null,
        operationSetVersion: null,
        capabilities: { singlePlayer: false, multiplayer: false },
        commonResources: [],
        moduleResources: [],
        duplicates: [],
        unknownKeys: [],
        iniBytes: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  modules.sort((a, b) => {
    const native = (m) => (m.id.toLowerCase() === 'native' ? 0 : 1);
    return native(a) - native(b) || a.id.localeCompare(b.id);
  });
  return modules;
}

/**
 * Find a module by id or slug (case-insensitive).
 * @param {WarbandModule[]} modules
 * @param {string} idOrSlug
 */
export function findModule(modules, idOrSlug) {
  const needle = idOrSlug.toLowerCase();
  return modules.find((m) => m.id.toLowerCase() === needle || m.slug === needle) ?? null;
}
