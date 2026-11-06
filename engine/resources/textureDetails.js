// @ts-check
/**
 * Shared texture resolution detail used by the asset index and the UI.
 */

import { parseDdsFile } from '../textures/dds.js';

/**
 * @param {{ brfIndex: any, textures: any, ddsCache: Map<string, any> }} context
 * @param {string} name
 */
export async function resolveTextureDetails(context, name) {
  const declared = context.brfIndex.resolveTexture(name);
  const file = context.textures.resolve(name);
  let dds = null;
  let ddsError = null;

  if (file.exists && file.filePath) {
    try {
      if (context.ddsCache.has(file.filePath)) dds = context.ddsCache.get(file.filePath);
      else {
        dds = await parseDdsFile(file.filePath);
        context.ddsCache.set(file.filePath, dds);
      }
    } catch (error) {
      ddsError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    name,
    declared: declared.length > 0,
    brf: declared[0]?.brf ?? null,
    sources: [...new Set(declared.map((entry) => entry.brf))],
    file,
    dds: dds
      ? { width: dds.width, height: dds.height, format: dds.format, mipmaps: dds.mipmaps }
      : null,
    ddsError,
  };
}
