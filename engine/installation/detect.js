// @ts-check
/**
 * Detection of a Mount & Blade: Warband installation.
 *
 * Safety: this module never writes to the installation. It only reads.
 */

import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { exists, listDir, readJson, resolveCaseInsensitive, statSafe } from '../util/fsx.js';

/**
 * @typedef {Object} WarbandInstallation
 * @property {string} id
 * @property {string} rootPath
 * @property {string} executablePath
 * @property {string|null} version
 * @property {string} versionSource
 * @property {string} modulesDir
 * @property {string|null} commonResDir
 * @property {string|null} texturesDir
 * @property {string|null} soundsDir
 * @property {string|null} dataDir
 * @property {string|null} musicDir
 * @property {string|null} userDataDir
 * @property {number} moduleCount
 * @property {{exeSize:number|null,exeMtimeMs:number|null}} fingerprint
 * @property {string[]} diagnostics
 */

/** @returns {string[]} */
export function defaultCandidates() {
  const home = os.homedir();
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const candidates = [
    'C:/Games/Mount and Blade Complete Collection/Mount and Blade - Warband',
    `${programFilesX86}/Mount&Blade Warband`,
    `${programFiles}/Mount&Blade Warband`,
    `${programFilesX86}/Steam/steamapps/common/MountBlade Warband`,
    `${programFiles}/Steam/steamapps/common/MountBlade Warband`,
    'C:/GOG Games/Mount and Blade - Warband',
    'C:/GOG Games/Mount & Blade Warband',
    `${home}/Documents/Mount&Blade Warband`,
  ];
  if (process.env.WARBAND_DIR) candidates.unshift(process.env.WARBAND_DIR);
  return candidates;
}

/**
 * Read `Version:` from rgl_log.txt. This is evidence from the engine itself,
 * not a guess from the executable metadata (whose file version is 1.0.0.0).
 * @param {string} rootPath
 * @returns {Promise<{version:string|null,source:string}>}
 */
async function readEngineVersion(rootPath) {
  const logPath = await resolveCaseInsensitive(rootPath, 'rgl_log.txt');
  if (!logPath) return { version: null, source: 'none' };
  try {
    const text = await readFile(logPath, 'utf8');
    const match = text.match(/Version:\s*([0-9]+(?:\.[0-9]+)+)/);
    if (match) return { version: match[1], source: 'rgl_log.txt' };
  } catch {
    /* ignore */
  }
  return { version: null, source: 'rgl_log-unreadable' };
}

/**
 * Validate a directory and build an installation descriptor.
 * @param {string} rootPath
 * @returns {Promise<WarbandInstallation|null>}
 */
export async function describeInstallation(rootPath) {
  const diagnostics = [];
  if (!(await exists(rootPath))) {
    diagnostics.push('path does not exist');
    return null;
  }

  const executablePath = await resolveCaseInsensitive(rootPath, 'mb_warband.exe');
  const modulesDir = await resolveCaseInsensitive(rootPath, 'Modules');
  if (!executablePath) diagnostics.push('mb_warband.exe not found');
  if (!modulesDir) diagnostics.push('Modules directory not found');
  if (!executablePath || !modulesDir) {
    return null;
  }

  const exeStat = await statSafe(executablePath);
  const modules = await listDir(modulesDir);
  const moduleCount = modules.filter((entry) => entry.isDirectory()).length;
  const { version, source } = await readEngineVersion(rootPath);

  /** @param {string} name */
  const optional = async (name) => resolveCaseInsensitive(rootPath, name);

  const userDataDir = path.join(os.homedir(), 'Documents', 'Mount&Blade Warband');
  const baseName = path.basename(rootPath).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'warband';
  const pathHash = createHash('sha1').update(rootPath.toLowerCase()).digest('hex').slice(0, 8);

  return {
    id: `${baseName}-${pathHash}`.slice(0, 64),
    rootPath,
    executablePath,
    version,
    versionSource: source,
    modulesDir,
    commonResDir: await optional('CommonRes'),
    texturesDir: await optional('Textures'),
    soundsDir: await optional('Sounds'),
    dataDir: await optional('Data'),
    musicDir: await optional('music'),
    userDataDir: (await exists(userDataDir)) ? userDataDir : null,
    moduleCount,
    fingerprint: {
      exeSize: exeStat?.size ?? null,
      exeMtimeMs: exeStat ? Math.round(exeStat.mtimeMs) : null,
    },
    diagnostics,
  };
}

/**
 * Locate the installation, in priority order:
 *   1. explicit path argument
 *   2. `WARBAND_DIR`
 *   3. `config/app.json` → `installationPath`
 *   4. well-known paths
 *
 * @param {{ projectRoot: string, explicitPath?: string }} options
 * @returns {Promise<{installation:WarbandInstallation|null, candidates:Array<{path:string,valid:boolean}>, configPath:string}>}
 */
export async function detectInstallation(options) {
  const configPath = path.join(options.projectRoot, 'config', 'app.json');
  /** @type {string[]} */
  const ordered = [];

  if (options.explicitPath) ordered.push(options.explicitPath);
  if (process.env.WARBAND_DIR) ordered.push(process.env.WARBAND_DIR);
  try {
    const config = await readJson(configPath);
    if (config?.installationPath) ordered.push(String(config.installationPath));
  } catch {
    /* config is optional */
  }
  ordered.push(...defaultCandidates());

  const seen = new Set();
  const candidates = [];
  for (const candidate of ordered) {
    const normalized = path.resolve(candidate);
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const installation = await describeInstallation(normalized);
    candidates.push({ path: normalized, valid: Boolean(installation) });
    if (installation) {
      return { installation, candidates, configPath };
    }
  }
  return { installation: null, candidates, configPath };
}
