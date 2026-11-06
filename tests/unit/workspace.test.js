import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../../engine/resources/workspace.js';

async function makeStore() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wos-workspace-'));
  const store = new WorkspaceStore({ rootDir: root });
  await store.init();
  return { root, store };
}

test('creates, lists and writes files inside a workspace', async () => {
  const { store } = await makeStore();
  const workspace = await store.create({ label: 'Armor tests' });
  assert.equal(workspace.id, 'armor-tests');

  const written = await store.writeFile(workspace.id, 'Resource/test.txt', Buffer.from('hello'));
  assert.equal(written.bytes, 5);
  assert.equal(await readFile(written.file, 'utf8'), 'hello');

  const list = await store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].files, 1);
});

test('backs up the previous revision before overwriting', async () => {
  const { store } = await makeStore();
  const workspace = await store.create({ label: 'Backups' });
  await store.writeFile(workspace.id, 'Resource/a.bin', Buffer.from([1, 2, 3]));
  const second = await store.writeFile(workspace.id, 'Resource/a.bin', Buffer.from([4, 5]));

  assert.ok(second.backup, 'a backup path must be returned');
  assert.deepEqual(Array.from(await readFile(second.backup)), [1, 2, 3]);
  assert.deepEqual(Array.from(await readFile(path.join(path.dirname(second.file), 'a.bin'))), [4, 5]);

  const backupDir = path.join(store.dirFor(workspace.id), '.backups');
  const stamps = await readdir(backupDir);
  assert.equal(stamps.length, 1);
});

test('prunes old workspace backups per file', async () => {
  const { store } = await makeStore();
  const workspace = await store.create({ label: 'Prune backups' });
  for (let revision = 0; revision < 4; revision += 1) {
    await store.writeFile(workspace.id, 'Resource/a.bin', Buffer.from(String(revision)));
  }
  assert.equal((await store.listBackups()).length, 3);
  const result = await store.pruneBackups(1);
  assert.equal(result.removed.length, 2);
  assert.equal(result.remaining, 1);
  assert.equal((await store.listBackups()).length, 1);
});

test('rejects absolute paths, traversal and invalid ids', async () => {
  const { store } = await makeStore();
  const workspace = await store.create({ label: 'Security' });

  assert.throws(() => store.resolve(workspace.id, '../escape.txt'), /cannot contain|escapes/);
  assert.throws(() => store.resolve(workspace.id, 'C:/Windows/system32/x.txt'), /relative/);
  assert.throws(() => store.resolve(workspace.id, '/etc/passwd'), /relative/);
  assert.throws(() => store.resolve('../evil', 'x.txt'), /Invalid workspace id/);
  await assert.rejects(
    () => store.writeFile(workspace.id, 'a/../../b.txt', Buffer.from('x')),
    /cannot contain|escapes/,
  );
});

test('requires an existing workspace', async () => {
  const { store } = await makeStore();
  await assert.rejects(() => store.writeFile('missing', 'a.txt', Buffer.from('x')));
});

test('removes a workspace only with its id as confirmation', async () => {
  const { store } = await makeStore();
  const workspace = await store.create({ label: 'Delete Me', moduleId: 'Native' });
  await store.writeFile(workspace.id, 'a.txt', Buffer.from('x'));

  await assert.rejects(() => store.remove(workspace.id, 'wrong'), /Confirmation required/);
  const result = await store.remove(workspace.id, workspace.id);
  assert.equal(result.removed, workspace.id);
  assert.equal((await store.list()).length, 0);
});
