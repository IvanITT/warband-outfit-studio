import test from 'node:test';
import assert from 'node:assert/strict';
import { BinaryReader, FormatError } from '../../engine/util/binaryReader.js';

function bufferWithString(value) {
  const body = Buffer.from(value, 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(body.length, 0);
  return Buffer.concat([length, body]);
}

test('reads length-prefixed strings', () => {
  const reader = new BinaryReader(bufferWithString('hello'));
  assert.equal(reader.string(), 'hello');
  assert.equal(reader.remaining, 0);
});

test('rejects strings longer than the allowed maximum', () => {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32LE(300, 0);
  const reader = new BinaryReader(buffer);
  assert.throws(() => reader.string(), FormatError);
});

test('maybeString reports presence and rewinds when absent', () => {
  const present = new BinaryReader(bufferWithString('bone_x'));
  const a = present.maybeStringWithPresence('bone');
  assert.deepEqual(a, { value: 'bone_x', present: true });

  const absentBuffer = Buffer.alloc(4);
  absentBuffer.writeUInt32LE(250, 0); // length >= 99 means "no string"
  const absent = new BinaryReader(absentBuffer);
  const b = absent.maybeStringWithPresence('bone');
  assert.deepEqual(b, { value: 'bone', present: false });
  assert.equal(absent.offset, 0);
});

test('point3 maps on-disk X,Z,Y to X,Y,Z', () => {
  const buffer = Buffer.alloc(12);
  buffer.writeFloatLE(1, 0);
  buffer.writeFloatLE(2, 4);
  buffer.writeFloatLE(3, 8);
  const reader = new BinaryReader(buffer);
  assert.deepEqual(reader.point3(), [1, 3, 2]);
});

test('count rejects impossible element counts', () => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(10_000, 0);
  const reader = new BinaryReader(buffer);
  assert.throws(() => reader.count(12), FormatError);
});

test('expectEnd reports trailing bytes', () => {
  const reader = new BinaryReader(Buffer.from([1, 2, 3, 4]));
  reader.u32();
  reader.expectEnd('fixture');
  const trailing = new BinaryReader(Buffer.from([1, 2, 3, 4, 5]));
  trailing.u32();
  assert.throws(() => trailing.expectEnd('fixture'), FormatError);
});
