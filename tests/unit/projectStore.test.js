import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectStore, slugify } from '../../engine/projects/projectStore.js';

async function makeStore() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wos-projects-'));
  const store = new ProjectStore({ rootDir: root });
  await store.init();
  return { root, store };
}

test('slugify produces stable ids', () => {
  assert.equal(slugify('Mi Armadura Épica'), 'mi-armadura-epica');
  assert.equal(slugify('***'), 'project');
});

test('creates, loads, lists and backs up projects', async () => {
  const { store } = await makeStore();
  const project = await store.create({
    name: 'Test Outfit',
    installationId: 'install-1',
    installationPath: 'C:/game',
    moduleId: 'Native',
  });
  assert.equal(project.id, 'test-outfit');
  assert.equal(project.schemaVersion, 1);

  const loaded = await store.load(project.id);
  assert.equal(loaded.name, 'Test Outfit');

  const list = await store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].counts.items, 0);

  loaded.items.push({ id: 'item-1', baseItemId: 'itm_mail_shirt', notes: '', overrides: {} });
  await store.save(loaded);

  const backups = await readdir(path.join(store.backupDir));
  assert.equal(backups.length, 1, 'saving an existing project must create a backup');

  const reloaded = await store.load(project.id);
  assert.equal(reloaded.items.length, 1);
  assert.ok(reloaded.updatedAt >= reloaded.createdAt);
});

test('refuses path traversal in project ids', async () => {
  const { store } = await makeStore();
  assert.throws(() => store.fileFor('../evil'), /Invalid project id/);
  assert.throws(() => store.fileFor('UPPER'), /Invalid project id/);
});

test('refuses a mismatched id on load', async () => {
  const { store } = await makeStore();
  await writeFile(
    path.join(store.rootDir, 'mismatch.json'),
    JSON.stringify({ schemaVersion: 1, id: 'other' }),
    'utf8',
  );
  await assert.rejects(() => store.load('mismatch'), /does not match/);
});
