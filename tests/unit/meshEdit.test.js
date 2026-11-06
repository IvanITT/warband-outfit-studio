import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTransform, deleteFaces, duplicateFaces, mirrorModel, extrudeFaces,
  mergeVertices, splitFaces, renderArrays, validateModel, modelStats,
  modelToOverride, modelFromOverride, selectedVertexSet, EditError,
} from '../../frontend/js/mesh-edit.js';

function triangle() {
  return {
    layout: 2,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    vertexPosition: new Int32Array([0, 1, 2]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    color: new Uint32Array([0xffffffff, 0xffffffff, 0xffffffff]),
    tangent: null,
    textureIndex: null,
    uv2: null,
    rigging: [],
    frames: [],
    rigged: false,
    dirty: false,
    topologyChanged: false,
  };
}

function quad() {
  const model = triangle();
  model.positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  model.vertexPosition = new Int32Array([0, 1, 2, 3]);
  model.normals = new Float32Array(12).fill(0);
  for (let i = 2; i < 12; i += 3) model.normals[i] = 1;
  model.uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  model.indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  model.color = new Uint32Array([0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff]);
  return model;
}

test('translates selected vertices along an axis with snapping', () => {
  const model = triangle();
  applyTransform(model, { vertices: [0, 1, 2] }, {
    mode: 'translate', axis: 'x', amount: 2.236, step: 0.1,
  });
  assert.ok(Math.abs(model.positions[0] - 2.2) < 1e-6);
  assert.ok(Math.abs(model.positions[3] - 3.2) < 1e-6);
  assert.equal(model.dirty, true);
});

test('rotates positions around the selection centroid', () => {
  const model = triangle();
  applyTransform(model, { vertices: [0, 1, 2] }, {
    mode: 'rotate', axis: 'z', amount: 90, step: 0,
  });
  assert.ok(Math.abs(model.positions[0] - 2 / 3) < 1e-5);
  assert.ok(Math.abs(model.positions[1] - 0) < 1e-5);
  // A normal along +Z is unchanged by a Z-axis rotation.
  assert.ok(Math.abs(model.normals[0]) < 1e-5);
  assert.ok(Math.abs(model.normals[1]) < 1e-5);
  assert.ok(Math.abs(model.normals[2] - 1) < 1e-5);
});

test('scales the selection uniformly around its centroid', () => {
  const model = triangle();
  applyTransform(model, { vertices: [0, 1, 2] }, {
    mode: 'scale', axis: 'x', amount: 2, step: 0,
  });
  const stats = modelStats(model);
  const sizeX = stats.bounds.max[0] - stats.bounds.min[0];
  assert.ok(Math.abs(sizeX - 2) < 1e-5);
});

test('deletes selected faces', () => {
  const model = quad();
  const result = deleteFaces(model, [0]);
  assert.equal(result.removed, 1);
  assert.equal(model.indices.length, 3);
  assert.equal(model.topologyChanged, true);
});

test('duplicates selected faces with independent vertices', () => {
  const model = triangle();
  const result = duplicateFaces(model, [0]);
  assert.equal(result.duplicatedFaces, 1);
  assert.equal(model.vertexPosition.length, 6);
  assert.equal(model.indices.length, 6);
  assert.equal(model.positions.length / 3, 6);
});

test('blocks vertex-count-changing edits on rigged meshes', () => {
  const model = triangle();
  model.rigging = [{ boneIndex: 0, pairs: [{ vertexIndex: 0, weight: 1 }] }];
  model.rigged = true;
  assert.throws(() => duplicateFaces(model, [0]), EditError);
  assert.throws(() => mirrorModel(model, 'x', true), EditError);
  assert.throws(() => splitFaces(model, [0]), EditError);
  assert.throws(() => extrudeFaces(model, [0], 0.1), EditError);

  // Transforms and face deletion do not change the vertex count.
  applyTransform(model, { vertices: [0] }, { mode: 'translate', axis: 'x', amount: 1 });
  assert.doesNotThrow(() => deleteFaces(model, [0]));
});

test('mirrors a copy and mirrors in place', () => {
  const copy = triangle();
  mirrorModel(copy, 'x', true);
  assert.equal(copy.vertexPosition.length, 6);
  assert.equal(copy.positions[copy.positions.length - 3], -0);

  const inPlace = triangle();
  mirrorModel(inPlace, 'x', false);
  assert.equal(inPlace.positions[3], -1);
  assert.deepEqual(Array.from(inPlace.indices), [0, 2, 1]);
});

test('extrudes selected faces', () => {
  const model = triangle();
  const result = extrudeFaces(model, [0], 0.5);
  assert.equal(result.extrudedFaces, 1);
  assert.equal(model.vertexPosition.length, 6);
  assert.equal(model.indices.length / 3, 7); // cap + 3 side quads
  assert.equal(model.indices[0], 3); // original face points at the offset cap
});

test('merges vertices and removes degenerate faces', () => {
  const model = quad();
  mergeVertices(model, [0, 1]);
  assert.equal(model.indices.length / 3, 1);
  assert.deepEqual(Array.from(model.indices), [0, 2, 3]);
});

test('splits selected faces into independent vertices', () => {
  const model = triangle();
  splitFaces(model, [0]);
  assert.equal(model.vertexPosition.length, 6);
  assert.ok(model.indices.every((value) => value >= 3));
});

test('validates ranges, finiteness and degeneracy', () => {
  const model = triangle();
  assert.deepEqual(validateModel(model).issues, []);
  model.indices[0] = 99;
  assert.ok(validateModel(model).issues.some((issue) => issue.includes('references vertex')));
});

test('round-trips a project override and expands render arrays', () => {
  const model = triangle();
  applyTransform(model, { vertices: [0, 1, 2] }, { mode: 'translate', axis: 'y', amount: 1 });
  const override = modelToOverride(model, { moduleId: 'Native', mesh: 'm', brf: 'C:/x.brf' });
  assert.equal(override.source.mesh, 'm');
  const restored = modelFromOverride(override);
  assert.deepEqual(Array.from(restored.positions), Array.from(model.positions));
  assert.deepEqual(Array.from(restored.indices), Array.from(model.indices));
  const arrays = renderArrays(restored);
  assert.equal(arrays.positions.length, restored.vertexPosition.length * 3);
});

test('selected faces contribute their vertices', () => {
  const model = quad();
  const set = selectedVertexSet(model, { faces: [0] });
  assert.deepEqual([...set], [0, 1, 2]);
});
