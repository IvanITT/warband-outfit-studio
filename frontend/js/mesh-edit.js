/**
 * Phase 4 mesh editing: pure operations on an editable mesh model.
 *
 * The model keeps the BRF structure: positions are shared by render vertices
 * (`vertexPosition`), so moving a vertex moves all UV seams that share that
 * position (the same behaviour as editing positions in OpenBRF).
 *
 * Topology operations that change the number of render vertices are blocked on
 * rigged meshes until weight editing exists (Phase 5), per ADR.
 */

export class EditError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EditError';
    this.code = code;
  }
}

/** @param {ArrayBufferView} array */
function encodeArray(array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return { type: array.constructor.name, count: array.length, data: btoa(binary) };
}

/** @param {{type:string,count:number,data:string}} encoded */
function decodeArray(encoded) {
  const binary = atob(encoded.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const Type = {
    Float32Array,
    Uint32Array,
    Int32Array,
    Uint8Array,
  }[encoded.type];
  if (!Type) throw new EditError('UNSUPPORTED_ARRAY', `Unsupported array type ${encoded.type}`);
  return new Type(bytes.buffer);
}

/** @param {any} rigging */
function cloneRigging(rigging) {
  return rigging.map((entry) => ({
    boneIndex: entry.boneIndex,
    pairs: entry.pairs.map((pair) => ({ vertexIndex: pair.vertexIndex, weight: pair.weight })),
  }));
}

/**
 * Build an editable model from `engine.getMeshEditable` output.
 * @param {any} editable
 */
export function createModel(editable) {
  return {
    layout: editable.layout,
    positions: decodeArray(editable.arrays.positions),
    vertexPosition: decodeArray(editable.arrays.vertexPosition),
    normals: decodeArray(editable.arrays.normals),
    uvs: decodeArray(editable.arrays.uvs),
    indices: decodeArray(editable.arrays.indices),
    color: editable.arrays.color ? decodeArray(editable.arrays.color) : null,
    tangent: editable.arrays.tangent ? decodeArray(editable.arrays.tangent) : null,
    textureIndex: editable.arrays.textureIndex ? decodeArray(editable.arrays.textureIndex) : null,
    uv2: editable.arrays.uv2 ? decodeArray(editable.arrays.uv2) : null,
    rigging: cloneRigging(editable.rigging ?? []),
    frames: (editable.frames ?? []).map((frame) => ({
      time: frame.time,
      positions: decodeArray(frame.positions),
      normals: decodeArray(frame.normals),
    })),
    rigged: (editable.rigging ?? []).some((entry) => entry.pairs.length > 0),
    dirty: false,
    topologyChanged: false,
  };
}

/** @param {any} model */
export function cloneModel(model) {
  return {
    layout: model.layout,
    positions: new Float32Array(model.positions),
    vertexPosition: new Int32Array(model.vertexPosition),
    normals: new Float32Array(model.normals),
    uvs: new Float32Array(model.uvs),
    indices: new Uint32Array(model.indices),
    color: model.color ? new Uint32Array(model.color) : null,
    tangent: model.tangent ? new Float32Array(model.tangent) : null,
    textureIndex: model.textureIndex ? new Uint8Array(model.textureIndex) : null,
    uv2: model.uv2 ? new Float32Array(model.uv2) : null,
    rigging: cloneRigging(model.rigging),
    frames: model.frames.map((frame) => ({
      time: frame.time,
      positions: new Float32Array(frame.positions),
      normals: new Float32Array(frame.normals),
    })),
    rigged: model.rigged,
    dirty: model.dirty,
    topologyChanged: model.topologyChanged,
  };
}

/** @param {any} model */
export function vertexCount(model) {
  return model.vertexPosition.length;
}

/** @param {any} model */
export function faceCount(model) {
  return model.indices.length / 3;
}

/**
 * Resolve a selection to a set of render vertex indices.
 * @param {any} model
 * @param {{vertices?:Iterable<number>,faces?:Iterable<number>}} selection
 */
export function selectedVertexSet(model, selection) {
  const set = new Set();
  for (const vertex of selection.vertices ?? []) {
    if (vertex >= 0 && vertex < vertexCount(model)) set.add(vertex);
  }
  for (const face of selection.faces ?? []) {
    const base = face * 3;
    if (base + 2 >= model.indices.length) continue;
    set.add(model.indices[base]);
    set.add(model.indices[base + 1]);
    set.add(model.indices[base + 2]);
  }
  return set;
}

/** @param {any} model */
function centroid(model, vertices) {
  const out = [0, 0, 0];
  if (vertices.size === 0) return out;
  for (const vertex of vertices) {
    const p = model.vertexPosition[vertex];
    out[0] += model.positions[p * 3];
    out[1] += model.positions[p * 3 + 1];
    out[2] += model.positions[p * 3 + 2];
  }
  out[0] /= vertices.size;
  out[1] /= vertices.size;
  out[2] /= vertices.size;
  return out;
}

/** @param {any} model */
function averageNormal(model, vertices) {
  const out = [0, 0, 0];
  for (const vertex of vertices) {
    out[0] += model.normals[vertex * 3];
    out[1] += model.normals[vertex * 3 + 1];
    out[2] += model.normals[vertex * 3 + 2];
  }
  const length = Math.hypot(out[0], out[1], out[2]);
  if (length < 1e-9) return [0, 1, 0];
  return [out[0] / length, out[1] / length, out[2] / length];
}

function snapValue(value, step) {
  if (!step || step <= 0) return value;
  return Math.round(value / step) * step;
}

function axisVector(axis, localNormal) {
  if (axis === 'x') return [1, 0, 0];
  if (axis === 'y') return [0, 1, 0];
  if (axis === 'z') return [0, 0, 1];
  return localNormal ?? [0, 1, 0];
}

/**
 * Apply a numeric transform to the selection.
 * @param {any} model
 * @param {{vertices?:number[],faces?:number[]}} selection
 * @param {{mode:'translate'|'rotate'|'scale', axis:'x'|'y'|'z'|'normal', amount:number, local?:boolean, step?:number}} options
 */
export function applyTransform(model, selection, options) {
  const vertices = selectedVertexSet(model, selection);
  if (vertices.size === 0) throw new EditError('EMPTY_SELECTION', 'Select vertices or faces first.');
  const positionSet = new Set();
  for (const vertex of vertices) positionSet.add(model.vertexPosition[vertex]);
  const pivot = centroid(model, vertices);
  const localNormal = averageNormal(model, vertices);
  const axis = axisVector(options.axis, localNormal);
  const amount = Number(options.amount);
  if (!Number.isFinite(amount) || amount === 0) throw new EditError('INVALID_AMOUNT', 'Amount must be a non-zero number.');

  if (options.mode === 'translate') {
    const delta = snapValue(amount, options.step ?? 0);
    for (const p of positionSet) {
      model.positions[p * 3] += axis[0] * delta;
      model.positions[p * 3 + 1] += axis[1] * delta;
      model.positions[p * 3 + 2] += axis[2] * delta;
      for (const frame of model.frames) {
        frame.positions[p * 3] += axis[0] * delta;
        frame.positions[p * 3 + 1] += axis[1] * delta;
        frame.positions[p * 3 + 2] += axis[2] * delta;
      }
    }
  } else if (options.mode === 'rotate') {
    const degrees = snapValue(amount, options.step ?? 0);
    const angle = (degrees * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const [ax, ay, az] = axis;
    const rotate = (x, y, z) => {
      const dot = x * ax + y * ay + z * az;
      const cx = ay * z - az * y;
      const cy = az * x - ax * z;
      const cz = ax * y - ay * x;
      return [
        x * cos + cx * sin + ax * dot * (1 - cos),
        y * cos + cy * sin + ay * dot * (1 - cos),
        z * cos + cz * sin + az * dot * (1 - cos),
      ];
    };
    for (const p of positionSet) {
      for (const array of [model.positions, ...model.frames.map((frame) => frame.positions)]) {
        const x = array[p * 3] - pivot[0];
        const y = array[p * 3 + 1] - pivot[1];
        const z = array[p * 3 + 2] - pivot[2];
        const [rx, ry, rz] = rotate(x, y, z);
        array[p * 3] = rx + pivot[0];
        array[p * 3 + 1] = ry + pivot[1];
        array[p * 3 + 2] = rz + pivot[2];
      }
    }
    for (const vertex of vertices) {
      const [rnx, rny, rnz] = rotate(
        model.normals[vertex * 3],
        model.normals[vertex * 3 + 1],
        model.normals[vertex * 3 + 2],
      );
      model.normals[vertex * 3] = rnx;
      model.normals[vertex * 3 + 1] = rny;
      model.normals[vertex * 3 + 2] = rnz;
      for (const frame of model.frames) {
        const [fnx, fny, fnz] = rotate(
          frame.normals[vertex * 3],
          frame.normals[vertex * 3 + 1],
          frame.normals[vertex * 3 + 2],
        );
        frame.normals[vertex * 3] = fnx;
        frame.normals[vertex * 3 + 1] = fny;
        frame.normals[vertex * 3 + 2] = fnz;
      }
    }
  } else if (options.mode === 'scale') {
    const factor = snapValue(amount, options.step ?? 0);
    if (factor === 0) throw new EditError('INVALID_AMOUNT', 'Scale factor cannot be zero.');
    for (const p of positionSet) {
      for (const array of [model.positions, ...model.frames.map((frame) => frame.positions)]) {
        array[p * 3] = pivot[0] + (array[p * 3] - pivot[0]) * factor;
        array[p * 3 + 1] = pivot[1] + (array[p * 3 + 1] - pivot[1]) * factor;
        array[p * 3 + 2] = pivot[2] + (array[p * 3 + 2] - pivot[2]) * factor;
      }
    }
  } else {
    throw new EditError('INVALID_MODE', `Unknown transform mode '${options.mode}'.`);
  }

  model.dirty = true;
  return { affectedVertices: vertices.size, affectedPositions: positionSet.size, frameCount: model.frames.length };
}

function assertTopologyAllowed(model) {
  if (model.frames.length > 0) {
    throw new EditError(
      'FRAMES_TOPOLOGY_BLOCKED',
      'This mesh has vertex-animation frames: topology edits are blocked (frames would be invalidated). Transforms are allowed.',
    );
  }
  if (model.rigged) {
    throw new EditError(
      'RIGGED_TOPOLOGY_BLOCKED',
      'This mesh is rigged: topology edits that change the vertex count are blocked until weight editing exists.',
    );
  }
}

/** @param {any} model @param {Iterable<number>} faceIndices */
export function deleteFaces(model, faceIndices) {
  const remove = new Set(faceIndices);
  const faces = [];
  for (let f = 0; f < faceCount(model); f += 1) {
    if (!remove.has(f)) {
      faces.push(model.indices[f * 3], model.indices[f * 3 + 1], model.indices[f * 3 + 2]);
    }
  }
  if (faces.length === model.indices.length) return { removed: 0 };
  model.indices = new Uint32Array(faces);
  model.dirty = true;
  model.topologyChanged = true;
  return { removed: remove.size };
}

/** @param {any} model @param {Iterable<number>} faceIndices */
export function duplicateFaces(model, faceIndices) {
  assertTopologyAllowed(model);
  const faces = [...faceIndices];
  if (faces.length === 0) throw new EditError('EMPTY_SELECTION', 'Select faces first.');

  const newPositions = [...model.positions];
  const newVertexPosition = [...model.vertexPosition];
  const newNormals = [...model.normals];
  const newUvs = [...model.uvs];
  const newColor = model.color ? [...model.color] : null;
  const newTangent = model.tangent ? [...model.tangent] : null;
  const newTextureIndex = model.textureIndex ? [...model.textureIndex] : null;
  const newUv2 = model.uv2 ? [...model.uv2] : null;
  const indices = [...model.indices];

  for (const face of faces) {
    const corners = [model.indices[face * 3], model.indices[face * 3 + 1], model.indices[face * 3 + 2]];
    const created = corners.map((vertex) => {
      const positionIndex = model.vertexPosition[vertex];
      const nextPosition = newPositions.length / 3;
      newPositions.push(
        model.positions[positionIndex * 3],
        model.positions[positionIndex * 3 + 1],
        model.positions[positionIndex * 3 + 2],
      );
      const nextVertex = newVertexPosition.length;
      newVertexPosition.push(nextPosition);
      newNormals.push(model.normals[vertex * 3], model.normals[vertex * 3 + 1], model.normals[vertex * 3 + 2]);
      newUvs.push(model.uvs[vertex * 2], model.uvs[vertex * 2 + 1]);
      if (newColor) newColor.push(model.color[vertex]);
      if (newTangent) newTangent.push(model.tangent[vertex * 3], model.tangent[vertex * 3 + 1], model.tangent[vertex * 3 + 2]);
      if (newTextureIndex) newTextureIndex.push(model.textureIndex[vertex]);
      if (newUv2) newUv2.push(model.uv2[vertex * 2], model.uv2[vertex * 2 + 1]);
      return nextVertex;
    });
    indices.push(created[0], created[1], created[2]);
  }

  model.positions = new Float32Array(newPositions);
  model.vertexPosition = new Int32Array(newVertexPosition);
  model.normals = new Float32Array(newNormals);
  model.uvs = new Float32Array(newUvs);
  model.color = newColor ? new Uint32Array(newColor) : null;
  model.tangent = newTangent ? new Float32Array(newTangent) : null;
  model.textureIndex = newTextureIndex ? new Uint8Array(newTextureIndex) : null;
  model.uv2 = newUv2 ? new Float32Array(newUv2) : null;
  model.indices = new Uint32Array(indices);
  model.dirty = true;
  model.topologyChanged = true;
  return { duplicatedFaces: faces.length, newVertices: faces.length * 3 };
}

/**
 * Mirror the mesh. `copy=true` duplicates it (vertex count changes, blocked on
 * rigged meshes); `copy=false` mirrors in place (allowed).
 * @param {any} model
 * @param {'x'|'y'|'z'} axis
 * @param {boolean} copy
 */
export function mirrorModel(model, axis = 'x', copy = true) {
  if (copy) assertTopologyAllowed(model);
  const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;

  if (!copy) {
    for (let i = 0; i < model.positions.length; i += 3) model.positions[i + axisIndex] *= -1;
    for (let i = 0; i < faceCount(model); i += 1) {
      const tmp = model.indices[i * 3 + 1];
      model.indices[i * 3 + 1] = model.indices[i * 3 + 2];
      model.indices[i * 3 + 2] = tmp;
    }
    model.dirty = true;
    model.topologyChanged = true;
    return { mirrored: true, copy: false };
  }

  const baseVertices = vertexCount(model);
  const newPositions = [...model.positions];
  const newVertexPosition = [...model.vertexPosition];
  const newNormals = [...model.normals];
  const newUvs = [...model.uvs];
  const newColor = model.color ? [...model.color] : null;
  const newTangent = model.tangent ? [...model.tangent] : null;
  const newTextureIndex = model.textureIndex ? [...model.textureIndex] : null;
  const newUv2 = model.uv2 ? [...model.uv2] : null;
  const indices = [...model.indices];

  for (let vertex = 0; vertex < baseVertices; vertex += 1) {
    const positionIndex = model.vertexPosition[vertex];
    const nextPosition = newPositions.length / 3;
    newPositions.push(
      model.positions[positionIndex * 3] * (axisIndex === 0 ? -1 : 1),
      model.positions[positionIndex * 3 + 1] * (axisIndex === 1 ? -1 : 1),
      model.positions[positionIndex * 3 + 2] * (axisIndex === 2 ? -1 : 1),
    );
    newVertexPosition.push(nextPosition);
    newNormals.push(
      model.normals[vertex * 3] * (axisIndex === 0 ? -1 : 1),
      model.normals[vertex * 3 + 1] * (axisIndex === 1 ? -1 : 1),
      model.normals[vertex * 3 + 2] * (axisIndex === 2 ? -1 : 1),
    );
    newUvs.push(model.uvs[vertex * 2], model.uvs[vertex * 2 + 1]);
    if (newColor) newColor.push(model.color[vertex]);
    if (newTangent) {
      newTangent.push(
        model.tangent[vertex * 3] * (axisIndex === 0 ? -1 : 1),
        model.tangent[vertex * 3 + 1] * (axisIndex === 1 ? -1 : 1),
        model.tangent[vertex * 3 + 2] * (axisIndex === 2 ? -1 : 1),
      );
    }
    if (newTextureIndex) newTextureIndex.push(model.textureIndex[vertex]);
    if (newUv2) newUv2.push(model.uv2[vertex * 2], model.uv2[vertex * 2 + 1]);
  }

  for (let f = 0; f < faceCount(model); f += 1) {
    const a = model.indices[f * 3] + baseVertices;
    const b = model.indices[f * 3 + 1] + baseVertices;
    const c = model.indices[f * 3 + 2] + baseVertices;
    indices.push(a, c, b);
  }

  model.positions = new Float32Array(newPositions);
  model.vertexPosition = new Int32Array(newVertexPosition);
  model.normals = new Float32Array(newNormals);
  model.uvs = new Float32Array(newUvs);
  model.color = newColor ? new Uint32Array(newColor) : null;
  model.tangent = newTangent ? new Float32Array(newTangent) : null;
  model.textureIndex = newTextureIndex ? new Uint8Array(newTextureIndex) : null;
  model.uv2 = newUv2 ? new Float32Array(newUv2) : null;
  model.indices = new Uint32Array(indices);
  model.dirty = true;
  model.topologyChanged = true;
  return { mirrored: true, copy: true };
}

/**
 * Extrude each selected face along its normal. The original face is replaced by
 * the offset face and three side quads. Basic per-face extrusion.
 * @param {any} model
 * @param {Iterable<number>} faceIndices
 * @param {number} distance
 */
export function extrudeFaces(model, faceIndices, distance) {
  assertTopologyAllowed(model);
  const faces = [...faceIndices];
  if (faces.length === 0) throw new EditError('EMPTY_SELECTION', 'Select faces first.');
  const amount = Number(distance);
  if (!Number.isFinite(amount) || amount === 0) throw new EditError('INVALID_AMOUNT', 'Distance must be non-zero.');

  const newPositions = [...model.positions];
  const newVertexPosition = [...model.vertexPosition];
  const newNormals = [...model.normals];
  const newUvs = [...model.uvs];
  const newColor = model.color ? [...model.color] : null;
  const newTangent = model.tangent ? [...model.tangent] : null;
  const newTextureIndex = model.textureIndex ? [...model.textureIndex] : null;
  const newUv2 = model.uv2 ? [...model.uv2] : null;
  const indices = [...model.indices];

  for (const face of faces) {
    const corners = [model.indices[face * 3], model.indices[face * 3 + 1], model.indices[face * 3 + 2]];
    const points = corners.map((vertex) => {
      const p = model.vertexPosition[vertex];
      return [model.positions[p * 3], model.positions[p * 3 + 1], model.positions[p * 3 + 2]];
    });
    const normal = faceNormal(points);
    const tops = corners.map((vertex, i) => {
      const nextPosition = newPositions.length / 3;
      newPositions.push(
        points[i][0] + normal[0] * amount,
        points[i][1] + normal[1] * amount,
        points[i][2] + normal[2] * amount,
      );
      const nextVertex = newVertexPosition.length;
      newVertexPosition.push(nextPosition);
      newNormals.push(model.normals[vertex * 3], model.normals[vertex * 3 + 1], model.normals[vertex * 3 + 2]);
      newUvs.push(model.uvs[vertex * 2], model.uvs[vertex * 2 + 1]);
      if (newColor) newColor.push(model.color[vertex]);
      if (newTangent) newTangent.push(model.tangent[vertex * 3], model.tangent[vertex * 3 + 1], model.tangent[vertex * 3 + 2]);
      if (newTextureIndex) newTextureIndex.push(model.textureIndex[vertex]);
      if (newUv2) newUv2.push(model.uv2[vertex * 2], model.uv2[vertex * 2 + 1]);
      return nextVertex;
    });

    // Replace the original face with the offset cap.
    indices[face * 3] = tops[0];
    indices[face * 3 + 1] = tops[1];
    indices[face * 3 + 2] = tops[2];

    // Side walls.
    for (let i = 0; i < 3; i += 1) {
      const j = (i + 1) % 3;
      const a = corners[i];
      const b = corners[j];
      const A = tops[i];
      const B = tops[j];
      indices.push(a, b, B, a, B, A);
    }
  }

  model.positions = new Float32Array(newPositions);
  model.vertexPosition = new Int32Array(newVertexPosition);
  model.normals = new Float32Array(newNormals);
  model.uvs = new Float32Array(newUvs);
  model.color = newColor ? new Uint32Array(newColor) : null;
  model.tangent = newTangent ? new Float32Array(newTangent) : null;
  model.textureIndex = newTextureIndex ? new Uint8Array(newTextureIndex) : null;
  model.uv2 = newUv2 ? new Float32Array(newUv2) : null;
  model.indices = new Uint32Array(indices);
  model.dirty = true;
  model.topologyChanged = true;
  return { extrudedFaces: faces.length };
}

function faceNormal(points) {
  const u = [points[1][0] - points[0][0], points[1][1] - points[0][1], points[1][2] - points[0][2]];
  const v = [points[2][0] - points[0][0], points[2][1] - points[0][1], points[2][2] - points[0][2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const length = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / length, n[1] / length, n[2] / length];
}

/**
 * Merge selected vertices into the first selected one (remaps faces, keeps
 * vertex count so it is allowed on rigged meshes).
 * @param {any} model
 * @param {Iterable<number>} vertexIndices
 */
export function mergeVertices(model, vertexIndices) {
  const list = [...vertexIndices];
  if (list.length < 2) throw new EditError('EMPTY_SELECTION', 'Select at least two vertices.');
  const target = list[0];
  const remove = new Set(list.slice(1));
  for (let i = 0; i < model.indices.length; i += 1) {
    if (remove.has(model.indices[i])) model.indices[i] = target;
  }
  // Remove degenerate faces.
  const faces = [];
  for (let f = 0; f < faceCount(model); f += 1) {
    const a = model.indices[f * 3];
    const b = model.indices[f * 3 + 1];
    const c = model.indices[f * 3 + 2];
    if (a !== b && b !== c && a !== c) faces.push(a, b, c);
  }
  model.indices = new Uint32Array(faces);
  model.dirty = true;
  model.topologyChanged = true;
  return { merged: list.length };
}

/**
 * Unweld selected faces (new vertices, same positions) so they can be edited
 * independently. Vertex count changes, so it is blocked on rigged meshes.
 * @param {any} model
 * @param {Iterable<number>} faceIndices
 */
export function splitFaces(model, faceIndices) {
  assertTopologyAllowed(model);
  const faces = [...faceIndices];
  if (faces.length === 0) throw new EditError('EMPTY_SELECTION', 'Select faces first.');

  const newVertexPosition = [...model.vertexPosition];
  const newNormals = [...model.normals];
  const newUvs = [...model.uvs];
  const newColor = model.color ? [...model.color] : null;
  const newTangent = model.tangent ? [...model.tangent] : null;
  const newTextureIndex = model.textureIndex ? [...model.textureIndex] : null;
  const newUv2 = model.uv2 ? [...model.uv2] : null;
  const indices = [...model.indices];

  for (const face of faces) {
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = model.indices[face * 3 + corner];
      const next = newVertexPosition.length;
      newVertexPosition.push(model.vertexPosition[vertex]);
      newNormals.push(model.normals[vertex * 3], model.normals[vertex * 3 + 1], model.normals[vertex * 3 + 2]);
      newUvs.push(model.uvs[vertex * 2], model.uvs[vertex * 2 + 1]);
      if (newColor) newColor.push(model.color[vertex]);
      if (newTangent) newTangent.push(model.tangent[vertex * 3], model.tangent[vertex * 3 + 1], model.tangent[vertex * 3 + 2]);
      if (newTextureIndex) newTextureIndex.push(model.textureIndex[vertex]);
      if (newUv2) newUv2.push(model.uv2[vertex * 2], model.uv2[vertex * 2 + 1]);
      indices[face * 3 + corner] = next;
    }
  }

  model.vertexPosition = new Int32Array(newVertexPosition);
  model.normals = new Float32Array(newNormals);
  model.uvs = new Float32Array(newUvs);
  model.color = newColor ? new Uint32Array(newColor) : null;
  model.tangent = newTangent ? new Float32Array(newTangent) : null;
  model.textureIndex = newTextureIndex ? new Uint8Array(newTextureIndex) : null;
  model.uv2 = newUv2 ? new Float32Array(newUv2) : null;
  model.indices = new Uint32Array(indices);
  model.dirty = true;
  model.topologyChanged = true;
  return { splitFaces: faces.length };
}

/** @param {any} model */
export function computeBounds(model) {
  if (model.positions.length === 0) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < model.positions.length; i += 3) {
    for (let a = 0; a < 3; a += 1) {
      const value = model.positions[i + a];
      if (value < min[a]) min[a] = value;
      if (value > max[a]) max[a] = value;
    }
  }
  return { min, max };
}

/** @param {any} model */
export function modelStats(model) {
  return {
    vertices: vertexCount(model),
    faces: faceCount(model),
    positions: model.positions.length / 3,
    rigged: model.rigged,
    frames: model.frames.length,
    dirty: model.dirty,
    topologyChanged: model.topologyChanged,
    bounds: computeBounds(model),
  };
}

/**
 * Expand positions per render vertex for the renderer.
 * @param {any} model
 */
export function renderArrays(model) {
  const count = vertexCount(model);
  const positions = new Float32Array(count * 3);
  for (let v = 0; v < count; v += 1) {
    const p = model.vertexPosition[v];
    positions[v * 3] = model.positions[p * 3];
    positions[v * 3 + 1] = model.positions[p * 3 + 1];
    positions[v * 3 + 2] = model.positions[p * 3 + 2];
  }
  return { positions, normals: model.normals, uvs: model.uvs, indices: model.indices };
}

/** @param {any} model */
export function validateModel(model) {
  const issues = [];
  if (model.positions.length % 3 !== 0) issues.push('positions length is not a multiple of 3');
  for (const frame of model.frames) {
    if (frame.positions.length !== model.positions.length) issues.push('frame positions/position mismatch');
    if (frame.normals.length !== model.normals.length) issues.push('frame normals/vertex mismatch');
  }
  if (model.normals.length !== vertexCount(model) * 3) issues.push('normals/vertex mismatch');
  if (model.uvs.length !== vertexCount(model) * 2) issues.push('uvs/vertex mismatch');
  if (model.indices.length % 3 !== 0) issues.push('indices length is not a multiple of 3');
  for (let v = 0; v < vertexCount(model); v += 1) {
    const p = model.vertexPosition[v];
    if (p < 0 || p >= model.positions.length / 3) {
      issues.push(`vertex ${v} references position ${p}`);
      break;
    }
  }
  for (let i = 0; i < model.indices.length; i += 1) {
    if (model.indices[i] >= vertexCount(model)) {
      issues.push(`index ${i} references vertex ${model.indices[i]}`);
      break;
    }
  }
  for (const entry of model.rigging) {
    for (const pair of entry.pairs) {
      if (pair.vertexIndex < 0 || pair.vertexIndex >= model.positions.length / 3) {
        issues.push(`rigging references position ${pair.vertexIndex}`);
        break;
      }
    }
  }
  for (const value of model.positions) if (!Number.isFinite(value)) { issues.push('non-finite position'); break; }
  for (const value of model.normals) if (!Number.isFinite(value)) { issues.push('non-finite normal'); break; }
  for (const value of model.uvs) if (!Number.isFinite(value)) { issues.push('non-finite uv'); break; }

  let degenerate = 0;
  for (let f = 0; f < faceCount(model); f += 1) {
    const a = model.indices[f * 3];
    const b = model.indices[f * 3 + 1];
    const c = model.indices[f * 3 + 2];
    if (a === b || b === c || a === c) degenerate += 1;
  }
  if (degenerate > 0) issues.push(`${degenerate} degenerate face(s)`);
  if (vertexCount(model) === 0 || faceCount(model) === 0) issues.push('mesh has no geometry');
  return { issues, degenerate };
}

/**
 * Serialize the model into a project override (base64 typed arrays).
 * @param {any} model
 * @param {{moduleId:string,mesh:string,brf:string}} source
 */
export function modelToOverride(model, source) {
  return {
    schemaVersion: 1,
    id: source.mesh,
    source: {
      moduleId: source.moduleId,
      mesh: source.mesh,
      brf: source.brf,
      vertexCount: vertexCount(model),
      faceCount: faceCount(model),
    },
    layout: model.layout,
    editedAt: new Date().toISOString(),
    stats: modelStats(model),
    arrays: {
      positions: encodeArray(model.positions),
      vertexPosition: encodeArray(model.vertexPosition),
      normals: encodeArray(model.normals),
      uvs: encodeArray(model.uvs),
      indices: encodeArray(model.indices),
      color: model.color ? encodeArray(model.color) : null,
      tangent: model.tangent ? encodeArray(model.tangent) : null,
      textureIndex: model.textureIndex ? encodeArray(model.textureIndex) : null,
      uv2: model.uv2 ? encodeArray(model.uv2) : null,
    },
    rigging: cloneRigging(model.rigging),
    frames: model.frames.map((frame) => ({
      time: frame.time,
      positions: encodeArray(frame.positions),
      normals: encodeArray(frame.normals),
    })),
  };
}

/** @param {any} override */
export function modelFromOverride(override) {
  return {
    layout: override.layout,
    positions: decodeArray(override.arrays.positions),
    vertexPosition: decodeArray(override.arrays.vertexPosition),
    normals: decodeArray(override.arrays.normals),
    uvs: decodeArray(override.arrays.uvs),
    indices: decodeArray(override.arrays.indices),
    color: override.arrays.color ? decodeArray(override.arrays.color) : null,
    tangent: override.arrays.tangent ? decodeArray(override.arrays.tangent) : null,
    textureIndex: override.arrays.textureIndex ? decodeArray(override.arrays.textureIndex) : null,
    uv2: override.arrays.uv2 ? decodeArray(override.arrays.uv2) : null,
    rigging: cloneRigging(override.rigging ?? []),
    frames: (override.frames ?? []).map((frame) => ({
      time: frame.time,
      positions: decodeArray(frame.positions),
      normals: decodeArray(frame.normals),
    })),
    rigged: (override.rigging ?? []).some((entry) => entry.pairs.length > 0),
    dirty: false,
    topologyChanged: false,
  };
}
