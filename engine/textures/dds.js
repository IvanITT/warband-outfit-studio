// @ts-check
/**
 * DDS header reader.
 *
 * VERIFIED: Warband textures are standard DDS files (`DDS ` magic, 124-byte
 * header). The engine builds paths as `Textures/<name>_<page>.dds`
 * (string confirmed in mb_warband.exe) and exposes degraded variants as
 * `*_degraded_.dds`.
 */

import { FormatError } from '../util/binaryReader.js';

const DDS_MAGIC = 0x20534444; // "DDS "

/**
 * @typedef {Object} DdsInfo
 * @property {number} width
 * @property {number} height
 * @property {number} mipmaps
 * @property {string} format     fourCC when present, otherwise `RGB<bpp>`.
 * @property {number|null} dxgiFormat
 * @property {number} flags
 * @property {number} depth
 * @property {number} bytes
 */

/**
 * @param {Buffer} buffer
 * @param {{ file?: string }} [options]
 * @returns {DdsInfo}
 */
export function parseDds(buffer, options = {}) {
  const file = options.file;
  if (buffer.length < 128) {
    throw new FormatError('file too small for a DDS header', { file, offset: 0 });
  }
  if (buffer.readUInt32LE(0) !== DDS_MAGIC) {
    throw new FormatError('missing DDS magic', { file, offset: 0 });
  }
  const headerSize = buffer.readUInt32LE(4);
  if (headerSize !== 124) {
    throw new FormatError(`unexpected DDS header size ${headerSize}`, { file, offset: 4 });
  }

  const flags = buffer.readUInt32LE(8);
  const height = buffer.readUInt32LE(12);
  const width = buffer.readUInt32LE(16);
  const depth = buffer.readUInt32LE(24);
  const mipmaps = buffer.readUInt32LE(28);

  // Pixel format starts at byte 76 (11 reserved DWORDs after mipmap count).
  const pfSize = buffer.readUInt32LE(76);
  const pfFlags = buffer.readUInt32LE(80);
  const fourCC = buffer.toString('latin1', 84, 88);
  const rgbBitCount = buffer.readUInt32LE(88);

  let format = fourCC.trim() || `RGB${rgbBitCount}`;
  let dxgiFormat = null;
  let bytes = 128;

  if (fourCC === 'DX10') {
    if (buffer.length < 128 + 20) {
      throw new FormatError('truncated DX10 header', { file, offset: 128 });
    }
    dxgiFormat = buffer.readUInt32LE(128);
    format = `DX10:${dxgiFormat}`;
    bytes = 148;
  }

  return {
    width,
    height,
    mipmaps,
    format,
    dxgiFormat,
    flags,
    depth: depth || 1,
    bytes,
    _pixelFormat: { size: pfSize, flags: pfFlags },
  };
}

/**
 * @param {string} filePath
 * @returns {Promise<DdsInfo>}
 */
export async function parseDdsFile(filePath) {
  const { readFile } = await import('node:fs/promises');
  const buffer = await readFile(filePath);
  return parseDds(buffer, { file: filePath });
}
