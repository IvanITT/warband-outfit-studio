import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseBrf, serializeBrf } from '../../engine/resources/brf.js';
import { createEngine } from '../../engine/index.js';
import { sha256File } from '../../engine/util/fsx.js';

const GAME = process.env.WARBAND_DIR ?? 'C:/Games/Mount and Blade Complete Collection/Mount and Blade - Warband';
const COMMON = path.join(GAME, 'CommonRes');
const hasGame = existsSync(path.join(GAME, 'mb_warband.exe'));

test('round-trips every CommonRes BRF byte-for-byte', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  let checked = 0;
  const failures = [];
  for (const name of await readdir(COMMON)) {
    if (!name.toLowerCase().endsWith('.brf')) continue;
    const file = path.join(COMMON, name);
    const source = await readFile(file);
    try {
      const doc = parseBrf(source, { file });
      const out = serializeBrf(doc, source);
      if (!out.equals(source)) failures.push(name);
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    checked += 1;
  }
  assert.ok(checked >= 20, `expected a corpus, got ${checked} files`);
  assert.deepEqual(failures, []);
});

test('modifies one mesh in a real BRF and preserves everything else', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const file = path.join(COMMON, 'armors_g.brf');
  const source = await readFile(file);
  const doc = parseBrf(source, { file });
  const mesh = doc.meshes.find((candidate) => candidate.name === 'mail_shirt_a');
  assert.ok(mesh);

  const { updateMesh } = await import('../../engine/resources/brf.js');
  updateMesh(doc, mesh, { material: 'unit_test_material' }, source);
  const out = serializeBrf(doc, source);

  const reparsed = parseBrf(out);
  assert.equal(reparsed.meshes.length, doc.meshes.length);
  assert.equal(reparsed.materials.length, doc.materials.length);
  assert.equal(reparsed.meshes.find((candidate) => candidate.name === 'mail_shirt_a').material, 'unit_test_material');
  assert.equal(serializeBrf(reparsed, out).equals(out), true);
});

test('reads real mesh geometry and validates counts', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-geometry-'));
  const engine = await createEngine({ projectRoot, installationPath: GAME, cache: false });
  const { mesh, geometry } = await engine.getMeshGeometry('Native', 'mail_shirt_a');

  assert.equal(geometry.vertexCount, mesh.vertexCount);
  assert.equal(geometry.faceCount, mesh.faceCount);
  assert.ok(geometry.vertexCount > 100);
  assert.ok(geometry.faceCount > 100);
  assert.equal(geometry.positions.length, geometry.positionCount * 3);
  assert.ok(geometry.rigging.length > 0, 'armor meshes are rigged to the body skeleton');
  assert.ok(geometry.bbox && geometry.bbox.max[1] > geometry.bbox.min[1]);

  let maxIndex = 0;
  for (const value of geometry.faces) maxIndex = Math.max(maxIndex, value);
  assert.ok(maxIndex < geometry.vertexCount, 'face indices must address valid vertices');
  for (const value of geometry.vertices.uv) assert.ok(Number.isFinite(value));
});

test('exports to a workspace without touching the installation', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-export-'));
  const engine = await createEngine({ projectRoot, installationPath: GAME, cache: false });
  const file = path.join(COMMON, 'armors_g.brf');
  const before = await sha256File(file);

  const workspace = await engine.createWorkspace('Export test');
  const result = await engine.exportBrf(workspace.id, file);

  assert.equal(result.bytes, (await readFile(file)).length);
  assert.equal(result.sha256, before);
  assert.equal(await sha256File(file), before, 'source BRF must be unchanged');
  assert.ok(result.file.startsWith(path.join(projectRoot, 'workspace')));
  assert.equal(existsSync(result.file), true);

  const workspaceFiles = await readdir(path.join(projectRoot, 'workspace', workspace.id), { recursive: true });
  assert.ok(workspaceFiles.some((entry) => String(entry).endsWith('armors_g.brf')));
});
