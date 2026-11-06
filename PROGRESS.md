# WARBand Outfit Studio — Progress log

> **`PROJECT_PLAN.md` is the canonical project specification, roadmap and state.**
> This file remains the historical phase journal: append a section per phase.

This file is the running record of the project. **Append a new section for every phase.** Do not rewrite history: if a previous statement is wrong, add a correction entry.

Format per phase:

```
## Phase N — <title>   (YYYY-MM-DD)
Status: COMPLETE | IN PROGRESS | BLOCKED
Objective / Scope / Deliverables / Implemented / Tests / Findings / Risks / Next
```

---

## Phase 0 — Architecture & Project Foundation

**Date:** 2026-11-06
**Status: COMPLETE**

### Objective

Build the minimum, validated foundation for a local Warband clothing/armor tool: verify the formats against the real game, define the engine/UI split, design the data model and API, create the repository, and prove the architecture with real data and automated tests — without implementing the full editor.

### Inputs used

- REA analysis: `C:\Users\52777\Desktop\Warband_REA_Analisis_Memoria.md` (engine 1.170, module system 1.171, item/BRF/DDS formats, 64-bit id encoding).
- Live installation: `C:\Games\Mount and Blade Complete Collection\Mount and Blade - Warband` (Native, Viking Conquest, Napoleonic Wars).
- OpenBRF source used **as format documentation** (`brfData.cpp`, `brfMesh.cpp`, `brfMaterial.cpp`, `brfTexture.cpp`, `brfShader.cpp`, `brfSkeleton.cpp`, `brfAnimation.cpp`, `brfBody.cpp`, `saveLoad.cpp`). No code copied; the implementation is original JavaScript.

### Deliverables (brief §15)

| # | Deliverable | Where |
|---|---|---|
| A | Architecture document | [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) |
| B | Warband format map for clothing/armor | [docs/warband-analysis/FORMAT-MAP.md](docs/warband-analysis/FORMAT-MAP.md) |
| C | Repository structure | [README.md](README.md) §Project layout + this section |
| D | Technology decisions | [docs/development/DECISIONS.md](docs/development/DECISIONS.md) |
| E | Data model | [docs/architecture/DATA-MODEL.md](docs/architecture/DATA-MODEL.md) |
| F | Implementation status | §Implementation status below |
| G | Test results | §Test results below |
| H | Next phase scope | §Phase 1 scope below |

### Repository created

```
C:\Users\52777\Desktop\warband-outfit-studio\
├─ Warband Outfit Studio.cmd     launcher (Node + --open)
├─ README.md  PROGRESS.md  LICENSE  .gitignore
├─ config/app.json               installation + port
├─ engine/                       Warband Engine (no HTTP, no UI)
│  ├─ installation/detect.js
│  ├─ modules/moduleIni.js, moduleRegistry.js
│  ├─ items/itemKinds.js
│  ├─ resources/brf.js, brfIndex.js, textureResolver.js
│  ├─ textures/dds.js
│  ├─ validation/rules.js, validate.js
│  ├─ projects/projectStore.js
│  ├─ util/binaryReader.js, textFile.js, fsx.js
│  └─ index.js
├─ backend/server/index.js, static.js · api/routes.js
├─ frontend/index.html, css/app.css, js/app.js, js/api.js
├─ docs/architecture · docs/warband-analysis · docs/formats · docs/development
├─ tests/unit (6 files) · tests/integration (3 files)
├─ tools/build-index.js, inspect-brf.js
├─ projects/  cache/  backups/  workspace/
```

### Implementation status

#### IMPLEMENTED

| Area | Detail |
|---|---|
| Installation detection | env/config/known paths, engine version from `rgl_log.txt`, module count, fingerprint, diagnostics |
| Module registry | case-insensitive scan, `module.ini` parsing, capabilities, resource lists, duplicate/unknown keys |
| Item parsing | `item_kinds1.txt` full record model, slots, armor stats, factions, triggers, byte-perfect round-trip |
| Item classification | head/body/foot/hand wearables; clothing and cape heuristics |
| BRF parsing | token stream, textures, shaders, materials, meshes, skeletons, animations (skipped with exact layout), collision bodies |
| Mesh conventions | base / `.lodN` / `.piece` / `bo_`, composed meshes, families |
| Cross-file index | merge `CommonRes` + module `Resource`, case-insensitive lookups, persistent cache |
| Texture resolution | module → game → languages, `.dds` optional, numbered pages |
| DDS parsing | width, height, mipmaps, format, DX10 |
| Validation | 15 rules (6 errors, 5 warnings, 4 infos), entity-referenced issues |
| Projects | create/list/load/save, atomic writes, automatic backups, id validation |
| HTTP API | 11 endpoints, stable error envelope, CSP, loopback-only |
| UI | module selector, wearable browser (search + slot/category filters), item stats, asset chain, validation panel, engine status |
| Tooling | `build-index`, `inspect-brf`, launcher |
| Tests | 40 automated tests (unit + integration) |

#### PARTIALLY IMPLEMENTED

| Area | Gap |
|---|---|
| Item model | Flags/capabilities are raw numbers; symbolic `itp_*`/`itc_*` decoding is not done |
| UI | Read-only; no project editor, no import, no visual asset preview |
| BRF | Read-only; geometry buffers are skipped (counts only) |
| Skeleton/body | Parsed or skipped structurally; not exposed in the model |
| Module `module.ini` | Known-key catalogue is a curated subset; duplicate/unknown detection only |

#### PLANNED (Phase 1+)

- Item flag decoder and item editor.
- Project asset/outfit model wired to the UI.
- Module System source import (Python 2) or a compatible compiler.
- 3D preview with vendored Three.js.
- Texture thumbnails (DDS → image).
- Export pipeline with dry-run validation, backups and confirmation.

#### UNKNOWN / REQUIRES FURTHER RESEARCH

- Exact engine behaviour for glove `_L`/`_R` mirroring.
- Female armor variant conventions (`_f`) — none found in Native armor packs.
- `itp_*` bit semantics beyond the type nibble in the context of the studio's categories.
- BRF writing edge cases (OpenBRF save order and version-specific fields).
- `.sco` scene structure (out of scope for clothing).
- `.sav` format.

### Test results

```
npm test
# tests 40 · pass 40 · fail 0 · duration ≈ 4.2 s
```

| Suite | Tests | What it proves |
|---|---:|---|
| `unit/binaryReader` | 6 | bound checks, strings, maybe-string presence, point order, trailing bytes |
| `unit/itemKinds` | 5 | record parsing, stats, round-trip, re-render, classification, error line numbers |
| `unit/moduleIni` | 2 | keys/comments/resources/versions/capabilities/duplicates |
| `unit/dds` | 3 | DDS header, bad magic, mesh naming |
| `unit/projectStore` | 4 | slug, create/load/list, backup-on-save, traversal rejection |
| `unit/validation` | 6 | missing mesh/material/texture/file, invalid DDS, shader warning |
| `integration/brf` | 6 | real BRFs (armors_g, materials, textures, core_shaders, ani_attacks), truncation, naming |
| `integration/pipeline` | 7 | installation, Native counts, real chain, composed mesh, batch validation, all modules' items |
| `integration/api` | 2 | HTTP endpoints, CSP, static, projects + backup, structured 404 |

Golden numbers asserted against the real installation:

| Metric | Value |
|---|---:|
| Native items | 620 |
| Native wearables | 279 (132 body / 113 head / 28 foot / 6 hand) |
| BRF files scanned | 219 |
| Meshes / materials / textures / shaders | 7 243 / 633 / 734 / 139 |
| `item_kinds1.txt` round-trip | byte-identical for Native, VC, NW |
| BRF parse errors | 0 |

### Performance (development machine)

| Operation | Time |
|---|---:|
| Full `CommonRes` cold parse (Node) | ~0.5 s |
| Viking Conquest (398 BRF, 563 MB) cold parse | ~1.75 s |
| Warm index load + merge + texture index | ~0.2 s |
| Item detail (chain + DDS headers) | < 10 ms |
| `npm test` (40 tests) | ~4.2 s |

### Findings and corrections

1. **BRF is a token stream, not a fixed 6-section container.** The earlier REA report interpreted the first `u32 6` as a section count; it is the length prefix of the string `"rfver "`. The verified layout is documented in [docs/formats/BRF.md](docs/formats/BRF.md). Statistical facts in the REA report (counts, engine version, item encoding) remain valid.
2. **An item's chain spans multiple BRFs.** `itm_mail_shirt` → `armors_g.brf` (mesh), `materials.brf` (material), `textures.brf` (texture). A tool that only opens one BRF cannot resolve items.
3. **Composed meshes are valid without a base mesh.** `itm_sarranid_felt_head_cloth_b` uses `common_tulbent_b.1/.2`; a naive "mesh not found" check produces a false positive. The studio reports INFO, not ERROR.
4. **`capabilities` is a 64-bit mask.** It must be a string in JS; `9223388529554358287` loses precision as a `Number`.
5. **Repeated `load_resource` keys are normal** (214 in Native); only non-repeatable keys are flagged as duplicates.
6. **Gloves are `_L` items** with a separate `_R` mesh; the item record references only the left mesh.

### Risks / open issues

| Risk | Impact | Mitigation |
|---|---|---|
| BRF writer not implemented | Cannot export new meshes yet | Format fully documented; next phase decision |
| Item flag table incomplete | Cannot edit flags safely in the UI | Generate from `header_items.py` in Phase 1 |
| Cache schema changes | Stale cache after engine changes | `PARSER_VERSION` constant invalidates it |
| Very large mods (VC: 1.3 GB assets) | Slower first index | Per-file cache; only metadata is kept |
| No 3D preview | Can't visually verify assets yet | Phase 2, vendored Three.js |

### Phase 1 scope (exact)

1. **Item flag/symbol decoder**
   - Generate a table from Module System `header_items.py` (`itp_*`, `itc_*`, `itcf_*`) with human labels.
   - Show decoded flags and capabilities in the item panel.
   - Tests: known vanilla items decode to expected symbols.

2. **Editable item records (in-memory + project)**
   - Project items reference a base item and store field overrides.
   - Validation: duplicate identifiers, id format, stat ranges, required meshes.
   - Round-trip export of a **copy** of `item_kinds1.txt` into `workspace/` (not the game).

3. **Project editor UI**
   - Create/open/save projects from the UI.
   - Add an item and an outfit skeleton to a project.
   - Show validation for the project as a whole.

4. **Module System source import (read-only)**
   - Import `module_items.py` / `module_constants.py` if the user provides a Module System folder.
   - Map source records to compiled ids for cross-checking.

**Explicitly out of Phase 1:** BRF writing, 3D viewport, deployment into a module.

### Milestone

Phase 0 committed as a stable milestone. No game files were modified. `npm test` green.

### Addendum — master plan adoption (2026-11-06)

- `PROJECT_PLAN.md` created as the canonical specification, 10-phase roadmap, decision log and tracker; this journal remains the historical record.
- Two small corrections after the first report: material-level validation issues are now attributed correctly, and local configuration was split into git-ignored `config/app.json` + committed `config/app.example.json`.
- Roadmap reconciliation recorded in `PROJECT_PLAN.md` §9 / ADR-012: Phase 0 already delivered the parsers and installation/module detection, so Phase 1 targets the remaining Resource Engine work instead of rebuilding them. **Pending user approval.**
- Milestone tag: `phase-0-foundation`.

---

## Phase 1 — Warband Resource Engine

**Date:** 2026-11-06
**Status: COMPLETE**

### Objective

Complete the resource layer so the engine can read geometry, write BRF files safely, decode item flags, and mutate resources **only** inside a workspace.

### Implemented

| Area | Deliverable |
|---|---|
| BRF writer | `serializeBrf(doc, source)`: untouched objects copied byte-for-byte; dirty meshes/materials/textures/shaders/skeletons re-encoded |
| Geometry | `readMeshGeometry`: positions, rigging, frames, typed vertex arrays (layouts 0/1/2), faces, bbox; limits + end checks |
| Mutation | `updateMesh`, `replaceMeshGeometry`, `loadMeshGeometry`; vertex-layout flag changes rejected |
| Item flags | `tools/generate-item-flags.js` → committed table with source SHA-256; `decodeItemFlags` / `decodeCapabilities` (enums before bits) |
| Workspaces | `WorkspaceStore`: guarded paths, atomic writes, overwrite backups + SHA-256; `engine.exportBrf` |
| Engine API | `getMeshGeometry`, `createWorkspace`, `listWorkspaces`, `exportBrf`; `getItemDetail` returns decoded flags |
| UI | Flags/capabilities panel with type, enum fields, aliases and unknown bits |
| Tools | `export-brf`, `generate-item-flags` |

### Tests

`npm test` → **61 / 61 passing** (~4.0 s).

New suites:

- `unit/brfWriter` (7): synthetic v1/v0 round-trip, `spec` presence, geometry, dirty material, layout-flag guard.
- `unit/itemFlags` (6): provenance, real items, unknown bits, enum-vs-bit, zero capabilities.
- `unit/workspace` (4): create/list/write, backup + hash, traversal/absolute rejection.
- `integration/brfWriter` (4): **219/219** `CommonRes` byte-identical corpus, real mesh edit, real geometry counts, workspace export with source hash check.

### Verified against real data

- Corpus: every `CommonRes` BRF parses and serializes byte-identically (219/219).
- `mail_shirt_a` geometry: counts match the index, 11 rigging bones, valid face indices, finite UVs.
- Export: source BRF SHA-256 unchanged; output under `workspace/`; previous revisions backed up.
- `itm_mail_shirt` flags decode to `itp_type_body_armor` + `itp_merchandise` + `itp_covers_legs`, no unknown bits.

### Findings / corrections

1. **Enums are not bits.** Attachment (`0xF00`), carry (`0x7F0000000`) and shoot (`0xFF000`) are masked fields. A bit-only decode would mislabel `0x30000000` as two carry flags. Decoder extracts fields first (F-19).
2. **The header carry mask spans bits 28–34**, not 28–31; values include `0x100000000`…`0x220000000`. Derived from `header_items.py` constants and verified against decode.
3. **Material `spec` is optional** (`LoadStringMaybe`): absent means the next four bytes are the specular float, not a placeholder. The writer emits nothing when absent.
4. **BRF byte ranges are the key to safe writing**: preserving untouched objects avoids re-encoding animations/bodies that Phase 1 does not model.

### Known limitations

- Dirty animations and collision bodies cannot be written (preserved verbatim; writer throws if marked dirty).
- Section counts cannot change yet (no add/remove objects).
- Geometry is re-read per request; no cache.
- Module `Resource` packs are not in the round-trip corpus (CommonRes only).
- Item capability bit 63 in `itm_no_item` is not in `header_items.py`; reported as unknown.

### Documentation updated

- `PROJECT_PLAN.md` (Phase 1 complete, Phase 2 proposed, ADR-013…017, findings, tests).
- `docs/formats/BRF.md` (writer + geometry), new `docs/formats/ITEM-FLAGS.md`.
- `docs/architecture/ARCHITECTURE.md`, `docs/architecture/DATA-MODEL.md`, `docs/development/DECISIONS.md`, `docs/development/SETUP.md`, `README.md`.

### Milestone

Tag `phase-1-resource-engine`. No game files were modified. `npm test` green.

---

## Phase 2 — Game & Module Manager

**Date:** 2026-11-06
**Status: COMPLETE**

### Objective

Turn detection/indexing into a complete local manager: multiple installation profiles, workspace lifecycle, a browsable asset index and a backup catalogue with verified restores.

### Implemented

| Area | Deliverable |
|---|---|
| Profiles | `config/profiles.json` (git-ignored), bootstrap, add/dedupe, activate, validate, remove with typed id |
| Workspaces | create/list/delete, `moduleId`, reuse (`ensure`), guarded writes, atomic updates, SHA-256 backups |
| Asset index | `listResources` / `getResourceDetail` for meshes, materials, textures, shaders; family/LOD/pieces; DDS metadata; cross-references |
| Backups | project + workspace listing, hash verification, restore with typed confirmation and pre-restore backup |
| UI | `Recursos`, `Workspaces`, `Copias` views; profile selector + modal; module selector |
| API | profiles, resources, workspaces, backups/restore endpoints |
| Version | 0.3.0, phase 2 |

### Tests

`npm test` → **74 / 74 passing** (~4.2 s).

New suites:

- `integration/profiles` (3): bootstrap, dedupe/invalid path, remove confirmation + active reset.
- `integration/resources` (6): lists, details, references, structured 404.
- `unit/backups` (3): project restore, workspace restore + tamper detection, path escapes.
- `unit/workspace` extended (5): delete requires the workspace id.
- `integration/api` extended: profiles, resources, workspaces, backups.

### Verified against real data

- Active profile: 1.170, 3 modules; written to `config/profiles.json` on first run.
- Asset index: 7,243 meshes in Native; `mail_shirt_a` resolves material, three textures (1024²) and `itm_mail_shirt`.
- Workspace UI: create `Ui Demo` → `workspace/ui-demo` with module Native; list shows file count.
- Backups: project + workspace rows rendered from real files; wrong confirmation → HTTP 400; correct restore restored `notes=v1` and created a pre-restore backup.
- UI DOM checks: 279 wearables, 7,243 resources, mesh refs, backup section counts, profile modal; no console errors.

### Findings / corrections

1. **Repeated CLI exports created `demo-1`, `demo-2`.** Fixed with `WorkspaceStore.ensure(label)` and `createWorkspace(label, { reuse: true })`; the CLI now reuses `workspace/demo`.
2. **Destructive actions need more than a boolean.** Profiles, workspaces and restores now require the entity id as `confirm` (ADR-019); restores also back up the current state.
3. **Backups must be validated, not trusted.** Workspace restores verify the sidecar SHA-256 before writing; tests tamper with a backup and assert rejection.
4. **Profiles must not leak machine paths.** `config/profiles.json` is git-ignored and auto-created (ADR-018).

### Known limitations

- No workspace rename or file-level delete.
- No diff preview before restore.
- No backup pruning (retention deferred to Phase 9).
- Asset index shows LOD/piece meshes as separate rows.
- Destructive confirmations use `window.prompt` (polish in Phase 10).
- Deployment is still Phase 8.

### Documentation updated

- `PROJECT_PLAN.md` (Phase 2 complete, Phase 3 proposed, ADR-018…020, tests, changelog).
- New `docs/architecture/MANAGER.md`.
- `docs/architecture/{ARCHITECTURE,DATA-MODEL}.md`, `docs/development/{DECISIONS,SETUP}.md`, `README.md`.

### Milestone

Tag `phase-2-module-manager`. No game files were modified. `npm test` green.

---

## Phase 3 — 3D Viewport

**Date:** 2026-11-06
**Status: COMPLETE**

### Objective

Render real Warband meshes locally in the browser, with no CDN and no runtime dependency beyond a vendored pinned library, and verify a real armor asset end to end.

### Implemented

| Area | Deliverable |
|---|---|
| Library | Three.js **0.169.0** vendored in `frontend/vendor/three/` (MIT) |
| Viewport | WebGL renderer, perspective camera, custom orbit/pan/zoom, grid, hemisphere + directional lights, resize observer |
| Data | `engine.getMeshRenderData` (expand per vertex, base64 typed arrays, bbox/counts) and `engine.getTextureFile` |
| API | `GET /api/meshes/:name/geometry`, `GET /api/textures/:name/raw` (binary) |
| DDS | browser decoder for DXT1/3/5 (DX10 BC1–BC3) + uncompressed 32-bit fallback |
| UI | **Visor** tab (search, load, stats), framing/grid/wireframe/V-flip toggles, “Ver en visor 3D” from the asset index |
| Performance | render loop paused when the tab is hidden; pixel ratio capped at 2 |

### Tests

`npm test` → **81 / 81 passing** (~4.4 s).

New suites:

- `unit/ddsDecode` (4): DXT1 4-colour and transparent modes, DXT5 alpha, bad magic.
- `integration/renderdata` (3): per-vertex expansion, raw DDS bytes, missing-texture code.
- `integration/api` extended: geometry payload and binary texture response.

### Verified against real data

- `mail_shirt_a`: 782 render vertices, 1,240 faces, 622 positions; max face index 781
  → confirms faces index the **vertex list** and each vertex indexes positions (F-21).
- Diffuse texture: 1024×1024 DXT1 decoded in the browser and displayed.
- Screenshot (Phase 3): correct silhouette, chainmail texture, grid and UI.
- Frame rate: **60 fps** (vsync) at 800×384.
- No console errors; WebGL context created.

### Findings

1. **Face/vertex indexing**: BRF faces index the vertex list, not the position list. The
   engine now expands positions/normals/UVs per vertex; a naive `positions[face]` mapping
   would be wrong for meshes with UV seams (F-21).
2. **UV convention**: the viewport defaults to V-flip (`v'=1-v`), matching OpenBRF's
   documented behaviour; the exact engine sampling remains **LIKELY**, so a toggle is
   exposed (F-22).
3. **DDS rows are top-down**; `DataTexture` uses `flipY=false`, and the V toggle controls
   the final orientation.

### Known limitations

- Bind pose only; no skeleton/skinning yet.
- Diffuse map only; normal/spec preview is Phase 5.
- No mipmaps, shadows, BC4–BC7 or cube maps.
- One mesh at a time; no mesh editing.
- Geometry is re-read per selection; no LRU cache.

### Documentation updated

- New `docs/architecture/VIEWPORT.md`.
- `PROJECT_PLAN.md` (Phase 3 complete, Phase 4 proposed, ADR-021…023, findings, tests).
- `docs/architecture/{ARCHITECTURE,DATA-MODEL}.md`, `docs/development/{DECISIONS,SETUP}.md`,
  `README.md`.

### Milestone

Tag `phase-3-viewport`. No game files were modified. `npm test` green.

---

## Phase 4 — Mesh Editor

**Date:** 2026-11-06
**Status: COMPLETE**

### Objective

Edit real Warband meshes in the viewport, preserve BRF compatibility (shared positions, rigging, UV seams, animation frames), store edits as project overrides and export them to a workspace copy.

### Implemented

| Area | Deliverable |
|---|---|
| Editable model | shared positions + `vertexPosition`, normals/UVs/indices, colour/tangent/uv2, rigging, animation frames |
| Selection | vertex/face raycast picking, shift multi-select, overlay points/faces |
| Transforms | move/rotate/scale, X/Y/Z/Normal, local axis, numeric input, snapping; frame positions/normals updated |
| Topology | delete, duplicate, mirror X, per-face extrude, merge, split |
| Guards | count-changing topology blocked on rigged/framed meshes (ADR-026) |
| History | 25 snapshots, undo/redo, reset |
| Overrides | project `meshes[]` with base64 arrays; save/load/delete; validation |
| Export | merge override into the source BRF; write `workspace/mesh-edits/<mesh>.brf` |
| API | editable mesh, project overrides, export |
| UI | Visor edit toolbar + project controls |

### Tests

`npm test` → **96 / 96 passing** (~4.8 s).

New suites:

- `unit/meshEdit` (13): transforms/snapping, topology, rigged guard, mirror/extrude/merge/split, validation, override round-trip.
- `integration/meshOverride` (2): real edit → override → export, frame preservation, invalid override rejection.
- `integration/api` extended: editable endpoint.

### Verified against real data

- `mail_shirt_a` (rigged, 2 animation frames): translated one selected vertex.
- Export diff vs source: **1 bind position** and **1 frame position** changed; frames preserved; vertex/face counts unchanged; source SHA-256 unchanged.
- UI flow verified: select vertex → apply transform → save override → export; screenshot captured.

### Findings

1. **Frames are per-position and per-vertex**: frame positions index positions (622), frame normals index vertices (782). Transforms must update both (F-23).
2. **Shared positions must be moved once**: many render vertices share a position; transforms deduplicate by `vertexPosition` (F-24).
3. **Count-changing topology cannot preserve rigging/frames**: blocked with explicit errors; delete/merge/transforms remain available.

### Known limitations

- No edge loops; vertex + face selection only (approved).
- Extrude is per-face (internal walls on adjacent faces).
- No UV or weight editing.
- Overrides store a full geometry snapshot.
- Meshes with frames allow transforms only.
- No link to outfit/item projects yet.
- No project diff/merge UI.

### Documentation updated

- New `docs/architecture/MESH-EDITOR.md` (with screenshot).
- `PROJECT_PLAN.md` (Phase 4 complete, Phase 5 proposed, ADR-024…026, findings, tests).
- `docs/architecture/{ARCHITECTURE,DATA-MODEL}.md`, `docs/development/{DECISIONS,SETUP}.md`,
  `README.md`.

### Milestone

Tag `phase-4-mesh-editor`. No game files were modified. `npm test` green.

---

## Phase 5 — Texture & Material System

**Date:** 2026-11-06
**Status: COMPLETE**

### Objective

Edit real BRF materials, preview them with diffuse/normal/specular maps, import DDS textures safely, and export material overrides plus their textures into a workspace.

### Implemented

| Area | Deliverable |
|---|---|
| Material model | fields, shader list, texture details and mesh users from the engine |
| Editor | Visor **Material** tab: shader, colour 0–255, specular, diffuse/bump/spec, toggles |
| Preview | diffuse `map`, normal `normalMap`, specular as metalness approximation, alpha/double-side |
| DDS import | validate header, write to `workspace/textures/`, register in `project.textures[]` |
| Overrides | project `materials[]`; save/load/delete; validation |
| Export | merge material into the source BRF, copy referenced textures to `workspace/materials/` |
| API | material editable, project materials/textures, texture import, material export |

### Tests

`npm test` → **102 / 102 passing** (~6.3 s).

New suites:

- `unit/materialOverride` (3): validation, colour range, texture references.
- `integration/materials` (3): real material edit/export, DDS import/registry, invalid override.
- `integration/api` extended: material editable endpoint.

### Verified against real data

- `mail_shirt_a`: shader `specular_shader_skin_bump_high`, maps diffuse/normal/spec, colour 15/15/15, specular 16.
- Edited to r/g/b 64/128/192 and specular 2.5; export produced `mail_shirt_a.brf` + 3 textures.
- Reparsed BRF matches the override; source SHA-256 unchanged.
- UI flow verified: material panel populated, preview refreshed, override saved, export succeeded; screenshot captured.

### Findings

1. **Material colour scale is 0–255** (not 0–1); `specular` is a raw float (F-25). The first implementation assumed 0–1 and was corrected before completion.
2. **`spec` is optional** in the BRF; a non-empty value implies presence (F-26).
3. **Specular preview is an approximation** (metalnessMap) because the Warband shader graph is unavailable (ADR-029).

### Known limitations

- No material creation from scratch (overrides target existing materials).
- No texture painting/resizing/conversion; import/reference only.
- DXT1/3/5 + BC1–3, first mip only.
- Shader parameters/options are not edited, only the shader name.
- Imported textures are not garbage-collected with projects.
- Specular/alpha preview is approximate.

### Documentation updated

- New `docs/architecture/MATERIALS.md` (with screenshot).
- `PROJECT_PLAN.md` (Phase 5 complete, Phase 6 proposed, ADR-027…029, findings, tests).
- `docs/architecture/{ARCHITECTURE,DATA-MODEL}.md`, `docs/development/{DECISIONS,SETUP}.md`,
  `README.md`.

### Milestone

Tag `phase-5-materials`. No game files were modified. `npm test` green.

---

## Phase 6 — Outfit & Armor Editor

**Date:** 2026-11-06
**Status: COMPLETE**

### Objective

Compose complete outfits on real Warband character bodies: load `skins.txt` and
skeleton/body meshes, equip items by slot, adjust placement, check obvious
clipping and persist/reopen outfit projects — without modifying the game.

### Implemented

| Area | Deliverable |
|---|---|
| Skins | `engine/skins/skins.js`; Native `man`/`woman`, six parts each |
| Body assembly | `skel_human` bind matrices for rigid parts; skinned meshes keep bind positions |
| Items | base + LOD-0 pieces; gloves load `_L` + `_R`; material metadata |
| UI | Visor **Outfit** tab: skin, body/head/hand/foot slots, offsets, preset, clipping, save/load/delete, PNG snapshot |
| Persistence | `project.outfits[]` item references; validation; typed delete confirmation |
| API | skins, characters, outfit meshes, outfit render, clipping, project outfits |
| Tests | 108 automated tests |

### Tests

`npm test` → **108 / 108 passing** (~6.8 s).

New suites:

- `unit/clipping` (4): containment, detached item, non-body overlap, missing bounds.
- `integration/skins` (1): real `skins.txt`, both bodies, missing skin.
- `integration/outfits` (1): item meshes, rigid pose, outfit save/load/delete/validation.
- `integration/api` extended: skins, characters, posed head, clipping, outfit CRUD.

### Verified against real data

- Native `skins.txt` = 2 skins; body parts resolve for `man` and `woman`.
- `male_head` raw bbox `y = -0.109…0.133` → posed `y = 1.497…1.824`.
- `man_body` stays at the authored bind pose (`posed.applied = false`).
- `itm_leather_gloves` resolves `_L` + `_R`; `itm_mail_shirt` → `mail_shirt_a`.
- UI `Knight Demo`: 11 pieces, saved/reloaded, 0 clipping warnings; screenshot
  captured to `docs/assets/outfits-phase6.png`.
- PNG snapshot export produced 56,713 bytes.
- Game installation read-only; no writes to BRFs, items or textures.

### Findings

1. **Face-key stride is six tokens**, not five (F-27); this initially misaligned
   the second skin and was corrected.
2. **Rigid vs skinned storage** is the key to assembling a body. Skinned meshes
   are already in bind-pose/world space; rigid parts are bone-local and need
   `parent × [x y z t]` (F-29/F-30). Applying matrices to skinned meshes
   double-transformed them (bbox y ≈ 2.99).
3. **Helmets and gloves are rigid**, while Native body/foot/body-armor meshes
   are rigged (F-31).
4. **Bounding-box clipping** cannot flag body-vs-item overlap without noise;
   body containment is intentionally skipped (ADR-033).
5. **Snapshot capture** works by rendering synchronously before
   `canvas.toDataURL()`; it is a browser download.

### Known limitations

- Bind pose only; no animation, skeleton rotation or weight editing.
- One item per slot; no layered garments or separate cape slot.
- Female armor fit is approximate; body armor is not re-skinned.
- Bbox clipping can miss surface intersections.
- PNG snapshot is not tracked in a project/workspace.
- Rigid/skinned classification is verified on Native, not traced through the
  engine executable.

### Documentation updated

- New `docs/architecture/OUTFITS.md` (with screenshot).
- `PROJECT_PLAN.md` (Phase 6 complete, Phase 7 proposed, ADR-030…033, findings, tests).
- `docs/architecture/{ARCHITECTURE,DATA-MODEL}.md`,
  `docs/development/{DECISIONS,SETUP}.md`, `README.md`, version 0.7.0.

### Milestone

Tag `phase-6-outfit-editor`. No game files were modified. `npm test` green.

---

## Phase 7 — Item Editor

**Date:** 2026-11-06
**Status: COMPLETE**

### Objective

Edit real Warband item records safely, validate their stats and references, and
export a merged compiled item file into a workspace without touching the game.

### Implemented

| Area | Deliverable |
|---|---|
| Editable model | `getItemEditable` + `/api/item-schema` with full record, flags/capabilities and symbol table |
| UI | In-place **Prendas** form: identity, type/flags, capabilities, stats, mesh rows, project selection |
| Overrides | `project.items[]`: edit existing or create new; immutable existing ids; duplicate/missing-mesh guards |
| Export | merge into `workspace/item-edits/item_kinds1.txt`; untouched records raw-preserved |
| Preview | opens the Phase 6 outfit view with the base item in its slot |
| Tests | 109 automated tests |

### Tests

`npm test` → **109 / 109 passing** (~5.9 s).

New suite:

- `integration/items` (1): editable record, override validation, new item export,
  re-parse and source SHA-256 unchanged.

`integration/api` extended with schema, editable item, project item CRUD and
export endpoints.

### Verified against real data

- `itm_mail_shirt`: type `itp_type_body_armor`, mesh `mail_shirt_a`, flags
  `0x101000D`.
- Edited `Edited_Mail_Shirt` body armor 44 and value 1500; exported.
- New `itm_test_new_armor` appended; exported file had **621** records from
  Native's 620 and re-parsed correctly.
- Source `Modules/Native/item_kinds1.txt` SHA-256 unchanged.
- UI verified: override loaded, saved, exported, previewed in the Visor;
  screenshot captured to `docs/assets/items-phase7.png`.

### Findings

1. **Raw-header reuse preserves untouched items** while re-rendering only
   touched headers (F-34).
2. **Type is flags & 0x1F; capabilities must stay a decimal string** (F-35).
3. **New records append cleanly** and update the declared count (F-36).
4. **Existing ids should be treated as immutable** because external records
   reference them (F-37).
5. **Item export is structural**; material/texture chain validation remains a
   separate validator path (F-38).

### Known limitations

- Existing ids cannot be renamed.
- Factions/triggers are preserved but not edited.
- Preview uses the base module item; edited meshes need export + index rebuild.
- Export is compiled `item_kinds1.txt`, not Module System `.py`.
- Item deletion is not exposed; only project overrides can be removed.

### Documentation updated

- New `docs/architecture/ITEMS.md` (with screenshot).
- `PROJECT_PLAN.md` (Phase 7 complete, Phase 8 proposed, ADR-034…036, findings, tests).
- `docs/architecture/{ARCHITECTURE,DATA-MODEL}.md`,
  `docs/development/{DECISIONS,SETUP}.md`, `README.md`, version 0.8.0.

### Milestone

Tag `phase-7-item-editor`. No game files were modified. `npm test` green.

---

## Phase 8 — Warband Builder & Exporter

**Date:** 2026-11-06
**Status: COMPLETE**

### Objective

Turn a project's mesh, material and item overrides into a validated, auditable
workspace build — without writing into the game installation.

### Implemented

| Area | Deliverable |
|---|---|
| Pipeline | group mesh/material overrides by source BRF, apply sequentially, merge items, copy textures |
| Validation gate | stops before writing on invalid artifacts, missing textures, item errors or target collisions |
| Modes | workspace overlay (default) and full module copy (explicit) |
| Manifest/log | `build.json` with target paths, bytes and SHA-256; human-readable `build.log` |
| API | `POST /api/projects/:id/build`, `GET /api/builds`, `GET /api/builds/:id` |
| UI | **Build** view: project selector, full-copy checkbox, build list, manifest and log |
| Tests | 111 automated tests |

### Tests

`npm test` → **111 / 111 passing** (~5.5 s).

New suite:

- `integration/build` (2): overlay with real mesh/material/item overrides,
  grouped target output, source hashes unchanged; invalid build gate.

`integration/api` extended with build creation/list/detail.

### Verified against real data

- Real project: `mail_shirt_a` mesh move, `mail_shirt_a` material colour/specular
  change, `itm_mail_shirt` item edit.
- Build overlay produced changed `armors_g.brf`, `materials.brf`, textures and
  `item_kinds1.txt`; parsed material and item output matched the overrides.
- Source BRF hashes unchanged; invalid item mesh produced no workspace.
- Full-copy mode verified manually on Native: 75.6 MB, `module.ini` present,
  ~2.2 s.
- The game installation remains read-only; deployment is a manual copy of a
  `module` build.

### Findings

1. **Multiple overrides in one source BRF must be grouped** and applied
   sequentially (F-39).
2. **Full Native copy is 75.6 MB** and completes in ~2.2 s locally (F-40).
3. **CommonRes BRFs can be placed in module `Resource/` by basename**; Native
   already has matching `load_resource` entries (F-41, LIKELY).
4. **Build manifests are sufficient to audit outputs** by path + SHA-256 (F-42).

### Known limitations

- No live game deployment; only workspace artifacts.
- Overlay relies on existing `module.ini` resource entries.
- Full-copy builds can be multi-GB for VC/NW.
- No diff viewer, rollback or retention policy yet.
- Build validation cannot prove every engine shader condition.

### Documentation updated

- New `docs/architecture/BUILDER.md`.
- `PROJECT_PLAN.md` (Phase 8 complete, Phase 9 proposed, ADR-037…039,
  findings, tests).
- `docs/architecture/{ARCHITECTURE,DATA-MODEL}.md`,
  `docs/development/{DECISIONS,SETUP}.md`, `README.md`, version 0.9.0.

### Milestone

Tag `phase-8-builder`. No game files were modified. `npm test` green.

---

## Phase 9 — Validation, Backup, Recovery & Hardening

**Date:** 2026-11-06
**Status: COMPLETE**

### Objective

Make builds recoverable and bounded: retain/prune artifacts and backups,
restore build project snapshots, compare sources with built files, and ensure
changed BRFs are loaded by the module.

### Implemented

| Area | Deliverable |
|---|---|
| Build snapshot | `project.json` saved with every build |
| Rollback | `rollbackBuild` restores the snapshot through project backup flow |
| Diff | `diffBuild` reports source/built bytes and SHA-256; project/game textures non-comparable |
| Build retention | keep-N build pruning with `PRUNE_BUILDS` |
| Backup retention | project/workspace keep-N pruning with `PRUNE_BACKUPS` |
| Module integration | missing `load_resource` entries appended to built `module.ini` |
| UI | build diff/rollback/prune controls; backups prune control |
| Tests | 114 automated tests |

### Tests

`npm test` → **114 / 114 passing** (~7.7 s).

New coverage:

- build rollback, diff and prune;
- module.ini missing-resource injection;
- project and workspace backup pruning;
- API diff/prune routes.

### Verified against real data

- Rollback restored `Built_Mail` after a post-build rename.
- Diff identified changed item/material/mesh files; textures marked unavailable.
- `core_ui_meshes` was added to the built `module.ini`.
- Keep-N pruning retained the newest build and removed older workspaces.
- Source game files remained read-only.

### Findings

1. **Build snapshots make project rollback deterministic** (F-43).
2. **Byte/SHA-256 diff is sufficient for a binary build audit** (F-44).
3. **Native does not list every CommonRes pack**, so module.ini append is
   required for some overlays (F-45).
4. **Keep-N retention needs typed confirmation** to avoid surprising deletion
   (F-46).

### Known limitations

- Rollback restores project state, not built files; rebuild afterwards.
- Diff is not a semantic mesh/texture diff.
- `module.ini` integration only appends; it does not remove/reorder entries.
- Backup pruning leaves empty `.backups` timestamp directories.
- Builds still do not write into the live game.

### Documentation updated

- `docs/architecture/BUILDER.md` expanded with recovery/retention/diff.
- `PROJECT_PLAN.md` (Phase 9 complete, Phase 10 proposed, ADR-040…043,
  findings, tests).
- `docs/architecture/{ARCHITECTURE,DATA-MODEL}.md`,
  `docs/development/{DECISIONS,SETUP}.md`, `README.md`, version 0.10.0.

### Milestone

Tag `phase-9-hardening`. No game files were modified. `npm test` green.

---

## Phase 10 — Build, Launch & Production Polish

**Date:** 2026-11-06
**Status: COMPLETE**

### Objective

Make the project distributable and supportable: portable release, first-run
setup, diagnostics/logs, recovery guidance and accessibility polish.

### Implemented

| Area | Deliverable |
|---|---|
| Release | `npm run release`; portable folder, Windows launcher, optional bundled Node runtime |
| First run | automatic installation wizard when no installation is registered |
| Diagnostics | **Sistema** health checks, environment, recovery guidance and log tail |
| Logging | `cache/logs/server.log`, 1 MB rotation, `/api/logs` |
| Accessibility | live status, `aria-current`, `/` search shortcut, focus-visible, reduced motion |
| Docs | user guide and release guide |
| Tests | 115 automated tests |

### Tests

`npm test` → **115 / 115 passing** (~6.1 s).

New coverage:

- portable release structure with `--no-runtime`;
- copied release server serves `/api/health`;
- diagnostics and log endpoints;
- release launcher/runtime metadata.

### Verified against real data

- Release test built the folder, imported its copied server and reached
  `/api/health` successfully.
- Diagnostics reports installation/modules/Node/writable-root checks.
- Server log tail is readable from **Sistema**.
- Bundled-runtime release was exercised manually.
- No game files were modified.

### Findings

1. **Portable folder release works without npm/install step** (F-47).
2. **Release-relative paths work for server and frontend** (F-48).
3. **Diagnostics can prove runtime/installation readiness without game writes**
   (F-49).
4. **First-run wizard avoids manual config editing** (F-50).

### Known limitations

- Packaging bundles `node.exe`, not a single SEA binary.
- First-run discovery may need a manual path if the game is non-standard.
- Diagnostics exposes log tail only; no export or log deletion UI.
- Live game deployment remains intentionally manual.
- Destructive actions still use `window.prompt`.

### Documentation updated

- `docs/guides/USER-GUIDE.md`, `docs/guides/RELEASE.md`.
- `PROJECT_PLAN.md` (Phase 10 complete, roadmap complete, ADR-044…046,
  findings, tests).
- `docs/architecture/{ARCHITECTURE,DATA-MODEL}.md`,
  `docs/development/{DECISIONS,SETUP}.md`, `README.md`, version 0.11.0.

### Milestone

Tag `phase-10-production`. The Phase 0–10 roadmap is feature-complete. No game
files were modified. `npm test` green.
