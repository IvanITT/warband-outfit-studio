import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEngine } from '../../engine/index.js';
import { parseItemKindsFile } from '../../engine/items/itemKinds.js';

const GAME = process.env.WARBAND_DIR ?? 'C:/Games/Mount and Blade Complete Collection/Mount and Blade - Warband';
const hasGame = existsSync(path.join(GAME, 'mb_warband.exe'));

function fieldsFrom(item, overrides = {}) {
  return {
    name: 'Edited_Mail_Shirt',
    plural: 'Edited_Mail_Shirts',
    flags: item.flags,
    capabilities: item.capabilities,
    value: 1500,
    modifierBits: item.modifierBits,
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
    ...overrides,
  };
}

test('edits, validates and exports item overrides without touching the game', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-items-'));
  const engine = await createEngine({ projectRoot, installationPath: GAME, cache: false });
  const source = path.join(GAME, 'Modules', 'Native', 'item_kinds1.txt');
  const before = createHash('sha256').update(await readFile(source)).digest('hex');

  const editable = await engine.getItemEditable('Native', 'itm_mail_shirt');
  assert.equal(editable.item.id, 'itm_mail_shirt');
  assert.equal(editable.item.slot, 'body');
  assert.equal(editable.flags.type.name, 'itp_type_body_armor');
  assert.equal(editable.item.meshes[0].name, 'mail_shirt_a');
  assert.ok(engine.getItemSchema().types.length > 10);

  const installation = engine.requireInstallation();
  const project = await engine.projects.create({
    name: 'Item Test',
    installationId: installation.id,
    installationPath: installation.rootPath,
    moduleId: 'Native',
  });
  const override = {
    schemaVersion: 1,
    id: 'itm_mail_shirt',
    baseItemId: 'itm_mail_shirt',
    mode: 'edit',
    moduleId: 'Native',
    fields: fieldsFrom(editable.item),
    meshes: editable.item.meshes,
    factions: editable.item.factions,
    triggers: editable.item.triggers,
  };

  await engine.saveItemOverride(project.id, override);
  assert.equal((await engine.listItemOverrides(project.id)).length, 1);
  assert.equal((await engine.getItemOverride(project.id, 'itm_mail_shirt')).fields.bodyArmor, 44);

  await assert.rejects(
    () => engine.saveItemOverride(project.id, { ...override, fields: fieldsFrom(editable.item, { flags: 0x1F }) }),
    (error) => {
      assert.equal(error.code, 'INVALID_ITEM');
      return true;
    },
  );
  await assert.rejects(
    () => engine.saveItemOverride(project.id, { ...override, meshes: [{ name: 'definitely_missing_mesh', modifierBits: 0 }] }),
    (error) => {
      assert.equal(error.code, 'INVALID_ITEM');
      return true;
    },
  );
  await assert.rejects(
    () => engine.saveItemOverride(project.id, { ...override, id: 'itm_renamed' }),
    (error) => {
      assert.equal(error.code, 'INVALID_ITEM');
      return true;
    },
  );

  const created = {
    ...override,
    id: 'itm_test_new_armor',
    baseItemId: null,
    mode: 'create',
    fields: fieldsFrom(editable.item, { name: 'Test_New_Armor', plural: 'Test_New_Armors' }),
    meshes: [{ name: 'mail_shirt_a', modifierBits: 0 }],
    factions: [],
    triggers: [],
  };
  await engine.saveItemOverride(project.id, created);

  const exported = await engine.exportItemOverrides(project.id);
  assert.equal(exported.overrides, 2);
  assert.ok(exported.workspaceId);
  const text = await readFile(exported.file, 'utf8');
  assert.match(text, /itm_test_new_armor Test_New_Armor Test_New_Armors/);
  assert.match(text, /itm_mail_shirt Edited_Mail_Shirt Edited_Mail_Shirts/);
  assert.match(text, / 16842765 0 1500 /);

  const native = await parseItemKindsFile(source);
  const parsed = await parseItemKindsFile(exported.file);
  assert.equal(parsed.declaredCount, native.declaredCount + 1);
  assert.ok(parsed.items.some((item) => item.id === 'itm_test_new_armor'));
  const edited = parsed.items.find((item) => item.id === 'itm_mail_shirt');
  assert.equal(edited.bodyArmor, 44);
  assert.equal(edited.name, 'Edited_Mail_Shirt');

  const after = createHash('sha256').update(await readFile(source)).digest('hex');
  assert.equal(after, before, 'source item_kinds1.txt must remain untouched');

  await assert.rejects(() => engine.removeItemOverride(project.id, 'itm_mail_shirt', 'wrong'), (error) => {
    assert.equal(error.code, 'CONFIRMATION_REQUIRED');
    return true;
  });
  await engine.removeItemOverride(project.id, 'itm_mail_shirt', 'itm_mail_shirt');
  assert.equal((await engine.listItemOverrides(project.id)).length, 1);
});
