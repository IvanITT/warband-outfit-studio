import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeItemFlags, decodeCapabilities, flagTable } from '../../engine/items/itemFlags.js';

test('generated table is complete and traceable', () => {
  assert.equal(flagTable.source, 'header_items.py');
  assert.match(flagTable.sourceSha256, /^[0-9a-f]{64}$/);
  assert.equal(flagTable.counts.types, 20);
  assert.ok(flagTable.counts.flags >= 40);
  assert.ok(flagTable.counts.capabilities >= 30);
  assert.ok(flagTable.counts.carry >= 20);
});

test('decodes a real body-armor item', () => {
  const decoded = decodeItemFlags('16842765'); // 0x0101000D — itm_mail_shirt
  assert.equal(decoded.type?.name, 'itp_type_body_armor');
  assert.equal(decoded.attachment, null);
  assert.deepEqual(decoded.flags.map((flag) => flag.name), ['itp_merchandise', 'itp_covers_legs']);
  assert.equal(decoded.unknownHex, null);

  const covers = decoded.flags.find((flag) => flag.name === 'itp_covers_legs');
  assert.ok(covers.aliases.includes('itp_doesnt_cover_hair'));
});

test('decodes a real helmet', () => {
  const decoded = decodeItemFlags('65548'); // 0x0001000C
  assert.equal(decoded.type?.name, 'itp_type_head_armor');
  assert.deepEqual(decoded.flags.map((flag) => flag.name), ['itp_merchandise']);
  assert.equal(decoded.unknownHex, null);
});

test('reports unknown bits instead of inventing names', () => {
  const decoded = decodeItemFlags('0x8000000000000001');
  assert.equal(decoded.type?.name, 'itp_type_horse');
  assert.equal(decoded.unknownHex, '0x8000000000000000');
});

test('decodes capabilities as fields plus bits', () => {
  // carry (bits 28-34) must never be interpreted as two independent bits
  const dagger = decodeCapabilities('0x30000000');
  assert.equal(dagger.carry?.name, 'itcf_carry_dagger_front_left');
  assert.deepEqual(dagger.flags, []);

  const weapon = decodeCapabilities('0x3'); // thrust + overswing one-handed
  assert.equal(weapon.carry, null);
  assert.deepEqual(weapon.flags.map((flag) => flag.name), ['itcf_thrust_onehanded', 'itcf_overswing_onehanded']);
});

test('zero capabilities decode to nothing', () => {
  const decoded = decodeCapabilities('0');
  assert.equal(decoded.carry, null);
  assert.equal(decoded.shoot, null);
  assert.deepEqual(decoded.flags, []);
  assert.equal(decoded.unknownHex, null);
});
