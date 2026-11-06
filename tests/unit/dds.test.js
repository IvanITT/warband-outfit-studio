import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDds } from '../../engine/textures/dds.js';
import { analyzeMeshName } from '../../engine/resources/brf.js';
import { FormatError } from '../../engine/util/binaryReader.js';

function makeDds({ width = 256, height = 128, fourCC = 'DXT1', mipmaps = 1 } = {}) {
  const buffer = Buffer.alloc(128);
  buffer.write('DDS ', 0, 'latin1');
  buffer.writeUInt32LE(124, 4);
  buffer.writeUInt32LE(0x1007, 8);
  buffer.writeUInt32LE(height, 12);
  buffer.writeUInt32LE(width, 16);
  buffer.writeUInt32LE(1, 24);
  buffer.writeUInt32LE(mipmaps, 28);
  buffer.writeUInt32LE(32, 76);
  buffer.writeUInt32LE(4, 80);
  buffer.write(fourCC, 84, 'latin1');
  return buffer;
}

test('parses a DXT1 DDS header', () => {
  const info = parseDds(makeDds());
  assert.equal(info.width, 256);
  assert.equal(info.height, 128);
  assert.equal(info.format, 'DXT1');
  assert.equal(info.mipmaps, 1);
});

test('rejects a file without the DDS magic', () => {
  const buffer = makeDds();
  buffer.write('NOPE', 0, 'latin1');
  assert.throws(() => parseDds(buffer), FormatError);
});

test('analyzes Warband mesh naming conventions', () => {
  assert.deepEqual(analyzeMeshName('mail_shirt_a'), {
    base: 'mail_shirt_a', lodLevel: 0, pieceIndex: 0, isLod: false, isCollisionBody: false,
  });
  assert.deepEqual(analyzeMeshName('mail_shirt_a.lod2'), {
    base: 'mail_shirt_a', lodLevel: 2, pieceIndex: 0, isLod: true, isCollisionBody: false,
  });
  assert.deepEqual(analyzeMeshName('common_tulbent_b.1'), {
    base: 'common_tulbent_b', lodLevel: 0, pieceIndex: 1, isLod: false, isCollisionBody: false,
  });
  assert.deepEqual(analyzeMeshName('common_tulbent_b.lod1.2'), {
    base: 'common_tulbent_b', lodLevel: 1, pieceIndex: 2, isLod: true, isCollisionBody: false,
  });
  assert.equal(analyzeMeshName('bo_mail_shirt_a').isCollisionBody, true);
});
