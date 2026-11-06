// @ts-check
/**
 * Project mesh overrides (Phase 4).
 *
 * An override is a project-owned snapshot of an edited mesh, referencing the
 * original BRF and mesh name. It never touches the installation; exporting
 * merges it into a copy of the source BRF inside `workspace/`.
 */

import { parseBrf, replaceMeshGeometry, serializeBrf } from './brf.js';

/**
 * @param {{type:string,count:number,data:string}} encoded
 * @param {any} Type
 */
function decodeTypedArray(encoded, Type) {
  const buffer = Buffer.from(encoded.data, 'base64');
  const bytes = new Uint8Array(buffer.length);
  bytes.set(buffer);
  const array = new Type(bytes.buffer, 0, encoded.count);
  return array;
}

/** @param {Float32Array} array */
function bounds(array) {
  if (array.length === 0) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < array.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = array[i + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return { min, max };
}

/**
 * @param {any} override
 * @returns {{ geometry: import('./geometry.js').MeshGeometry, issues: string[] }}
 */
export function buildGeometryFromOverride(override) {
  const issues = [];
  const arrays = override.arrays ?? {};

  const positions = decodeTypedArray(arrays.positions, Float32Array);
  const vertexPosition = decodeTypedArray(arrays.vertexPosition, Int32Array);
  const normals = decodeTypedArray(arrays.normals, Float32Array);
  const uvs = decodeTypedArray(arrays.uvs, Float32Array);
  const indices = decodeTypedArray(arrays.indices, Uint32Array);
  const color = arrays.color ? decodeTypedArray(arrays.color, Uint32Array) : new Uint32Array(vertexPosition.length).fill(0xffffffff);
  const tangent = arrays.tangent ? decodeTypedArray(arrays.tangent, Float32Array) : null;
  const textureIndex = arrays.textureIndex ? decodeTypedArray(arrays.textureIndex, Uint8Array) : null;
  const uv2 = arrays.uv2 ? decodeTypedArray(arrays.uv2, Float32Array) : null;

  const vertexCount = vertexPosition.length;
  const positionCount = positions.length / 3;
  const faceCount = indices.length / 3;

  const tangentFinal = tangent ?? (override.layout === 1 ? new Float32Array(vertexCount * 3) : null);
  const textureIndexFinal = textureIndex ?? (override.layout === 1 ? new Uint8Array(vertexCount) : null);
  const uv2Final = uv2 ?? (override.layout === 0 ? new Float32Array(vertexCount * 2) : null);

  const frames = (override.frames ?? []).map((frame) => ({
    time: frame.time,
    positions: decodeTypedArray(frame.positions, Float32Array),
    normals: decodeTypedArray(frame.normals, Float32Array),
  }));
  for (const frame of frames) {
    if (frame.positions.length !== positions.length) issues.push('frame positions/position mismatch');
    if (frame.normals.length !== normals.length) issues.push('frame normals/vertex mismatch');
  }

  if (positions.length % 3 !== 0) issues.push('positions length is not a multiple of 3');
  if (normalCount(normals) !== vertexCount) issues.push('normals/vertex mismatch');
  if (uvs.length !== vertexCount * 2) issues.push('uvs/vertex mismatch');
  if (indices.length % 3 !== 0) issues.push('indices length is not a multiple of 3');
  if (color.length !== vertexCount) issues.push('color/vertex mismatch');
  if (tangent && tangent.length !== vertexCount * 3) issues.push('tangent/vertex mismatch');
  if (textureIndex && textureIndex.length !== vertexCount) issues.push('textureIndex/vertex mismatch');
  if (uv2 && uv2.length !== vertexCount * 2) issues.push('uv2/vertex mismatch');
  if (vertexCount === 0 || faceCount === 0) issues.push('mesh has no geometry');

  for (let v = 0; v < vertexCount; v += 1) {
    if (vertexPosition[v] < 0 || vertexPosition[v] >= positionCount) {
      issues.push(`vertex ${v} references position ${vertexPosition[v]}`);
      break;
    }
  }
  for (let i = 0; i < indices.length; i += 1) {
    if (indices[i] >= vertexCount) {
      issues.push(`index ${i} references vertex ${indices[i]}`);
      break;
    }
  }
  for (const value of positions) if (!Number.isFinite(value)) { issues.push('non-finite position'); break; }
  for (const value of normals) if (!Number.isFinite(value)) { issues.push('non-finite normal'); break; }
  for (const value of uvs) if (!Number.isFinite(value)) { issues.push('non-finite uv'); break; }

  const geometry = {
    positionCount,
    positions,
    rigging: override.rigging ?? [],
    frames,
    vertexCount,
    layout: override.layout,
    vertices: { index: vertexPosition, color, normal: normals, tangent: tangentFinal, textureIndex: textureIndexFinal, uv: uvs, uv2: uv2Final },
    faceCount,
    faces: indices,
    bbox: bounds(positions),
    bytes: 0,
    flags: 0,
    material: '',
  };

  return { geometry, issues };
}

function normalCount(normals) {
  return normals.length / 3;
}

/**
 * Apply an override to the source BRF buffer.
 * @param {Buffer} sourceBuffer
 * @param {any} override
 * @param {{ file?: string }} [options]
 */
export function applyOverride(sourceBuffer, override, options = {}) {
  const doc = parseBrf(sourceBuffer, options);
  const mesh = doc.meshes.find((candidate) => candidate.name === override.source.mesh);
  if (!mesh) {
    const error = new Error(`Mesh '${override.source.mesh}' was not found in the source BRF.`);
    // @ts-expect-error machine-readable
    error.code = 'MESH_NOT_FOUND';
    throw error;
  }
  if (override.layout !== mesh.vertexVersion) {
    const error = new Error(
      `Override layout v${override.layout} does not match source mesh layout v${mesh.vertexVersion}.`,
    );
    // @ts-expect-error machine-readable
    error.code = 'LAYOUT_MISMATCH';
    throw error;
  }

  const { geometry, issues } = buildGeometryFromOverride(override);
  if (issues.length > 0) {
    const error = new Error(`Override is invalid: ${issues.join('; ')}`);
    // @ts-expect-error machine-readable
    error.code = 'INVALID_OVERRIDE';
    throw error;
  }

  replaceMeshGeometry(doc, mesh, geometry);
  return { doc, mesh, buffer: serializeBrf(doc, sourceBuffer) };
}
