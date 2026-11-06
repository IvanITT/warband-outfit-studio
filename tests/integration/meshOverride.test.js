import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEngine } from '../../engine/index.js';
import { parseBrf } from '../../engine/resources/brf.js';
import { readMeshGeometry } from '../../engine/resources/geometry.js';
import { sha256File } from '../../engine/util/fsx.js';
import {
  createModel, applyTransform, duplicateFaces, modelToOverride, EditError,
} from '../../frontend/js/mesh-edit.js';

const GAME = process.env.WARBAND_DIR ?? 'C:/Games/Mount and Blade Complete Collection/Mount and Blade - Warband';
const hasGame = existsSync(path.join(GAME, 'mb_warband.exe'));

test('edits a real mesh, stores an override and exports it to a workspace', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-meshedit-'));
  const engine = await createEngine({ projectRoot, installationPath: GAME, cache: false });

  const editable = await engine.getMeshEditable('Native', 'mail_shirt_a');
  assert.equal(editable.rigged, true);
  assert.equal(editable.frameCount, 2);

  const model = createModel(editable);
  const originalBounds = { ...editable.bbox };
  applyTransform(model, { vertices: [...Array(model.vertexPosition.length).keys()] }, {
    mode: 'translate', axis: 'x', amount: 0.25, step: 0,
  });

  const override = modelToOverride(model, editable.source);
  assert.equal(override.id, 'mail_shirt_a');
  assert.equal(override.stats.vertices, editable.counts.vertices);

  // Guessed topology edit on a rigged mesh must be rejected.
  assert.throws(() => duplicateFaces(model, [0]), EditError);

  const project = await engine.projects.create({
    name: 'Mesh Edits',
    installationId: engine.installation.id,
    installationPath: engine.installation.rootPath,
    moduleId: 'Native',
  });
  await engine.saveMeshOverride(project.id, override);

  const list = await engine.listMeshOverrides(project.id);
  assert.equal(list.length, 1);
  assert.equal((await engine.getMeshOverride(project.id, 'mail_shirt_a')).layout, editable.layout);

  const before = await sha256File(editable.source.brf);
  const exported = await engine.exportMeshOverride(project.id, 'mail_shirt_a');
  assert.equal(await sha256File(editable.source.brf), before, 'source BRF must not change');
  assert.ok(exported.file.startsWith(path.join(projectRoot, 'workspace')));
  assert.equal(exported.vertices, editable.counts.vertices);
  assert.equal(exported.faces, editable.counts.faces);

  const output = await readFile(exported.file);
  const doc = parseBrf(output);
  const mesh = doc.meshes.find((candidate) => candidate.name === 'mail_shirt_a');
  assert.ok(mesh);
  const geometry = readMeshGeometry(output, mesh);
  assert.equal(geometry.vertexCount, editable.counts.vertices);
  assert.equal(geometry.faceCount, editable.counts.faces);
  assert.equal(geometry.frames.length, 2, 'vertex-animation frames must be preserved');
  assert.ok(Math.abs(geometry.bbox.min[0] - (originalBounds.min[0] + 0.25)) < 0.001);
});

test('rejects an invalid override', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-meshedit-bad-'));
  const engine = await createEngine({ projectRoot, installationPath: GAME, cache: false });
  const editable = await engine.getMeshEditable('Native', 'mail_shirt_a');
  const model = createModel(editable);
  const override = modelToOverride(model, editable.source);
  override.arrays.indices.count = 3;
  override.arrays.indices.data = Buffer.from(new Uint32Array([0, 1, 9999]).buffer).toString('base64');

  const project = await engine.projects.create({
    name: 'Bad Edits',
    installationId: engine.installation.id,
    installationPath: engine.installation.rootPath,
    moduleId: 'Native',
  });
  await assert.rejects(() => engine.saveMeshOverride(project.id, override), /invalid/i);
});
