import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectStore } from '../../engine/projects/projectStore.js';
import { WorkspaceStore } from '../../engine/resources/workspace.js';

test('lists and restores project backups with confirmation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wos-backups-'));
  const store = new ProjectStore({ rootDir: root });
  await store.init();

  const project = await store.create({
    name: 'Backup Test',
    installationId: 'install',
    installationPath: 'C:/game',
    moduleId: 'Native',
  });

  project.items.push({ id: 'a', baseItemId: 'itm_mail_shirt', notes: '', overrides: {} });
  await store.save(project);
  project.items.push({ id: 'b', baseItemId: 'itm_helmet', notes: '', overrides: {} });
  await store.save(project);

  const backups = await store.listBackups();
  assert.equal(backups.length, 2);
  assert.ok(backups.every((backup) => backup.sha256.length === 64));

  // Pick the oldest snapshot explicitly (mtime ties are possible).
  let oldest = null;
  for (const backup of backups) {
    const snapshot = JSON.parse(await readFile(backup.path, 'utf8'));
    if (snapshot.items.length === 0) oldest = backup;
  }
  assert.ok(oldest, 'the initial snapshot must exist');
  await assert.rejects(() => store.restoreBackup(oldest.path, 'wrong'), /Confirmation required/);

  const result = await store.restoreBackup(oldest.path, project.id);
  assert.equal(result.project.items.length, 0);
  assert.ok(result.previousBackup);
  assert.equal((await store.load(project.id)).items.length, 0);
});

test('restores workspace backups and rejects tampered files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wos-ws-backups-'));
  const store = new WorkspaceStore({ rootDir: root });
  await store.init();
  const workspace = await store.create({ label: 'Backup WS' });

  await store.writeFile(workspace.id, 'Resource/a.bin', Buffer.from([1, 2, 3]));
  await store.writeFile(workspace.id, 'Resource/a.bin', Buffer.from([4, 5]));

  const backups = await store.listBackups(workspace.id);
  assert.equal(backups.length, 1);
  const backup = backups[0];
  assert.equal(backup.file, 'Resource/a.bin');

  await assert.rejects(() => store.restoreBackup(workspace.id, backup.path, 'wrong'), /Confirmation required/);

  const restored = await store.restoreBackup(workspace.id, backup.path, workspace.id);
  assert.deepEqual(Array.from(await readFile(restored.file)), [1, 2, 3]);
  assert.equal((await store.listBackups(workspace.id)).length, 2);

  // Tamper with a backup and ensure the hash check stops the restore.
  const after = (await store.listBackups(workspace.id)).find((entry) => entry.path !== backup.path);
  await writeFile(after.path, Buffer.from([9, 9, 9]));
  await assert.rejects(
    () => store.restoreBackup(workspace.id, after.path, workspace.id),
    /hash does not match/,
  );
});

test('refuses restore paths outside the backup roots', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wos-backup-escape-'));
  const projects = new ProjectStore({ rootDir: root });
  await projects.init();
  await assert.rejects(() => projects.restoreBackup('C:/Windows/not-a-backup.json', 'x'), /outside/);

  const workspaces = new WorkspaceStore({ rootDir: root });
  await workspaces.init();
  const workspace = await workspaces.create({ label: 'Escape' });
  await assert.rejects(
    () => workspaces.restoreBackup(workspace.id, path.join(root, 'outside.bin'), workspace.id),
    /outside/,
  );
});
