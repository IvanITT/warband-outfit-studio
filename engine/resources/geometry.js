// @ts-check
/**
 * Lazy mesh-geometry reader for BRF files.
 *
 * Geometry is intentionally not loaded during indexing: a module can contain
 * tens of thousands of meshes and only a handful are ever displayed. This
 * module reads one mesh on demand, validates every count and returns typed
 * arrays ready for a renderer (Phase 3) or an editor (Phase 4).
 *
 * UV coordinates are stored exactly as they appear on disk. OpenBRF flips V
 * for display (`v = 1 - v`); the studio does not, to guarantee byte-identical
 * round-trips.
 */

import { BinaryReader, FormatError } from '../util/binaryReader.js';

export const DEFAULT_LIMITS = Object.freeze({
  maxPositions: 2_000_000,
  maxVertices: 2_000_000,
  maxFaces: 4_000_000,
  maxRiggingPairs: 8_000_000,
  maxFrames: 1024,
});

/** @typedef {typeof DEFAULT_LIMITS} GeometryLimits */

/**
 * @typedef {Object} MeshGeometry
 * @property {number} positionCount
 * @property {Float32Array} positions          flat [x,y,z] per position
 * @property {{boneIndex:number, pairs:{vertexIndex:number,weight:number}[]}[]} rigging
 * @property {{time:number, positions:Float32Array, normals:Float32Array}[]} frames
 * @property {number} vertexCount
 * @property {number} layout                   0, 1 or 2
 * @property {{index:Int32Array,color:Uint32Array,normal:Float32Array,tangent:Float32Array|null,textureIndex:Uint8Array|null,uv:Float32Array,uv2:Float32Array|null}} vertices
 * @property {number} faceCount
 * @property {Uint32Array} faces               flat [a,b,c] per face
 * @property {{min:[number,number,number],max:[number,number,number]}|null} bbox
 * @property {number} bytes
 * @property {number} flags                    mesh flags (copy)
 * @property {string} material                 material name (copy)
 */

/**
 * @param {BinaryReader} reader
 * @param {number} count
 * @param {number} limit
 * @param {string} label
 */
function checkCount(reader, count, limit, label) {
  if (count < 0) reader.corrupt(`negative ${label} count ${count}`);
  if (count > limit) {
    throw new FormatError(`${label} count ${count} exceeds limit ${limit}`, {
      offset: reader.offset,
      file: reader.file,
    });
  }
}

/**
 * Read the geometry of one mesh. `mesh.rawStart` must point at the mesh name
 * length, exactly as recorded by `parseBrf`.
 *
 * @param {Buffer} source
 * @param {{rawStart:number, rawEnd:number, name:string, vertexVersion:number, vertexCount:number, faceCount:number, frameCount:number}} mesh
 * @param {{ file?: string, limits?: Partial<GeometryLimits> }} [options]
 * @returns {MeshGeometry}
 */
export function readMeshGeometry(source, mesh, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
  const reader = new BinaryReader(source, { file: options.file });
  reader.offset = mesh.rawStart;

  const name = reader.string(255);
  if (name !== mesh.name) {
    throw new FormatError(`geometry name mismatch: expected '${mesh.name}', got '${name}'`, {
      offset: mesh.rawStart,
      file: options.file,
    });
  }
  const flags = reader.u32();
  const material = reader.string(255);
  const layout = mesh.vertexVersion;

  // Positions (bind pose).
  const positionCount = reader.u32();
  checkCount(reader, positionCount, limits.maxPositions, 'position');
  const positions = new Float32Array(positionCount * 3);
  for (let i = 0; i < positionCount; i += 1) {
    const [x, y, z] = reader.point3();
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  }

  // Rigging: per bone, a list of (vertexIndex, weight) pairs.
  const riggingCount = reader.count(4);
  checkCount(reader, riggingCount, limits.maxRiggingPairs, 'rigging');
  const rigging = [];
  for (let i = 0; i < riggingCount; i += 1) {
    const boneIndex = reader.i32();
    const pairCount = reader.count(8);
    checkCount(reader, pairCount, limits.maxRiggingPairs, 'rigging pair');
    const pairs = new Array(pairCount);
    for (let p = 0; p < pairCount; p += 1) {
      pairs[p] = { vertexIndex: reader.i32(), weight: reader.f32() };
    }
    rigging.push({ boneIndex, pairs });
  }

  // Additional vertex-animation frames.
  const frameCount = reader.i32();
  checkCount(reader, frameCount, limits.maxFrames, 'frame');
  const frames = [];
  for (let f = 0; f < frameCount; f += 1) {
    const time = reader.i32();
    const posCount = reader.count(12);
    checkCount(reader, posCount, limits.maxPositions, 'frame position');
    const framePositions = new Float32Array(posCount * 3);
    for (let p = 0; p < posCount; p += 1) {
      const [x, y, z] = reader.point3();
      framePositions[p * 3] = x;
      framePositions[p * 3 + 1] = y;
      framePositions[p * 3 + 2] = z;
    }
    const normCount = reader.count(12);
    checkCount(reader, normCount, limits.maxPositions, 'frame normal');
    const frameNormals = new Float32Array(normCount * 3);
    for (let n = 0; n < normCount; n += 1) {
      const [x, y, z] = reader.point3();
      frameNormals[n * 3] = x;
      frameNormals[n * 3 + 1] = y;
      frameNormals[n * 3 + 2] = z;
    }
    frames.push({ time, positions: framePositions, normals: frameNormals });
  }

  // Vertices.
  const vertexCount = reader.u32();
  checkCount(reader, vertexCount, limits.maxVertices, 'vertex');
  const index = new Int32Array(vertexCount);
  const color = new Uint32Array(vertexCount);
  const normal = new Float32Array(vertexCount * 3);
  const tangent = layout === 1 ? new Float32Array(vertexCount * 3) : null;
  const textureIndex = layout === 1 ? new Uint8Array(vertexCount) : null;
  const uv = new Float32Array(vertexCount * 2);
  const uv2 = layout === 0 ? new Float32Array(vertexCount * 2) : null;

  for (let v = 0; v < vertexCount; v += 1) {
    index[v] = reader.i32();
    color[v] = reader.u32();
    const n = reader.point3();
    normal[v * 3] = n[0];
    normal[v * 3 + 1] = n[1];
    normal[v * 3 + 2] = n[2];

    if (layout === 1) {
      const t = reader.point3();
      tangent[v * 3] = t[0];
      tangent[v * 3 + 1] = t[1];
      tangent[v * 3 + 2] = t[2];
      textureIndex[v] = reader.u8();
    }
    uv[v * 2] = reader.f32();
    uv[v * 2 + 1] = reader.f32();
    if (layout === 0) {
      uv2[v * 2] = reader.f32();
      uv2[v * 2 + 1] = reader.f32();
    }
  }

  // Faces.
  const faceCount = reader.u32();
  checkCount(reader, faceCount, limits.maxFaces, 'face');
  const faces = new Uint32Array(faceCount * 3);
  for (let f = 0; f < faceCount; f += 1) {
    faces[f * 3] = reader.u32();
    faces[f * 3 + 1] = reader.u32();
    faces[f * 3 + 2] = reader.u32();
  }

  if (reader.offset !== mesh.rawEnd) {
    throw new FormatError(
      `mesh '${mesh.name}' geometry ended at ${reader.offset}, expected ${mesh.rawEnd}`,
      { file: options.file },
    );
  }
  if (vertexCount !== mesh.vertexCount || faceCount !== mesh.faceCount) {
    throw new FormatError(`mesh '${mesh.name}' counts disagree with the index`, {
      file: options.file,
    });
  }

  let bbox = null;
  if (positionCount > 0) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positionCount; i += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = positions[i * 3 + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
    bbox = { min, max };
  }

  return {
    positionCount,
    positions,
    rigging,
    frames,
    vertexCount,
    layout,
    vertices: { index, color, normal, tangent, textureIndex, uv, uv2 },
    faceCount,
    faces,
    bbox,
    bytes: mesh.rawEnd - mesh.rawStart,
    flags,
    material,
  };
}
