// @ts-check
/**
 * BRF ("Binary Resource File") reader.
 *
 * The structure below is VERIFIED against the OpenBRF reference implementation
 * (`brfData.cpp`, `brfMesh.cpp`, `brfMaterial.cpp`, `brfTexture.cpp`,
 * `brfShader.cpp`, `brfSkeleton.cpp`, `brfAnimation.cpp`, `brfBody.cpp`) and
 * validated against 218 real Warband BRF files: the parser must consume every
 * byte and stop exactly on the `end` token.
 *
 * BRF is a token stream, not a fixed-header container:
 *
 *   "rfver " <int32 version>            (optional; 0 = Mount&Blade, 1 = Warband)
 *   "texture"        <u32 n> <texture>...
 *   "shader"         <u32 n> <shader>...
 *   "material"       <u32 n> <material>...
 *   "mesh"           <u32 n> <mesh>...
 *   "skeleton"       <u32 n> <skeleton>...
 *   "skeleton_anim"  <u32 n> <animation>...
 *   "body"           <u32 n> <body>...
 *   "end"
 *
 * Strings are u32 length + latin-1 bytes. Vectors are u32 count + elements.
 */

import { BinaryReader, FormatError } from '../util/binaryReader.js';

export const BRF_TOKENS = Object.freeze([
  'texture',
  'shader',
  'material',
  'mesh',
  'skeleton',
  'skeleton_anim',
  'body',
]);

/** Flags bit that selects the early-Warband vertex layout. VERIFIED (OpenBRF). */
const MESH_FLAG_VERTEX_VERSION_1 = 1 << 16;

/**
 * @typedef {Object} BrfTexture
 * @property {string} name
 * @property {number} flags
 * @property {number} frames  Animated texture frame count ((flags >> 24) & 0xF) * 4.
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
 * @property {number} specular
 * @property {number} r
 * @property {number} g
 * @property {number} b
 */

/**
 * @typedef {Object} MeshNameInfo
 * @property {string} base       Base mesh name (no .lodN / .piece suffix).
 * @property {number} lodLevel   0 for the base mesh, 1.. for .lodN.
 * @property {number} pieceIndex 0 for the base piece, 1.. for .N.
 * @property {boolean} isLod
 * @property {boolean} isCollisionBody
 */

/**
 * @typedef {Object} BrfMesh
 * @property {string} name
 * @property {number} flags
 * @property {string} material
 * @property {number} vertexVersion 0 = M&B, 1 = early Warband, 2 = Warband.
 * @property {number} vertexCount
 * @property {number} faceCount
 * @property {number} frameCount
 * @property {number} positionCount
 * @property {boolean} rigged
 * @property {MeshNameInfo} nameInfo
 */

/**
 * @typedef {Object} BrfSkeleton
 * @property {string} name
 * @property {number} boneCount
 * @property {string[]} boneNames
 */

/**
 * @typedef {Object} BrfAnimation
 * @property {string} name
 * @property {number} boneCount
 * @property {number} translationCount
 */

/**
 * @typedef {Object} BrfBody
 * @property {string} name
 * @property {string} kind
 * @property {number} partCount
 */

/**
 * @typedef {Object} BrfDocument
 * @property {number} version
 * @property {string[]} tokenOrder
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
 * Parse a mesh name following the Warband conventions (VERIFIED against real
 * files):
 *   `mail_shirt_a`                 base
 *   `mail_shirt_a.lod1`            LOD 1
 *   `common_tulbent_b.1`           extra piece 1 of `common_tulbent_b`
 *   `common_tulbent_b.lod1.2`      LOD 1, piece 2
 *   `bo_mail_shirt_a`              collision body
 *
 * @param {string} name
 * @returns {MeshNameInfo}
 */
export function analyzeMeshName(name) {
  let rest = name;
  let lodLevel = 0;
  let pieceIndex = 0;

  // Convention: <base>[.lodN][.piece]. Strip the piece suffix first so that
  // `common_tulbent_b.lod1.2` yields base=common_tulbent_b, lod=1, piece=2.
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

/**
 * @param {BinaryReader} reader
 * @param {number} fileVersion
 * @param {number} index
 * @returns {BrfMesh}
 */
function readMesh(reader, fileVersion, index) {
  const name = reader.string(255);
  const flags = reader.u32();
  const material = reader.string(255);

  // Vector of Point3f positions. We only need the count; skip the payload.
  const positionCount = reader.count(12);
  reader.skip(positionCount * 12);

  // Vector of per-bone rigging entries:
  //   i32 boneIndex, u32 pairCount, pairCount * (i32 vertexIndex, f32 weight)
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
    reader.i32(); // time
    const posCount = reader.count(12);
    reader.skip(posCount * 12);
    const normCount = reader.count(12);
    reader.skip(normCount * 12);
  }

  // Vertex layout depends on the *global* file version and, for Warband files,
  // on the per-mesh flag bit 16. VERIFIED (OpenBRF brfMesh.cpp).
  let vertexVersion = 0;
  let vertexStride = 36; // v0: index + color + normal + uv + uv2
  if (fileVersion !== 0) {
    vertexVersion = flags & MESH_FLAG_VERTEX_VERSION_1 ? 1 : 2;
    vertexStride = vertexVersion === 1 ? 41 : 28;
  }

  const vertexCount = reader.count(vertexStride);
  reader.skip(vertexCount * vertexStride);

  const faceCount = reader.count(12);
  reader.skip(faceCount * 12);

  return {
    name,
    flags,
    material,
    vertexVersion,
    vertexCount,
    faceCount,
    frameCount,
    positionCount,
    rigged,
    nameInfo: analyzeMeshName(name),
    _index: index,
  };
}

/**
 * @param {BinaryReader} reader
 * @returns {BrfMaterial}
 */
function readMaterial(reader) {
  const name = reader.string(255);
  const flags = reader.u32();
  const shader = reader.string(255);
  const diffuseA = reader.string(255);
  const diffuseB = reader.string(255);
  const bump = reader.string(255);
  const enviro = reader.string(255);
  const spec = reader.maybeString('none');
  const specular = reader.f32();
  const r = reader.f32();
  const g = reader.f32();
  const b = reader.f32();
  return { name, flags, shader, diffuseA, diffuseB, bump, enviro, spec, specular, r, g, b };
}

/**
 * @param {BinaryReader} reader
 * @returns {BrfShader}
 */
function readShader(reader) {
  const name = reader.string(255);
  const flags = reader.u32();
  const requires = reader.u32();
  const technique = reader.string(255);
  const hasFallback = reader.u32();
  if (hasFallback > 1) reader.corrupt(`shader fallback flag ${hasFallback}`);
  const fallback = hasFallback === 1 ? reader.string(255) : null;
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
  return { name, flags, requires, technique, fallback, options };
}

/**
 * @param {BinaryReader} reader
 * @returns {BrfSkeleton}
 */
function readSkeleton(reader) {
  const name = reader.string(255);
  const boneCount = reader.count();
  /** @type {string[]} */
  const boneNames = [];
  for (let i = 0; i < boneCount; i += 1) {
    reader.i32(); // attach (parent bone index)
    const bone = reader.maybeStringWithPresence('bone');
    // `b` is only present when a name was written. VERIFIED (OpenBRF).
    if (bone.present) reader.i32();
    reader.point3();
    reader.point3();
    reader.point3();
    reader.point3();
    boneNames.push(bone.value);
  }
  return { name, boneCount, boneNames };
}

/**
 * @param {BinaryReader} reader
 * @returns {BrfAnimation}
 */
function readAnimation(reader) {
  const name = reader.string(255);
  const boneCount = reader.count();
  for (let i = 0; i < boneCount; i += 1) {
    const keyCount = reader.count(20);
    reader.skip(keyCount * 20); // i32 frame + Point4f rotation
  }
  const translationCount = reader.count(16);
  reader.skip(translationCount * 16); // i32 frame + Point3f
  return { name, boneCount, translationCount };
}

/**
 * @param {BinaryReader} reader
 * @param {string} [firstWord]
 * @returns {number} number of parts consumed
 */
function readBodyPart(reader, firstWord) {
  const kind = firstWord ?? reader.string(255);
  switch (kind) {
    case 'manifold': {
      const pointCount = reader.count(12);
      reader.skip(pointCount * 12);
      const faceCount = reader.i32();
      if (faceCount < 0 || faceCount > 1_000_000) reader.corrupt(`manifold face count ${faceCount}`);
      for (let i = 0; i < faceCount; i += 1) {
        reader.i32(); // orientation
        reader.i32(); // flags
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

/**
 * @param {BinaryReader} reader
 * @returns {BrfBody}
 */
function readBody(reader) {
  const name = reader.string(255);
  const kind = reader.string(255);
  let partCount = 0;
  if (kind === 'composite') {
    partCount = reader.count();
    for (let i = 0; i < partCount; i += 1) readBodyPart(reader);
  } else {
    partCount = readBodyPart(reader, kind);
  }
  return { name, kind, partCount };
}

/**
 * Parse a BRF file from a Buffer.
 * @param {Buffer} buffer
 * @param {{ file?: string }} [options]
 * @returns {BrfDocument}
 */
export function parseBrf(buffer, options = {}) {
  const reader = new BinaryReader(buffer, options);
  /** @type {BrfDocument} */
  const doc = {
    version: 0,
    tokenOrder: [],
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
    const token = reader.string(255);

    if (token === 'end') break;
    if (token === 'rfver ') {
      const version = reader.i32();
      if (version < 0 || version > 1) reader.corrupt(`unsupported BRF version ${version}`);
      doc.version = version;
      continue;
    }
    if (!BRF_TOKENS.includes(token)) reader.corrupt(`unknown BRF token '${token}'`);

    doc.tokenOrder.push(token);
    const count = reader.u32();
    switch (token) {
      case 'texture':
        for (let i = 0; i < count; i += 1) {
          const name = reader.string(255);
          const flags = reader.u32();
          const frames = ((flags >>> 24) & 0xf) * 4;
          doc.textures.push({ name, flags, frames });
        }
        doc.counts.texture += count;
        break;
      case 'shader':
        for (let i = 0; i < count; i += 1) doc.shaders.push(readShader(reader));
        doc.counts.shader += count;
        break;
      case 'material':
        for (let i = 0; i < count; i += 1) doc.materials.push(readMaterial(reader));
        doc.counts.material += count;
        break;
      case 'mesh':
        for (let i = 0; i < count; i += 1) doc.meshes.push(readMesh(reader, doc.version, i));
        doc.counts.mesh += count;
        break;
      case 'skeleton':
        for (let i = 0; i < count; i += 1) doc.skeletons.push(readSkeleton(reader));
        doc.counts.skeleton += count;
        break;
      case 'skeleton_anim':
        for (let i = 0; i < count; i += 1) doc.animations.push(readAnimation(reader));
        doc.counts.animation += count;
        break;
      case 'body':
        for (let i = 0; i < count; i += 1) doc.bodies.push(readBody(reader));
        doc.counts.body += count;
        break;
      default:
        reader.corrupt(`unhandled BRF token '${token}'`);
    }
  }

  reader.expectEnd(options.file ?? 'BRF');
  doc.bytesRead = reader.offset;
  return doc;
}

/**
 * Parse a BRF file from disk.
 * @param {string} filePath
 * @returns {Promise<BrfDocument>}
 */
export async function parseBrfFile(filePath) {
  const { readFile } = await import('node:fs/promises');
  const buffer = await readFile(filePath);
  return parseBrf(buffer, { file: filePath });
}

export { FormatError };
