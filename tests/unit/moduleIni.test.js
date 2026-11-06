import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseModuleIniFile } from '../../engine/modules/moduleIni.js';

const FIXTURE = [
  '# comment at top',
  'module_name = Test_Mod   # inline comment',
  'compatible_with_warband = 1',
  'module_version = 7',
  'operation_set_version = 1168',
  'has_single_player = 0',
  'has_multiplayer = 1',
  'scan_module_textures = 1',
  'load_resource = textures',
  'load_resource = materials',
  'load_mod_resource = custom',
  'unknown_experimental_key = 42',
  'module_name = Duplicated',
].join('\r\n') + '\r\n';

async function parseFixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wos-ini-'));
  const file = path.join(dir, 'module.ini');
  await writeFile(file, FIXTURE, 'utf8');
  return parseModuleIniFile(file);
}

test('parses keys, comments and repeated resources', async () => {
  const ini = await parseFixture();
  // Duplicate keys are reported and the last value wins (INI semantics).
  assert.equal(ini.moduleName, 'Duplicated');
  assert.deepEqual(ini.commonResources, ['textures', 'materials']);
  assert.deepEqual(ini.moduleResources, ['custom']);
  assert.equal(ini.versions.module, '7');
  assert.equal(ini.versions.operationSet, '1168');
  assert.equal(ini.capabilities.singlePlayer, false);
  assert.equal(ini.capabilities.multiplayer, true);
  assert.deepEqual(ini.unknownKeys, ['unknown_experimental_key']);
  assert.deepEqual(ini.duplicates, ['module_name']);
  assert.equal(ini.entries.length, 12);
});

test('defaults to single player + multiplayer when the flags are absent', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wos-ini2-'));
  const file = path.join(dir, 'module.ini');
  await writeFile(file, 'module_name = Bare\r\n', 'utf8');
  const ini = await parseModuleIniFile(file);
  assert.deepEqual(ini.capabilities, { singlePlayer: true, multiplayer: true });
  assert.equal(ini.versions.module, null);
});
