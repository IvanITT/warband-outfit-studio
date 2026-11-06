import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBrf, serializeBrf, loadMeshGeometry, updateMesh } from '../../engine/resources/brf.js';

/* ---- tiny BRF builder (independent of the writer under test) ---- */

function str(value) {
  const body = Buffer.from(value, 'latin1');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}
function i32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(value, 0);
  return buffer;
}
function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}
function f32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatLE(value, 0);
  return buffer;
}
function p3(x, y, z) {
  // BRF stores X, Z, Y
  return Buffer.concat([f32(x), f32(z), f32(y)]);
}

/**
 * Build a one-mesh BRF.
 * @param {{version:number|null, specPresent:boolean}} options
 */
function makeBrf({ version = 1, specPresent = true } = {}) {
  const chunks = [];
  if (version !== null) chunks.push(str('rfver '), i32(version));

  chunks.push(str('texture'), u32(1), str('t.dds'), u32(0));

  chunks.push(
    str('material'), u32(1), str('mat'), u32(0), str('simple_shader'),
    str('t'), str('none'), str('none'), str('none'),
  );
  if (specPresent) chunks.push(str('none'));
  chunks.push(f32(1), f32(1), f32(1), f32(1));

  chunks.push(str('mesh'), u32(1), str('m'), u32(0), str('mat'));
  // positions: 3
  chunks.push(u32(3), p3(0, 0, 0), p3(1, 0, 0), p3(0, 1, 0));
  // rigging: 0
  chunks.push(u32(0));
  // frames: 0
  chunks.push(i32(0));

  // vertices: 3, layout depends on version
  chunks.push(u32(3));
  for (const [x, y, z] of [[0, 0, 0], [1, 0, 0], [0, 1, 0]]) {
    chunks.push(i32(0), u32(0xffffffff), p3(x, y, z));
    if (version === null) chunks.push(f32(0), f32(0), f32(0), f32(0));
    else chunks.push(f32(0), f32(0));
  }

  // faces: 1
  chunks.push(u32(1), u32(0), u32(1), u32(2));
  chunks.push(str('end'));
  return Buffer.concat(chunks);
}

test('round-trips a versioned BRF byte-for-byte', () => {
  const source = makeBrf({ version: 1 });
  const doc = parseBrf(source);
  const out = serializeBrf(doc, source);
  assert.equal(out.equals(source), true);
});

test('round-trips a Mount&Blade (no rfver) BRF byte-for-byte', () => {
  const source = makeBrf({ version: null });
  const doc = parseBrf(source);
  assert.equal(doc.version, 0);
  assert.equal(doc.header, null);
  assert.equal(serializeBrf(doc, source).equals(source), true);
});

test('preserves material spec presence', () => {
  for (const specPresent of [true, false]) {
    const source = makeBrf({ version: 1, specPresent });
    const doc = parseBrf(source);
    assert.equal(doc.materials[0].specPresent, specPresent);
    assert.equal(serializeBrf(doc, source).equals(source), true);
  }
});

test('loads geometry from the mesh range', () => {
  const source = makeBrf({ version: 1 });
  const doc = parseBrf(source);
  const geometry = loadMeshGeometry(doc, 0, source);
  assert.equal(geometry.positionCount, 3);
  assert.equal(geometry.vertexCount, 3);
  assert.equal(geometry.faceCount, 1);
  assert.equal(geometry.layout, 2);
  assert.deepEqual(Array.from(geometry.faces), [0, 1, 2]);
  assert.deepEqual(geometry.bbox?.min, [0, 0, 0]);
  assert.deepEqual(geometry.bbox?.max, [1, 1, 0]);
});

test('writes a modified mesh material and reparses it', () => {
  const source = makeBrf({ version: 1 });
  const doc = parseBrf(source);
  updateMesh(doc, 0, { material: 'mat_renamed' }, source);
  const out = serializeBrf(doc, source);
  assert.notEqual(out.length, source.length);

  const reparsed = parseBrf(out);
  assert.equal(reparsed.meshes[0].material, 'mat_renamed');
  assert.equal(reparsed.meshes[0].vertexCount, 3);
  assert.equal(serializeBrf(reparsed, out).equals(out), true);
});

test('rejects changing the vertex-layout flag', () => {
  const source = makeBrf({ version: 1 });
  const doc = parseBrf(source);
  assert.throws(() => updateMesh(doc, 0, { flags: 1 << 16 }, source), /vertex-layout/);
});

test('serialization requires the original buffer for untouched objects', () => {
  const source = makeBrf({ version: 1 });
  const doc = parseBrf(source);
  assert.throws(() => serializeBrf(doc, null), /original BRF buffer/);
});
