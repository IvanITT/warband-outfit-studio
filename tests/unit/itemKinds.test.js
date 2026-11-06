import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseItemKindsFile,
  serializeItemDocument,
  renderItemHeader,
  classifyItem,
} from '../../engine/items/itemKinds.js';

const FIXTURE = [
  'itemsfile version 3',
  '2',
  ' itm_test_armor Test_Armor Test_Armors 1  test_mesh 0  16842765 0 100 0 2.500000 100 1 5 2 0 0 0 0 0 0 0 0',
  ' 0',
  '0',
  '',
  ' itm_test_clothing Test_Clothing Test_Clothes 1  cloth_mesh 0  16842749 0 10 0 0.500000 100 0 0 0 0 0 0 0 0 0 0 0',
  ' 1',
  ' 12',
  '0',
  '',
].join('\r\n') + '\r\n';

async function withFixture(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wos-items-'));
  const file = path.join(dir, 'item_kinds1.txt');
  await writeFile(file, FIXTURE, 'utf8');
  try {
    await callback(file, dir);
  } finally {
    /* temp directory is left to the OS */
  }
}

test('parses the item header, nested lines and stats', async () => {
  await withFixture(async (file) => {
    const doc = await parseItemKindsFile(file);
    assert.equal(doc.declaredCount, 2);
    assert.equal(doc.items.length, 2);

    const armor = doc.items[0];
    assert.equal(armor.id, 'itm_test_armor');
    assert.equal(armor.name, 'Test_Armor');
    assert.deepEqual(armor.meshes, [{ name: 'test_mesh', modifierBits: 0 }]);
    assert.equal(armor.flags, 16842765);
    assert.equal(armor.value, 100);
    assert.equal(armor.weight, 2.5);
    assert.equal(armor.headArmor, 1);
    assert.equal(armor.bodyArmor, 5);
    assert.equal(armor.legArmor, 2);
    assert.equal(armor.slot, 'body');
    assert.equal(armor.category, 'armor');

    const clothing = doc.items[1];
    assert.equal(clothing.slot, 'body');
    assert.equal(clothing.category, 'clothing');
    assert.deepEqual(clothing.factions, [12]);
  });
});

test('round-trips the original file byte-for-byte', async () => {
  await withFixture(async (file) => {
    const doc = await parseItemKindsFile(file);
    const serialized = serializeItemDocument(doc);
    assert.equal(serialized, FIXTURE);
    const original = await readFile(file, 'utf8');
    assert.equal(serialized, original);
  });
});

test('re-renders modified headers using Module System formatting', async () => {
  await withFixture(async (file) => {
    const doc = await parseItemKindsFile(file);
    doc.items[0].bodyArmor = 9;
    const header = renderItemHeader(doc.items[0]);
    assert.match(header, /^ itm_test_armor Test_Armor Test_Armors 1 test_mesh 0 16842765 0 100 0 2\.500000 100 1 9 2 0 0 0 0 0 0 0 0$/);
  });
});

test('classifies capes and slots', () => {
  assert.equal(classifyItem(0x0101000d, 'itm_coat_with_cape', 'Coat_with_Cape', 40).category, 'cape');
  assert.equal(classifyItem(0x0101000d, 'itm_tunic', 'Tunic', 0).category, 'clothing');
  assert.equal(classifyItem(0x0101000c, 'itm_helmet', 'Helmet', 0).slot, 'head');
  assert.equal(classifyItem(0x0101000f, 'itm_gloves', 'Gloves', 0).slot, 'hand');
  assert.equal(classifyItem(0x00000002, 'itm_sword', 'Sword', 0).isArmor, false);
});

test('rejects malformed records with the line number', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wos-items-bad-'));
  const file = path.join(dir, 'item_kinds1.txt');
  await writeFile(file, 'itemsfile version 3\r\n1\r\n not_an_item broken\r\n 0\r\n0\r\n', 'utf8');
  await assert.rejects(() => parseItemKindsFile(file), /item_kinds1\.txt:3/);
});
