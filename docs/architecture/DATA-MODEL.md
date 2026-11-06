# Internal data model

The model is UI-independent and lives in `engine/`. Types are documented as
TypeScript-like shapes; the implementation is ESM JavaScript with JSDoc.

## 1. Aggregate objects

```
WarbandInstallation
  id                 stable slug derived from the root path
  rootPath
  executablePath
  version            from rgl_log.txt ("1.170"), not the exe file version
  versionSource
  modulesDir / commonResDir / texturesDir / soundsDir / dataDir / musicDir
  userDataDir        %USERPROFILE%\Documents\Mount&Blade Warband
  moduleCount
  fingerprint        { exeSize, exeMtimeMs }
  diagnostics[]
```

```
WarbandModule
  id                 directory name ("Native", "Viking Conquest") — stable on disk
  slug               URL-safe ("viking-conquest")
  path
  moduleName         module.ini `module_name`
  version            `module_version`
  operationSetVersion `operation_set_version`
  capabilities       { singlePlayer, multiplayer }
  commonResources[]  `load_resource`
  moduleResources[]  `load_mod_resource` / `load_module_resource`
  duplicates[]       repeated non-repeatable keys
  unknownKeys[]      keys outside the known 1.170/1.171 set
```

## 2. Items

```
ItemDocument
  format             "itemsfile version 3"
  declaredCount
  items[]            ItemRecord
  encoding           "utf8" | "cp1252"
  trailingLines[]

ItemRecord
  index, line
  id                 "itm_mail_shirt"
  name, plural       display strings with `_` instead of spaces
  flags              uint32; low nibble = itp_type_*
  capabilities       decimal string (64-bit)
  value, weight, abundance
  headArmor, bodyArmor, legArmor
  difficulty, hitPoints, speedRating, missileSpeed, weaponLength,
  maxAmmo, thrustDamage, swingDamage
  modifierBits
  meshes[]           { name, modifierBits }
  factions[]         numeric ids
  triggers[]         raw lines
  slot               head | body | foot | hand | one_handed | ...
  isArmor            boolean
  category           armor | clothing | cape | other
  raw                original lines (byte-perfect round-trip)
```

Invariants:

- `meshes.length` equals the `n_meshes` token.
- Faction ids count equals the faction count line.
- Serialization with no re-render option reproduces the original file byte-for-byte (tested on all three modules).
- `capabilities` is never converted to `Number` (precision loss above 2^53).

### 2.1 Item editor overrides

`ItemEditable` adds decoded symbols to an `ItemRecord`:

```
ItemEditable
  item          ItemRecord
  flags         { value, hex, type, attachment, flags[], unknownHex }
  capabilities  { value, hex, carry, shoot, flags[], unknownHex }
  schema        types[], attachment[], flags[], carry[], shoot[], capabilities[]
```

Project `items[]` override:

```
ItemOverride
  schemaVersion 1
  id            item id (must equal baseItemId for edits)
  baseItemId    existing id | null (new item)
  mode          edit | create
  moduleId
  fields        { name, plural, flags, capabilities, value, modifierBits,
                  weight, abundance, headArmor, bodyArmor, legArmor,
                  difficulty, hitPoints, speedRating, missileSpeed,
                  weaponLength, maxAmmo, thrustDamage, swingDamage }
  meshes[]      { name, modifierBits }
  factions[]    preserved/optional
  triggers[]    preserved/optional
  notes, updatedAt
```

Export merges overrides into the module's document and writes
`workspace/item-edits/item_kinds1.txt`; new records are appended, existing
records keep their position. Untouched records reuse their raw lines.

## 3. Resources

```
BrfDocument
  version            0 (M&B) | 1 (Warband)
  header             { present, version, rawStart, rawEnd } | null
  sections[]         { token, count, items[], rawStart, rawEnd }
  textures[]         { name, flags, frames, rawStart, rawEnd }
  shaders[]          { name, flags, requires, technique, fallback, options[], rawStart, rawEnd }
  materials[]        { name, flags, shader, diffuseA, diffuseB, bump, enviro,
                       spec, specPresent, specular, r, g, b, rawStart, rawEnd }
  meshes[]           { name, flags, material, vertexVersion, vertexCount,
                       faceCount, frameCount, positionCount, rigged,
                       nameInfo, rawStart, rawEnd, dirty, geometry }
  skeletons[]        { name, boneCount, boneNames, bones[], rawStart, rawEnd }
  animations[]       { name, boneCount, translationCount, rawStart, rawEnd }
  bodies[]           { name, kind, partCount, rawStart, rawEnd }
  bytesRead, fileBytes, counts
```

Every object records its exact byte range. `serializeBrf(doc, source)` copies
untouched ranges verbatim (byte-identical output) and re-encodes only dirty
objects. `sections` preserves the order and count of token blocks.

```
MeshGeometry
  positionCount, positions: Float32Array      # x,y,z
  rigging[]        { boneIndex, pairs[{vertexIndex, weight}] }
  frames[]         { time, positions, normals }
  vertexCount, layout, vertices{
    index: Int32Array, color: Uint32Array, normal: Float32Array,
    tangent: Float32Array|null, textureIndex: Uint8Array|null,
    uv: Float32Array, uv2: Float32Array|null
  }
  faceCount, faces: Uint32Array
  bbox             { min:[x,y,z], max:[x,y,z] } | null
  bytes, flags, material
```

Geometry is lazy: indexing stores metadata only; `engine.getMeshGeometry()`
reads one mesh and enforces allocation limits.

```
DecodedFlags / DecodedCapabilities
  value, hex
  type / attachment / carry / shoot   symbol | null
  flags[]                             { name, hex, aliases[] }
  unknownHex                          string | null
```

Enums are decoded as fields (type, attachment, carry, shoot) and never as
independent bits.

```
BrfIndex
  files[]            per-file summary + counts
  meshes             Map<lowercase name, MeshEntry[]>
  meshesByBase       Map<lowercase base, MeshEntry[]>   (LODs + pieces)
  materials          Map<lowercase name, MaterialEntry[]>
  textures           Map<lowercase name (with .dds), TextureEntry[]>
  shaders            Map<lowercase name, brfFile[]>
  resolveMesh(name)  -> { direct, base, lods, pieces, family, exists, info }
  resolveMaterial(name)
  resolveTexture(name)   accepts names with or without `.dds`
  stats              counts, bytes, cache hits, buildMs
  parseErrors[]
```

### 3.1 Render-ready mesh data

```
MeshRenderData
  mesh        mesh metadata
  layout      0 | 1 | 2
  uvFlip      'v'  (OpenBRF convention)
  bbox        { min, max } | null
  posed       { bone: string|null, applied: boolean }
  counts      { vertices, faces, positions }
  arrays      {
    positions: { type:'Float32Array', count, data: base64 },
    normals:   { type:'Float32Array', count, data: base64 },
    uvs:       { type:'Float32Array', count, data: base64 },
    indices:   { type:'Uint32Array',  count, data: base64 }
  }
```

BRF faces index the **vertex list**; each vertex stores `index` into the
position array. `engine.getMeshRenderData` expands positions/normals/UVs per
vertex so the viewport can use the face array as `BufferGeometry.index`.
Base64 keeps the JSON response compact.

### 3.2 Editable mesh and project overrides

```
EditableModel
  layout
  positions            Float32Array (shared, x,y,z)
  vertexPosition       Int32Array (render vertex → position)
  normals, uvs         per render vertex
  indices              Uint32Array (face triplet → render vertex)
  color, tangent, textureIndex, uv2
  rigging[]            { boneIndex, pairs[{vertexIndex, weight}] }
  frames[]             { time, positions, normals }
  dirty, topologyChanged
```

Overrides (`project.meshes[]`) store the same arrays as base64 plus
`source { moduleId, mesh, brf }`, `layout`, `stats` and `editedAt`. The project
references the original BRF; exporting merges the override and writes a copy in
`workspace/`.

Material overrides (`project.materials[]`) store the material fields plus
`source { moduleId, material, brf }`. Imported textures (`project.textures[]`)
record `{ name, workspaceId, path, width, height, format, mipmaps, sha256 }`;
material export copies every referenced texture into the workspace.
**Material colours are 0–255, not 0–1 (VERIFIED).**

### 3.3 Character bodies and outfit records

```
CharacterBody
  skin    { name, flags, skeleton, scale }
  skins[] string
  parts[] { role: body|calf_l|calf_r|hand_l|hand_r|head,
            name, material, brf }
```

`role` maps to the skeleton bone used when a part is rigid. `posed` in
`MeshRenderData` reports `{ bone, applied }`; `applied=false` means the mesh was
skinned and its authored bind positions were kept.

Outfit (`project.outfits[]`):

```json
{
  "schemaVersion": 1,
  "id": "knight-demo",
  "name": "Knight Demo",
  "moduleId": "Native",
  "bodySkin": "man",
  "entries": {
    "body": "itm_mail_shirt",
    "head": "itm_helmet_with_neckguard",
    "hand": "itm_leather_gloves",
    "foot": "itm_leather_boots"
  },
  "transforms": {
    "head": { "x": 0, "y": 0.02, "z": 0, "scale": 1 }
  },
  "updatedAt": "..."
}
```

`entries` keys are fixed to `body|head|hand|foot`; each value is an item id or
`null`. `transforms` is a per-slot map; missing slots default to `0,0,0,1`.
The record references items, it does not copy item data (ADR-032).

## 4. Resolved chain
```
ItemChain
  item     { id, name, slot, category, value, armor:{head,body,leg} }
  meshes[] ResolvedMesh
  issues[] ValidationIssue
  summary  { errors, warnings, infos }

ResolvedMesh
  name, resolved
  geometry { baseCount, lodLevels[], pieceCount, vertexVersion,
             vertexCount, faceCount }
  brfFiles[]
  material ResolvedMaterial | null
  pair     ResolvedMesh | null      // _R glove counterpart
  issues   code[]

ResolvedMaterial
  name, resolved, brf, shader
  textures ResolvedTexture[]

ResolvedTexture
  role      diffuseA | diffuseB | bump | enviro | spec
  name
  declared  boolean                  // present in some BRF
  brf
  file      { filePath, relativePath, exists, pages[], alternatives[], location }
  dds       { width, height, format, mipmaps } | null
  issues    code[]
```

## 5. Validation

```
ValidationIssue
  code      stable identifier (WB-E-001, WB-W-004, WB-I-003, ...)
  severity  error | warning | info
  title
  message   human readable, names the failing entity
  entity    { type: 'item'|'mesh'|'material'|'texture', name, ...context }
```

The rule catalogue is the single source of truth; adding a rule does not change
the API shape.

## 6. Projects

```
WarbandProject
  schemaVersion   1
  id              slug, validated, matches the file name
  name
  createdAt, updatedAt
  target          { installationId, installationPath, moduleId }
  assets[]        { id, kind: mesh|material|texture|item, name, notes }
  items[]         { id, baseItemId, mode, moduleId, fields, meshes, factions,
                    triggers, notes, updatedAt }
  outfits[]       { id, name, moduleId, bodySkin, entries, transforms, updatedAt }
  validation      { lastRunAt, summary }
  notes
```

Projects are stored in `projects/<id>.json` and validated on load. Saving an
existing project first copies it to `backups/projects/`.

## 7. Workspaces

```
WorkspaceMetadata
  schemaVersion   1
  id              slug, validated, matches the directory name
  label
  createdAt, updatedAt
  files           { [relativePath]: { bytes, sha256, updatedAt } }
```

Layout:

```
workspace/<id>/.workspace.json
workspace/<id>/.backups/<timestamp>/<relativePath>
workspace/<id>/<relativePath>
```

Invariants and safety rules (tested):

- Paths are relative; `.`/`..`, absolute paths, drive letters and NUL bytes are
  rejected.
- The resolved path must stay inside `workspace/<id>/`.
- Overwriting a file first copies the previous revision under `.backups/` and
  records its SHA-256.
- Writes are atomic (temp file + rename).
- The game installation is never a destination; exports only read from it.

`WorkspaceStore.writeBrf()` serializes a `BrfDocument` and writes it through the
same guarded path.

## 8. Installation profiles
```
ProfilesDocument
  schemaVersion   1
  activeId        profile id | null
  profiles[]      InstallationProfile

InstallationProfile
  id              slug + path hash
  label
  path            normalized absolute root
  createdAt, lastValidatedAt
  valid           describeInstallation() succeeded
  version         engine version from rgl_log.txt
  moduleCount
```

Only the active profile drives the engine. Switching profiles reloads modules and
clears the parsed module cache. `config/profiles.json` is machine-local and
git-ignored.

## 9. Backups

```
ProjectBackup
  kind: 'project'
  id, name, target
  path, bytes, sha256, createdAt

WorkspaceBackup
  kind: 'workspace'
  workspaceId, file
  path, metaPath, bytes, sha256, backedUpAt
```

Restore inputs: the backup path plus a `confirm` value equal to the entity id.
The current state is backed up before the restore, making the operation
reversible. Workspace restores verify SHA-256 first.

## 10. Deliberate omissions (updated after Phase 7)

| Concept | Status | Phase |
|---|---|---|
| Geometry buffers | **Implemented** (lazy, typed arrays, limits) | 1 |
| Item flag symbols | **Implemented** (generated table + decoder) | 1 |
| BRF writer | **Implemented** (raw-range copy + dirty objects) | 1 |
| Skeleton/rig data per mesh | Raw rigging available; bones exposed in `BrfSkeleton` | 1 |
| Installation profiles | **Implemented** (add/activate/validate/remove) | 2 |
| Workspace lifecycle | **Implemented** (create/list/delete, guarded writes) | 2 |
| Asset index | **Implemented** (meshes/materials/textures/shaders + references) | 2 |
| Backup catalogue & restore | **Implemented** (projects + workspaces, hashes, confirmation) | 2 |
| 3D rendering | **Implemented** (Three.js, DDS, outfit bodies) | 3–6 |
| Outfit composition rules | **Implemented** (slots, rigid bind pose, clipping, projects) | 6 |
| Item overrides | **Implemented** (`project.items[]`, validation, workspace export) | 7 |
| Export job / module integration | Workspace-only serialization exists; deployment not started | 8 |
| Module System `.py` writer | Compiled item file only | Future |

## 11. Identity rules

- **Module identity** = directory name (case preserved), plus a lowercase slug for URLs.
- **Item identity** = record id (`itm_*`).
- **Mesh/material/texture identity** = name; lookups are case-insensitive because the engine can be configured that way (`use_case_insensitive_mesh_searches`) and Windows paths are case-insensitive.
- **Record identity inside a file** = array index; inserting in the middle shifts all ids. The studio never rewrites record order.
