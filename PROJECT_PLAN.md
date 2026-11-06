# Warband Outfit Studio — Project Plan

> **This is the master specification, roadmap, decision log and progress tracker.**
> `PROGRESS.md` is kept as the historical phase journal; this file is canonical.
>
> Last updated: **2026-11-06**
> Current phase: **Phase 10 — COMPLETE**
> Waiting for: **final project review**

---

## 1. Project Overview

**Warband Outfit Studio** is a local, offline-capable development environment for creating clothing and wearable equipment for **Mount & Blade: Warband** (engine 1.170).

It reads a real game installation, resolves the complete asset chain

```
Item → Mesh → Material → Texture → .dds
```

and will progressively add editing, 3D preview, item authoring, building and safe deployment.

The code is split into a reusable **Warband Engine** and an **Outfit Studio UI**, so future tools (Weapon Studio, Troop Editor, Scene Studio, …) can be built on the same engine.

- Repository: `C:\Users\52777\Desktop\warband-outfit-studio`
- Stack: Node.js 22, native ESM, zero runtime dependencies
- Reverse-engineering input: `C:\Users\52777\Desktop\Warband_REA_Analisis_Memoria.md` (REA analysis)
- Live target: GOG *Complete Collection* — Native, Viking Conquest, Napoleonic Wars

---

## 2. Project Goals

### Immediate

1. Inspect real clothing/armor assets with full reference resolution.
2. Validate assets before they reach the game.
3. Author items and outfits without hand-editing compiled `.txt` files.
4. Preview assets on Warband character bodies.
5. Export into a module **safely** (workspace → validation → backup → confirmation).

### Long-term

- A reusable, documented **Warband Engine** covering installation, modules, resources, items, validation, export.
- Additional specialized studios (weapons, shields, characters, horses, scenes, animations, troops, factions, dialogs, quests).
- A stable local tool that works offline, with no cloud or telemetry.

---

## 3. Non-Goals

- A generic 3D editor or a Blender replacement.
- Game engine modification, executable patching or memory hacking.
- Multiplayer server tooling.
- Supporting games other than the Warband family in the current roadmap.
- Cloud collaboration, accounts, telemetry, online asset libraries.
- Automatic deployment into a game installation without explicit confirmation.
- Re-implementing OpenBRF's full visual editing feature set.
- Implementing later phases before the current one is approved.

---

## 4. Development Principles

1. **Phase control.** Only one phase is active. A phase ends with tests, verification, documentation, a report and a stop.
2. **Explicit approval.** Authorization comes from the user, never from the roadmap order.
3. **No over-implementation.** Build only what the current phase requires; future dependencies get the minimum foundation.
4. **Verify, don't guess.** Every Warband claim is labelled `VERIFIED`, `LIKELY`, `UNCONFIRMED`, `UNKNOWN` or `REQUIRES INVESTIGATION`.
5. **Documentation is part of the software.** This file and `docs/` are updated whenever meaningful progress happens.
6. **Safety first.** The original installation is read-only. Destructive operations require a workspace, a backup and confirmation.
7. **Correctness > compatibility > stability > maintainability > features.**
8. **No unnecessary dependencies.** Every dependency needs a licence, maintenance and offline-runtime justification.
9. **Tests are mandatory** for parsers, serializers, validation, projects and backup logic. Prefer real game files as read-only fixtures.
10. **Small, testable modules.** No giant files, magic offsets without documentation, or machine-specific paths in code.

### Phase approval protocol

At the end of every phase the report uses this exact shape:

```text
PHASE STATUS
Phase / Status / Implemented / Tests / Verified against real Warband data /
Documentation updated / Known issues / Technical debt / Remaining work /
Recommended next phase / Waiting for explicit user approval.
```

Then the agent stops. Valid approval examples: “Proceed to Phase 1.”, “Approved. Start Phase 3.”

---

## 5. Architecture

```
┌──────────────────────────────────────────────┐
│ Outfit Studio UI (frontend/)                 │
│ asset browser · chain inspector · validation │
│ project manager · 3D viewport (Phase 3+)     │
└──────────────────────▲───────────────────────┘
                       │ HTTP JSON (127.0.0.1)
┌──────────────────────┴───────────────────────┐
│ Local server (backend/)                      │
│ routing · static files · error envelope      │
└──────────────────────▲───────────────────────┘
                       │ direct calls
┌──────────────────────┴───────────────────────┐
│ Warband Engine (engine/)                     │
│ installation · modules · items · BRF ·       │
│ textures · validation · projects · exporters │
└──────────────────────▲───────────────────────┘
                       │ read-only (Phase 0–7)
┌──────────────────────┴───────────────────────┐
│ Mount & Blade: Warband installation          │
└──────────────────────────────────────────────┘
```

**Hard boundary:** `engine/` must not import from `backend/` or `frontend/`. The UI must not parse game formats.

Implemented engine modules:

| Module | Responsibility | Status |
|---|---|---|
| `engine/installation/detect.js` | locate/describe installation, engine version | IMPLEMENTED |
| `engine/installation/profileStore.js` | installation profiles (add/activate/validate/remove) | IMPLEMENTED |
| `engine/modules/moduleIni.js` | `module.ini` parser | IMPLEMENTED |
| `engine/modules/moduleRegistry.js` | module discovery, ids, capabilities | IMPLEMENTED |
| `engine/items/itemKinds.js` | `item_kinds1.txt` parse + byte-perfect serialize | IMPLEMENTED |
| `engine/resources/brf.js` | BRF token-stream parser + writer (raw-range copy, dirty objects) | IMPLEMENTED |
| `engine/resources/geometry.js` | lazy mesh geometry with allocation limits | IMPLEMENTED |
| `engine/resources/workspace.js` | workspace-only writes, backups, SHA-256 | IMPLEMENTED |
| `engine/resources/meshOverride.js` | project mesh overrides, validation, BRF merge | IMPLEMENTED |
| `engine/resources/materialOverride.js` | material override validation, merge + texture copy | IMPLEMENTED |
| `engine/skins/skins.js` | `skins.txt` body/calf/hand/head/skeleton parser | IMPLEMENTED |
| `engine/outfit/clipping.js` | bounding-box outfit clipping analysis | IMPLEMENTED |
| `engine/resources/brfIndex.js` | cross-file index + persistent cache | IMPLEMENTED |
| `engine/resources/textureResolver.js` | DDS discovery | IMPLEMENTED |
| `engine/textures/dds.js` | DDS header | IMPLEMENTED |
| `engine/items/itemFlags.js` | generated `itp_*` / `itcf_*` decoder | IMPLEMENTED |
| `engine/validation/*` | 15 validation rules | IMPLEMENTED |
| `engine/projects/projectStore.js` | JSON projects + backups | IMPLEMENTED |
| `engine/exporters/*` | build/export pipeline | PLANNED (Phase 8) |

Detailed documents:

- [Architecture](docs/architecture/ARCHITECTURE.md)
- [Data model](docs/architecture/DATA-MODEL.md)
- [Outfits](docs/architecture/OUTFITS.md)
- [Items](docs/architecture/ITEMS.md)
- [Builder](docs/architecture/BUILDER.md)
- [Format map](docs/warband-analysis/FORMAT-MAP.md)
- [BRF](docs/formats/BRF.md) · [Items](docs/formats/ITEMS.md) · [DDS](docs/formats/DDS.md)

---

## 6. Technology Stack

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 22+, native ESM | already installed; fast binary I/O; one language for engine/backend/tools |
| Backend | `node:http` (custom router) | zero dependencies, full control, small surface |
| Frontend | vanilla HTML/CSS/ES modules | no build step, offline-safe, fast startup |
| 3D | Three.js **vendored locally** in Phase 3 | no CDN, offline operation; licence review pending |
| Types | JSDoc + `// @ts-check` | editor safety without a compiler toolchain |
| Tests | `node:test` + `node:assert` | built in, deterministic, no dependencies |
| Storage | JSON files + filesystem | inspectable, diffable, no database |
| Cache | per-file JSON index in `cache/` | 147 MB / 219 BRF parsed in ~0.5 s, warm ~0.2 s |
| Packaging | `.cmd` launcher + portable folder; optional bundled `node.exe` | no npm install; runtime can ship with the app |
| VCS | Git, milestone tags | `phase-0-foundation`, … |

Constraints: Windows target, offline operation, no runtime npm dependencies, loopback-only server.

---

## 7. Warband Reverse Engineering Knowledge

### 7.1 Target installation

| Fact | Value | Classification |
|---|---|---|
| Engine version | **1.170** (`rgl_log.txt`; `compatible_multiplayer_version_no = 1170`) | VERIFIED |
| Executable | `mb_warband.exe`, 5,336,064 bytes, PE32 x86, not .NET | VERIFIED |
| SHA-256 | `a4ef0017a8cf6d85c327cfb16f9cdc4faeccc3d140c57571fe00c1e1894e52c9` | VERIFIED |
| Modules | Native, Viking Conquest, Napoleonic Wars | VERIFIED |
| Module System reference | 1.171 (matches Native counts) | VERIFIED |

### 7.2 Relevant formats

| Format | Role | Classification |
|---|---|---|
| `item_kinds1.txt` | item definitions, wearable slot in `flags & 0xF` | VERIFIED |
| `module.ini` | module contract: resources, versions, capabilities | VERIFIED |
| BRF | mesh/material/texture/shader/skeleton/body container | VERIFIED |
| DDS | texture files | VERIFIED |
| `module_items.py` | item source; requires external Module System (Python 2) | VERIFIED |
| `.sco` | scenes; out of scope for clothing | UNKNOWN (not investigated) |
| `.sav` | saves; out of scope | UNKNOWN |

### 7.3 Measured inventory

| Metric | Native | Viking Conquest | Napoleonic Wars |
|---|---:|---:|---:|
| Items | 620 | 1,266 | 767 |
| Wearables | 279 | 688 | 517 |
| BRF files (incl. CommonRes) | 219 | 398 | 370 |
| Meshes | 7,243 | 23,112 | 15,540 |
| Materials | 633 | 1,489 | 1,357 |
| Textures | 734 | 2,042 | 1,631 |
| BRF parse errors | 0 | 0 | 0 |

Native wearables: 132 body, 113 head, 28 foot, 6 hand.

### 7.4 Key verified relationships

- One item chain spans **multiple BRF files**: mesh → `armors_g.brf`, material → `materials.brf`, texture → `textures.brf`.
- Material texture references omit `.dds`; the BRF texture table includes it.
- Mesh LODs and pieces are naming conventions: `.lodN`, `.N`, `.lodN.N`; `bo_` = collision body.
- A composed item may have **no base mesh** (`common_tulbent_b.1/.2`) and still be valid.
- Gloves reference a `_L` mesh; `_R` is a separate mesh.
- `capabilities` is a 64-bit mask and cannot be stored as a JS `Number`.
- `Native/strings.txt` contains two CP1252 bytes; encoding must be detected per file.

Full detail and confidence labels: [FORMAT-MAP.md](docs/warband-analysis/FORMAT-MAP.md), [BRF.md](docs/formats/BRF.md), [ITEMS.md](docs/formats/ITEMS.md).

---

## 8. Phase Roadmap

Phases are sequential and require explicit approval. “Status” reflects reality, not intention.

### Phase 0 — Foundation & Architecture — **COMPLETE (2026-11-06)**

- Repository, engine/backend/frontend split, docs system, tests, launcher.
- Installation + module detection, item and BRF parsers, cross-file index, texture/DDS resolution, 15 validation rules, project store with backups, read-only API and UI.
- 40 automated tests; verified against the real installation.

### Phase 1 — Warband Resource Engine — **COMPLETE (2026-11-06)**

Completed:

- BRF writer with **byte-identical round-trip on all 219 `CommonRes` files**; dirty meshes/materials/textures/shaders/skeletons re-encoded, untouched objects copied verbatim.
- Lazy mesh geometry (positions, rigging, frames, UVs, normals, faces, bbox) with allocation limits.
- Generated item-flag table from `header_items.py` (offline, committed with SHA-256) and enum-aware decoder.
- Workspace store as the only write target: path guards, atomic writes, backups with SHA-256.
- `engine.getMeshGeometry`, `engine.exportBrf`, `createWorkspace`, `listWorkspaces`.
- UI shows decoded flags/capabilities.
- 61 automated tests.

**Exit met:** corpus green (219/219), geometry counts match, flags decoded, installation untouched (hash-checked).

### Phase 2 — Game & Module Manager — **COMPLETE (2026-11-06)**

Completed:

- Installation profiles (`config/profiles.json`): bootstrap, add, dedupe, activate, validate, remove with typed confirmation.
- Workspace lifecycle: create/list/delete, module association, guarded writes, atomic updates, backups with SHA-256.
- Asset index API + UI: meshes, materials, textures, shaders, family/LOD/piece data, cross-references and an "open item" jump.
- Backup catalogue: project + workspace backups, hash verification, typed confirmation, pre-restore backup.
- Module manager UI: active profile, module selector, capabilities/versions visible in status.
- New views: Recursos, Workspaces, Copias; profile modal.
- 74 automated tests.

**Exit met:** profiles resolve and activate independently; workspaces can be created/deleted safely; asset index browsable; restores verified and reversible; game untouched.

### Phase 3 — 3D Viewport — **COMPLETE (2026-11-06)**

Completed:

- Vendored Three.js 0.169.0 (MIT) under `frontend/vendor/three/`; no CDN, no import map.
- WebGL viewport with custom orbit/pan/zoom, grid, lighting and resize handling.
- Engine render-data API (base64 typed arrays, per-vertex expansion) and raw DDS endpoint.
- Client-side DXT1/3/5 decoder; `DataTexture` diffuse preview; material colour fallback.
- **Visor** tab with mesh search, framing, grid/wireframe/V-flip toggles and stats.
- “Ver en visor 3D” from the asset index.
- 81 automated tests.

**Exit met:** real `mail_shirt_a` (782 verts / 1,240 faces, 1024×1024 DXT1) renders at 60 fps in the browser, no console errors; screenshot verified.

### Phase 4 — Mesh Editor — **COMPLETE (2026-11-06)**

Completed:

- Editable model preserving shared positions, `vertexPosition`, normals/UVs, indices, rigging and animation frames.
- Vertex/face selection with raycast, multi-select and overlays.
- Move/rotate/scale with axis X/Y/Z/Normal, local mode, numeric input and snapping; transforms update bind pose and frames.
- Topology: delete, duplicate, mirror X, extrude, merge, split.
- Guards: vertex-count topology blocked on rigged/framed meshes; transforms allowed (ADR-026).
- Undo/redo (25 snapshots), reset to original.
- Project overrides (`project.meshes[]`), save/load, validation, and export merged into `workspace/mesh-edits/`.
- Visor edit toolbar; "Ver en visor 3D" integration.
- 96 automated tests.

**Exit met:** a real `mail_shirt_a` edit changes exactly one position + its frame position, preserves frames/counts, round-trips through the BRF writer, and leaves the source hash unchanged.

### Phase 5 — Texture & Material System — **COMPLETE (2026-11-06)**

Completed:

- Material panel in the Visor: shader, colour (0–255), specular, diffuse/bump/spec names, normal/spec/alpha/double-sided toggles.
- DDS import into `workspace/textures/` with header validation and project registry.
- Material overrides in projects; save/load/delete and export merging the BRF + copying referenced textures.
- Preview uses diffuse `map`, normal `normalMap`, specular as a metalness approximation.
- 102 automated tests.

**Exit met:** real `mail_shirt_a` material edited (r/g/b 64/128/192, specular 2.5), exported with 3 textures; source BRF unchanged; preview and screenshot verified.

### Phase 6 — Outfit & Armor Editor — **COMPLETE (2026-11-06)**

Completed:

- `skins.txt` parser (2 skins) and body resolution: `man`/`woman`, six body parts each.
- Bind-pose body assembly using `CommonRes/skeletons.brf` global bone matrices for rigid parts; skinned meshes render their stored bind positions.
- Outfit side tab: body preset, body/head/hand/foot slots, per-slot X/Y/Z/scale offsets, preset, clipping analysis, save/load/delete and PNG snapshot.
- Project `outfits[]` records referencing item ids; validation rejects wrong slots; typed confirmation for delete.
- 108 automated tests.

**Exit met:** a full outfit (`mail_shirt` + `helmet_with_neckguard` + `leather_gloves` + `leather_boots`) renders on both bodies, saves, reloads and validates; source game files untouched.

### Phase 7 — Item Editor — **COMPLETE (2026-11-06)**

Completed:

- `getItemEditable` + `/api/item-schema` expose full item records and symbolic flag/capability data.
- In-place item form in **Prendas**: identity, type, flags, capabilities, 17 stats, mesh references and modifier bits.
- Project `items[]` overrides: edit existing records or create new ones; existing ids immutable; duplicate ids and missing meshes blocked.
- **Exportar items** merges all overrides into `workspace/item-edits/item_kinds1.txt`; untouched raw records remain byte-identical.
- Preview opens the Phase 6 outfit view with the base item in its slot.
- 109 automated tests.

**Exit met:** `itm_mail_shirt` edited and `itm_test_new_armor` created; exported 621-record file re-parsed correctly; source `item_kinds1.txt` SHA-256 unchanged.

### Phase 8 — Warband Builder & Exporter — **COMPLETE (2026-11-06)**

Completed:

- Build pipeline merges mesh, material, texture and item overrides.
- Validation gate stops on invalid overrides or target collisions before any workspace write.
- Overlay builds write only changed assets; full-module builds copy the whole module first.
- `build.json` manifest with file hashes and `build.log`; build list/detail UI.
- Grouped overrides by source BRF; textures deduplicated.
- 111 automated tests.

**Exit met:** a real Native project with mesh + material + item overrides produced a workspace overlay (4+ artifacts) with the edited material and item, source hashes unchanged; full-copy mode verified on Native (75.6 MB, `module.ini` present).

### Phase 9 — Validation, Backup, Recovery & Hardening — **COMPLETE (2026-11-06)**

Completed:

- Build retention: keep N newest build workspaces; typed `PRUNE_BUILDS` confirmation.
- Backup retention: per-project and per-workspace-file pruning with `PRUNE_BACKUPS`.
- Build rollback: build stores `project.json`; rollback restores it with a normal project backup.
- Build diff: source vs built bytes/SHA-256, changed/added/unchanged/unavailable.
- `module.ini` integration: adds missing `load_resource` entries for changed BRF basenames.
- 114 automated tests.

**Exit met:** build outputs retain their project snapshot and can be rolled back; diffs identify changed item/material/mesh/config files; retention removes old builds/backups with typed confirmation; missing resources are injected into `module.ini`; sources stay read-only.

### Phase 10 — Build, Launch & Production Polish — **COMPLETE (2026-11-06)**

Completed:

- Portable release builder with optional bundled Node runtime and Windows launcher.
- Root `WARBand Outfit Studio.exe` launcher: starts Node, opens the browser and assigns the server to a Job Object with kill-on-close, so closing the launcher stops all started processes.
- First-run installation wizard opens automatically when no installation is registered.
- **Sistema** diagnostics view: health checks, environment, recovery guidance and server log tail.
- Server diagnostics logging (`cache/logs/server.log`, 1 MB rotation) and `/api/diagnostics` / `/api/logs`.
- Accessibility/polish: live status, `aria-current` navigation, keyboard `/` search focus, focus-visible outlines, reduced-motion support.
- User guide and release guide.
- 115 automated tests.

**Exit met:** `npm run release` creates a portable folder; release test imports the copied server and reaches `/api/health`; diagnostics checks installation, modules, Node and writable roots; no game writes.

---

## 9. Current Phase

**Phase 10 is COMPLETE.** All roadmap phases are implemented, tested and documented.

**The project is feature-complete for the agreed roadmap.** No later phase has
been authorized; remaining work is post-1.0 feedback and specialized studios.

### Roadmap reconciliation (accepted)

The master roadmap assumed Phase 0 would produce only foundations, with parsers in Phase 1 and installation/module management in Phase 2. The Phase 0 work already delivered:

- BRF and item parsers,
- installation and module detection,
- cross-file indexing and DDS resolution,
- validation and project storage.

The user approved Phase 1 with this reconciliation (ADR-012). Consequences, retained:

- **Phase 1** targeted the **unfinished** Resource Engine work: geometry, BRF writing, symbolic item flags, mutation APIs and corpus tests. **Done.**
- **Phase 2** targeted the **unfinished** manager work: profiles, workspace lifecycle, asset index UI, backup catalogue/restore. **Done.**
- **Phase 3** delivered the local viewport: vendored Three.js, render data, DDS preview, camera and toggles. **Done.**
- **Phase 4** delivered mesh editing: selection, transforms, topology, history, project overrides and workspace export. **Done.**
- **Phase 5** delivered materials/textures: material editing, DDS import, preview, overrides and export. **Done.**
- No earlier deliverable was re-implemented.

---

## 10. Completed Work

### Phase 0 (2026-11-06)

**Repository**

- Git repository with milestone commits: `16a17cb`, `3944ccf`.
- Launcher `Warband Outfit Studio.cmd` (Node check + `--open`).
- `README.md`, `PROGRESS.md`, `LICENSE` (MIT), `.gitignore`.
- Local config split: committed `config/app.example.json`; machine-specific `config/app.json` git-ignored.

**Warband Engine**

- Installation detection (env/config/known paths, `rgl_log.txt` version, fingerprint, diagnostics).
- Module registry + `module.ini` parsing (resources, versions, capabilities, duplicates, unknown keys).
- `item_kinds1.txt` parser + **byte-identical round-trip** on Native, Viking Conquest and Napoleonic Wars.
- BRF parser: token stream, textures, shaders, materials, meshes, skeletons, animations, collision bodies; per-mesh vertex-version handling.
- Cross-file BRF index with per-file persistent cache (219 files / 147.5 MB, 0 errors).
- Texture resolution (module → game → languages, numbered pages) and DDS header parsing.
- 15 validation rules with stable codes and entity references.
- Project store: schema version, id validation, atomic writes, automatic backups.

**Backend**

- `node:http` server bound to `127.0.0.1`, port fallback 8791–8800, CSP, security headers.
- 11 JSON endpoints, stable error envelope, structured 404/503.
- Static frontend serving with traversal protection.

**Frontend**

- Spanish UI: installation pill, module selector, wearable browser (279 Native / 688 VC), search and slot/category filters.
- Item detail: stats, slot/category, mesh geometry summary, material, textures with dimensions/format.
- Validation panel with severity/code/message.
- Engine status panel and footer phase indicator.

**Tools & docs**

- `tools/build-index.js`, `tools/inspect-brf.js`.
- 8 documents: architecture, data model, format map, BRF/ITEMS/DDS, setup, decisions, progress journal.

**Verification**

- 40/40 tests (4.4 s), real-game integration assertions, 0 BRF parse errors, no writes to the installation.

### Phase 1 (2026-11-06)

**Resource engine**

- **BRF writer** (`serializeBrf`): untouched objects copied from recorded byte ranges; dirty meshes/materials/textures/shaders/skeletons re-encoded. Animations/bodies are preserved verbatim and rejected if marked dirty.
- **Lazy geometry** (`readMeshGeometry`): positions, rigging, animation frames, typed vertex arrays for layouts 0/1/2, faces, bbox; allocation limits and end-of-range verification.
- **Mutation helpers**: `loadMeshGeometry`, `updateMesh` (material/flags), `replaceMeshGeometry`; vertex-layout flag changes rejected.
- **Workspace store** (`WorkspaceStore`): guarded relative paths, atomic writes, per-file SHA-256, backups on overwrite; only write target in the project.
- **Engine API**: `getMeshGeometry`, `createWorkspace`, `listWorkspaces`, `exportBrf` (installation read-only; patches applied in memory; output under `workspace/`).
- **Item flags**: generator + committed table (`sourceSha256`, counts) and enum-aware decoder; `getItemDetail` returns `flags`/`capabilities`; UI renders chips and unknown bits.

**Tools**

- `tools/generate-item-flags.js`, `tools/export-brf.js`.

**Verification**

- 61/61 tests in ~4.0 s.
- Corpus: **219/219 `CommonRes` BRFs byte-identical** after parse → serialize; modified mesh reparses and is round-trip stable.
- Real geometry: `mail_shirt_a` vertex/face counts match the index, rigging present, face indices valid, UVs finite.
- Export: source BRF SHA-256 unchanged; output written under `workspace/`.

### Phase 2 (2026-11-06)

**Installation profiles**

- `ProfileStore` in `config/profiles.json` (git-ignored) with bootstrap, add/dedupe, activate, validate-all and removal guarded by the profile id.
- Engine reloads modules and clears the module cache on activation.
- Profile modal in the UI (add/activate/validate/remove).

**Workspaces**

- `WorkspaceStore`: create/list/delete, `moduleId` metadata, `ensure()` reuse, guarded relative paths, atomic writes, `.backups/` with SHA-256 sidecars.
- Engine `createWorkspace(label, { reuse, moduleId })`, `removeWorkspace(id, confirm)`.
- UI view for create/list/delete with typed confirmation.

**Asset index**

- `engine.listResources` and `engine.getResourceDetail` for meshes, materials, textures and shaders, with family/LOD/piece data, DDS metadata and cross-references.
- New **Recursos** view; item references jump back to the outfit view.

**Backups**

- `ProjectStore.listBackups/restoreBackup`; `WorkspaceStore.listBackups/restoreBackup`.
- Hash verification for workspace restores; pre-restore backup; path guards; typed confirmation.
- **Copias** view listing both kinds.

**Verification**

- 74/74 tests in ~4.2 s.
- Real data: profile 1.170/3 modules; 7,243 meshes indexed; `mail_shirt_a` material/refs resolved.
- Restores verified against the real stores; wrong confirmations rejected with 400.
- UI verified through the DOM: 279 wearables, 7,243 resources, mesh detail refs, workspace creation, backup rows, profile modal, no console errors.

### Phase 3 (2026-11-06)

**Viewport**

- Vendored Three.js 0.169.0 (MIT) in `frontend/vendor/three/`; custom orbit/pan/zoom controls (no import map, CSP unchanged).
- **Visor** tab: mesh search/list, canvas, grid, lights, framing, wireframe and UV V-flip toggles, stats overlay.
- Render loop pauses when the tab is hidden; resize observer keeps the canvas correct.

**Data path**

- `engine.getMeshRenderData`: expands positions/normals/UVs per vertex (BRF faces index the vertex list) and returns base64 typed arrays + bbox/counts.
- `engine.getTextureFile`: reads raw DDS bytes with an installation path guard.
- `GET /api/meshes/:name/geometry`, `GET /api/textures/:name/raw` (binary response support in the server).
- Browser DDS decoder for DXT1/DXT3/DXT5/DX10 BC1–BC3 + uncompressed 32-bit fallback.

**Verification**

- 81/81 tests in ~4.4 s (new DDS decoder, render data, API geometry/texture).
- Real render: `mail_shirt_a`, 782 vertices / 1,240 faces, 1024×1024 DXT1, **60 fps** (vsync), screenshot checked.
- No console errors; “Ver en visor 3D” works from the asset index.

### Phase 4 (2026-11-06)

**Editor**

- `frontend/js/mesh-edit.js`: editable model (shared positions + vertexPosition, normals/UVs/indices, attributes, rigging, frames), selection, transforms, topology, validation, override encode/decode.
- Vertex/face picking with shift multi-select and overlays; transforms with X/Y/Z/Normal, local axis, snapping.
- Topology: delete, duplicate, mirror X, per-face extrude, merge, split; vertex-count changes blocked on rigged/framed meshes.
- History: 25 snapshots, undo/redo/reset.

**Persistence/export**

- Project `meshes[]` overrides with base64 typed arrays; engine validation; save/load/delete.
- `engine.exportMeshOverride` merges the override into the source BRF and writes `workspace/mesh-edits/<mesh>.brf` (atomic + backup + hash).
- New API: editable mesh, project mesh overrides, export.

**Verification**

- 96/96 tests in ~4.8 s (mesh edit unit suite + real override/export integration + API).
- Real edit: exactly 1 position + 1 frame position changed; frames preserved; vertex/face counts unchanged; source SHA-256 unchanged.
- UI verified end to end: select vertex → translate → save override → export; screenshot captured.

---

### Phase 5 (2026-11-06)

**Material editor**

- `getMaterialEditable`: fields, shader list, texture details, meshes using the material.
- Visor side panel: shader (139 in Native), colour 0–255, specular, diffuse/bump/spec, toggles, import DDS, preview, save/load/export.
- Material overrides in `project.materials[]`; imported textures in `project.textures[]`.
- `exportMaterialOverride`: merge fields, serialize BRF, copy referenced textures to `workspace/materials/Textures/`.
- Texture import validates the DDS header and writes to `workspace/textures/`.

**Verification**

- 102/102 tests in ~6.3 s (material validation + real material edit/export + texture import + API).
- Real `mail_shirt_a`: fields changed to r/g/b 64/128/192, specular 2.5; 3 textures copied; source hash unchanged.
- UI verified: material panel populated, preview updated, override saved, export produced BRF + 3 textures; screenshot captured.

---

### Phase 6 (2026-11-06)

**Outfit & armor editor**

- `parseSkinsFile` consumes all `skins.txt` fields and returns man/woman body, calf, hand, head and skeleton names.
- `getCharacter` resolves six bind-pose body parts with their materials/BRFs.
- Rigid mesh posing: global bind matrices from `CommonRes/skeletons.brf` move bone-local heads, hands, helmets and gloves into character space; skinned meshes keep their stored bind positions.
- Engine `getOutfitItemMeshes` resolves base + piece meshes (no LODs), adds the glove `_R` counterpart and returns material metadata.
- Visor **Outfit** tab: skin preset, body/head/hand/foot selection, per-slot X/Y/Z/scale offsets, preset, clipping analysis, save/load/delete and PNG snapshot.
- `project.outfits[]` records reference item ids; validation enforces slot compatibility and numeric transforms; delete needs the outfit id.
- 108 automated tests.

**Verification**

- 108/108 tests in ~6.8 s (skins parser, rigid pose, outfit persistence, clipping, API).
- `man`/`woman` bodies each resolve six parts; `male_head` rigid pose moved from head-local space into bind-pose space (`min.y` 1.497 > raw 0.133).
- `leather_gloves` resolves `L` + `R`; `mail_shirt` resolves `mail_shirt_a`.
- UI verified with `mail_shirt` + `helmet_with_neckguard` + `leather_gloves` + `leather_boots`: 11 pieces, saved as `Knight Demo`, reloaded, `0` clipping warnings; screenshot captured.
- Snapshot export produced a 56,713-byte PNG.

---

### Phase 7 (2026-11-06)

**Item editor**

- `getItemEditable` returns the full record plus `decodeItemFlags`/`decodeCapabilities`; `/api/item-schema` exposes the generated symbol table.
- In-place **Prendas** form: ID/name/plural, type selector + flags, capabilities, value/modifier/weight/abundance, 12 combat/armor stats, mesh rows and modifier bits.
- Project `items[]` overrides support editing existing records and creating new ones. Existing ids are immutable; duplicate ids and missing meshes are rejected.
- Factions and triggers are preserved; they are not edited in this phase.
- **Exportar items** merges overrides into a workspace `item_kinds1.txt`; untouched records reuse raw lines.
- **Ver en outfit** preview uses the Phase 6 composition with the base item in its slot.
- 109 automated tests.

**Verification**

- 109/109 tests in ~5.9 s (item editable/validation/export, API).
- `itm_mail_shirt` edited (`name = Edited_Mail_Shirt`, body armor 44); new `itm_test_new_armor` appended.
- Export produced 621 records from Native's 620, re-parsed correctly; source SHA-256 unchanged.
- UI verified: editor loads override, saves, exports to `item-edits/item_kinds1.txt`, previews an item in the Visor.
- Screenshot captured to `docs/assets/items-phase7.png`.

---

### Phase 8 (2026-11-06)

**Project builder & exporter**

- `buildProject`: groups mesh/material overrides by source BRF, applies them sequentially, merges item overrides, copies referenced textures and writes a workspace artifact.
- **Validation gate** stops before writing on invalid artifacts, missing textures, item errors or target collisions.
- Two modes: `overlay` (changed assets only) and `module` (full module copy first, then overlay).
- `build.json` manifest with file kind/source/target/bytes/SHA-256 and `build.log`.
- Build view: project selector, full-copy checkbox, build list, manifest and log.
- API: `POST /api/projects/:id/build`, `GET /api/builds`, `GET /api/builds/:id`.
- 111 automated tests.

**Verification**

- 111/111 tests in ~5.5 s (build integration + API).
- Real mesh + material + item project produced an overlay with 4+ artifacts; edited material fields and item name were present in the output.
- Source BRF/item hashes unchanged.
- Invalid item mesh stopped the build without creating a workspace.
- Full-copy mode verified manually on Native: 75.6 MB, `module.ini` present, ~2.2 s.
- No game files were written.

**Deployment stance**

The original safety invariant remains: the game installation is read-only. A
`module` build is a deployable module tree inside `workspace/`; applying it to
the game is a deliberate manual copy, not an automated write (ADR-037).

---

### Phase 9 (2026-11-06)

**Hardening, retention, rollback and diff**

- Build workspaces now include `project.json` (snapshot used by rollback).
- `pruneBuilds(keep)` deletes older build workspaces with typed `PRUNE_BUILDS` confirmation.
- `pruneBackups(keep)` prunes project backups and workspace file backups with `PRUNE_BACKUPS`.
- `rollbackBuild(projectId, buildId)` restores the project snapshot from a build, creating a project backup first.
- `diffBuild(buildId)` compares source vs built bytes and SHA-256, reporting changed/added/unchanged/unavailable.
- Build adds missing `load_resource` entries to `module.ini` for changed BRF basenames.
- Build view: retention controls, diff and rollback actions.
- Copies view: backup pruning.
- API: build diff/rollback/prune and backup prune.
- 114 automated tests.

**Verification**

- Rollback restored `Built_Mail` after a post-build rename.
- Diff identified changed item/material/mesh entries; textures are marked non-comparable.
- Pruning kept one build and removed older workspaces; project/workspace backup pruning kept one per group.
- Missing `core_ui_meshes` resource was added to the built `module.ini`.
- Sources remained read-only.

---

### Phase 10 (2026-11-06)

**Packaging, setup and production polish**

- `tools/build-release.js` / `npm run release`: portable folder with optional
  bundled Node runtime, Windows launcher, docs and empty writable directories.
- Root `WARBand Outfit Studio.exe`: starts Node, opens the browser and keeps
  the server in a Job Object with kill-on-close; closing the window stops the
  server and its child processes. `.cmd` remains the fallback.
- First-run wizard opens automatically when no installation is registered.
- **Sistema** view: Node/installation/modules/writable-root checks, environment
  data, recovery guidance and server log tail.
- Server logging at `cache/logs/server.log` with 1 MB rotation;
  `/api/diagnostics` and `/api/logs`.
- Accessibility: live status region, `aria-current` nav, `/` search shortcut,
  focus-visible outlines, reduced-motion support.
- User guide and release guide.
- 115 automated tests.

**Verification**

- `integration/release` builds a `--no-runtime` release, validates its
  structure including the root `.exe`, and starts the copied server to reach
  `/api/health`.
- Diagnostics reports all checks; logs endpoint returns bounded lines.
- Release builder with a bundled runtime was exercised manually (Node runtime
  copied).
- Launcher cleanup was exercised manually: a second server on port 8792 was
  started by the `.exe`; terminating the launcher closed the server while the
  unrelated process on 8791 continued.
- No game files were modified.

---

## 11. Pending Work

**None for the agreed 0–10 roadmap.**

### Post-1.0 backlog

- Specialized studios (weapons, troops, scenes, animations).
- Optional module deployment workflow.
- Semantic mesh/texture diffing.
- Additional module-format writers.

### Explicitly out of scope

Live game process patching, automatic Steam/GOG deployment, cloud services,
animation/troop/scene editors.

---

## 12. Known Issues (after Phase 10)

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | Outfits are bind-pose only; no animation, skeleton posing or weight editing | Medium | Future phase |
| 2 | Rigid-vs-skinned handling is inferred from empty `rigging[]`; this is **VERIFIED** for Native body/head/hand meshes but not traced in the engine | Medium | Documented (ADR-031) |
| 3 | Clipping uses bounding boxes; body-vs-item containment is not reported as clipping | Medium | Documented (ADR-033) |
| 4 | One item per slot; no layered body garments or separate cape slot | Medium | Future outfit work |
| 5 | Body armor is displayed on both genders without re-skinning; female fit is approximate | Medium | Documented |
| 6 | PNG snapshot is a browser download, not a workspace artifact | Low | Future export flow |
| 7 | Dirty animations and collision bodies cannot be written | Medium | Preserved verbatim; writer throws if marked dirty |
| 8 | Adding/removing BRF objects (section count changes) is not exposed | Medium | Phase 8 (builder) |
| 9 | Specular preview is a metalness approximation, not the game shader | Medium | Documented (ADR-029) |
| 10 | Mesh topology changes are blocked on rigged/framed meshes | Medium | Weights in a later phase |
| 11 | Extrude is per-face; adjacent faces keep internal walls | Low | Improve in a Phase 4 follow-up |
| 12 | Overrides store a full geometry snapshot, not a delta | Low | Optimize if projects grow |
| 13 | No UV or bone-weight editing yet | Medium | Future phase |
| 14 | No material creation from scratch (overrides existing only) | Medium | Future phase |
| 15 | No texture editing (paint/resize/convert); import only | Medium | Future phase |
| 16 | UV V flip is LIKELY (OpenBRF convention); toggle available | Low | Controlled experiment |
| 17 | Geometry is re-read on every viewport selection | Low | LRU if it hurts |
| 18 | Duplicate material names resolve first-wins; BRF load order is LIKELY | Low | Controlled experiment |
| 19 | Glove `_L`/`_R` engine mirroring is LIKELY, not traced | Low | Documented |
| 20 | `module.ini` known-key catalogue is curated, not exhaustive | Low | Extend with engine evidence |
| 21 | `WB-I-003` (no normal map) is noisy for vanilla assets | Low | UI filter pending |
| 22 | No workspace rename/file-level delete or restore diff preview | Low | Phase 9 |
| 23 | `.sco` and `.sav` are uninvestigated | Low (out of scope) | - |
| 24 | Item preview uses the base module asset; edited mesh refs are not visible until export + index rebuild | Medium | Documented |
| 25 | Item export writes compiled `item_kinds1.txt`, not Module System `.py` | Medium | Phase 8/module-system writer |
| 26 | Existing item ids cannot be changed; no reference migration | Medium | Future item migration |
| 27 | Item factions and triggers are preserved but not editable | Low | Future item editor pass |
| 28 | Item deletion is not exposed; only project overrides can be removed | Low | Future item editor pass |
| 29 | Builds never deploy into the live game; only workspace artifacts are produced | High | Documented safety invariant (ADR-037) |
| 30 | Overlay builds assume `module.ini` already loads changed BRF basenames | Medium | Phase 9 rewrite |
| 31 | Full-copy builds can be multi-GB; explicit option only | Medium | Documented |
| 32 | No build diff viewer, rollback or retention policy | Medium | Phase 9 |
| 33 | Build validation checks override structure/chains but not every game shader/engine condition | Medium | Future validation work |
| 34 | Rollback restores the project snapshot, not already-built workspace files | Medium | Rebuild after rollback |
| 35 | Build diff is byte/hash based; no semantic mesh/texture diff viewer | Low | Future diff UI |
| 36 | Backup pruning has no retention preview and leaves empty backup folders | Low | Phase 10 polish |
| 37 | `module.ini` integration appends resources; it does not remove or reorder existing entries | Low | Future integration pass |
| 38 | Release packaging bundles `node.exe` rather than a single SEA binary | Medium | Acceptable portable equivalent |
| 39 | First-run detection needs a known path or manual path input | Low | First-run wizard covers it |
| 40 | Server log rotation uses one `.1` archive; no UI deletion | Low | Diagnostics view shows tail |
| 41 | No live game deployment or automated installer | High | Intentional safety invariant |
| 42 | Build diff remains byte/hash based | Low | Post-1.0 semantic diff |
| 43 | Root `.exe` launcher uses .NET Framework 4, present on modern Windows but not embedded | Low | `.cmd` fallback included |

---

## 13. Technical Debt

| Area | Debt | Plan |
|---|---|---|
| `engine/validation/validate.js` | Mixed responsibilities (resolution + rules) in one file | Split when rules exceed ~20 |
| `brfIndex` cache | Whole-module JSON cache; 7.8 MB for VC | Per-pack cache only if it becomes a problem |
| Encoding | CP1252 fallback is silent; no per-file report in the UI | Surface in Phase 3 diagnostics |
| `module.ini` | Hand-curated known keys | Generate from engine evidence / module system |
| Frontend | No component framework; DOM helpers are ad hoc | Re-evaluate at Phase 3 (viewport) |
| BRF writer | Encodes dirty meshes via `Buffer.concat` of many small chunks | Optimise only if large-mesh writes show up in profiles |
| Geometry | No cache; one file read per mesh selection | LRU if profiling shows it matters |
| DDS decoder | First mip only; DXT1/3/5 + BC1-3; no BC4-7/mipmaps | Extend when a target asset needs it |
| Viewport controls | Custom orbit controls without inertia/touch pinch | Add in Phase 4 if needed |
| Viewport tests | DOM/screenshot verification; no automated WebGL assertion | Add a render smoke test in Phase 9 |
| Mesh history | Full model snapshots (25 max) | Delta/undo journal if memory matters |
| Mesh overrides | Full geometry snapshot per edited mesh | Delta format if projects grow |
| Extrude | Per-face implementation (internal walls on adjacent faces) | Region extrude in a Phase 4 follow-up |
| Selection | Vertex + face only (approved); no edge loops | Revisit with UV editing |
| Rigged/framed meshes | Count-changing topology blocked | Future weights phase |
| Material preview | Specular approximated via metalnessMap | Custom shader if needed |
| Texture storage | Imported textures shared in `workspace/textures`; no GC | Phase 9 retention |
| Material scope | Only existing materials can be overridden | Future creation flow |
| Outfit assembly | Rigid parts are placed with bind matrices; no runtime skinning/poses | Add skeleton posing when animation work starts |
| Outfit clipping | Bounding-box heuristic; no mesh-level collision test | Add triangle/vertex proximity in Phase 9 |
| Outfit slots | One item per slot; body includes clothing/armor/cape | Layered body model when item rules require it |
| Snapshot | Browser-download PNG; not tracked in a project/workspace | Route through workspace exports in Phase 8 |
| Item export | Compiled item file only; factions/triggers preserved but not edited | Module System writer + item migration in Phase 8+ |
| Item preview | Base module item; override meshes/names need a rebuild | Add override-aware preview in a later pass |
| Item validation | Mesh existence is checked, but material/texture chain health is delegated to the existing validator | Reuse full chain rules before build |
| Build deployment | Workspace-only; no live module install | Phase 10 packaging/deploy workflow |
| Build module.ini | Appends missing `load_resource` entries; no removal/reordering | Future integration pass |
| Build retention | Keep-N pruning implemented; no preview/undo | Phase 10 polish |
| Build diff | Byte/hash diff implemented; no semantic mesh/texture diff | Future diff UI |
| Build rollback | Project snapshot only; build files are immutable history | Rebuild after rollback |
| Backup pruning | Per-project/per-file keep-N; empty directories remain | Phase 10 cleanup |
| Flags table | Generated from 1.171; no 1.174 table | Regenerate when supporting another branch |
| Tests | Corpus is `CommonRes` only; module `Resource` packs not round-tripped | Extend in Phase 3+ |
| Backups | Keep-N pruning implemented; no preview | Post-1.0 polish |
| UI confirmations | `window.prompt` for destructive actions | In-app dialog post-1.0 |
| Docs | `PROGRESS.md` and `PROJECT_PLAN.md` overlap | PROJECT_PLAN canonical; PROGRESS historical |
| Packaging | Portable folder with optional bundled `node.exe`; no single SEA binary | Evaluate SEA post-1.0 |
| First run | Manual path if known-path detection misses | Improve install discovery |
| Diagnostics | Log tail only; no export/viewer | Post-1.0 |
| Deployment | Workspace handoff only | Separate installer phase if requested |
| Launcher | Small .NET Framework 4 console executable | Replace with native/SEA launcher if needed |

---

## 14. Architectural Decisions

| ADR | Decision | Status |
|---|---|---|
| ADR-001 | Node.js 22 + native ESM, no transpiler | Accepted |
| ADR-002 | Zero runtime dependencies | Accepted |
| ADR-003 | Read-only game access; separate workspace | Accepted |
| ADR-004 | Own BRF parser (OpenBRF as documentation only) | Accepted |
| ADR-005 | Persistent per-file BRF cache | Accepted |
| ADR-006 | Vanilla frontend, no framework | Accepted |
| ADR-007 | Loopback-only server, no auth | Accepted |
| ADR-008 | JSON projects with schema version | Accepted |
| ADR-009 | Engine version from `rgl_log.txt` | Accepted |
| ADR-010 | Validation codes are a public contract | Accepted |
| ADR-011 | Local config is git-ignored; example committed | Accepted (2026-11-06) |
| ADR-012 | Phase 0 overlap with master’s Phase 1–2 (parsers/detection) is retained, not rebuilt | **Accepted** (Phase 1 approved) |
| ADR-013 | BRF writer copies untouched ranges; only dirty objects re-encoded | Accepted (Phase 1) |
| ADR-014 | Lazy geometry, no cache until a renderer needs it | Accepted (Phase 1) |
| ADR-015 | Workspaces are the only write target (guards, atomic, backup, hash) | Accepted (Phase 1) |
| ADR-016 | Commit generated flag table; no runtime Python | Accepted (Phase 1) |
| ADR-017 | Enums decoded as fields, not independent bits | Accepted (Phase 1) |
| ADR-018 | Installation profiles in machine-local `config/profiles.json` | Accepted (Phase 2) |
| ADR-019 | Destructive actions require typed id confirmation | Accepted (Phase 2) |
| ADR-020 | Keep every backup in Phase 2; pruning deferred | Accepted (Phase 2) |
| ADR-021 | Vendor Three.js 0.169.0 locally; no CDN | Accepted (Phase 3) |
| ADR-022 | Decode DDS in the browser (DXT1/3/5) | Accepted (Phase 3) |
| ADR-023 | Custom orbit controls instead of the addon/import map | Accepted (Phase 3) |
| ADR-024 | Edit shared positions via vertexPosition indirection | Accepted (Phase 4) |
| ADR-025 | Mesh edits are project overrides; export writes workspace copies | Accepted (Phase 4) |
| ADR-026 | Block count-changing topology on rigged/framed meshes | Accepted (Phase 4) |
| ADR-027 | Material colours are raw 0-255 values | Accepted (Phase 5) |
| ADR-028 | Imported textures live in a workspace + project registry | Accepted (Phase 5) |
| ADR-029 | Normal/spec preview is an approximation | Accepted (Phase 5) |
| ADR-030 | Use Native `skins.txt` + `skel_human` bodies, not a mannequin | Accepted (Phase 6) |
| ADR-031 | Pose rigid meshes with bind bone matrices; leave skinned bind positions untouched | Accepted (Phase 6) |
| ADR-032 | Outfits are project records referencing item ids, not item copies | Accepted (Phase 6) |
| ADR-033 | Clipping is a bounding-box heuristic with explicit false-positive limits | Accepted (Phase 6) |
| ADR-034 | Item overrides reference a base record; existing ids are immutable | Accepted (Phase 7) |
| ADR-035 | Export compiled `item_kinds1.txt` to a workspace | Accepted (Phase 7) |
| ADR-036 | Validate item references, save overrides separately | Accepted (Phase 7) |
| ADR-037 | Builds write only to workspaces; deployment stays manual | Accepted (Phase 8) |
| ADR-038 | Group overrides by source BRF | Accepted (Phase 8) |
| ADR-039 | Full module copies are explicit | Accepted (Phase 8) |
| ADR-040 | Builds store a project snapshot for rollback | Accepted (Phase 9) |
| ADR-041 | Retention is keep-N with typed confirmation | Accepted (Phase 9) |
| ADR-042 | Diff compares source bytes and SHA-256 | Accepted (Phase 9) |
| ADR-043 | Builds append missing `load_resource` entries | Accepted (Phase 9) |
| ADR-044 | Portable release with optional bundled Node runtime | Accepted (Phase 10) |
| ADR-045 | Diagnostics logs live under `cache/logs` with 1 MB rotation | Accepted (Phase 10) |
| ADR-046 | First run opens the installation wizard automatically | Accepted (Phase 10) |
| ADR-047 | Root `.exe` launcher owns the server through a Job Object | Accepted (Phase 10) |

Full text: [DECISIONS.md](docs/development/DECISIONS.md).

Change policy: a discovery that invalidates an ADR is documented, its impact explained, the ADR marked superseded, and the user is asked for approval when the change is material.

---

## 15. Reverse Engineering Findings

| # | Finding | Evidence | Classification | Code impact |
|---|---|---|---|---|
| F-01 | BRF is a token stream (`rfver`, `texture`, `shader`, `material`, `mesh`, `skeleton`, `skeleton_anim`, `body`, `end`), not a fixed container | OpenBRF + 219 real files consumed exactly | **VERIFIED** | `engine/resources/brf.js` |
| F-02 | The `u32 6` at the start of a BRF is the length of `"rfver "`, not a section count | Byte inspection + parser | **VERIFIED** | Supersedes the earlier REA interpretation |
| F-03 | Mesh vertex layout is per-mesh: `flags & (1<<16)` selects v1 (41 B) vs v2 (28 B); v0 = 36 B | OpenBRF + real files | **VERIFIED** | `brf.js` |
| F-04 | Skeleton bones have an optional `b` field only when a name is stored | OpenBRF `LoadStringMaybe` | **VERIFIED** | `brf.js` |
| F-05 | Items resolve across multiple BRFs (mesh, material, texture packs) | `itm_mail_shirt` | **VERIFIED** | `brfIndex.js` |
| F-06 | Composed meshes may have no base mesh (`.1`, `.2` only) | `itm_sarranid_felt_head_cloth_b` | **VERIFIED** | `WB-I-001`, resolver |
| F-07 | Gloves reference `_L`; `_R` exists separately | item + mesh names | **LIKELY** (engine mirroring not traced) | `WB-I-002` |
| F-08 | Material texture names omit `.dds`; BRF texture table includes it | materials.brf / textures.brf | **VERIFIED** | resolver |
| F-09 | `capabilities` is a 64-bit mask | value `9223388529554358287` | **VERIFIED** | string model |
| F-10 | `Native/strings.txt` has 2 CP1252 bytes; VC is UTF-8 | byte scan | **VERIFIED** | encoding detection |
| F-11 | Duplicate BRF material names: first loaded wins | not traced in engine | **UNCONFIRMED** | index keeps all, exposes first |
| F-12 | Clothing = body item with `bodyArmor == 0`; cape = name heuristic | data only | **LIKELY** | classifier |
| F-13 | Item record order below the hardwired block must not change | `module_items.py` comment | **VERIFIED** | future editor invariant |
| F-14 | `.sco` scene layout | not investigated | **UNKNOWN** | out of scope |
| F-15 | Savegame `.sav` layout | not investigated | **UNKNOWN** | out of scope |
| F-16 | BRF round-trip is byte-exact when untouched objects are copied | 219/219 `CommonRes` files | **VERIFIED** | `serializeBrf` |
| F-17 | BRF geometry counts and byte ranges agree with the index | real meshes (e.g. `mail_shirt_a` 782 verts / 1240 faces) | **VERIFIED** | `readMeshGeometry` |
| F-18 | Item flags: type is `flags & 0x1F`; attachment is `0xF00`; carry is `0x7F0000000`; shoot is `0xFF000` | `header_items.py` + generated table | **VERIFIED** | `itemFlags.js` |
| F-19 | Carry/shoot/attachment are enums, not independent bits | `itcf_carry_dagger_front_left = 0x30000000` | **VERIFIED** | enum-first decoder |
| F-20 | Some item capability bits are not in `header_items.py` | `itm_no_item` bit 63 | **UNKNOWN** | reported as `unknownHex` |
| F-21 | BRF faces index the **vertex list**; each vertex stores an index into the position array | `mail_shirt_a`: 782 verts, 622 positions, max face index 781 | **VERIFIED** | `getMeshRenderData` expands per vertex |
| F-22 | DDS textures are top-down rows; UV V needs the OpenBRF flip for GL display | real texture renders correctly with `v'=1-v` | **LIKELY** | viewport default + toggle |
| F-23 | BRF rigging pairs reference **position** indices; frames store positions per position and normals per vertex | `mail_shirt_a`: 622 positions, 782 verts, 2 frames | **VERIFIED** | edit model + override export |
| F-24 | Editing a shared position must move it once, not once per UV seam | duplicate vertex indices share position indices | **VERIFIED** | dedupe by `vertexPosition` in transforms |
| F-25 | BRF material `r/g/b` are 0-255; `specular` is a raw float | `mail_shirt_a` = 15/15/15, specular 16; range 0-228 | **VERIFIED** | material editor/validator |
| F-26 | Material `spec` is optional; a non-empty value implies presence | `LoadStringMaybe` + real materials | **VERIFIED** | editor sets `specPresent` |
| F-27 | `skins.txt` face keys use six tokens (`name idx flag min max label`), not five | Native man/woman parsed to the correct hair/beard/constraint counts | **VERIFIED** | `engine/skins/skins.js` |
| F-28 | Native exposes exactly two human skins: `man` and `woman`; body/calf/hand/head names are stored per skin | Native `skins.txt` | **VERIFIED** | `getCharacter` |
| F-29 | `skel_human` has 20 bones; global bind matrix = parent matrix × `[x y z t]` | `CommonRes/skeletons.brf`, assembled male/female body | **VERIFIED** | `getSkeletonMatrices` |
| F-30 | Skinned mesh positions are already bind-pose/world coordinates; rigid body parts are bone-local | one-bone vs empty rigging + visual assembly | **VERIFIED** | rigid pose path |
| F-31 | Helmets and gloves are rigid; Native body, foot and body-armor items are rigged | 108 head, 12 hand, 28 foot, 132 body item meshes | **VERIFIED** | outfit bone mapping |
| F-32 | Gloves resolve as `_L` and `_R` meshes; the outfit view must load both | `itm_leather_gloves` | **VERIFIED** | `getOutfitItemMeshes` |
| F-33 | Full outfit composition and save/load round-trip works for both bodies | UI + engine integration | **VERIFIED** | Phase 6 exit |
| F-34 | `item_kinds1.txt` untouched records can be copied raw while touched headers are re-rendered | existing serializer + 3-module round-trip tests | **VERIFIED** | item export |
| F-35 | Item `flags` low 5 bits are the type; capabilities must remain a decimal string | schema + `mail_shirt` (`0x101000D`, capabilities `0`) | **VERIFIED** | item editor |
| F-36 | Adding a record changes only the declared count and appends one separator block | Native 620 → 621 export re-parsed | **VERIFIED** | new item export |
| F-37 | Existing item ids are referenced externally by troops/scripts; renaming in place is unsafe | item docs + Module System conventions | **LIKELY** | ADR-034 |
| F-38 | A new item with a valid mesh but no material chain can still be exported structurally; visual validation remains separate | item export tests | **VERIFIED** | item validation limits |
| F-39 | Multiple mesh/material overrides in one source BRF must be applied sequentially to a single output | build integration test + Native BRF grouping | **VERIFIED** | `buildProject` grouping |
| F-40 | A full Native module copy is 75.6 MB and completes in ~2.2 s locally | manual copy test | **VERIFIED** | full-copy mode |
| F-41 | CommonRes BRFs can be placed in the module `Resource/` by basename; Native already lists common resources in `module.ini` | Native `load_resource` entries | **LIKELY** | build layout |
| F-42 | Build artifacts are fully described by target path + SHA-256 without re-parsing every output | manifest/log tests | **VERIFIED** | build manifest |
| F-43 | A build project snapshot restores exactly the override set used for that build | rollback test | **VERIFIED** | `project.json` + rollback |
| F-44 | Source-vs-build byte hashes provide a useful change report without parsing binaries | diff test | **VERIFIED** | `diffBuild` |
| F-45 | Native `module.ini` already lists most CommonRes packs; unlisted packs need appended `load_resource` entries | `core_ui_meshes` build test | **VERIFIED** | module.ini integration |
| F-46 | Keep-N pruning is safe when confirmation is required and newest entries are sorted first | backup/build prune tests | **VERIFIED** | retention |
| F-47 | Zero-dependency app can be released as a portable folder with optional bundled `node.exe` | release test | **VERIFIED** | release builder |
| F-48 | Release server entrypoints and frontend work relative to the release root | release smoke test | **VERIFIED** | packaging |
| F-49 | Diagnostics can verify Node version, installation, modules and writable roots without game writes | diagnostics API test | **VERIFIED** | Sistema view |
| F-50 | First-run wizard removes the need for manual config editing | app flow | **VERIFIED** | setup |
| F-51 | A Windows Job Object with kill-on-close reliably terminates the Node server when the launcher exits | launcher cleanup test on port 8792 | **VERIFIED** | launcher |

---

## 16. Testing Status

**Command:** `npm test` - **115 / 115 passing** (~8.3 s), zero dependencies.

| Suite | Tests | Coverage |
|---|---:|---|
| `unit/binaryReader` | 6 | bounds, strings, maybe-string presence, point order, trailing bytes |
| `unit/itemKinds` | 5 | parsing, stats, byte-perfect round-trip, re-render, classification, errors |
| `unit/itemFlags` | 6 | table provenance, real items, unknown bits, enum-vs-bit, zero capabilities |
| `unit/brfWriter` | 7 | synthetic round-trip (v1/v0), spec presence, geometry, dirty material, flag guard |
| `unit/workspace` | 6 | create/list/write, backup + hash, prune, traversal, delete confirmation, missing workspace |
| `unit/backups` | 3 | project backup/restore, workspace restore + tamper detection, path escapes |
| `unit/moduleIni` | 2 | keys, comments, resources, versions, capabilities, duplicates |
| `unit/dds` | 3 | DDS header, bad magic, mesh naming |
| `unit/projectStore` | 5 | ids, create/load/list, backup-on-save, prune, traversal rejection |
| `unit/validation` | 6 | missing mesh/material/texture/file, invalid DDS, shader warning |
| `integration/brf` | 6 | real BRFs, truncation, naming |
| `integration/brfWriter` | 4 | 219-file byte-identical corpus, real mesh edit, real geometry, workspace export |
| `integration/profiles` | 3 | bootstrap, dedupe/invalid, remove confirmation + active reset |
| `integration/resources` | 6 | lists, mesh/material/texture/shader details, references, structured 404 |
| `integration/pipeline` | 7 | installation, Native counts, chain + flags, composed mesh, batch validation, all modules |
| `unit/ddsDecode` | 4 | DXT1 4-colour/transparent, DXT5 alpha, bad magic |
| `unit/meshEdit` | 13 | transforms, snapping, topology, guards, overrides, validation |
| `integration/meshOverride` | 2 | real edit/override/export, frame preservation, invalid override |
| `unit/materialOverride` | 3 | validation, texture references |
| `unit/clipping` | 4 | containment, detached item, non-body overlap, missing bounds |
| `integration/materials` | 3 | real material edit/export, texture import, invalid override |
| `integration/skins` | 1 | Native `skins.txt`, both bodies, missing skin |
| `integration/outfits` | 1 | item meshes, rigid pose, outfit save/load/delete/validation |
| `integration/items` | 1 | editable record, override validation, new item export, source hash |
| `integration/build` | 3 | overlay grouping, module.ini injection, rollback/prune/diff, invalid gate |
| `integration/release` | 1 | portable release structure and copied-server `/api/health` |
| `integration/renderdata` | 3 | per-vertex expansion, raw DDS bytes, missing texture code |
| `integration/api` | 2 | profiles, resources, geometry, texture bytes, workspaces, backups, projects, outfits, CSP, static, 404 |

Golden assertions: 620 items / 279 wearables; 7,243 meshes / 633 materials / 734 textures / 139 shaders; 0 parse errors; byte-identical `item_kinds1.txt` round-trip in all three modules; **219/219 BRF byte-identical round-trip**.

**Not yet tested:** item deployment into a live module, Module System `.py` output, animation/skeleton posing, dirty animation/body writing (unsupported), module `Resource` corpus round-trip, `.sco`/`.sav`, concurrent index builds, >1 GB mods under memory pressure.

---

## 17. Change Log

### 2026-11-06 - Phase 10 completed

- **Release**: portable folder builder with optional bundled Node runtime and Windows launcher.
- **Setup**: automatic first-run installation wizard.
- **Diagnostics**: Sistema view, health checks, recovery guidance, server log tail.
- **Polish**: live status, aria-current nav, `/` search shortcut, focus-visible, reduced motion.
- **Docs**: user guide + release guide.
- **Tests**: 115 passing (release smoke + diagnostics).
- Milestone tag: `phase-10-production`.

### 2026-11-06 - Phase 9 completed

- **Retention**: keep-N build pruning and project/workspace backup pruning with typed confirmation.
- **Recovery**: build project snapshots and `rollbackBuild`.
- **Diff**: source-vs-built byte/SHA-256 report with changed/added/unchanged/unavailable.
- **Module integration**: append missing `load_resource` entries to built `module.ini`.
- **UI/API**: build diff/rollback/prune, backups prune; `/api/builds/:id/diff`, rollback/prune routes.
- **Tests**: 114 passing (retention, rollback, diff, module.ini).
- Docs: data model/architecture/ADR-040..043.
- Milestone tag: `phase-9-hardening`.

### 2026-11-06 - Phase 8 completed

- **Builder**: grouped mesh/material BRF merges, item merge, texture copy, validation gate.
- **Modes**: workspace overlay and explicit full-module copy.
- **Manifest/log**: file hashes, override counts, warnings, build log.
- **UI/API**: Build view, build list/detail, `/api/projects/:id/build`, `/api/builds`.
- **Safety**: installation remains read-only; deployment artifact stays in workspace.
- **Tests**: 111 passing (build integration/API).
- Docs: `docs/architecture/BUILDER.md`, data model/architecture/ADR-037..039.
- Milestone tag: `phase-8-builder`.

### 2026-11-06 - Phase 7 completed

- **Item model**: `getItemEditable` + generated item schema; full record fields and symbolic flags/capabilities.
- **Editor UI**: in-place Prendas form, type/flags, stats, mesh rows, project selection, create/edit/delete overrides.
- **Validation**: immutable existing ids, duplicate ids, numeric/flag/capability and mesh-reference checks.
- **Export**: merge overrides into workspace `item_kinds1.txt`; untouched records byte-identical; source hash unchanged.
- **Preview**: base item opens the Phase 6 outfit view; 0.8.0.
- **Tests**: 109 passing (item editable/override/export/API).
- Docs: `docs/architecture/ITEMS.md`, data model/architecture/ADR-034..036.
- Milestone tag: `phase-7-item-editor`.

### 2026-11-06 - Phase 6 completed

- **Bodies**: `skins.txt` parser; `man`/`woman` six-part bodies; bind matrices from `skel_human`.
- **Composition**: rigid head/hand/helmet/glove posing; body/head/hand/foot outfit slots; per-slot offsets and scale.
- **Projects**: `project.outfits[]` save/load/delete, validation and typed confirmation.
- **UI**: Outfit tab, preset, clipping report, PNG snapshot; 0.7.0.
- **Tests**: 108 passing (skins, outfit pose, clipping, API).
- Docs: `docs/architecture/OUTFITS.md`, data model/architecture/ADR-030..033.
- Milestone tag: `phase-6-outfit-editor`.

### 2026-11-06 - Phase 5 completed

- **Material editor**: fields, shaders, 0-255 colours, specular, texture names, preview toggles.
- **DDS import**: validated into `workspace/textures/` and registered in `project.textures[]`.
- **Overrides**: project materials, save/load/delete, export merged BRF + copied textures.
- **Preview**: diffuse/normal maps, specular metalness approximation, alpha/double-side.
- **Tests**: 102 passing (material unit + real export/import integration).
- Docs: `docs/architecture/MATERIALS.md`, data model/architecture/ADR-027..029.
- Milestone tag: `phase-5-materials`.


### 2026-11-06 - Phase 4 completed

- **Mesh editor**: editable model, vertex/face selection, numeric transforms, topology operations, undo/redo/reset.
- **Warband constraints**: shared positions preserved; rigged/framed meshes block count-changing topology.
- **Overrides**: project mesh overrides, validation, save/load/delete, export merged into workspace BRFs.
- **UI**: Visor edit toolbar and project controls.
- **Tests**: 96 passing (mesh edit unit suite + real override/export integration).
- Docs: `docs/architecture/MESH-EDITOR.md`, data model/architecture/ADR-024..026.
- Milestone tag: `phase-4-mesh-editor`.


### 2026-11-06 - Phase 3 completed

- **Viewport**: Three.js 0.169.0 vendored; custom orbit controls; grid, lights, framing, wireframe and UV V-flip toggles.
- **Data**: `getMeshRenderData` (base64 typed arrays, per-vertex expansion), `getTextureFile`, two new API endpoints, binary responses.
- **DDS**: browser decoder for DXT1/3/5 and DX10 BC1-BC3.
- **UI**: Visor tab + "Ver en visor 3D" from the asset index.
- **Tests**: 81 passing (DDS decoder, render data, geometry/texture API).
- Docs: `docs/architecture/VIEWPORT.md`, architecture/data model/ADR-021..023.
- Milestone tag: `phase-3-viewport`.


### 2026-11-06 — Phase 2 completed

- **Profiles**: `ProfileStore` + modal; bootstrap/dedupe/activate/validate/remove.
- **Workspaces**: lifecycle store + UI; guarded paths, delete confirmation, module metadata.
- **Asset index**: engine methods + **Recursos** view with cross-references.
- **Backups**: project/workspace catalogue + restore with hashes, typed confirmation, pre-restore backup; **Copias** view.
- **UI**: new views (Recursos, Workspaces, Copias), profile selector, 0.3.0.
- **Tests**: 74 passing (profiles, resources, backups, workspace delete).
- Docs: `docs/architecture/MANAGER.md`, architecture/data model/ADR-018…020.
- Milestone tag: `phase-2-module-manager`.

### 2026-11-06 — Phase 1 completed

- **BRF writer**: raw-range copying + dirty re-encode; 219/219 `CommonRes` files byte-identical.
- **Geometry**: lazy typed-array reader with limits; engine `getMeshGeometry`.
- **Item flags**: generated table (SHA-256 provenance) + enum-aware decoder; UI chips.
- **Workspaces**: guarded, atomic, backed-up, hashed; `exportBrf` only writes there.
- **Tests**: 61 passing (new writer/flags/workspace/corpus/geometry/export suites).
- Docs: BRF writer + geometry, ITEM-FLAGS, data model, architecture, ADR-013…017.
- Milestone tag: `phase-1-resource-engine`.

### 2026-11-06 — Master plan adopted

- Added `PROJECT_PLAN.md` as the canonical specification, roadmap, decision log and tracker.
- Recorded the 10-phase roadmap and the approval protocol.
- Documented the Phase 0 / Phase 1–2 overlap (ADR-012, since approved).

### 2026-11-06 — Phase 0 corrections and hardening

- **Corrected** the REA report: BRF is a token stream, not 6 fixed sections (F-02).
- Fixed `analyzeMeshName` for `.lodN.M` names.
- Fixed validation material issue attribution.
- Split local config (`config/app.json`, git-ignored) from `config/app.example.json`.
- Made static assets `no-cache` during development.

### 2026-11-06 — Phase 0 completed

- Initial repository, engine, backend, frontend, docs and tests.
- Commits: `16a17cb` (foundation), `3944ccf` (polish).

### 2026-11-06 — Reverse engineering baseline

- REA analysis of engine 1.170 and the three installed modules; BRF/items/DDS formats and the 64-bit identifier model documented in `Warband_REA_Analisis_Memoria.md`.

---

## 18. Next Phase

**No further phase is authorized.** The Phase 0–10 roadmap is complete.

Post-1.0 candidates are listed in §11 (specialized studios, optional deployment
workflow, semantic diffing and additional format writers). Any new work requires
an explicit scope and approval.

**Waiting for final project review.**
