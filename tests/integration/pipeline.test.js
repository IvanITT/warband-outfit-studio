import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createEngine } from '../../engine/index.js';
import { parseItemKindsFile } from '../../engine/items/itemKinds.js';
import { fileURLToPath } from 'node:url';

const GAME = process.env.WARBAND_DIR ?? 'C:/Games/Mount and Blade Complete Collection/Mount and Blade - Warband';
const hasGame = existsSync(path.join(GAME, 'mb_warband.exe'));
const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

test('engine detects the installation and inventories modules', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const engine = await createEngine({ projectRoot: PROJECT_ROOT, installationPath: GAME, cache: false });
  const status = engine.getStatus();
  assert.equal(status.ok, true);
  assert.equal(status.installation.version, '1.170');
  const ids = engine.modules.map((m) => m.id);
  assert.ok(ids.includes('Native'));
  assert.ok(ids.includes('Viking Conquest'));
  assert.ok(ids.includes('Napoleonic Wars'));
});

test('Native summary matches the REA analysis counts', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const engine = await createEngine({ projectRoot: PROJECT_ROOT, installationPath: GAME, cache: false });
  const summary = await engine.getModuleSummary('Native');
  assert.equal(summary.items.total, 620);
  assert.equal(summary.items.armor, 279);
  assert.equal(summary.items.bySlot.body, 132);
  assert.equal(summary.items.bySlot.head, 113);
  assert.equal(summary.items.bySlot.foot, 28);
  assert.equal(summary.items.bySlot.hand, 6);
  assert.equal(summary.resources.meshes, 7243);
  assert.equal(summary.resources.materials, 633);
  assert.equal(summary.resources.textures, 734);
});

test('resolves a real armor chain across BRF files', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const engine = await createEngine({ projectRoot: PROJECT_ROOT, installationPath: GAME, cache: false });
  const { item, chain, flags, capabilities } = await engine.getItemDetail('Native', 'itm_mail_shirt');

  assert.equal(item.slot, 'body');
  assert.equal(chain.meshes.length, 1);
  const mesh = chain.meshes[0];
  assert.equal(mesh.name, 'mail_shirt_a');
  assert.equal(mesh.resolved, true);
  assert.equal(mesh.material.name, 'mail_shirt_a');
  assert.deepEqual(
    mesh.material.textures.map((texture) => texture.role),
    ['diffuseA', 'bump', 'spec'],
  );
  for (const texture of mesh.material.textures) {
    assert.equal(texture.declared, true);
    assert.equal(texture.file.exists, true);
    assert.equal(texture.dds.width, 1024);
  }
  assert.equal(chain.summary.errors, 0);
  assert.equal(flags.type.name, 'itp_type_body_armor');
  assert.equal(flags.unknownHex, null);
  assert.ok(flags.flags.some((flag) => flag.name === 'itp_merchandise'));
  assert.equal(capabilities.value, '0');
});

test('resolves a composed mesh (pieces without a base mesh)', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const engine = await createEngine({ projectRoot: PROJECT_ROOT, installationPath: GAME, cache: false });
  const { item, chain } = await engine.getItemDetail('Native', 'itm_sarranid_felt_head_cloth_b');
  assert.equal(item.slot, 'head');
  assert.equal(chain.meshes[0].geometry.baseCount, 0);
  assert.equal(chain.meshes[0].geometry.pieceCount, 2);
  assert.ok(chain.meshes[0].geometry.lodLevels.includes(1));
  assert.ok(chain.issues.some((issue) => issue.code === 'WB-I-001'));
});

test('validates real armor items without errors', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const engine = await createEngine({ projectRoot: PROJECT_ROOT, installationPath: GAME, cache: false });
  const result = await engine.validate('Native', [
    'itm_mail_shirt',
    'itm_helmet_with_neckguard',
    'itm_leather_gloves',
    'itm_leather_boots',
  ]);
  assert.equal(result.summary.errors, 0);
  assert.equal(result.results.length, 4);
});

test('parses every module item file', async () => {
  const modules = ['Native', 'Viking Conquest', 'Napoleonic Wars'];
  for (const module of modules) {
    const file = path.join(GAME, 'Modules', module, 'item_kinds1.txt');
    if (!existsSync(file)) continue;
    const doc = await parseItemKindsFile(file);
    assert.equal(doc.items.length, doc.declaredCount);
  }
});
