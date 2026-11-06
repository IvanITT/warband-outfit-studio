/**
 * Minimal DDS decoder for the viewport (browser-side, no dependencies).
 *
 * Warband textures are overwhelmingly DXT1/DXT3/DXT5. The decoder returns the
 * first mip level as RGBA (top-down rows), ready for a THREE.DataTexture.
 */

const DDS_MAGIC = 0x20534444;
const DDPF_FOURCC = 0x4;

function rgb565(value) {
  const r = ((value >> 11) & 0x1f) * 255 / 31;
  const g = ((value >> 5) & 0x3f) * 255 / 63;
  const b = (value & 0x1f) * 255 / 31;
  return [r, g, b];
}

function colorTable(c0, c1, forceFourColor = false) {
  const a = rgb565(c0);
  const b = rgb565(c1);
  const table = [
    [...a, 255],
    [...b, 255],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  if (c0 > c1 || forceFourColor) {
    table[2] = [(2 * a[0] + b[0]) / 3, (2 * a[1] + b[1]) / 3, (2 * a[2] + b[2]) / 3, 255];
    table[3] = [(a[0] + 2 * b[0]) / 3, (a[1] + 2 * b[1]) / 3, (a[2] + 2 * b[2]) / 3, 255];
  } else {
    table[2] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, 255];
    table[3] = [0, 0, 0, 0];
  }
  return table;
}

function writeBlock(out, width, height, x0, y0, table, bits, alphaFn) {
  for (let py = 0; py < 4; py += 1) {
    for (let px = 0; px < 4; px += 1) {
      const x = x0 + px;
      const y = y0 + py;
      if (x >= width || y >= height) continue;
      const index = (py * 4 + px) * 2;
      const code = (bits >>> index) & 0x3;
      const color = table[code];
      const offset = (y * width + x) * 4;
      out[offset] = color[0];
      out[offset + 1] = color[1];
      out[offset + 2] = color[2];
      out[offset + 3] = alphaFn ? alphaFn(py * 4 + px) : color[3];
    }
  }
}

function decodeDxt1(view, dataOffset, width, height, out) {
  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
  for (let by = 0; by < blocksHigh; by += 1) {
    for (let bx = 0; bx < blocksWide; bx += 1) {
      const offset = dataOffset + (by * blocksWide + bx) * 8;
      const c0 = view.getUint16(offset, true);
      const c1 = view.getUint16(offset + 2, true);
      const bits = view.getUint32(offset + 4, true);
      writeBlock(out, width, height, bx * 4, by * 4, colorTable(c0, c1), bits, null);
    }
  }
}

function decodeDxt3(view, dataOffset, width, height, out) {
  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
  for (let by = 0; by < blocksHigh; by += 1) {
    for (let bx = 0; bx < blocksWide; bx += 1) {
      const offset = dataOffset + (by * blocksWide + bx) * 16;
      const alphaBits = [];
      for (let i = 0; i < 8; i += 1) {
        const byte = view.getUint8(offset + i);
        alphaBits.push((byte & 0x0f) * 17, (byte >> 4) * 17);
      }
      const c0 = view.getUint16(offset + 8, true);
      const c1 = view.getUint16(offset + 10, true);
      const bits = view.getUint32(offset + 12, true);
      writeBlock(out, width, height, bx * 4, by * 4, colorTable(c0, c1, true), bits, (i) => alphaBits[i]);
    }
  }
}

function decodeDxt5(view, dataOffset, width, height, out) {
  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
  for (let by = 0; by < blocksHigh; by += 1) {
    for (let bx = 0; bx < blocksWide; bx += 1) {
      const offset = dataOffset + (by * blocksWide + bx) * 16;
      const a0 = view.getUint8(offset);
      const a1 = view.getUint8(offset + 1);
      const alpha = [a0, a1];
      if (a0 > a1) {
        for (let i = 1; i <= 6; i += 1) alpha.push(((7 - i) * a0 + i * a1) / 7);
      } else {
        for (let i = 1; i <= 4; i += 1) alpha.push(((5 - i) * a0 + i * a1) / 5);
        alpha.push(0, 255);
      }

      let alphaIndices = 0n;
      for (let i = 0; i < 6; i += 1) alphaIndices |= BigInt(view.getUint8(offset + 2 + i)) << BigInt(8 * i);

      const c0 = view.getUint16(offset + 8, true);
      const c1 = view.getUint16(offset + 10, true);
      const bits = view.getUint32(offset + 12, true);
      writeBlock(out, width, height, bx * 4, by * 4, colorTable(c0, c1, true), bits, (i) => {
        const code = Number((alphaIndices >> BigInt(3 * i)) & 7n);
        return alpha[code];
      });
    }
  }
}

function decodeUncompressed(view, dataOffset, width, height, out, bitCount) {
  if (bitCount !== 32) throw new Error(`unsupported uncompressed DDS (${bitCount} bpp)`);
  for (let i = 0; i < width * height; i += 1) {
    const src = dataOffset + i * 4;
    // DDS 32-bit data is conventionally BGRA.
    out[i * 4] = view.getUint8(src + 2);
    out[i * 4 + 1] = view.getUint8(src + 1);
    out[i * 4 + 2] = view.getUint8(src);
    out[i * 4 + 3] = view.getUint8(src + 3);
  }
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @returns {{ width:number, height:number, format:string, mipmaps:number, data:Uint8ClampedArray }}
 */
export function decodeDds(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.byteLength < 128 || view.getUint32(0, true) !== DDS_MAGIC) {
    throw new Error('not a DDS file');
  }
  const height = view.getUint32(12, true);
  const width = view.getUint32(16, true);
  const mipmaps = view.getUint32(28, true);
  const pfFlags = view.getUint32(80, true);
  let fourCC = String.fromCharCode(
    view.getUint8(84), view.getUint8(85), view.getUint8(86), view.getUint8(87),
  ).replace(/\0/g, '').trim();
  const bitCount = view.getUint32(88, true);
  let dataOffset = 128;
  let dxgiFormat = null;

  if (fourCC === 'DX10') {
    dataOffset = 148;
    dxgiFormat = view.getUint32(128, true);
    const map = { 71: 'DXT1', 72: 'DXT1', 74: 'DXT3', 75: 'DXT3', 77: 'DXT5', 78: 'DXT5' };
    fourCC = map[dxgiFormat] ?? `DX10:${dxgiFormat}`;
  }

  const out = new Uint8ClampedArray(width * height * 4);
  if (fourCC === 'DXT1') decodeDxt1(view, dataOffset, width, height, out);
  else if (fourCC === 'DXT3') decodeDxt3(view, dataOffset, width, height, out);
  else if (fourCC === 'DXT5') decodeDxt5(view, dataOffset, width, height, out);
  else if ((pfFlags & DDPF_FOURCC) === 0) decodeUncompressed(view, dataOffset, width, height, out, bitCount);
  else throw new Error(`unsupported DDS format '${fourCC || `RGB${bitCount}`}'`);

  return { width, height, format: fourCC || `RGB${bitCount}`, mipmaps, data: out };
}
