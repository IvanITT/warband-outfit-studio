// @ts-check
/**
 * Cross-file BRF index.
 *
 * Warband item meshes and their materials/textures are not necessarily in the
 * same BRF:
 *
 *   itm_mail_shirt -> mesh `mail_shirt_a`      (CommonRes/armors_g.brf)
 *                  -> material `mail_shirt_a`  (CommonRes/materials.brf)
 *                  -> texture `mail_shirt_a.dds` (CommonRes/textures.brf)
 *
 * VERIFIED on the installed Native module. The index therefore loads every
 * BRF the module can see (global `CommonRes` + module `Resource`) and merges
 * them by name.
 *
 * A persistent per-file cache avoids re-parsing 147 MB / 219 files on every
 * launch. Cache validity is based on size + mtime + parser version.
 */

import path from 'node:path';
import { listFiles, readJson, statSafe, writeJsonAtomic } from '../util/fsx.js';
import { analyzeMeshName, parseBrfFile } from './brf.js';

export const PARSER_VERSION = 3;
const CACHE_SCHEMA = 1;

/**
 * @typedef {Object} MeshEntry
 * @property {string} name
 * @property {string} key
 * @property {string} brf
 * @property {number} flags
 * @property {string} material
 * @property {number} vertexVersion
 * @property {number} vertexCount
 * @property {number} faceCount
 * @property {number} frameCount
 * @property {number} rawStart
 * @property {number} rawEnd
 * @property {boolean} rigged
 * @property {import('./brf.js').MeshNameInfo} nameInfo
 */

/**
 * @typedef {Object} MaterialEntry
 * @property {string} name
 * @property {string} key
 * @property {string} brf
 * @property {string} shader
 * @property {string} diffuseA
 * @property {string} diffuseB
 * @property {string} bump
 * @property {string} enviro
 * @property {string} spec
 * @property {number} specular
 * @property {number} r
 * @property {number} g
 * @property {number} b
 * @property {number} flags
 */

/**
 * @typedef {Object} TextureEntry
 * @property {string} name
 * @property {string} key
 * @property {string} brf
 * @property {number} flags
 * @property {number} frames
 */

/**
 * @param {import('./brf.js').BrfDocument} doc
 * @param {string} file
 */
function summarizeDocument(doc, file) {
  return {
    version: doc.version,
    bytes: doc.fileBytes,
    counts: doc.counts,
    meshes: doc.meshes.map((mesh) => ({
      name: mesh.name,
      flags: mesh.flags,
      material: mesh.material,
      vertexVersion: mesh.vertexVersion,
      vertexCount: mesh.vertexCount,
      faceCount: mesh.faceCount,
      frameCount: mesh.frameCount,
      rawStart: mesh.rawStart,
      rawEnd: mesh.rawEnd,
      rigged: mesh.rigged,
    })),
    materials: doc.materials.map((material) => ({
      name: material.name,
      flags: material.flags,
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
    })),
    textures: doc.textures.map((texture) => ({
      name: texture.name,
      flags: texture.flags,
      frames: texture.frames,
    })),
    shaders: doc.shaders.map((shader) => ({ name: shader.name })),
    skeletonCount: doc.skeletons.length,
    animationCount: doc.animations.length,
    bodyCount: doc.bodies.length,
    file,
  };
}

/**
 * @param {string} cacheFile
 * @param {Map<string, {size:number,mtimeMs:number}>} current
 */
async function loadCache(cacheFile, current) {
  try {
    const cache = await readJson(cacheFile);
    if (cache?.schemaVersion !== CACHE_SCHEMA || cache?.parserVersion !== PARSER_VERSION) return null;
    /** @type {Map<string, any>} */
    const reusable = new Map();
    for (const [file, stat] of current) {
      const entry = cache.files?.[file];
      if (entry && entry.size === stat.size && entry.mtimeMs === stat.mtimeMs && !entry.error) {
        reusable.set(file, entry.summary);
      }
    }
    return reusable;
  } catch {
    return null;
  }
}

/**
 * @param {object} options
 * @param {import('../installation/detect.js').WarbandInstallation} options.installation
 * @param {import('../modules/moduleRegistry.js').WarbandModule} options.module
 * @param {string} options.cacheDir
 * @param {boolean} [options.useCache]
 * @returns {Promise<any>}
 */
export async function createBrfIndex(options) {
  const { installation, module, cacheDir } = options;
  const useCache = options.useCache !== false;
  const started = performance.now();

  /** @type {string[]} */
  const files = [];
  if (installation.commonResDir) {
    files.push(...(await listFiles(installation.commonResDir, { extensions: ['.brf'], maxDepth: 1 })));
  }
  const moduleResources = path.join(module.path, 'Resource');
  files.push(...(await listFiles(moduleResources, { extensions: ['.brf'], maxDepth: 1 })));
  files.sort();

  /** @type {Map<string, {size:number,mtimeMs:number}>} */
  const stats = new Map();
  for (const file of files) {
    const stat = await statSafe(file);
    if (stat?.isFile()) stats.set(file, { size: stat.size, mtimeMs: Math.round(stat.mtimeMs) });
  }

  const cacheFile = path.join(cacheDir, `brf-index-v${PARSER_VERSION}-${installation.id}-${module.slug}.json`);
  const cached = useCache ? await loadCache(cacheFile, stats) : null;

  /** @type {Map<string, any>} */
  const summaries = new Map();
  /** @type {Array<{file:string,error:string}>} */
  const parseErrors = [];
  let parsedCount = 0;
  let cachedCount = 0;

  for (const file of files) {
    const stat = stats.get(file);
    if (!stat) continue;
    const hit = cached?.get(file);
    if (hit) {
      summaries.set(file, hit);
      cachedCount += 1;
      continue;
    }
    try {
      const doc = await parseBrfFile(file);
      summaries.set(file, summarizeDocument(doc, file));
      parsedCount += 1;
    } catch (error) {
      parseErrors.push({ file, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // Persist the cache atomically. Only used files are written, so deleted BRFs
  // disappear from the cache on the next run.
  if (useCache) {
    const cacheObject = {
      schemaVersion: CACHE_SCHEMA,
      parserVersion: PARSER_VERSION,
      installationId: installation.id,
      module: module.id,
      generatedAt: new Date().toISOString(),
      files: Object.fromEntries(
        [...summaries.entries()].map(([file, summary]) => {
          const stat = stats.get(file);
          return [file, { size: stat?.size ?? 0, mtimeMs: stat?.mtimeMs ?? 0, summary }];
        }),
      ),
    };
    try {
      await writeJsonAtomic(cacheFile, cacheObject);
    } catch {
      /* a read-only cache directory must not break the app */
    }
  }

  /** @type {Map<string, MeshEntry[]>} */
  const meshes = new Map();
  /** @type {Map<string, MeshEntry[]>} */
  const meshesByBase = new Map();
  /** @type {Map<string, MaterialEntry[]>} */
  const materials = new Map();
  /** @type {Map<string, TextureEntry[]>} */
  const textures = new Map();
  /** @type {Map<string, string[]>} */
  const shaders = new Map();

  let totalBytes = 0;
  const fileSummaries = [];

  for (const [file, summary] of summaries) {
    totalBytes += summary.bytes ?? 0;
    fileSummaries.push({
      file,
      version: summary.version,
      bytes: summary.bytes,
      counts: summary.counts,
      skeletonCount: summary.skeletonCount,
      animationCount: summary.animationCount,
      bodyCount: summary.bodyCount,
    });

    for (const mesh of summary.meshes) {
      const key = mesh.name.toLowerCase();
      /** @type {MeshEntry} */
      const entry = {
        name: mesh.name,
        key,
        brf: file,
        flags: mesh.flags,
        material: mesh.material,
        vertexVersion: mesh.vertexVersion,
        vertexCount: mesh.vertexCount,
        faceCount: mesh.faceCount,
        frameCount: mesh.frameCount,
        rawStart: mesh.rawStart,
        rawEnd: mesh.rawEnd,
        rigged: mesh.rigged,
        nameInfo: analyzeMeshName(mesh.name),
      };
      const list = meshes.get(key) ?? [];
      list.push(entry);
      meshes.set(key, list);

      const baseKey = entry.nameInfo.base.toLowerCase();
      const baseList = meshesByBase.get(baseKey) ?? [];
      baseList.push(entry);
      meshesByBase.set(baseKey, baseList);
    }

    for (const material of summary.materials) {
      const key = material.name.toLowerCase();
      const list = materials.get(key) ?? [];
      list.push({ ...material, key, brf: file });
      materials.set(key, list);
    }

    for (const texture of summary.textures) {
      const key = texture.name.toLowerCase();
      const list = textures.get(key) ?? [];
      list.push({ ...texture, key, brf: file });
      textures.set(key, list);
    }

    for (const shader of summary.shaders) {
      const key = shader.name.toLowerCase();
      const list = shaders.get(key) ?? [];
      list.push(file);
      shaders.set(key, list);
    }
  }

  /**
   * Resolve a mesh and its family (base, LODs, extra pieces).
   * @param {string} name
   */
  function resolveMesh(name) {
    const info = analyzeMeshName(name);
    const baseKey = info.base.toLowerCase();
    const family = meshesByBase.get(baseKey) ?? [];
    const direct = meshes.get(name.toLowerCase()) ?? [];
    return {
      name,
      info,
      direct,
      family,
      base: family.filter((entry) => entry.nameInfo.lodLevel === 0 && entry.nameInfo.pieceIndex === 0),
      lods: family.filter((entry) => entry.nameInfo.lodLevel > 0 && entry.nameInfo.pieceIndex === 0),
      pieces: family.filter((entry) => entry.nameInfo.pieceIndex > 0),
      exists: direct.length > 0 || family.length > 0,
    };
  }

  /** @param {string} name */
  function resolveMaterial(name) {
    return materials.get(name.toLowerCase()) ?? [];
  }

  /** @param {string} name */
  function resolveTexture(name) {
    const key = name.toLowerCase().endsWith('.dds') ? name.toLowerCase() : `${name.toLowerCase()}.dds`;
    return textures.get(key) ?? [];
  }

  return {
    files: fileSummaries,
    parseErrors,
    meshes,
    meshesByBase,
    materials,
    textures,
    shaders,
    resolveMesh,
    resolveMaterial,
    resolveTexture,
    stats: {
      brfFiles: files.length,
      meshes: [...meshes.values()].reduce((sum, list) => sum + list.length, 0),
      materials: [...materials.values()].reduce((sum, list) => sum + list.length, 0),
      textures: [...textures.values()].reduce((sum, list) => sum + list.length, 0),
      shaders: shaders.size,
      bytes: totalBytes,
      parseErrors: parseErrors.length,
      parsedFiles: parsedCount,
      cachedFiles: cachedCount,
      buildMs: Math.round(performance.now() - started),
      cacheFile,
    },
  };
}
