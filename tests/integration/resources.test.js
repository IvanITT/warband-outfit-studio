import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEngine } from '../../engine/index.js';

const GAME = process.env.WARBAND_DIR ?? 'C:/Games/Mount and Blade Complete Collection/Mount and Blade - Warband';
const hasGame = existsSync(path.join(GAME, 'mb_warband.exe'));

async function makeEngine() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-resources-'));
  return createEngine({ projectRoot, installationPath: GAME, cache: false });
}

test('lists indexes meshes, materials, textures and shaders', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const engine = await makeEngine();

  const meshes = await engine.listResources('Native', { type: 'mesh', q: 'mail_shirt', limit: 10 });
  assert.ok(meshes.total >= 1);
  assert.ok(meshes.items.some((item) => item.name === 'mail_shirt_a'));

  const materials = await engine.listResources('Native', { type: 'material', q: 'mail_shirt', limit: 10 });
  assert.ok(materials.items.some((item) => item.name === 'mail_shirt_a'));

  const textures = await engine.listResources('Native', { type: 'texture', q: 'mail_shirt', limit: 10 });
  assert.ok(textures.items.some((item) => item.name === 'mail_shirt_a.dds' && item.exists));

  const shaders = await engine.listResources('Native', { type: 'shader', q: 'simple_shader', limit: 10 });
  assert.ok(shaders.items.some((item) => item.name === 'simple_shader'));
});

test('mesh detail resolves material, textures and using items', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const engine = await makeEngine();
  const { detail } = await engine.getResourceDetail('Native', 'mesh', 'mail_shirt_a');

  assert.equal(detail.primary.name, 'mail_shirt_a');
  assert.equal(detail.material.name, 'mail_shirt_a');
  assert.equal(detail.textures.diffuseA.file.exists, true);
  assert.equal(detail.textures.bump.dds.width, 1024);
  assert.ok(detail.usedByItems.some((item) => item.id === 'itm_mail_shirt'));
});

test('material detail lists meshes and textures', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const engine = await makeEngine();
  const { detail } = await engine.getResourceDetail('Native', 'material', 'mail_shirt_a');
  assert.ok(detail.meshes.some((mesh) => mesh.name === 'mail_shirt_a'));
  assert.equal(detail.textures.spec.file.exists, true);
});

test('texture detail lists dimensions and materials', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const engine = await makeEngine();
  const { detail } = await engine.getResourceDetail('Native', 'texture', 'mail_shirt_a');
  assert.equal(detail.dds.width, 1024);
  assert.equal(detail.file.exists, true);
  assert.ok(detail.materials.some((material) => material.name === 'mail_shirt_a'));
});

test('shader detail lists materials using it', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const engine = await makeEngine();
  const { detail } = await engine.getResourceDetail('Native', 'shader', 'simple_shader');
  assert.ok(detail.materials.length > 0);
  assert.ok(detail.sources.length > 0);
});

test('unknown resources return structured errors', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const engine = await makeEngine();
  await assert.rejects(() => engine.getResourceDetail('Native', 'mesh', 'definitely_missing'), (error) => {
    assert.equal(error.code, 'MESH_NOT_FOUND');
    return true;
  });
});
