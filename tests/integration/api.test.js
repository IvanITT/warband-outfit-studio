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

  const schemaResponse = await fetch(`${base}/api/item-schema`);
  const itemSchema = await schemaResponse.json();
  assert.equal(itemSchema.ok, true);
  assert.ok(itemSchema.types.length > 10);

  const itemEditableResponse = await fetch(`${base}/api/items/itm_mail_shirt/editable?module=Native`);
  const editableItem = await itemEditableResponse.json();
  assert.equal(editableItem.ok, true);
  assert.equal(editableItem.item.meshes[0].name, 'mail_shirt_a');
  assert.equal(editableItem.flags.type.name, 'itp_type_body_armor');

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

  const editableResponse = await fetch(`${base}/api/meshes/mail_shirt_a/editable?module=Native`);
  const editable = await editableResponse.json();
  assert.equal(editable.ok, true);
  assert.equal(editable.rigged, true);
  assert.equal(editable.frameCount, 2);
  assert.equal(editable.arrays.vertexPosition.count, 782);
  assert.equal(editable.source.mesh, 'mail_shirt_a');

  const materialResponse = await fetch(`${base}/api/materials/mail_shirt_a/editable?module=Native`);
  const material = await materialResponse.json();
  assert.equal(material.ok, true);
  assert.ok(material.fields.shader);
  assert.ok(material.shaders.length > 0);
  assert.equal(material.textures.diffuseA.file.exists, true);

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

  const skinsResponse = await fetch(`${base}/api/skins?module=Native`);
  const skins = await skinsResponse.json();
  assert.equal(skins.ok, true);
  assert.deepEqual(skins.skins.map((skin) => skin.name), ['man', 'woman']);

  const characterResponse = await fetch(`${base}/api/characters?module=Native&skin=woman`);
  const character = await characterResponse.json();
  assert.equal(character.skin.name, 'woman');
  assert.equal(character.parts.length, 6);

  const outfitRenderResponse = await fetch(
    `${base}/api/meshes/male_head/outfit-render?module=Native&role=head`,
  );
  const posedHead = await outfitRenderResponse.json();
  assert.equal(posedHead.posed.bone, 'head');
  assert.equal(posedHead.posed.applied, true);
  assert.ok(posedHead.bbox.min[1] > 1.4);

  const analyzeResponse = await fetch(`${base}/api/outfits/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bodyBbox: { min: [-1, -1, -1], max: [1, 1, 1] },
      items: [{ slot: 'head', itemId: 'helmet', bbox: { min: [10, 10, 10], max: [11, 11, 11] } }],
    }),
  });
  const analysis = await analyzeResponse.json();
  assert.equal(analysis.summary.warnings, 1);

  const outfit = {
    schemaVersion: 1,
    id: 'api-outfit',
    name: 'API Outfit',
    moduleId: 'Native',
    bodySkin: 'man',
    entries: { body: 'itm_mail_shirt', head: '', hand: 'itm_leather_gloves', foot: '' },
    transforms: {},
  };
  const saveOutfitResponse = await fetch(`${base}/api/projects/${created.project.id}/outfits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outfit }),
  });
  assert.equal(saveOutfitResponse.status, 200);
  assert.equal((await saveOutfitResponse.json()).outfit.id, 'api-outfit');

  const outfitsResponse = await fetch(`${base}/api/projects/${created.project.id}/outfits`);
  assert.equal((await outfitsResponse.json()).outfits.length, 1);
  const outfitResponse = await fetch(`${base}/api/projects/${created.project.id}/outfits/api-outfit`);
  assert.equal((await outfitResponse.json()).outfit.name, 'API Outfit');

  const badOutfitDelete = await fetch(
    `${base}/api/projects/${created.project.id}/outfits/api-outfit?confirm=wrong`,
    { method: 'DELETE' },
  );
  assert.equal(badOutfitDelete.status, 400);
  const outfitDelete = await fetch(
    `${base}/api/projects/${created.project.id}/outfits/api-outfit?confirm=api-outfit`,
    { method: 'DELETE' },
  );
  assert.equal(outfitDelete.status, 200);

  const itemOverride = {
    schemaVersion: 1,
    id: 'itm_mail_shirt',
    baseItemId: 'itm_mail_shirt',
    mode: 'edit',
    moduleId: 'Native',
    fields: {
      name: 'API_Mail_Shirt',
      plural: 'API_Mail_Shirts',
      flags: editableItem.item.flags,
      capabilities: editableItem.item.capabilities,
      value: 1500,
      modifierBits: editableItem.item.modifierBits,
      weight: 19.5,
      abundance: 100,
      headArmor: 0,
      bodyArmor: 44,
      legArmor: 12,
      difficulty: 8,
      hitPoints: 0,
      speedRating: 0,
      missileSpeed: 0,
      weaponLength: 0,
      maxAmmo: 0,
      thrustDamage: 0,
      swingDamage: 0,
    },
    meshes: editableItem.item.meshes,
    factions: editableItem.item.factions,
    triggers: editableItem.item.triggers,
  };
  const itemOverrideResponse = await fetch(`${base}/api/projects/${created.project.id}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ override: itemOverride }),
  });
  assert.equal(itemOverrideResponse.status, 200);
  assert.equal((await itemOverrideResponse.json()).override.id, 'itm_mail_shirt');

  const itemOverridesResponse = await fetch(`${base}/api/projects/${created.project.id}/items`);
  assert.equal((await itemOverridesResponse.json()).items.length, 1);
  const itemOverrideGetResponse = await fetch(`${base}/api/projects/${created.project.id}/items/itm_mail_shirt`);
  assert.equal((await itemOverrideGetResponse.json()).override.fields.bodyArmor, 44);

  const itemExportResponse = await fetch(`${base}/api/projects/${created.project.id}/items/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceLabel: 'api-item-edits' }),
  });
  assert.equal(itemExportResponse.status, 200);
  const itemExport = await itemExportResponse.json();
  assert.equal(itemExport.overrides, 1);
  assert.ok(itemExport.file.endsWith('item_kinds1.txt'));

  const itemOverrideDelete = await fetch(
    `${base}/api/projects/${created.project.id}/items/itm_mail_shirt?confirm=itm_mail_shirt`,
    { method: 'DELETE' },
  );
  assert.equal(itemOverrideDelete.status, 200);

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
