import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEngine } from '../../engine/index.js';
import { parseSkinsFile } from '../../engine/skins/skins.js';

const GAME = process.env.WARBAND_DIR ?? 'C:/Games/Mount and Blade Complete Collection/Mount and Blade - Warband';
const hasGame = existsSync(path.join(GAME, 'mb_warband.exe'));

test('parses Native skins.txt and resolves both human bodies', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const file = path.join(GAME, 'Modules', 'Native', 'skins.txt');
  const parsed = await parseSkinsFile(file);
  assert.equal(parsed.declared, 2);
  assert.deepEqual(parsed.skins.map((skin) => skin.name), ['man', 'woman']);
  assert.equal(parsed.skins[0].body, 'man_body');
  assert.equal(parsed.skins[0].calf, 'man_calf_l');
  assert.equal(parsed.skins[0].hand, 'm_handL');
  assert.equal(parsed.skins[0].headMesh, 'male_head');
  assert.equal(parsed.skins[0].skeleton, 'skel_human');
  assert.equal(parsed.skins[1].body, 'woman_body');
  assert.equal(parsed.skins[1].headMesh, 'female_head');

  for (const module of ['Viking Conquest', 'Napoleonic Wars']) {
    const extra = await parseSkinsFile(path.join(GAME, 'Modules', module, 'skins.txt'));
    assert.ok(extra.skins.length >= 2);
  }

  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-skins-'));
  const engine = await createEngine({ projectRoot, installationPath: GAME, cache: false });
  const skins = await engine.getSkins('Native');
  assert.deepEqual(skins.skins.map((skin) => skin.name), ['man', 'woman']);

  for (const name of ['man', 'woman']) {
    const character = await engine.getCharacter('Native', name);
    assert.equal(character.skin.name, name);
    assert.deepEqual(character.parts.map((part) => part.role), [
      'body', 'calf_l', 'calf_r', 'hand_l', 'hand_r', 'head',
    ]);
    assert.ok(character.parts.every((part) => part.material && part.brf));
  }

  await assert.rejects(() => engine.getCharacter('Native', 'missing'), (error) => {
    assert.equal(error.code, 'SKIN_NOT_FOUND');
    return true;
  });
});

test('builds outfit item meshes, rigid poses and persisted outfits', { skip: hasGame ? false : 'Warband not installed' }, async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'wos-outfit-'));
  const engine = await createEngine({ projectRoot, installationPath: GAME, cache: false });

  const gloves = await engine.getOutfitItemMeshes('Native', 'itm_leather_gloves');
  assert.deepEqual(gloves.meshes.map((mesh) => mesh.name), ['leather_gloves_L', 'leather_gloves_R']);

  const shirt = await engine.getOutfitItemMeshes('Native', 'itm_mail_shirt');
  assert.equal(shirt.meshes[0].name, 'mail_shirt_a');

  const headRaw = await engine.getMeshRenderData('Native', 'male_head');
  const headPosed = await engine.getOutfitMeshRenderData('Native', 'male_head', { role: 'head' });
  assert.equal(headPosed.posed.bone, 'head');
  assert.equal(headPosed.posed.applied, true);
  assert.ok(headPosed.bbox.min[1] > headRaw.bbox.max[1]);

  const bodyPosed = await engine.getOutfitMeshRenderData('Native', 'man_body', { role: 'body' });
  assert.equal(bodyPosed.posed.applied, false);

  const installation = engine.requireInstallation();
  const project = await engine.projects.create({
    name: 'Outfit Test',
    installationId: installation.id,
    installationPath: installation.rootPath,
    moduleId: 'Native',
  });
  const outfit = {
    schemaVersion: 1,
    id: 'knight',
    name: 'Knight',
    moduleId: 'Native',
    bodySkin: 'man',
    entries: {
      body: 'itm_mail_shirt',
      head: 'itm_helmet_with_neckguard',
      hand: 'itm_leather_gloves',
      foot: 'itm_leather_boots',
    },
    transforms: { head: { x: 0, y: 0.02, z: 0, scale: 1 } },
    updatedAt: new Date().toISOString(),
  };

  await engine.saveOutfit(project.id, outfit);
  const listed = await engine.listOutfits(project.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, 'knight');
  assert.deepEqual((await engine.getOutfit(project.id, 'knight')).entries, outfit.entries);

  await assert.rejects(
    () => engine.saveOutfit(project.id, { ...outfit, id: 'bad', entries: { body: 'itm_leather_gloves' } }),
    (error) => {
      assert.equal(error.code, 'INVALID_OUTFIT');
      return true;
    },
  );
  await assert.rejects(
    () => engine.saveOutfit(project.id, { ...outfit, id: 'bad-skin', bodySkin: 'elf' }),
    (error) => {
      assert.equal(error.code, 'INVALID_OUTFIT');
      return true;
    },
  );

  await assert.rejects(() => engine.removeOutfit(project.id, 'knight', 'wrong'), (error) => {
    assert.equal(error.code, 'CONFIRMATION_REQUIRED');
    return true;
  });
  await engine.removeOutfit(project.id, 'knight', 'knight');
  await assert.rejects(() => engine.getOutfit(project.id, 'knight'), (error) => {
    assert.equal(error.code, 'OUTFIT_NOT_FOUND');
    return true;
  });
});
