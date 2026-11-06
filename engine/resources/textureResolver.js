// @ts-check
/**
 * Texture resolution across a Warband installation.
 *
 * Search order (VERIFIED behaviour, see docs):
 *   1. `<module>/Textures/<name>.dds`
 *   2. `<install>/Textures/<name>.dds`
 *   3. `<install>/Textures/languages/<lang>/<name>.dds`
 *
 * BRF texture names usually include `.dds`; material references usually do not.
 * Both spellings are accepted. The engine also supports numbered pages
 * (`<name>_<page>.dds`, format string found in mb_warband.exe), which are
 * reported as `pages`.
 */

import path from 'node:path';
import { exists, listDir } from '../util/fsx.js';

/**
 * @typedef {Object} TextureHit
 * @property {string} name          Name as requested (normalized, no extension).
 * @property {string|null} filePath
 * @property {string|null} relativePath
 * @property {boolean} exists
 * @property {string[]} pages       Additional page files, when present.
 * @property {string[]} alternatives
 * @property {'module'|'game'|'language'|null} location
 */

/**
 * @param {string} name
 */
function normalize(name) {
  return name.toLowerCase().endsWith('.dds') ? name : `${name}.dds`;
}

/**
 * Build a case-insensitive index of DDS files under the supplied roots.
 * @param {Array<{ dir: string, baseDir: string, location: 'module'|'game'|'language' }>} roots
 */
export async function buildTextureIndex(roots) {
  /** @type {Map<string, Array<{ filePath:string, relativePath:string, location:string }>>} */
  const byName = new Map();

  for (const root of roots) {
    if (!root.dir || !(await exists(root.dir))) continue;
    const dirs = root.location === 'language'
      ? (await listDir(root.dir)).filter((entry) => entry.isDirectory()).map((entry) => path.join(root.dir, entry.name))
      : [root.dir];

    for (const dir of dirs) {
      for (const entry of await listDir(dir)) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.dds')) continue;
        const key = entry.name.toLowerCase();
        const filePath = path.join(dir, entry.name);
        const list = byName.get(key) ?? [];
        list.push({
          filePath,
          relativePath: path.relative(root.baseDir, filePath).replace(/\\/g, '/'),
          location: root.location,
        });
        byName.set(key, list);
      }
    }
  }

  return byName;
}

/**
 * @param {Map<string, Array<{filePath:string,relativePath:string,location:string}>>} index
 * @param {string} name
 * @returns {TextureHit}
 */
export function resolveTexture(index, name) {
  const fileName = normalize(name);
  const key = fileName.toLowerCase();
  const hits = index.get(key) ?? [];

  if (hits.length === 0) {
    return {
      name: name.replace(/\.dds$/i, ''),
      filePath: null,
      relativePath: null,
      exists: false,
      pages: [],
      alternatives: [],
      location: null,
    };
  }

  const order = /** @type {Record<string, number>} */ ({ module: 0, game: 1, language: 2 });
  const sorted = [...hits].sort((a, b) => (order[a.location] ?? 9) - (order[b.location] ?? 9));
  const best = sorted[0];

  // Numbered pages next to the primary file (engine format `%s_%d.dds`).
  const base = fileName.replace(/\.dds$/i, '');
  const pages = [];
  for (let i = 0; i < 32; i += 1) {
    const page = index.get(`${base}_${i}.dds`.toLowerCase());
    if (!page || page.length === 0) break;
    pages.push(page[0].filePath);
  }

  return {
    name: base,
    filePath: best.filePath,
    relativePath: best.relativePath,
    exists: true,
    pages,
    alternatives: sorted.slice(1).map((hit) => hit.filePath),
    location: /** @type {TextureHit['location']} */ (best.location),
  };
}

/**
 * @param {string} modulePath
 * @param {import('../installation/detect.js').WarbandInstallation} installation
 */
export async function createTextureResolver(modulePath, installation) {
  /** @type {Array<{dir:string,baseDir:string,location:'module'|'game'|'language'}>} */
  const roots = [
    { dir: path.join(modulePath, 'Textures'), baseDir: modulePath, location: 'module' },
    { dir: installation.texturesDir ?? '', baseDir: installation.rootPath, location: 'game' },
    {
      dir: installation.texturesDir ? path.join(installation.texturesDir, 'languages') : '',
      baseDir: installation.rootPath,
      location: 'language',
    },
  ];

  const index = await buildTextureIndex(roots);
  return {
    index,
    resolve: (/** @type {string} */ name) => resolveTexture(index, name),
    size: index.size,
  };
}
