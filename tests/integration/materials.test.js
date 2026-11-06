import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEngine } from '../../engine/index.js';
import { parseBrf } from '../../engine/resources/brf.js';
import { sha256File } from '../../engine/util/fsx.js';

const GAME = process.env.WARBAND_DIR ?? 'C:/Games/Mount and Blade Complete Collection/Mount and Blade - Warband';
const hasGame = existsSync(path.join(GAME, 'mb_warband.exe'));

test('edits a real material, stores an override and exports it with textures', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-materials-'));
  const engine = await createEngine({ projectRoot, installationPath: GAME, cache: false });

  const editable = await engine.getMaterialEditable('Native', 'mail_shirt_a');
  assert.equal(editable.material.name, 'mail_shirt_a');
  assert.ok(editable.fields.shader);
  assert.ok(editable.shaders.includes(editable.fields.shader));
  assert.equal(editable.textures.diffuseA.file.exists, true);
  assert.ok(editable.meshes.some((mesh) => mesh.name === 'mail_shirt_a'));

  const override = {
    schemaVersion: 1,
    id: 'mail_shirt_a',
    source: {
      moduleId: 'Native',
      material: 'mail_shirt_a',
      brf: editable.material.brf,
    },
    fields: {
      ...editable.fields,
      specular: 2.5,
      r: 64,
      g: 128,
      b: 191,
    },
    editedAt: new Date().toISOString(),
  };

  const project = await engine.projects.create({
    name: 'Material Edits',
    installationId: engine.installation.id,
    installationPath: engine.installation.rootPath,
    moduleId: 'Native',
  });
  await engine.saveMaterialOverride(project.id, override);
  assert.equal((await engine.listMaterialOverrides(project.id)).length, 1);

  const source = editable.material.brf;
  const before = await sha256File(source);
  const exported = await engine.exportMaterialOverride(project.id, 'mail_shirt_a');
  assert.equal(await sha256File(source), before, 'source BRF must not change');
  assert.ok(exported.file.startsWith(path.join(projectRoot, 'workspace')));
  assert.ok(exported.textures.length >= 1);

  const output = await readFile(exported.file);
  const doc = parseBrf(output);
  const material = doc.materials.find((candidate) => candidate.name === 'mail_shirt_a');
  assert.ok(material);
  assert.equal(material.specular, 2.5);
  assert.equal(material.r, 64);
  assert.equal(material.g, 128);
  assert.equal(material.b, 191);
  assert.equal(material.diffuseA, editable.fields.diffuseA);

  for (const texture of exported.textures) {
    assert.equal(existsSync(texture.path), true, `texture ${texture.name} must be copied`);
  }
  assert.equal(await sha256File(exported.textures[0].path), await sha256File(
    path.join(GAME, 'Textures', exported.textures[0].name),
  ));
});

test('imports and registers a DDS texture in a project', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-textures-'));
  const engine = await createEngine({ projectRoot, installationPath: GAME, cache: false });
  const project = await engine.projects.create({
    name: 'Texture Import',
    installationId: engine.installation.id,
    installationPath: engine.installation.rootPath,
    moduleId: 'Native',
  });
  const workspace = await engine.createWorkspace('textures', { reuse: true, moduleId: 'Native' });

  const buffer = await readFile(path.join(GAME, 'Textures', 'mail_shirt_a.dds'));
  const imported = await engine.importTexture(workspace.id, 'mail_shirt_a.dds', buffer);
  assert.equal(imported.width, 1024);
  assert.equal(imported.format, 'DXT1');
  assert.equal(imported.name, 'mail_shirt_a.dds');

  await engine.saveProjectTexture(project.id, imported);
  const textures = await engine.listProjectTextures(project.id);
  assert.equal(textures.length, 1);
  assert.equal(textures[0].name, 'mail_shirt_a.dds');
  const projectRaw = await engine.getProjectTextureFile(project.id, 'mail_shirt_a.dds');
  assert.equal(projectRaw.buffer.subarray(0, 4).toString('latin1'), 'DDS ');

  const invalid = Buffer.from('not a dds');
  await assert.rejects(() => engine.importTexture(workspace.id, 'bad.dds', invalid), (error) => {
    assert.equal(error.code, 'INVALID_DDS');
    return true;
  });
});

test('rejects an invalid material override', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-materials-bad-'));
  const engine = await createEngine({ projectRoot, installationPath: GAME, cache: false });
  const project = await engine.projects.create({
    name: 'Bad Material',
    installationId: engine.installation.id,
    installationPath: engine.installation.rootPath,
    moduleId: 'Native',
  });
  await assert.rejects(
    () => engine.saveMaterialOverride(project.id, {
      id: 'x',
      source: { moduleId: 'Native', material: 'x', brf: 'C:/x.brf' },
      fields: { shader: '', r: 2 },
    }),
    /invalid/i,
  );
});
