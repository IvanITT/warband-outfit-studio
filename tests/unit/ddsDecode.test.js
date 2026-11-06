import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeDds } from '../../frontend/js/dds.js';

function header(width, height, fourCC) {
  const buffer = new ArrayBuffer(128);
  const view = new DataView(buffer);
  view.setUint32(0, 0x20534444, true); // "DDS "
  view.setUint32(4, 124, true);
  view.setUint32(12, height, true);
  view.setUint32(16, width, true);
  view.setUint32(28, 1, true);
  view.setUint32(76, 32, true);
  view.setUint32(80, 4, true); // DDPF_FOURCC
  for (let i = 0; i < 4; i += 1) view.setUint8(84 + i, fourCC.charCodeAt(i));
  return buffer;
}

function dxt1Block(c0, c1, bits) {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint16(0, c0, true);
  view.setUint16(2, c1, true);
  view.setUint32(4, bits, true);
  return buffer;
}

function dxt5Block(a0, a1, alphaByte0, c0 = 0xffff, c1 = 0x0000, bits = 0) {
  const buffer = new ArrayBuffer(16);
  const view = new DataView(buffer);
  view.setUint8(0, a0);
  view.setUint8(1, a1);
  view.setUint8(2, alphaByte0);
  view.setUint16(8, c0, true);
  view.setUint16(10, c1, true);
  view.setUint32(12, bits, true);
  return buffer;
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(new Uint8Array(part), offset);
    offset += part.byteLength;
  }
  return out.buffer;
}

test('decodes a DXT1 block (4-color mode)', () => {
  const file = concat([header(4, 4, 'DXT1'), dxt1Block(0xf800, 0x07e0, 0)]);
  const image = decodeDds(file);
  assert.equal(image.width, 4);
  assert.equal(image.height, 4);
  assert.equal(image.format, 'DXT1');
  assert.deepEqual(Array.from(image.data.slice(0, 4)), [255, 0, 0, 255]);
  assert.equal(image.data.length, 4 * 4 * 4);
});

test('decodes DXT1 transparent mode', () => {
  // c0 <= c1 enables the 3-color + transparent mode; code 3 is transparent.
  const file = concat([header(4, 4, 'DXT1'), dxt1Block(0x0000, 0xffff, 0xffffffff)]);
  const image = decodeDds(file);
  assert.equal(image.data[3], 0);
});

test('decodes DXT5 alpha indices', () => {
  const file = concat([
    header(4, 4, 'DXT5'),
    dxt5Block(255, 0, 0x01), // first pixel alpha index = 1 → 0
  ]);
  const image = decodeDds(file);
  assert.equal(image.format, 'DXT5');
  assert.equal(image.data[3], 0);
  assert.equal(image.data[4 + 3], 255); // second pixel index 0 → 255
});

test('rejects files without the DDS magic', () => {
  const buffer = header(4, 4, 'DXT1');
  new DataView(buffer).setUint32(0, 0, true);
  assert.throws(() => decodeDds(buffer), /not a DDS/);
});
