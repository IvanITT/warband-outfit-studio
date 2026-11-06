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

## 3. Resources

```
BrfDocument
  version            0 (M&B) | 1 (Warband)
  tokenOrder[]
  textures[]         { name, flags, frames }
  shaders[]          { name, flags, requires, technique, fallback, options[] }
  materials[]        { name, flags, shader, diffuseA, diffuseB, bump,
                       enviro, spec, specular, r, g, b }
  meshes[]           { name, flags, material, vertexVersion, vertexCount,
                       faceCount, frameCount, positionCount, rigged,
                       nameInfo: { base, lodLevel, pieceIndex, isLod,
                                   isCollisionBody } }
  skeletons[]        { name, boneCount, boneNames[] }
  animations[]       { name, boneCount, translationCount }
  bodies[]           { name, kind, partCount }
  bytesRead, fileBytes, counts
```

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
  items[]         { id, baseItemId, notes, overrides }
  outfits[]       { id, name, slot, itemIds[] }
  validation      { lastRunAt, summary }
  notes
```

Projects are stored in `projects/<id>.json` and validated on load. Saving an
existing project first copies it to `backups/projects/`.

## 7. Deliberate omissions (Phase 0)

| Concept | Why it is missing | Phase |
|---|---|---|
| Geometry buffers | Not needed for inspection; keeps the index light | 2 |
| Skeleton/rig data per mesh | Same | 2 |
| Item flag symbols | Needs the full `header_items.py` table | 1 |
| Outfit composition rules | Depends on slot/attachment research | 2 |
| Export job | Requires BRF writer + module backup flow | 3 |

## 8. Identity rules

- **Module identity** = directory name (case preserved), plus a lowercase slug for URLs.
- **Item identity** = record id (`itm_*`).
- **Mesh/material/texture identity** = name; lookups are case-insensitive because the engine can be configured that way (`use_case_insensitive_mesh_searches`) and Windows paths are case-insensitive.
- **Record identity inside a file** = array index; inserting in the middle shifts all ids. The studio never rewrites record order.
