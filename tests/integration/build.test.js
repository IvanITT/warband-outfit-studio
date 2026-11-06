import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEngine } from '../../engine/index.js';
import { sha256File } from '../../engine/util/fsx.js';
import { parseBrf } from '../../engine/resources/brf.js';
import { createModel, applyTransform, modelToOverride } from '../../frontend/js/mesh-edit.js';

const GAME = process.env.WARBAND_DIR ?? 'C:/Games/Mount and Blade Complete Collection/Mount and Blade - Warband';
const hasGame = existsSync(path.join(GAME, 'mb_warband.exe'));

test('builds a project overlay with mesh, material and item overrides', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-build-'));
  const engine = await createEngine({ projectRoot, installationPath: GAME, cache: false });
  const project = await engine.projects.create({
    name: 'Build Test',
    installationId: engine.installation.id,
    installationPath: engine.installation.rootPath,
    moduleId: 'Native',
  });

  // Mesh override: move the shirt by 0.25 on X.
  const mesh = await engine.getMeshEditable('Native', 'mail_shirt_a');
  const model = createModel(mesh);
  applyTransform(model, { vertices: [...Array(model.vertexPosition.length).keys()] }, {
    mode: 'translate', axis: 'x', amount: 0.25, step: 0,
  });
  await engine.saveMeshOverride(project.id, modelToOverride(model, mesh.source));

  // Material override: visible colour change.
  const material = await engine.getMaterialEditable('Native', 'mail_shirt_a');
  const materialOverride = {
    schemaVersion: 1,
    id: 'mail_shirt_a',
    source: { moduleId: 'Native', material: 'mail_shirt_a', brf: material.material.brf },
    fields: { ...material.fields, r: 10, g: 20, b: 30, specular: 3.5 },
    editedAt: new Date().toISOString(),
  };
  await engine.saveMaterialOverride(project.id, materialOverride);

  // Item override: edit a base item.
  const item = await engine.getItemEditable('Native', 'itm_mail_shirt');
  const fields = {
    name: 'Built_Mail', plural: 'Built_Mails', flags: item.item.flags,
    capabilities: item.item.capabilities, value: 1234, modifierBits: item.item.modifierBits,
    weight: 19, abundance: 100, headArmor: 0, bodyArmor: 44, legArmor: 12,
    difficulty: 8, hitPoints: 0, speedRating: 0, missileSpeed: 0, weaponLength: 0,
    maxAmmo: 0, thrustDamage: 0, swingDamage: 0,
  };
  await engine.saveItemOverride(project.id, {
    schemaVersion: 1, id: 'itm_mail_shirt', baseItemId: 'itm_mail_shirt',
    mode: 'edit', moduleId: 'Native', fields,
    meshes: item.item.meshes, factions: item.item.factions, triggers: item.item.triggers,
  });

  const beforeMesh = await sha256File(mesh.source.brf);
  const beforeMaterial = await sha256File(material.material.brf);
  const built = await engine.buildProject(project.id);
  assert.equal(built.mode, 'overlay');
  assert.ok(built.manifest.summary.files >= 4);
  assert.ok(built.files.some((file) => file.kind === 'mesh'));
  assert.ok(built.files.some((file) => file.kind === 'material'));
  assert.ok(built.files.some((file) => file.kind === 'texture'));
  assert.ok(built.files.some((file) => file.kind === 'items'));

  assert.equal(await sha256File(mesh.source.brf), beforeMesh);
  assert.equal(await sha256File(material.material.brf), beforeMaterial);

  const root = path.join(projectRoot, 'workspace', built.workspaceId);
  const itemFile = path.join(root, 'Modules', 'Native', 'item_kinds1.txt');
  assert.equal(existsSync(itemFile), true);
  const itemText = await readFile(itemFile, 'utf8');
  assert.match(itemText, /itm_mail_shirt Built_Mail Built_Mails/);

  const materialFile = path.join(root, 'Modules', 'Native', 'Resource', 'materials.brf');
  assert.equal(existsSync(materialFile), true);
  const materialDoc = parseBrf(await readFile(materialFile));
  const editedMaterial = materialDoc.materials.find((entry) => entry.name === 'mail_shirt_a');
  assert.equal(editedMaterial.r, 10);
  assert.equal(editedMaterial.g, 20);
  assert.equal(editedMaterial.b, 30);
  assert.equal(editedMaterial.specular, 3.5);

  const meshFile = path.join(root, 'Modules', 'Native', 'Resource', 'armors_g.brf');
  assert.equal(existsSync(meshFile), true);
  assert.equal(existsSync(path.join(root, 'build.json')), true);
  assert.equal(existsSync(path.join(root, 'build.log')), true);

  const listed = await engine.listBuilds();
  assert.ok(listed.builds.some((entry) => entry.id === built.buildId));
  const fetched = await engine.getBuild(built.buildId);
  assert.equal(fetched.manifest.projectId, project.id);
  assert.match(fetched.log, /Build /);
});

test('rejects a build with invalid overrides before writing a workspace', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-build-bad-'));
  const engine = await createEngine({ projectRoot, installationPath: GAME, cache: false });
  const project = await engine.projects.create({
    name: 'Bad Build',
    installationId: engine.installation.id,
    installationPath: engine.installation.rootPath,
    moduleId: 'Native',
  });
  const item = await engine.getItemEditable('Native', 'itm_mail_shirt');
  await engine.projects.saveItemOverride(project.id, {
    schemaVersion: 1,
    id: 'itm_mail_shirt',
    baseItemId: 'itm_mail_shirt',
    mode: 'edit',
    moduleId: 'Native',
    fields: {
      name: 'Broken', plural: 'Broken', flags: item.item.flags,
      capabilities: item.item.capabilities, value: 1, modifierBits: 0,
      weight: 1, abundance: 0, headArmor: 0, bodyArmor: 0, legArmor: 0,
      difficulty: 0, hitPoints: 0, speedRating: 0, missileSpeed: 0,
      weaponLength: 0, maxAmmo: 0, thrustDamage: 0, swingDamage: 0,
    },
    meshes: [{ name: 'missing_mesh_for_build', modifierBits: 0 }],
    factions: [], triggers: [],
  });

  await assert.rejects(() => engine.buildProject(project.id), (error) => {
    assert.equal(error.code, 'BUILD_VALIDATION_FAILED');
    return true;
  });
  assert.equal((await engine.listBuilds()).builds.length, 0);
});
