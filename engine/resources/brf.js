// @ts-check
/**
 * BRF ("Binary Resource File") reader and writer.
 *
 * BRF is a token stream (VERIFIED against OpenBRF and 219 real files):
 *
 *   "rfver " <int32 version>            optional; 0 = Mount&Blade, 1 = Warband
 *   "texture"        <u32 n> <texture>...
 *   "shader"         <u32 n> <shader>...
 *   "material"       <u32 n> <material>...
 *   "mesh"           <u32 n> <mesh>...
 *   "skeleton"       <u32 n> <skeleton>...
 *   "skeleton_anim"  <u32 n> <animation>...
 *   "body"           <u32 n> <body>...
 *   "end"
 *
 * The reader records the exact byte range of every object. `serializeBrf`
 * copies untouched ranges verbatim, which makes round-trips byte-identical
 * even for object kinds the studio does not model in detail (animations,
 * collision bodies). Dirty meshes/materials/textures/shaders/skeletons are
 * re-encoded from their model.
 */

import { BinaryReader, FormatError } from '../util/binaryReader.js';
import { readMeshGeometry } from './geometry.js';

export const BRF_TOKENS = Object.freeze([
  'texture',
  'shader',
  'material',
  'mesh',
  'skeleton',
  'skeleton_anim',
  'body',
]);

/** Token name → key in `doc.counts`. */
const COUNT_KEY = Object.freeze({
  texture: 'texture',
  shader: 'shader',
  material: 'material',
  mesh: 'mesh',
  skeleton: 'skeleton',
  skeleton_anim: 'animation',
  body: 'body',
});

/** Flags bit that selects the early-Warband vertex layout. VERIFIED (OpenBRF). */
const MESH_FLAG_VERTEX_VERSION_1 = 1 << 16;
const MAX_STRING = 255;

/**
 * @typedef {Object} BrfTexture
 * @property {string} name
 * @property {number} flags
 * @property {number} frames
 * @property {number} rawStart
 * @property {number} rawEnd
 * @property {boolean} [dirty]
 */

/**
 * @typedef {Object} BrfShaderOption
 * @property {number} map
 * @property {number} colorOp
 * @property {number} alphaOp
 * @property {number} flags
 */

/**
 * @typedef {Object} BrfShader
 * @property {string} name
 * @property {number} flags
 * @property {number} requires
 * @property {string} technique
 * @property {string|null} fallback
 * @property {BrfShaderOption[]} options
 * @property {number} rawStart
 * @property {number} rawEnd
 * @property {boolean} [dirty]
 */

/**
 * @typedef {Object} BrfMaterial
 * @property {string} name
 * @property {number} flags
 * @property {string} shader
 * @property {string} diffuseA
 * @property {string} diffuseB
 * @property {string} bump
 * @property {string} enviro
 * @property {string} spec
 * @property {boolean} specPresent
 * @property {number} specular
 * @property {number} r
 * @property {number} g
 * @property {number} b
 * @property {number} rawStart
 * @property {number} rawEnd
 * @property {boolean} [dirty]
 */

/**
 * @typedef {Object} MeshNameInfo
 * @property {string} base
 * @property {number} lodLevel
 * @property {number} pieceIndex
 * @property {boolean} isLod
 * @property {boolean} isCollisionBody
 */

/**
 * @typedef {Object} BrfMesh
 * @property {string} name
 * @property {number} flags
 * @property {string} material
 * @property {number} vertexVersion
 * @property {number} vertexCount
 * @property {number} faceCount
 * @property {number} frameCount
 * @property {number} positionCount
 * @property {boolean} rigged
 * @property {MeshNameInfo} nameInfo
 * @property {number} rawStart
 * @property {number} rawEnd
 * @property {boolean} dirty
 * @property {import('./geometry.js').MeshGeometry|null} geometry
 */

/**
 * @typedef {Object} BrfBone
 * @property {number} attach
 * @property {string} name
 * @property {boolean} namePresent
 * @property {number|null} b
 * @property {[number,number,number]} x
 * @property {[number,number,number]} z
 * @property {[number,number,number]} y
 * @property {[number,number,number]} t
 */

/**
 * @typedef {Object} BrfSkeleton
 * @property {string} name
 * @property {number} boneCount
 * @property {string[]} boneNames
 * @property {BrfBone[]} bones
 * @property {number} rawStart
 * @property {number} rawEnd
 * @property {boolean} [dirty]
 */

/**
 * @typedef {Object} BrfAnimation
 * @property {string} name
 * @property {number} boneCount
 * @property {number} translationCount
 * @property {number} rawStart
 * @property {number} rawEnd
 */

/**
 * @typedef {Object} BrfBody
 * @property {string} name
 * @property {string} kind
 * @property {number} partCount
 * @property {number} rawStart
 * @property {number} rawEnd
 */

/**
 * @typedef {Object} BrfSection
 * @property {string} token
 * @property {number} count
 * @property {any[]} items
 * @property {number} rawStart
 * @property {number} rawEnd
 */

/**
 * @typedef {Object} BrfDocument
 * @property {number} version
 * @property {{present:boolean, version:number, rawStart:number, rawEnd:number}|null} header
 * @property {string[]} tokenOrder
 * @property {BrfSection[]} sections
 * @property {BrfTexture[]} textures
 * @property {BrfShader[]} shaders
 * @property {BrfMaterial[]} materials
 * @property {BrfMesh[]} meshes
 * @property {BrfSkeleton[]} skeletons
 * @property {BrfAnimation[]} animations
 * @property {BrfBody[]} bodies
 * @property {number} bytesRead
 * @property {number} fileBytes
 * @property {{texture:number,shader:number,material:number,mesh:number,skeleton:number,animation:number,body:number}} counts
 */

/**
 * Analyze a Warband mesh name.
 * @param {string} name
 * @returns {MeshNameInfo}
 */
export function analyzeMeshName(name) {
  let rest = name;
  let lodLevel = 0;
  let pieceIndex = 0;

  // Strip the piece suffix first: `x.lod1.2` → x.lod1 → x.
  const pieceMatch = rest.match(/\.(\d+)$/);
  if (pieceMatch) {
    pieceIndex = Number(pieceMatch[1]);
    rest = rest.slice(0, pieceMatch.index);
  }
  const lodMatch = rest.match(/\.lod(\d+)$/i);
  if (lodMatch) {
    lodLevel = Number(lodMatch[1]);
    rest = rest.slice(0, lodMatch.index);
  }

  return {
    base: rest,
    lodLevel,
    pieceIndex,
    isLod: lodLevel > 0,
    isCollisionBody: /^bo_/i.test(name),
  };
}

/* ------------------------------------------------------------------ */
/* Reading                                                            */
/* ------------------------------------------------------------------ */

/**
 * @param {BinaryReader} reader
 * @param {number} fileVersion
 * @returns {BrfMesh}
 */
function readMesh(reader, fileVersion) {
  const drawName = reader.string(MAX_STRING);
  const flags = reader.u32();
  const material = reader.string(MAX_STRING);

  const positionCount = reader.count(12);
  reader.skip(positionCount * 12);

  const riggingCount = reader.count();
  let rigged = false;
  for (let i = 0; i < riggingCount; i += 1) {
    reader.i32();
    const pairCount = reader.count(8);
    reader.skip(pairCount * 8);
    if (pairCount > 0) rigged = true;
  }

  const frameCount = reader.i32();
  if (frameCount < 0 || frameCount > 1_000_000) reader.corrupt(`mesh frame count ${frameCount}`);
  for (let frame = 0; frame < frameCount; frame += 1) {
    reader.i32();
    const posCount = reader.count(12);
    reader.skip(posCount * 12);
    const normCount = reader.count(12);
    reader.skip(normCount * 12);
  }

  let vertexVersion = 0;
  let vertexStride = 36;
  if (fileVersion !== 0) {
    vertexVersion = flags & MESH_FLAG_VERTEX_VERSION_1 ? 1 : 2;
    vertexStride = vertexVersion === 1 ? 41 : 28;
  }

  const vertexCount = reader.count(vertexStride);
  reader.skip(vertexCount * vertexStride);

  const faceCount = reader.count(12);
  reader.skip(faceCount * 12);

  return {
    name: drawName,
    flags,
    material,
    vertexVersion,
    vertexCount,
    faceCount,
    frameCount,
    positionCount,
    rigged,
    nameInfo: analyzeMeshName(drawName),
    rawStart: 0,
    rawEnd: 0,
    dirty: false,
    geometry: null,
  };
}

/** @param {BinaryReader} reader @returns {BrfMaterial} */
function readMaterial(reader) {
  const name = reader.string(MAX_STRING);
  const flags = reader.u32();
  const shader = reader.string(MAX_STRING);
  const diffuseA = reader.string(MAX_STRING);
  const diffuseB = reader.string(MAX_STRING);
  const bump = reader.string(MAX_STRING);
  const enviro = reader.string(MAX_STRING);
  const spec = reader.maybeStringWithPresence('none');
  const specular = reader.f32();
  const r = reader.f32();
  const g = reader.f32();
  const b = reader.f32();
  return {
    name, flags, shader, diffuseA, diffuseB, bump, enviro,
    spec: spec.value,
    specPresent: spec.present,
    specular, r, g, b,
    rawStart: 0,
    rawEnd: 0,
    dirty: false,
  };
}

/** @param {BinaryReader} reader @returns {BrfShader} */
function readShader(reader) {
  const name = reader.string(MAX_STRING);
  const flags = reader.u32();
  const requires = reader.u32();
  const technique = reader.string(MAX_STRING);
  const hasFallback = reader.u32();
  if (hasFallback > 1) reader.corrupt(`shader fallback flag ${hasFallback}`);
  const fallback = hasFallback === 1 ? reader.string(MAX_STRING) : null;
  const optionCount = reader.count(16);
  /** @type {BrfShaderOption[]} */
  const options = [];
  for (let i = 0; i < optionCount; i += 1) {
    options.push({
      map: reader.i32(),
      colorOp: reader.u32(),
      alphaOp: reader.u32(),
      flags: reader.u32(),
    });
  }
  return { name, flags, requires, technique, fallback, options, rawStart: 0, rawEnd: 0, dirty: false };
}

/** @param {BinaryReader} reader @returns {BrfSkeleton} */
function readSkeleton(reader) {
  const name = reader.string(MAX_STRING);
  const boneCount = reader.count();
  /** @type {BrfBone[]} */
  const bones = [];
  for (let i = 0; i < boneCount; i += 1) {
    const attach = reader.i32();
    const maybe = reader.maybeStringWithPresence('bone');
    const b = maybe.present ? reader.i32() : null;
    bones.push({
      attach,
      name: maybe.value,
      namePresent: maybe.present,
      b,
      x: reader.point3(),
      z: reader.point3(),
      y: reader.point3(),
      t: reader.point3(),
    });
  }
  return {
    name,
    boneCount,
    boneNames: bones.map((bone) => bone.name),
    bones,
    rawStart: 0,
    rawEnd: 0,
    dirty: false,
  };
}

/** @param {BinaryReader} reader @returns {BrfAnimation} */
function readAnimation(reader) {
  const name = reader.string(MAX_STRING);
  const boneCount = reader.count();
  for (let i = 0; i < boneCount; i += 1) {
    const keyCount = reader.count(20);
    reader.skip(keyCount * 20);
  }
  const translationCount = reader.count(16);
  reader.skip(translationCount * 16);
  return { name, boneCount, translationCount, rawStart: 0, rawEnd: 0 };
}

/**
 * @param {BinaryReader} reader
 * @param {string} [firstWord]
 */
function readBodyPart(reader, firstWord) {
  const kind = firstWord ?? reader.string(MAX_STRING);
  switch (kind) {
    case 'manifold': {
      const pointCount = reader.count(12);
      reader.skip(pointCount * 12);
      const faceCount = reader.i32();
      if (faceCount < 0 || faceCount > 1_000_000) reader.corrupt(`manifold face count ${faceCount}`);
      for (let i = 0; i < faceCount; i += 1) {
        reader.i32();
        reader.i32();
        const vertexCount = reader.i32();
        if (vertexCount < 0 || vertexCount > 1_000_000) reader.corrupt(`manifold vertex count ${vertexCount}`);
        reader.skip(vertexCount * 4);
      }
      return 1;
    }
    case 'capsule':
      reader.f32();
      reader.point3();
      reader.point3();
      reader.u32();
      return 1;
    case 'sphere':
      reader.f32();
      reader.point3();
      reader.u32();
      return 1;
    case 'face': {
      const pointCount = reader.count(12);
      reader.skip(pointCount * 12);
      reader.u32();
      return 1;
    }
    default:
      reader.corrupt(`unknown body part kind '${kind}'`);
  }
  return 0;
}

/** @param {BinaryReader} reader @returns {BrfBody} */
function readBody(reader) {
  const name = reader.string(MAX_STRING);
  const kind = reader.string(MAX_STRING);
  let partCount = 0;
  if (kind === 'composite') {
    partCount = reader.count();
    for (let i = 0; i < partCount; i += 1) readBodyPart(reader);
  } else {
    partCount = readBodyPart(reader, kind);
  }
  return { name, kind, partCount, rawStart: 0, rawEnd: 0 };
}

/**
 * @param {Buffer} buffer
 * @param {{ file?: string }} [options]
 * @returns {BrfDocument}
 */
export function parseBrf(buffer, options = {}) {
  const reader = new BinaryReader(buffer, options);
  /** @type {BrfDocument} */
  const doc = {
    version: 0,
    header: null,
    tokenOrder: [],
    sections: [],
    textures: [],
    shaders: [],
    materials: [],
    meshes: [],
    skeletons: [],
    animations: [],
    bodies: [],
    bytesRead: 0,
    fileBytes: buffer.length,
    counts: { texture: 0, shader: 0, material: 0, mesh: 0, skeleton: 0, animation: 0, body: 0 },
  };

  for (;;) {
    if (reader.remaining < 4) reader.corrupt('missing end token');
    const tokenStart = reader.offset;
    const token = reader.string(MAX_STRING);

    if (token === 'end') break;
    if (token === 'rfver ') {
      const version = reader.i32();
      if (version < 0 || version > 1) reader.corrupt(`unsupported BRF version ${version}`);
      doc.version = version;
      doc.header = { present: true, version, rawStart: tokenStart, rawEnd: reader.offset };
      continue;
    }
    if (!BRF_TOKENS.includes(token)) reader.corrupt(`unknown BRF token '${token}'`);

    doc.tokenOrder.push(token);
    const count = reader.u32();
    /** @type {BrfSection} */
    const section = { token, count, items: [], rawStart: tokenStart, rawEnd: 0 };

    for (let i = 0; i < count; i += 1) {
      const rawStart = reader.offset;
      /** @type {any} */
      let item;
      switch (token) {
        case 'texture': {
          const name = reader.string(MAX_STRING);
          const flags = reader.u32();
          item = { name, flags, frames: ((flags >>> 24) & 0xf) * 4, rawStart, rawEnd: 0 };
          doc.textures.push(item);
          break;
        }
        case 'shader':
          item = readShader(reader);
          doc.shaders.push(item);
          break;
        case 'material':
          item = readMaterial(reader);
          doc.materials.push(item);
          break;
        case 'mesh':
          item = readMesh(reader, doc.version);
          doc.meshes.push(item);
          break;
        case 'skeleton':
          item = readSkeleton(reader);
          doc.skeletons.push(item);
          break;
        case 'skeleton_anim':
          item = readAnimation(reader);
          doc.animations.push(item);
          break;
        case 'body':
          item = readBody(reader);
          doc.bodies.push(item);
          break;
        default:
          reader.corrupt(`unhandled BRF token '${token}'`);
      }
      item.rawStart = rawStart;
      item.rawEnd = reader.offset;
      section.items.push(item);
    }

    section.rawEnd = reader.offset;
    doc.sections.push(section);
    doc.counts[COUNT_KEY[token]] += count;
  }

  reader.expectEnd(options.file ?? 'BRF');
  doc.bytesRead = reader.offset;
  return doc;
}

/**
 * @param {string} filePath
 * @returns {Promise<BrfDocument>}
 */
export async function parseBrfFile(filePath) {
  const { readFile } = await import('node:fs/promises');
  const buffer = await readFile(filePath);
  return parseBrf(buffer, { file: filePath });
}

/* ------------------------------------------------------------------ */
/* Writing                                                            */
/* ------------------------------------------------------------------ */

/** @param {string} value */
function encodeString(value) {
  const body = Buffer.from(value, 'latin1');
  if (body.length >= 256) throw new Error(`BRF string too long (${body.length}): ${value.slice(0, 40)}…`);
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** @param {number} value */
function i32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(value, 0);
  return buffer;
}

/** @param {number} value */
function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

/** @param {number} value */
function f32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatLE(value, 0);
  return buffer;
}

/** @param {ArrayLike<number>} point [x,y,z] */
function point3(point) {
  return Buffer.concat([f32(point[0]), f32(point[2]), f32(point[1])]);
}

/** @param {ArrayLike<number>} values */
function vec3(values) {
  return Buffer.concat([u32(values.length / 3), ...Array.from({ length: values.length / 3 }, (_, i) => point3(values.subarray(i * 3, i * 3 + 3)))]);
}

/** @param {import('./geometry.js').MeshGeometry} geometry */
function writeMeshGeometry(mesh, geometry) {
  const chunks = [
    encodeString(mesh.name),
    u32(mesh.flags),
    encodeString(mesh.material),
    vec3(geometry.positions),
  ];

  chunks.push(u32(geometry.rigging.length));
  for (const entry of geometry.rigging) {
    chunks.push(i32(entry.boneIndex), u32(entry.pairs.length));
    for (const pair of entry.pairs) chunks.push(i32(pair.vertexIndex), f32(pair.weight));
  }

  chunks.push(i32(geometry.frames.length));
  for (const frame of geometry.frames) {
    chunks.push(i32(frame.time), vec3(frame.positions), vec3(frame.normals));
  }

  const { vertices } = geometry;
  chunks.push(u32(geometry.vertexCount));
  for (let v = 0; v < geometry.vertexCount; v += 1) {
    chunks.push(i32(vertices.index[v]), u32(vertices.color[v]));
    chunks.push(point3(vertices.normal.subarray(v * 3, v * 3 + 3)));
    if (geometry.layout === 1) {
      chunks.push(point3(/** @type {Float32Array} */ (vertices.tangent).subarray(v * 3, v * 3 + 3)));
      chunks.push(Buffer.from([/** @type {Uint8Array} */ (vertices.textureIndex)[v]]));
    }
    chunks.push(f32(vertices.uv[v * 2]), f32(vertices.uv[v * 2 + 1]));
    if (geometry.layout === 0) {
      const uv2 = /** @type {Float32Array} */ (vertices.uv2);
      chunks.push(f32(uv2[v * 2]), f32(uv2[v * 2 + 1]));
    }
  }

  chunks.push(u32(geometry.faceCount));
  for (let f = 0; f < geometry.faceCount; f += 1) {
    chunks.push(u32(geometry.faces[f * 3]), u32(geometry.faces[f * 3 + 1]), u32(geometry.faces[f * 3 + 2]));
  }

  return Buffer.concat(chunks);
}

/** @param {BrfTexture} texture */
function writeTexture(texture) {
  return Buffer.concat([encodeString(texture.name), u32(texture.flags)]);
}

/** @param {BrfMaterial} material */
function writeMaterial(material) {
  return Buffer.concat([
    encodeString(material.name),
    u32(material.flags),
    encodeString(material.shader),
    encodeString(material.diffuseA),
    encodeString(material.diffuseB),
    encodeString(material.bump),
    encodeString(material.enviro),
    ...(material.specPresent ? [encodeString(material.spec)] : []),
    f32(material.specular),
    f32(material.r),
    f32(material.g),
    f32(material.b),
  ]);
}

/** @param {BrfShader} shader */
function writeShader(shader) {
  const chunks = [
    encodeString(shader.name),
    u32(shader.flags),
    u32(shader.requires),
    encodeString(shader.technique),
    u32(shader.fallback === null ? 0 : 1),
  ];
  if (shader.fallback !== null) chunks.push(encodeString(shader.fallback));
  chunks.push(u32(shader.options.length));
  for (const option of shader.options) chunks.push(i32(option.map), u32(option.colorOp), u32(option.alphaOp), u32(option.flags));
  return Buffer.concat(chunks);
}

/** @param {BrfBone} bone */
function writeBone(bone) {
  const chunks = [i32(bone.attach)];
  if (bone.namePresent) chunks.push(encodeString(bone.name), i32(bone.b ?? 0));
  else chunks.push(u32(0));
  chunks.push(point3(bone.x), point3(bone.z), point3(bone.y), point3(bone.t));
  return Buffer.concat(chunks);
}

/** @param {BrfSkeleton} skeleton */
function writeSkeleton(skeleton) {
  return Buffer.concat([
    encodeString(skeleton.name),
    u32(skeleton.bones.length),
    ...skeleton.bones.map(writeBone),
  ]);
}

/** @param {string} token @param {any} item */
function writeItem(token, item) {
  switch (token) {
    case 'texture':
      return writeTexture(item);
    case 'material':
      return writeMaterial(item);
    case 'shader':
      return writeShader(item);
    case 'skeleton':
      return writeSkeleton(item);
    case 'mesh':
      if (!item.geometry) throw new Error(`mesh '${item.name}' is dirty but its geometry is not loaded`);
      return writeMeshGeometry(item, item.geometry);
    case 'skeleton_anim':
      throw new Error('writing animations is not supported in Phase 1');
    case 'body':
      throw new Error('writing collision bodies is not supported in Phase 1');
    default:
      throw new Error(`unknown BRF token ${token}`);
  }
}

/**
 * Serialize a BRF document.
 *
 * Untouched objects are copied from `source` using their recorded byte ranges,
 * which guarantees byte-identical output. Objects marked `dirty` are encoded
 * from the model (Phase 1 supports meshes, materials, textures, shaders and
 * skeletons).
 *
 * @param {BrfDocument} doc
 * @param {Buffer} source Original file bytes; required for untouched objects.
 * @returns {Buffer}
 */
export function serializeBrf(doc, source) {
  if (!Buffer.isBuffer(source) && !(source instanceof Uint8Array)) {
    throw new TypeError('serializeBrf requires the original BRF buffer');
  }
  const chunks = [];
  if (doc.header?.present) chunks.push(encodeString('rfver '), i32(doc.header.version));

  for (const section of doc.sections) {
    chunks.push(encodeString(section.token), u32(section.items.length));
    for (const item of section.items) {
      if (item.dirty) chunks.push(writeItem(section.token, item));
      else {
        if (item.rawEnd > source.length || item.rawStart < 0) throw new Error('BRF object range outside the source buffer');
        chunks.push(source.subarray(item.rawStart, item.rawEnd));
      }
    }
  }

  chunks.push(encodeString('end'));
  return Buffer.concat(chunks);
}

/* ------------------------------------------------------------------ */
/* Mutation helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Load and attach geometry to a mesh.
 * @param {BrfDocument} doc
 * @param {number|BrfMesh} meshOrIndex
 * @param {Buffer} source
 * @param {{ limits?: Partial<import('./geometry.js').GeometryLimits> }} [options]
 */
export function loadMeshGeometry(doc, meshOrIndex, source, options = {}) {
  const mesh = typeof meshOrIndex === 'number' ? doc.meshes[meshOrIndex] : meshOrIndex;
  if (!mesh) throw new RangeError(`mesh index ${meshOrIndex} out of range`);
  if (!mesh.geometry) {
    mesh.geometry = readMeshGeometry(source, mesh, { limits: options.limits });
  }
  return mesh.geometry;
}

/**
 * Patch a mesh and mark it dirty. Only material and flag changes are supported
 * in Phase 1; toggling the vertex-layout bit (1 << 16) is rejected because it
 * would invalidate the geometry buffers.
 *
 * @param {BrfDocument} doc
 * @param {number|BrfMesh} meshOrIndex
 * @param {{ material?: string, flags?: number }} patch
 * @param {Buffer} source
 */
export function updateMesh(doc, meshOrIndex, patch, source) {
  const mesh = typeof meshOrIndex === 'number' ? doc.meshes[meshOrIndex] : meshOrIndex;
  if (!mesh) throw new RangeError(`mesh index ${meshOrIndex} out of range`);
  loadMeshGeometry(doc, mesh, source);

  if (patch.material !== undefined) {
    if (typeof patch.material !== 'string' || patch.material.length === 0) throw new Error('material must be a non-empty string');
    mesh.material = patch.material;
  }
  if (patch.flags !== undefined) {
    if (!Number.isInteger(patch.flags) || patch.flags < 0 || patch.flags > 0xffffffff) throw new Error('flags must be a uint32');
    if ((mesh.flags ^ patch.flags) & MESH_FLAG_VERTEX_VERSION_1) {
      throw new Error('changing the vertex-layout flag is not supported');
    }
    mesh.flags = patch.flags;
  }
  mesh.dirty = true;
  return mesh;
}

/**
 * Replace a mesh's geometry in memory.
 * @param {BrfDocument} doc
 * @param {number|BrfMesh} meshOrIndex
 * @param {import('./geometry.js').MeshGeometry} geometry
 */
export function replaceMeshGeometry(doc, meshOrIndex, geometry) {
  const mesh = typeof meshOrIndex === 'number' ? doc.meshes[meshOrIndex] : meshOrIndex;
  if (!mesh) throw new RangeError(`mesh index ${meshOrIndex} out of range`);
  if (geometry.layout !== mesh.vertexVersion) {
    throw new Error(`geometry layout ${geometry.layout} does not match mesh layout ${mesh.vertexVersion}`);
  }
  mesh.geometry = geometry;
  mesh.vertexCount = geometry.vertexCount;
  mesh.faceCount = geometry.faceCount;
  mesh.positionCount = geometry.positionCount;
  mesh.frameCount = geometry.frames.length;
  mesh.rigged = geometry.rigging.some((entry) => entry.pairs.length > 0);
  mesh.dirty = true;
  return mesh;
}

export { FormatError };
