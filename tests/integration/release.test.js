import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildRelease } from '../../tools/build-release.js';

const GAME = process.env.WARBAND_DIR ?? 'C:/Games/Mount and Blade Complete Collection/Mount and Blade - Warband';

test('builds a portable release and starts its server', { skip: existsSync(path.join(GAME, 'mb_warband.exe')) ? false : 'Warband not installed' }, async (t) => {
  const outRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-release-'));
  const outDir = path.join(outRoot, 'release');
  const result = await buildRelease({ outDir, includeRuntime: false });
  assert.equal(result.bundledRuntime, false);
  for (const relative of [
    'WARBand Outfit Studio.cmd',
    'WARBand Outfit Studio.exe',
    'BUILD-INFO.json',
    'backend/server/index.js',
    'engine/index.js',
    'frontend/index.html',
    'config/app.example.json',
    'docs/development/SETUP.md',
    'projects',
    'workspace',
    'cache',
    'backups',
  ]) {
    assert.equal(existsSync(path.join(outDir, relative)), true, `${relative} must exist`);
  }

  const info = JSON.parse(await readFile(path.join(outDir, 'BUILD-INFO.json'), 'utf8'));
  assert.equal(info.bundledRuntime, false);
  assert.equal(info.entrypoint, 'WARBand Outfit Studio.exe');
  assert.equal(info.runtimeEntrypoint, 'backend/server/index.js');

  const releaseServer = await import(pathToFileURL(path.join(outDir, 'backend', 'server', 'index.js')).href);
  const started = await releaseServer.startServer({
    projectRoot: outDir,
    port: 0,
    installationPath: GAME,
    cache: false,
  });
  t.after(() => new Promise((resolve) => started.server.close(resolve)));
  const health = await fetch(`${started.url}api/health`);
  assert.equal(health.status, 200);
  const payload = await health.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.service, 'warband-outfit-studio');
});
