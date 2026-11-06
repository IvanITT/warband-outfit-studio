import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEngine } from '../../engine/index.js';

const GAME = process.env.WARBAND_DIR ?? 'C:/Games/Mount and Blade Complete Collection/Mount and Blade - Warband';
const hasGame = existsSync(path.join(GAME, 'mb_warband.exe'));

test('bootstraps a profile from the detected installation', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-profiles-'));
  const engine = await createEngine({ projectRoot, installationPath: GAME, cache: false });
  const profiles = engine.getProfiles();
  assert.equal(profiles.profiles.length, 1);
  assert.equal(profiles.activeId, profiles.profiles[0].id);
  assert.equal(profiles.profiles[0].valid, true);
  assert.equal(profiles.profiles[0].version, '1.170');
  assert.equal(existsSync(path.join(projectRoot, 'config', 'profiles.json')), true);
});

test('deduplicates profiles by path and rejects invalid installations', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-profiles2-'));
  const engine = await createEngine({ projectRoot, installationPath: GAME, cache: false });

  const existing = await engine.addProfile({ path: GAME, label: 'Duplicate' });
  assert.equal(existing.created, false);
  assert.equal(engine.getProfiles().profiles.length, 1);

  await assert.rejects(
    () => engine.addProfile({ path: path.join(projectRoot, 'not-a-game'), label: 'Broken' }),
    /not a Mount & Blade/,
  );
  assert.equal(engine.getProfiles().profiles.length, 1);
});

test('removing a profile requires confirmation and clears the active install', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-profiles3-'));
  const engine = await createEngine({ projectRoot, installationPath: GAME, cache: false });
  const id = engine.getProfiles().activeId;

  await assert.rejects(() => engine.removeProfile(id, 'wrong'), /Confirmation required/);
  assert.equal(engine.getProfiles().profiles.length, 1);

  const result = await engine.removeProfile(id, id);
  assert.equal(result.profiles.profiles.length, 0);
  assert.equal(result.profiles.activeId, null);
  assert.equal(engine.getStatus().ok, false);
});
