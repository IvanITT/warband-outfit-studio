import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../backend/server/index.js';

const GAME = process.env.WARBAND_DIR ?? 'C:/Games/Mount and Blade Complete Collection/Mount and Blade - Warband';
const hasGame = existsSync(path.join(GAME, 'mb_warband.exe'));

test('HTTP API exposes installation, items, validation and projects', { skip: hasGame ? false : 'Warband not installed' }, async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-api-'));
  const started = await startServer({
    projectRoot,
    port: 0,
    host: '127.0.0.1',
    installationPath: GAME,
    cache: false,
  });
  t.after(() => new Promise((resolve) => started.server.close(resolve)));
  const base = `http://127.0.0.1:${started.port}`;

  const statusResponse = await fetch(`${base}/api/status`);
  assert.equal(statusResponse.status, 200);
  assert.equal(statusResponse.headers.get('content-security-policy') !== null, true);
  const status = await statusResponse.json();
  assert.equal(status.ok, true);
  assert.equal(status.installation.version, '1.170');

  const itemsResponse = await fetch(`${base}/api/items?module=Native&slot=body&limit=5`);
  const items = await itemsResponse.json();
  assert.equal(items.total, 132);
  assert.equal(items.items.length, 5);
  assert.ok(items.items.every((item) => item.slot === 'body'));

  const detailResponse = await fetch(`${base}/api/items/itm_mail_shirt?module=Native`);
  const detail = await detailResponse.json();
  assert.equal(detail.item.id, 'itm_mail_shirt');
  assert.equal(detail.chain.meshes[0].material.name, 'mail_shirt_a');
  assert.equal(detail.flags.type.name, 'itp_type_body_armor');
  assert.equal(detail.capabilities.value, '0');

  const validationResponse = await fetch(`${base}/api/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: 'Native', ids: ['itm_mail_shirt', 'itm_leather_gloves'] }),
  });
  const validation = await validationResponse.json();
  assert.equal(validation.summary.errors, 0);

  const profilesResponse = await fetch(`${base}/api/profiles`);
  const profiles = await profilesResponse.json();
  assert.equal(profiles.ok, true);
  assert.equal(profiles.profiles.length, 1);
  assert.equal(profiles.profiles[0].valid, true);

  const resourcesResponse = await fetch(`${base}/api/resources?module=Native&type=mesh&q=mail_shirt&limit=5`);
  const resources = await resourcesResponse.json();
  assert.equal(resources.ok, true);
  assert.ok(resources.total >= 1);

  const resourceResponse = await fetch(`${base}/api/resources/mesh/mail_shirt_a?module=Native`);
  const resource = await resourceResponse.json();
  assert.equal(resource.detail.material.name, 'mail_shirt_a');
  assert.ok(resource.detail.usedByItems.some((item) => item.id === 'itm_mail_shirt'));

  const geometryResponse = await fetch(`${base}/api/meshes/mail_shirt_a/geometry?module=Native`);
  const geometry = await geometryResponse.json();
  assert.equal(geometry.ok, true);
  assert.equal(geometry.counts.vertices, 782);
  assert.ok(geometry.arrays.positions.data.length > 100);
  assert.equal(geometry.arrays.positions.type, 'Float32Array');

  const textureResponse = await fetch(`${base}/api/textures/mail_shirt_a/raw?module=Native`);
  assert.equal(textureResponse.status, 200);
  assert.equal(textureResponse.headers.get('content-type'), 'application/octet-stream');
  const textureBytes = new Uint8Array(await textureResponse.arrayBuffer());
  assert.equal(String.fromCharCode(...textureBytes.slice(0, 4)), 'DDS ');

  const backupsResponse = await fetch(`${base}/api/backups`);
  const backupList = await backupsResponse.json();
  assert.equal(backupList.ok, true);
  assert.ok(Array.isArray(backupList.projects));
  assert.ok(Array.isArray(backupList.workspaces));

  const workspaceResponse = await fetch(`${base}/api/workspaces`, {    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'API Workspace', module: 'Native' }),
  });
  const createdWorkspace = await workspaceResponse.json();
  assert.equal(createdWorkspace.workspace.id, 'api-workspace');

  const workspacesResponse = await fetch(`${base}/api/workspaces`);
  const workspaceList = await workspacesResponse.json();
  assert.equal(workspaceList.workspaces.length, 1);

  const badDelete = await fetch(
    `${base}/api/workspaces/${createdWorkspace.workspace.id}?confirm=wrong`,
    { method: 'DELETE' },
  );
  assert.equal(badDelete.status, 400);

  const deleteResponse = await fetch(
    `${base}/api/workspaces/${createdWorkspace.workspace.id}?confirm=${createdWorkspace.workspace.id}`,
    { method: 'DELETE' },
  );
  assert.equal(deleteResponse.status, 200);
  assert.equal((await (await fetch(`${base}/api/workspaces`)).json()).workspaces.length, 0);

  const createResponse = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'API Test Project', module: 'Native' }),
  });
  const created = await createResponse.json();
  assert.equal(created.ok, true);
  assert.equal(created.project.id, 'api-test-project');

  const projectResponse = await fetch(`${base}/api/projects/${created.project.id}`);
  const project = await projectResponse.json();
  project.project.notes = 'edited through the API';
  const putResponse = await fetch(`${base}/api/projects/${created.project.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: project.project }),
  });
  assert.equal(putResponse.status, 200);

  const backups = await readdir(path.join(projectRoot, 'backups', 'projects'));
  assert.ok(backups.length >= 1);

  const indexResponse = await fetch(`${base}/`);
  assert.equal(indexResponse.status, 200);
  assert.match(await indexResponse.text(), /WARBand Outfit Studio/);
});

test('API returns a structured 404 for unknown items', { skip: hasGame ? false : 'Warband not installed' }, async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-api-404-'));
  const started = await startServer({ projectRoot, port: 0, installationPath: GAME, cache: false });
  t.after(() => new Promise((resolve) => started.server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${started.port}/api/items/itm_does_not_exist?module=Native`);
  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'ITEM_NOT_FOUND');
});
