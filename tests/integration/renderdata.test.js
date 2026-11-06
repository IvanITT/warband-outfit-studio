import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEngine } from '../../engine/index.js';

const GAME = process.env.WARBAND_DIR ?? 'C:/Games/Mount and Blade Complete Collection/Mount and Blade - Warband';
const hasGame = existsSync(path.join(GAME, 'mb_warband.exe'));

function decode(encoded) {
  const binary = Buffer.from(encoded.data, 'base64');
  const Type = { Float32Array, Uint32Array }[encoded.type];
  return new Type(binary.buffer, binary.byteOffset, binary.byteLength / Type.BYTES_PER_ELEMENT);
}

test('builds render data from a real mesh', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-render-'));
  const engine = await createEngine({ projectRoot, installationPath: GAME, cache: false });
  const data = await engine.getMeshRenderData('Native', 'mail_shirt_a');

  assert.equal(data.mesh.name, 'mail_shirt_a');
  assert.equal(data.counts.vertices, 782);
  assert.equal(data.counts.faces, 1240);
  assert.equal(data.uvFlip, 'v');
  assert.ok(data.bbox.min[1] < data.bbox.max[1]);

  const positions = decode(data.arrays.positions);
  const normals = decode(data.arrays.normals);
  const uvs = decode(data.arrays.uvs);
  const indices = decode(data.arrays.indices);

  assert.equal(positions.length, data.counts.vertices * 3);
  assert.equal(normals.length, data.counts.vertices * 3);
  assert.equal(uvs.length, data.counts.vertices * 2);
  assert.equal(indices.length, data.counts.faces * 3);

  let maxIndex = 0;
  for (const value of indices) maxIndex = Math.max(maxIndex, value);
  assert.ok(maxIndex < data.counts.vertices);
  for (const value of positions) assert.ok(Number.isFinite(value));
});

test('serves raw texture bytes', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-texture-'));
  const engine = await createEngine({ projectRoot, installationPath: GAME, cache: false });
  const file = await engine.getTextureFile('Native', 'mail_shirt_a');
  assert.equal(file.buffer.subarray(0, 4).toString('latin1'), 'DDS ');
  assert.ok(file.buffer.length > 128);
  assert.ok(file.filePath.includes('Textures'));
});

test('reports missing textures with a structured code', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-texture-missing-'));
  const engine = await createEngine({ projectRoot, installationPath: GAME, cache: false });
  await assert.rejects(() => engine.getTextureFile('Native', 'definitely_missing'), (error) => {
    assert.equal(error.code, 'TEXTURE_NOT_FOUND');
    return true;
  });
});
