# BRF format (Binary Resource File)

**Status: VERIFIED** against the OpenBRF reference implementation and validated against **219 real BRF files** (218 in `CommonRes` + `ani_attacks`/`anim_b` samples). The parser consumes every byte and stops exactly on the `end` token.

> Correction to the earlier REA report: BRF is **not** a fixed container with a `u32 6` count and six sections. The first bytes of a file are the length prefix of the token string `"rfver "`. The file is a **token stream**.

## 1. Primitives

All values are little-endian.

| Type | Layout |
|---|---|
| `string` | `u32 length` (< 256) followed by `length` bytes, latin-1, **not** NUL terminated |
| `maybe-string` | `u32 length`; if `0 < length < 99` a string follows, otherwise the four bytes are rewound and a default value is used |
| `vector<T>` | `u32 count` followed by `count` elements |
| `Point2f` | `f32 u`, `f32 v` |
| `Point3f` | `f32 x`, `f32 z`, `f32 y` — **the on-disk order is X, Z, Y**; the reader returns `(x, y, z)` |
| `Point4f` | `f32 y`, `f32 w`, `f32 z`, `f32 x` (OpenBRF quaternion convention) |

## 2. Token stream

```
BRF := ( token )* "end"
token :=
    "rfver "        i32 version          # optional; 0 = Mount&Blade, 1 = Warband
  | "texture"       u32 n  Texture[n]
  | "shader"        u32 n  Shader[n]
  | "material"      u32 n  Material[n]
  | "mesh"          u32 n  Mesh[n]
  | "skeleton"      u32 n  Skeleton[n]
  | "skeleton_anim" u32 n  Animation[n]
  | "body"          u32 n  Body[n]
```

Observed writer order (OpenBRF `BrfData::Save`): `rfver`, `texture`, `shader`, `material`, `mesh`, `skeleton`, `skeleton_anim`, `body`, `end`. A parser must accept any order because the stream is self-describing.

## 3. Structures

### Texture

```
string name
u32    flags
```
Frames = `((flags >> 24) & 0xF) * 4`. Animated texture pages are named `<name>_<n>.dds`.

### Shader

```
string name
u32    flags
u32    requires
string technique
u32    hasFallback           # 0 or 1
string fallback              # only when hasFallback == 1
u32    optionCount
ShaderOption[optionCount]
```
`ShaderOption` = `i32 map, u32 colorOp, u32 alphaOp, u32 flags` (16 bytes).

### Material

```
string name
u32    flags
string shader
string diffuseA
string diffuseB
string bump
string enviro
maybe-string spec            # default "none"
f32    specular
f32    r
f32    g
f32    b
```
`diffuseA`/`bump`/`spec` are texture **names without** the `.dds` extension in most assets; the texture list stores them **with** the extension.

### Mesh

```
string name
u32    flags
string material
vector<Point3f> positions          # bind-pose vertices (count + 12 bytes each)
vector<Rigging> rigging            # boneIndex i32 + vector<Pair>
i32    frameCount                  # vertex-animation frames after the bind frame
Frame[frameCount]
vector<Vertex> vertices
vector<Face> faces
```

`Rigging` = `i32 boneIndex`, `u32 pairCount`, `Pair[pairCount]` where `Pair` = `i32 vertexIndex`, `f32 weight`.

`Frame` = `i32 time`, `vector<Point3f> positions`, `vector<Point3f> normals`.

`Face` = three `i32` vertex indices (12 bytes).

**Vertex layout is selected per mesh:**

| Version | Condition | Layout | Bytes |
|---|---|---|---:|
| 0 | file has no `rfver` (Mount&Blade) | `i32 index`, `u32 color`, `Point3f normal`, `Point2f uv1`, `Point2f uv2` | 36 |
| 1 | `version >= 1` and `flags & (1 << 16)` | `i32 index`, `u32 color`, `Point3f normal`, `Point3f tangent`, `u8 textureIndex`, `Point2f uv` | 41 |
| 2 | `version >= 1` and flag bit 16 clear | `i32 index`, `u32 color`, `Point3f normal`, `Point2f uv` | 28 |

The UV V coordinate is flipped by OpenBRF on load (`v = 1 - v`); store raw values when round-tripping.

### Skeleton

```
string name
vector<Bone> bones
```
`Bone`:
```
i32         attach              # parent index, -1 for root
maybe-string name               # default "bone"
i32         b                   # ONLY present when a name was actually stored
Point3f     x
Point3f     z
Point3f     y
Point3f     t
```
The optional `b` field is a real layout trap: a bone named `bone` (the same as the default) is still `present`, so the parser must track presence, not compare strings.

### Animation (`skeleton_anim`)

```
string name
vector<BoneTrack> tracks        # one per bone
vector<Translation> translations
```
`BoneTrack` = `vector<Key>` where `Key` = `i32 frameIndex`, `Point4f rotation` (20 bytes).
`Translation` = `i32 frameIndex`, `Point3f translation` (16 bytes).

### Body (collision mesh)

```
string name
string kind
```
If `kind == "composite"`: `vector<BodyPart>` (each part starts with its own kind string).
Otherwise the single part uses `kind`.

| Kind | Layout |
|---|---|
| `manifold` | `vector<Point3f> points`, `i32 faceCount`, per face: `i32 orientation`, `i32 flags`, `i32 vertexCount`, `i32 indices[vertexCount]` |
| `capsule` | `f32 radius`, `Point3f center`, `Point3f direction`, `u32 flags` |
| `sphere` | `f32 radius`, `Point3f center`, `u32 flags` |
| `face` | `vector<Point3f> points`, `u32 flags` |

## 4. Worked example (`anim_b.brf`, 972 bytes)

```
06 00 00 00            u32 6 → length of the next string
72 66 76 65 72 20      "rfver "
01 00 00 00            version = 1
01 00 00 00            skeleton count = 1
0d 00 00 00            name length = 13
73 6b 65 6c 65 74 6f 6e 5f 61 6e 69 6d   "skeleton_anim"
...
65 6e 64               "end"
```
The initial `6` is the string length prefix, not a section count.

## 5. Verification

`tests/integration/brf.test.js` asserts, on the installed game:

- `armors_g.brf`: 20 meshes, version 1, `bytesRead === fileBytes`
- `materials.brf`: 526 materials
- `textures.brf`: 644 textures
- `core_shaders.brf`: 139 shaders
- `ani_attacks.brf`: 22 animations
- full `CommonRes` scan: 219 files, 0 parse errors, 7 243 meshes / 633 materials / 734 textures / 139 shaders

## 6. Writing (Phase 1)

`serializeBrf(doc, sourceBuffer)` rebuilds the token stream:

- For every object that is **not dirty**, the writer copies its original byte
  range (`rawStart..rawEnd`) from the source buffer. The output is therefore
  **byte-identical**, including animations and collision bodies that are not
  modelled in detail.
- For a **dirty** object, the writer encodes it from the model. Phase 1
  supports meshes, materials, textures, shaders and skeletons.
- Writing dirty animations or bodies throws a clear error.

```js
import { parseBrf, serializeBrf, updateMesh } from './engine/resources/brf.js';

const source = await readFile(brfPath);
const doc = parseBrf(source, { file: brfPath });

updateMesh(doc, 0, { material: 'new_material' }, source); // marks mesh dirty
const out = serializeBrf(doc, source);
```

**Verified corpus**: all **219** `CommonRes` BRFs round-trip byte-for-byte
(`tests/integration/brfWriter.test.js`). A modified mesh reparses correctly and
the result is itself round-trip stable.

Safety: the writer only produces a Buffer. Persisting it goes through
`WorkspaceStore`, which writes inside `workspace/`, backs up replaced files and
records SHA-256 hashes.

## 7. Geometry (Phase 1)

`readMeshGeometry(source, mesh, { limits })` lazily decodes one mesh:

| Field | Type | Notes |
|---|---|---|
| `positions` | `Float32Array` | flat `x,y,z`, bind pose |
| `rigging` | `{boneIndex, pairs:[{vertexIndex,weight}]}[]` | per bone |
| `frames` | `{time, positions, normals}[]` | vertex animation |
| `vertices.index/color/normal/uv` | typed arrays | layouts 0/1/2 |
| `vertices.tangent/textureIndex/uv2` | typed arrays or `null` | layout-dependent |
| `faces` | `Uint32Array` | flat triplets |
| `bbox` | `{min,max}` or `null` | computed from positions |
| `layout` | `0/1/2` | matches `mesh.vertexVersion` |

Limits (defaults): 2 M positions, 2 M vertices, 4 M faces, 8 M rigging pairs,
1 024 frames. Every count is bounded before allocation, and the parser verifies
that the geometry ends exactly at the recorded `rawEnd`.

**UVs are raw** (not V-flipped) to keep round-trips exact. A renderer must flip
V to match OpenBRF/Warband display.

Geometry is **not cached**: `engine.getMeshGeometry(moduleId, meshName)` reads
the BRF file on demand. Indexing keeps metadata only.

## 8. Known gaps

- Dirty **animations** and **collision bodies** cannot be written yet (they are
  preserved verbatim when untouched). Phase 2+.
- Adding or removing objects (changing section counts) is not exposed by the
  mutation API yet; Phase 8 (builder) will need it.
- Geometry is re-read from disk on every call; an LRU cache is deferred until a
  consumer (Phase 3 viewport) demonstrates the need.
