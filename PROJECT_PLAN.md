# Warband Outfit Studio — Project Plan

> **This is the master specification, roadmap, decision log and progress tracker.**
> `PROGRESS.md` is kept as the historical phase journal; this file is canonical.
>
> Last updated: **2026-11-06**
> Current phase: **Phase 4 — COMPLETE**
> Waiting for: **explicit user approval to start Phase 5**

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
| Packaging | `.cmd` launcher now; Node SEA in Phase 10 | removes the Node prerequisite eventually |
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

### Phase 5 — Texture & Material System

- DDS decoding/preview, material creation/editing, shader selection, alpha/mipmap awareness.
- Texture assignment and export.
- **Exit:** new material + texture visible in viewport and exportable.

### Phase 6 — Outfit & Armor Editor

- Character body preview, equip/unequip across slots, transforms, replacement, presets.
- Outfit projects with save/load.
- **Exit:** a complete outfit is assembled, saved, reopened and validated.

### Phase 7 — Item Editor

- Create/edit items: id, names, type, mesh refs, armor values, weight, value, flags, merchandise.
- Symbolic flags from Phase 1; validation and serialization.
- **Exit:** new item written to a workspace copy and validated; round-trip is stable.

### Phase 8 — Warband Builder & Exporter

- Project → validate → build → resources → item integration → module integration.
- Collision detection, backups, build logs, clear errors.
- **Exit:** a build produces a deployable module copy in `workspace/`, with a dry-run report.

### Phase 9 — Validation, Backup, Recovery & Automated Testing

- Expand rules and coverage; backup metadata, hashes, restore, build history, rollback.
- End-to-end tests for build/restore/error paths.
- **Exit:** destructive operations are reversible and tested.

### Phase 10 — Build, Launch & Production Polish

- Launcher/packaging, first-run setup, settings, logs, recovery workflows, UI polish, performance, accessibility.
- **Exit:** a packaged application with user and developer documentation, release checklist.

---

## 9. Current Phase

**Phase 4 is COMPLETE.** All Phase 4 deliverables are implemented, tested and documented.

**No later phase has been authorized.** The next action is to wait for explicit approval to start Phase 5.

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

## 11. Pending Work

### Phase 5 (proposed, not authorized)

1. **Texture pipeline** — DDS decode beyond the viewport: list pages, alpha/mip awareness, texture import into a workspace and material assignment.
2. **Material model** — create/edit materials (shader, diffuse/bump/spec/enviro, colour/specular/flags) with the BRF writer.
3. **Material preview** — normal/spec channels in the viewport (normal map approximation), alpha blending modes.
4. **Shader awareness** — select from shaders present in loaded BRFs; warn on unknown shaders.
5. **Texture assignment** — attach a texture to a material/mesh, validate existence and dimensions.
6. **Overrides** — project texture/material overrides referencing base assets; export merged BRF copies.
7. **Tests/docs** — DDS variants, material round-trip, preview checklist.

### Explicitly out of Phase 5

Outfit composition, item editing, deployment.

### Decisions requested with this approval

1. **Texture storage**: copy imported textures into `workspace/` (proposed) vs reference arbitrary local paths.
2. **DDS scope**: DXT1/3/5 + BC1–3 first (proposed) vs add BC4–7 and mipmaps now.
3. **Normal preview**: tangent-space approximation with a toggle (proposed) vs physically accurate without tangents (impossible for layout 2).

### Backlog after Phase 5

- Phase 6: outfit editor; Phase 7: item editor; Phase 8: exporter; Phase 9: hardening; Phase 10: packaging.

---

## 12. Known Issues (after Phase 4)

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | The outfit view is read-only; project item editing is not implemented | High | Planned Phase 6–7 |
| 2 | Dirty animations and collision bodies cannot be written | Medium | Preserved verbatim; writer throws if marked dirty |
| 3 | Adding/removing BRF objects (section count changes) is not exposed | Medium | Phase 8 (builder) |
| 4 | Viewport renders the bind pose only (no skinning/skeleton pose) | Medium | Phase 6 |
| 5 | Only the diffuse map is previewed (no normal/spec) | Medium | Phase 5 |
| 6 | Mesh topology changes are blocked on rigged/framed meshes | Medium | Phase 5 (weights) |
| 7 | Extrude is per-face; adjacent faces keep internal walls | Low | Improve in Phase 4 follow-up |
| 8 | Overrides store a full geometry snapshot, not a delta | Low | Optimize if projects grow |
| 9 | No UV or bone-weight editing yet | Medium | Phase 5 |
| 10 | UV V flip is LIKELY (OpenBRF convention); toggle available | Low | Controlled experiment |
| 11 | Geometry is re-read on every viewport selection | Low | LRU if it hurts |
| 12 | Duplicate material names resolve first-wins; BRF load order is LIKELY | Low | Controlled experiment |
| 13 | Glove `_L`/`_R` engine mirroring is LIKELY, not traced | Low | Documented |
| 14 | `module.ini` known-key catalogue is curated, not exhaustive | Low | Extend with engine evidence |
| 15 | `WB-I-003` (no normal map) is noisy for vanilla assets | Low | UI filter pending |
| 16 | No workspace rename/file-level delete or restore diff preview | Low | Phase 9 |
| 17 | `.sco` and `.sav` are uninvestigated | Low (out of scope) | — |

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
| DDS decoder | First mip only; DXT1/3/5 + BC1-3; no BC4-7/mipmaps | Extend in Phase 5 |
| Viewport controls | Custom orbit controls without inertia/touch pinch | Add in Phase 4 if needed |
| Viewport tests | DOM/screenshot verification; no automated WebGL assertion | Add a render smoke test in Phase 9 |
| Mesh history | Full model snapshots (25 max) | Delta/undo journal if memory matters |
| Mesh overrides | Full geometry snapshot per edited mesh | Delta format if projects grow |
| Extrude | Per-face implementation (internal walls on adjacent faces) | Region extrude in a Phase 4 follow-up |
| Selection | Vertex + face only (approved); no edge loops | Revisit with UV editing |
| Rigged/framed meshes | Count-changing topology blocked | Phase 5 weights |
| Flags table | Generated from 1.171; no 1.174 table | Regenerate when supporting another branch |
| Tests | Corpus is `CommonRes` only; module `Resource` packs not round-tripped | Extend in Phase 3+ |
| Backups | No pruning/retention policy (ADR-020) | Phase 9 |
| UI confirmations | `window.prompt` for destructive actions | Replace with an in-app dialog in Phase 10 |
| Docs | `PROGRESS.md` and `PROJECT_PLAN.md` overlap | PROJECT_PLAN canonical; PROGRESS historical |
| Packaging | Requires Node installed | Phase 10 (Node SEA) |

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

---

## 16. Testing Status

**Command:** `npm test` - **96 / 96 passing** (~4.8 s), zero dependencies.

| Suite | Tests | Coverage |
|---|---:|---|
| `unit/binaryReader` | 6 | bounds, strings, maybe-string presence, point order, trailing bytes |
| `unit/itemKinds` | 5 | parsing, stats, byte-perfect round-trip, re-render, classification, errors |
| `unit/itemFlags` | 6 | table provenance, real items, unknown bits, enum-vs-bit, zero capabilities |
| `unit/brfWriter` | 7 | synthetic round-trip (v1/v0), spec presence, geometry, dirty material, flag guard |
| `unit/workspace` | 5 | create/list/write, backup + hash, traversal, delete confirmation, missing workspace |
| `unit/backups` | 3 | project backup/restore, workspace restore + tamper detection, path escapes |
| `unit/moduleIni` | 2 | keys, comments, resources, versions, capabilities, duplicates |
| `unit/dds` | 3 | DDS header, bad magic, mesh naming |
| `unit/projectStore` | 4 | ids, create/load/list, backup-on-save, traversal rejection |
| `unit/validation` | 6 | missing mesh/material/texture/file, invalid DDS, shader warning |
| `integration/brf` | 6 | real BRFs, truncation, naming |
| `integration/brfWriter` | 4 | 219-file byte-identical corpus, real mesh edit, real geometry, workspace export |
| `integration/profiles` | 3 | bootstrap, dedupe/invalid, remove confirmation + active reset |
| `integration/resources` | 6 | lists, mesh/material/texture/shader details, references, structured 404 |
| `integration/pipeline` | 7 | installation, Native counts, chain + flags, composed mesh, batch validation, all modules |
| `unit/ddsDecode` | 4 | DXT1 4-colour/transparent, DXT5 alpha, bad magic |
| `unit/meshEdit` | 13 | transforms, snapping, topology, guards, overrides, validation |
| `integration/meshOverride` | 2 | real edit/override/export, frame preservation, invalid override |
| `integration/renderdata` | 3 | per-vertex expansion, raw DDS bytes, missing texture code |
| `integration/api` | 2 | profiles, resources, geometry, texture bytes, workspaces, backups, projects, CSP, static, 404 |

Golden assertions: 620 items / 279 wearables; 7,243 meshes / 633 materials / 734 textures / 139 shaders; 0 parse errors; byte-identical `item_kinds1.txt` round-trip in all three modules; **219/219 BRF byte-identical round-trip**.

**Not yet tested:** viewport (not implemented), dirty animation/body writing (unsupported), module `Resource` corpus round-trip, `.sco`/`.sav`, concurrent index builds, >1 GB mods under memory pressure.

---

## 17. Change Log

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

**Phase 5 — Texture & Material System** (proposed; requires explicit approval).

### Proposed scope

| Work item | Deliverable | Exit criterion |
|---|---|---|
| Texture pipeline | DDS variants, pages, alpha/mip awareness | real textures decode and preview |
| Material model | create/edit shader, maps, colour, flags | material round-trips through the BRF writer |
| Material preview | normal/spec approximation + alpha | visually verifiable on armour |
| Shader awareness | shader list + unknown warnings | no silent fallbacks |
| Texture assignment | attach/validate textures | missing files are caught before export |
| Overrides | project material/texture overrides | export merges into workspace |
| Tests/docs | DDS variants + material round-trip | green and documented |

### Explicitly out of Phase 5

Outfit composition, item editing, deployment.

### Decisions requested with this approval

1. **Texture storage**: copy imported textures into `workspace/` (proposed) vs reference arbitrary local paths.
2. **DDS scope**: DXT1/3/5 + BC1–3 first (proposed) vs add BC4–7 and mipmaps now.
3. **Normal preview**: tangent-space approximation with a toggle (proposed) vs skip normals until tangents are editable.

**Waiting for explicit user approval.**
