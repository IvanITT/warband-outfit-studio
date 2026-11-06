import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseBrf, parseBrfFile, analyzeMeshName } from '../../engine/resources/brf.js';

const GAME = process.env.WARBAND_DIR ?? 'C:/Games/Mount and Blade Complete Collection/Mount and Blade - Warband';
const COMMON = path.join(GAME, 'CommonRes');
const hasGame = existsSync(path.join(GAME, 'mb_warband.exe'));

test('parses a real armor BRF and consumes every byte', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const doc = await parseBrfFile(path.join(COMMON, 'armors_g.brf'));
  assert.equal(doc.version, 1);
  assert.equal(doc.meshes.length, 20);
  assert.equal(doc.bytesRead, doc.fileBytes);
  assert.ok(doc.meshes.every((mesh) => mesh.vertexVersion === 1 || mesh.vertexVersion === 2));
  assert.ok(doc.meshes.some((mesh) => mesh.nameInfo.isLod));
});

test('parses standalone material and texture packs', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const materials = await parseBrfFile(path.join(COMMON, 'materials.brf'));
  assert.equal(materials.materials.length, 526);
  assert.equal(materials.meshes.length, 0);

  const textures = await parseBrfFile(path.join(COMMON, 'textures.brf'));
  assert.equal(textures.textures.length, 644);
  assert.ok(textures.textures.every((texture) => texture.name.length > 0));
});

test('parses shaders with their option blocks', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const doc = await parseBrfFile(path.join(COMMON, 'core_shaders.brf'));
  assert.equal(doc.shaders.length, 139);
  assert.ok(doc.shaders.every((shader) => typeof shader.technique === 'string'));
});

test('parses an animation-only BRF', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const doc = await parseBrfFile(path.join(COMMON, 'ani_attacks.brf'));
  assert.equal(doc.animations.length, 22);
  assert.equal(doc.skeletons.length, 0);
  assert.equal(doc.bytesRead, doc.fileBytes);
});

test('rejects truncated files instead of guessing', () => {
  const buffer = Buffer.alloc(8);
  buffer.write('mesh', 0, 'latin1');
  buffer.writeUInt32LE(1, 4);
  assert.throws(() => parseBrf(buffer), /unexpected end of file|invalid/);
});

test('mesh name analysis handles pieces and LODs', () => {
  assert.equal(analyzeMeshName('common_tulbent_b.lod2.1').base, 'common_tulbent_b');
  assert.equal(analyzeMeshName('common_tulbent_b.lod2.1').lodLevel, 2);
  assert.equal(analyzeMeshName('common_tulbent_b.lod2.1').pieceIndex, 1);
});
