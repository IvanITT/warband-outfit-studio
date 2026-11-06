// @ts-check
/**
 * `skins.txt` parser (VERIFIED against process_skins.py and Native).
 *
 * Tokens are whitespace separated; line breaks are not significant. The parser
 * keeps only the character-composition fields needed by the outfit editor and
 * skips face keys, textures, voices and constraints by consuming their declared
 * counts.
 */

import { readTextFile } from '../util/textFile.js';

/**
 * @typedef {Object} WarbandSkin
 * @property {string} name
 * @property {number} flags
 * @property {string} body
 * @property {string} calf
 * @property {string} hand
 * @property {string} headMesh
 * @property {number} hairCount
 * @property {number} beardCount
 * @property {string} skeleton
 * @property {number} scale
 */

/**
 * @param {string} filePath
 */
export async function parseSkinsFile(filePath) {
  const { lines, encoding } = await readTextFile(filePath);
  const tokens = lines.join(' ').trim().split(/\s+/);
  let i = 0;

  const header = tokens.slice(0, 3).join(' ');
  if (!header.startsWith('skins_file version')) {
    throw new Error(`skins.txt: unsupported header '${tokens.slice(0, 3).join(' ')}'`);
  }
  i = 3;
  const declared = Number(tokens[i++]);
  if (!Number.isInteger(declared) || declared < 0) throw new Error('skins.txt: invalid skin count');

  /** @type {WarbandSkin[]} */
  const skins = [];
  for (let skinIndex = 0; skinIndex < declared; skinIndex += 1) {
    const name = tokens[i++];
    const flags = Number(tokens[i++]);
    const body = tokens[i++];
    const calf = tokens[i++];
    const hand = tokens[i++];
    const headMesh = tokens[i++];
    const faceKeys = Number(tokens[i++]);
    i += faceKeys * 6;

    const hairCount = Number(tokens[i++]);
    i += hairCount;
    const beardCount = Number(tokens[i++]);
    i += beardCount;
    const hairTexCount = Number(tokens[i++]);
    i += hairTexCount;
    const beardTexCount = Number(tokens[i++]);
    i += beardTexCount;
    const faceTexCount = Number(tokens[i++]);
    for (let t = 0; t < faceTexCount; t += 1) {
      i += 1; // texture name
      i += 1; // colour
      const hairMats = Number(tokens[i++]);
      const hairColors = Number(tokens[i++]);
      i += hairMats + hairColors;
    }
    const voiceCount = Number(tokens[i++]);
    i += voiceCount * 2;

    const skeleton = tokens[i++];
    const scale = Number(tokens[i++]);
    i += 2; // blood particle ids
    const constraintCount = Number(tokens[i++]);
    for (let c = 0; c < constraintCount; c += 1) {
      i += 2; // float + int
      const pairs = Number(tokens[i++]);
      i += pairs * 2;
    }

    skins.push({
      name,
      flags,
      body,
      calf,
      hand,
      headMesh,
      hairCount,
      beardCount,
      skeleton,
      scale,
    });
  }

  return { file: filePath, encoding, declared, skins };
}
