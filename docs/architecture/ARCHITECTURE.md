# Architecture

**Phase 0 — validated foundation.** This document explains the complete proposed architecture and the part that is implemented today.

## 1. Goals

1. Understand real Warband clothing/armor assets end to end.
2. Make it easier, safer and more reliable to **create** and **integrate** them.
3. Stay local: no cloud, no telemetry, no external runtime services.
4. Keep the Warband knowledge reusable outside the UI.

## 2. Non-goals (current phases)

- Editing meshes, textures or items.
- Writing BRF files.
- 3D preview.
- Exporting into a module.
- A generic 3D editor.
- Multi-game support.

## 3. Two layers

```
┌─────────────────────────────────────────────────────────────┐
│  Outfit Studio (frontend/)                                  │
│  vanilla HTML/CSS/JS · asset browser · chain inspector       │
│  validation panel · project manager (Phase 1+)               │
└───────────────────────────▲─────────────────────────────────┘
                            │ HTTP JSON (localhost)
┌───────────────────────────┴─────────────────────────────────┐
│  backend/ — local HTTP server, routing, static assets       │
└───────────────────────────▲─────────────────────────────────┘
                            │ direct function calls
┌───────────────────────────┴─────────────────────────────────┐
│  Warband Engine (engine/) — no UI, no HTTP                   │
│  installation · modules · items · BRF · textures ·          │
│  validation · projects                                      │
└───────────────────────────▲─────────────────────────────────┘
                            │ read-only
┌───────────────────────────┴─────────────────────────────────┐
│  Mount & Blade: Warband installation                        │
│  mb_warband.exe · Modules/ · CommonRes/ · Textures/ · ...   │
└─────────────────────────────────────────────────────────────┘
```

The engine can be imported by a CLI (`tools/*.js`) or a future desktop shell without the server.

## 4. Engine modules

| Module | Responsibility | State |
|---|---|---|
| `engine/installation/detect.js` | Locate and describe an installation (exe, modules, version, optional dirs). Read-only. | IMPLEMENTED |
| `engine/installation/profileStore.js` | Installation profiles, activation, validation, removal. | IMPLEMENTED |
| `engine/modules/moduleIni.js` | Parse `module.ini` (keys, duplicates, resources, versions, capabilities). | IMPLEMENTED |
| `engine/modules/moduleRegistry.js` | Enumerate modules, stable ids/slugs. | IMPLEMENTED |
| `engine/items/itemKinds.js` | Parse/serialize `item_kinds1.txt`, classify slots/categories. | IMPLEMENTED |
| `engine/resources/brf.js` | BRF token-stream parser + writer (raw-range copy, dirty objects). | IMPLEMENTED |
| `engine/resources/brfIndex.js` | Merge all BRFs, resolve mesh families, persistent cache. | IMPLEMENTED |
| `engine/resources/textureResolver.js` | Case-insensitive DDS discovery + page detection. | IMPLEMENTED |
| `engine/resources/geometry.js` | Lazy mesh geometry (positions, rigging, frames, vertices, faces, bbox) with limits. | IMPLEMENTED |
| `engine/resources/workspace.js` | Only write target: guarded paths, atomic writes, backups, SHA-256. | IMPLEMENTED |
| `engine/resources/meshOverride.js` | Project mesh overrides: decode, validate, merge into a BRF. | IMPLEMENTED |
| `engine/resources/materialOverride.js` | Material overrides: validate, merge fields, collect textures. | IMPLEMENTED |
| `engine/skins/skins.js` | Parse `skins.txt` (body/calf/hand/head/skeleton per skin). | IMPLEMENTED |
| `engine/outfit/clipping.js` | Bounding-box outfit clipping analysis. | IMPLEMENTED |
| `engine/items/itemFlags.js` | Generated `itp_*` / `itcf_*` decoder and editor schema. | IMPLEMENTED |
| `engine/textures/dds.js` | DDS header parser. | IMPLEMENTED |
| `engine/validation/*` | Rule catalogue + item chain validation. | IMPLEMENTED |
| `engine/projects/projectStore.js` | JSON projects, atomic writes, automatic backups, restore. | IMPLEMENTED |
| `engine.buildProject` | Merge override artifacts into a workspace overlay or full module copy. | IMPLEMENTED |
| `engine/resources/workspace.js` | Workspace lifecycle, guarded writes, backups, restore. | IMPLEMENTED |
| `engine.buildProject` | Workspace overlay / full module build (Phase 8). | IMPLEMENTED |

## 5. Data flow: resolving one item

```
GET /api/items/itm_mail_shirt?module=Native
        │
        ▼
engine.getModuleData("Native")         ← lazy, cached per process
        ├─ parseItemKinds (620 records)
        ├─ createBrfIndex (CommonRes + Native/Resource)
        │     └─ per-file cache in cache/brf-index-*.json
        └─ createTextureResolver (module + global + languages)
        │
        ▼
resolveItemChain(item)
        ├─ resolveMesh("mail_shirt_a") → direct + base + LODs + pieces
        ├─ resolveMaterial("mail_shirt_a")
        ├─ resolveTexture("mail_shirt_a") → declared + .dds on disk
        ├─ parse DDS header (width/height/format)
        └─ rules → validation issues
        │
        ▼
{ item, chain: { meshes, issues, summary } }
```

## 6. Geometry and mutation flow (Phase 1)

```
engine.getMeshGeometry(module, name)
        │  index.resolveMesh -> mesh entry (BRF + byte range)
        ▼
readMeshGeometry(source, entry, limits)
        │  positions / rigging / frames / vertices / faces / bbox
        ▼
{ mesh, geometry }        (typed arrays, no caching)

engine.exportBrf(workspaceId, brfPath, { meshPatches })
        │  read installation file (read-only)
        ├─ parseBrf -> doc
        ├─ updateMesh(doc, mesh, patch, source) -> geometry loaded, mesh dirty
        ├─ serializeBrf(doc, source)  -> untouched objects copied byte-for-byte
        ▼
WorkspaceStore.writeFile()  -> workspace/<id>/... (atomic + backup + SHA-256)
```

The installation is only read. Every persisted byte passes through
`WorkspaceStore`, which rejects absolute paths and `..` escapes.

## 6.1 Outfit composition flow (Phase 6)

```
engine.getCharacter(module, skin)
        │  parse skins.txt -> body/calf/hand/head names
        ▼
resolve six mesh entries (body, calf.L/R, hand.L/R, head)
        │
        ├─ rigged mesh -> render stored bind-pose positions
        └─ rigid mesh  -> apply skel_human global bind matrix

engine.getOutfitItemMeshes(module, itemId)
        │  base + LOD-0 pieces; gloves also load _R
        ▼
render arrays -> Three.js group per slot
        │
        ├─ per-slot translation/scale
        ├─ bbox clipping analysis
        └─ project.outfits[] record (item ids + transforms)
```

`skel_human` matrices are parsed once from `CommonRes/skeletons.brf` and
cached per engine process. Rigid meshes are identified by an empty `rigging[]`
array; skinned meshes keep their authored bind positions (ADR-031).

## 6.2 Item editor flow (Phase 7)

```
engine.getItemEditable(module, item)
        │  full record + decodeItemFlags/decodeCapabilities
        ▼
UI form -> project.items[] override (validated)
        │  id/name/stats/meshes; existing ids immutable
        ▼
engine.exportItemOverrides(project)
        │  parse original item_kinds1.txt
        ├─ merge overridden base records
        ├─ append new records
        ├─ rerender only touched headers
        └─ WorkspaceStore.writeFile("item_kinds1.txt")
```

The item file writer reuses untouched raw headers and separators, so a vanilla
load/save remains byte-identical. Exporting never writes to the game.

## 6.3 Build flow (Phase 8)

```
project overrides
  ├─ group mesh overrides by source BRF -> apply sequentially -> one BRF
  ├─ group material overrides by source BRF -> apply -> copy textures
  └─ merge item overrides into item_kinds1.txt
        │
        ▼
validation gate (no writes on failure)
        │
        ▼
build workspace
  Modules/<module>/Resource/<changed>.brf
  Modules/<module>/Textures/<copy>.dds
  Modules/<module>/item_kinds1.txt
  build.json + build.log
```

`mode:"overlay"` writes only changed assets; `mode:"module"` first copies the
whole module and then applies the overlay. Both live entirely under
`workspace/`; the game installation is never written.

## 7. Indexing and cache
- **Scope**: every `.brf` in `<install>/CommonRes` plus `<module>/Resource`.
- **Cost measured**: 219 files / 147.5 MB → ~0.5 s cold parse in Node.
- **Cache**: `cache/brf-index-v2-<installationId>-<moduleSlug>.json`, keyed per file by `size + mtimeMs`.
- **Invalidation**: parser version constant + file stat; a changed BRF is re-parsed, deleted files disappear.
- **Failure policy**: a corrupt BRF is recorded in `parseErrors` and does not abort the index.
- **Memory**: the merged index keeps names/metadata only (no vertex data), ~7 243 mesh records.

The cache is derived data and safe to delete.

## 8. HTTP API (Phase 0-1)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness, version, uptime |
| GET | `/api/status` | installation, profiles, modules, project root |
| GET | `/api/profiles` | profile list + active |
| POST | `/api/profiles` | add `{ path, label }` (validates) |
| POST | `/api/profiles/:id/activate` | switch active installation |
| POST | `/api/profiles/validate` | re-validate every profile |
| DELETE | `/api/profiles/:id?confirm=<id>` | remove a profile (typed confirmation) |
| GET | `/api/modules` | module list with capabilities and ini summary |
| GET | `/api/modules/:id/summary` | item counts by slot, BRF stats, timing |
| GET | `/api/items` | paged wearable items (`slot`, `category`, `q`, `wearable`, `limit`, `offset`) |
| GET | `/api/items/:id` | item + resolved chain + validation + decoded flags |
| GET | `/api/items/:id/editable` | full editable item record for the item editor |
| GET | `/api/item-schema` | generated type/flag/capability symbol table |
| POST | `/api/validate` | batch validation `{ module, ids[] }` |
| GET | `/api/resources` | asset index (`type`, `q`, paging) |
| GET | `/api/resources/:type/:name` | mesh/material/texture/shader detail + references |
| GET | `/api/meshes/:name/geometry` | render-ready base64 typed arrays + bbox/counts |
| GET | `/api/meshes/:name/outfit-render` | rigid-pose variant for character assembly (`slot`/`role`) |
| GET | `/api/meshes/:name/editable` | editable model (shared positions, rigging, frames) |
| GET | `/api/skins` | `skins.txt` skins and skeletons |
| GET | `/api/characters` | resolved body parts for a skin |
| GET | `/api/outfit-items/:id/meshes` | base/piece/glove-pair meshes for an item |
| POST | `/api/outfits/analyze` | bounding-box clipping report |
| GET/POST | `/api/projects/:id/meshes` | list/save mesh overrides |
| GET/DELETE | `/api/projects/:id/meshes/:mesh` | load/delete an override |
| POST | `/api/projects/:id/meshes/:mesh/export` | merge the override and write a workspace BRF |
| GET | `/api/materials/:name/editable` | material fields, textures, shaders, users |
| GET/POST | `/api/projects/:id/materials` | list/save material overrides |
| GET/DELETE | `/api/projects/:id/materials/:name` | load/delete a material override |
| POST | `/api/projects/:id/materials/:name/export` | merge material + copy textures |
| POST | `/api/workspaces/:id/textures` | import a base64 DDS |
| GET/POST | `/api/projects/:id/textures` | list/register project textures |
| GET | `/api/textures/:name/raw` | raw DDS bytes (binary response) |
| GET | `/api/workspaces` | workspace list |
| POST | `/api/workspaces` | create `{ label, module }` |
| DELETE | `/api/workspaces/:id?confirm=<id>` | delete workspace (typed confirmation) |
| GET | `/api/backups` | project + workspace backup catalogue |
| POST | `/api/backups/restore` | restore `{ kind, path, confirm, workspaceId? }` |
| GET | `/api/projects` | project list |
| POST | `/api/projects` | create project `{ name, module, notes }` |
| GET | `/api/projects/:id` | load project |
| PUT | `/api/projects/:id` | save project (creates a backup) |
| GET/POST | `/api/projects/:id/items` | list/save item overrides |
| GET/DELETE | `/api/projects/:id/items/:itemId` | load/delete (typed confirmation) |
| POST | `/api/projects/:id/items/export` | merge item overrides into a workspace |
| POST | `/api/projects/:id/build` | validate and build a workspace overlay/module |
| GET | `/api/builds` | list build workspaces |
| GET | `/api/builds/:id` | read a build manifest and log |
| GET/POST | `/api/projects/:id/outfits` | list/save outfits |
| GET/DELETE | `/api/projects/:id/outfits/:outfitId` | load/delete (typed confirmation) |

Errors use a stable envelope:

```json
{ "ok": false, "error": { "code": "ITEM_NOT_FOUND", "message": "...", "details": null } }
```

## 9. Safety model (updated Phase 1)

1. **Read-only game access**: the engine only reads installation files. Exports
   read a BRF and write only into `workspace/`.
2. **Workspace separation**: projects in `projects/`, derived data in `cache/`,
   backups in `backups/` and `workspace/<id>/.backups/`, working copies in
   `workspace/`.
3. **Atomic writes**: files, projects and caches are written to a temp file and
   renamed.
4. **Automatic backup**: overwriting a project or a workspace file copies the
   previous revision first (workspace backups also record SHA-256).
5. **Path validation**: project/workspace ids are slugs; workspace paths cannot
   escape their root; static serving rejects traversal.
6. **Local binding**: the server binds `127.0.0.1` and is not reachable from the
   network.
7. **Deployment** (Phase 8) is still not implemented: it will require a dry-run
   report, explicit confirmation and a hash-recorded backup of the target.

## 10. Technology decisions (summary)

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js 22, ESM | already installed, fast binary I/O, single language across engine/backend/tools |
| Backend | `node:http` | zero dependencies, full control, tiny footprint |
| Frontend | vanilla HTML/CSS/JS modules | no build step, no framework churn, instant startup |
| 3D | Three.js 0.169 vendored in `frontend/vendor/`; custom orbit controls | offline-safe, no CDN, no import map |
| Types | JSDoc + `// @ts-check` | editor safety without a build toolchain |
| Tests | `node:test` | built in, zero dependencies |
| Storage | JSON files + filesystem | inspectable, diffable, no database |
| Packaging | `.cmd` launcher now; Node SEA later | simple; SEA removes the Node prerequisite |

Full rationale and trade-offs: [DECISIONS.md](../development/DECISIONS.md).

## 11. Failure modes and handling

| Failure | Behaviour |
|---|---|
| No installation | `/api/status` returns `ok:false` with the probed candidates; UI explains how to configure |
| Module without `item_kinds1.txt` | `MODULE_NOT_FOUND` / clear error |
| Corrupt BRF | recorded in `parseErrors`; other packs still load |
| Missing texture file | `WB-E-004` for the affected item only |
| Corrupt DDS | `WB-E-005`; dimensions unavailable |
| Port busy | tries the next 9 ports |
| Cache directory read-only | parsing continues, cache write is ignored |

## 12. Extensibility

- **New formats** (`.sco`, `.sav`, module system compiler) plug into `engine/` without touching the server or UI.
- **New rules** are pure functions in `engine/validation/rules.js` with stable codes.
- **New editors** consume the same JSON API; the frontend is replaceable.
- **Batch/CI** can use `engine/` through `tools/` with no server.
