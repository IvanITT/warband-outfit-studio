# Warband Outfit Studio — Project Plan

> **This is the master specification, roadmap, decision log and progress tracker.**
> `PROGRESS.md` is kept as the historical phase journal; this file is canonical.
>
> Last updated: **2026-11-06**
> Current phase: **Phase 0 — COMPLETE**
> Waiting for: **explicit user approval to start Phase 1**

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
| `engine/modules/moduleIni.js` | `module.ini` parser | IMPLEMENTED |
| `engine/modules/moduleRegistry.js` | module discovery, ids, capabilities | IMPLEMENTED |
| `engine/items/itemKinds.js` | `item_kinds1.txt` parse + byte-perfect serialize | IMPLEMENTED |
| `engine/resources/brf.js` | BRF token-stream parser | IMPLEMENTED |
| `engine/resources/brfIndex.js` | cross-file index + persistent cache | IMPLEMENTED |
| `engine/resources/textureResolver.js` | DDS discovery | IMPLEMENTED |
| `engine/textures/dds.js` | DDS header | IMPLEMENTED |
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

### Phase 1 — Warband Resource Engine

Complete the resource layer so it can **read, represent, mutate and write** the relevant formats safely.

- Geometry extraction API (positions, normals, UVs, faces, rigging) with memory limits.
- BRF writer: round-trip and selective object replacement.
- Item flag/symbol table generated from `header_items.py` (offline, committed).
- Resource mutation API that only writes to `workspace/`.
- Serialization tests over a representative BRF corpus.
- **Exit:** round-trip corpus green, geometry counts match, flags decoded, no writes to the game.

### Phase 2 — Game & Module Manager

Turn the existing detection/index into a complete manager.

- Multi-installation profiles, user-selected paths, validation.
- Module selection and capabilities surfaced in the UI.
- Workspace creation/management (`workspace/<project>/module/`), safe copies.
- Backup catalogue with hashes and restore.
- Asset index UI (meshes, materials, textures, missing references).
- **Exit:** user can create a workspace from a module, browse the index and restore a backup; tests cover the flow.

### Phase 3 — 3D Viewport

- Vendored Three.js (local), WebGL viewport, orbit/pan/zoom, grid, lighting.
- Load meshes through the engine (no duplicate parsing in the browser).
- Basic material preview (diffuse/normal/spec), selection.
- **Exit:** a real Warband mesh renders correctly with controls; performance acceptable on integrated GPU.

### Phase 4 — Mesh Editor

- Vertex/face selection, move/rotate/scale, duplicate/delete/merge/split/mirror, basic extrude.
- Warband-compatible geometry constraints; undo history where practical.
- **Exit:** edited mesh survives export and validates.

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

**Phase 0 is COMPLETE.** All Phase 0 deliverables are implemented, tested and documented.

**No later phase has been authorized.** The next action is to wait for explicit approval.

### Roadmap reconciliation (important)

The master roadmap assumes Phase 0 produces only foundations, with parsers in Phase 1 and installation/module management in Phase 2. The Phase 0 work, driven by the previous brief, already delivered:

- BRF and item parsers,
- installation and module detection,
- cross-file indexing and DDS resolution,
- validation and project storage.

This is **not** a silent deviation. It is recorded here as an architectural fact:

- **Phase 1** is therefore scoped to the **unfinished** Resource Engine work: geometry, BRF writing, symbolic item flags, mutation APIs and corpus tests.
- **Phase 2** is scoped to the **unfinished** manager work: multi-installation profiles, workspace lifecycle, backup catalogue/restore and management UI.
- No earlier deliverable is re-implemented.

Approval is requested for this reconciliation together with Phase 1.

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

---

## 11. Pending Work

### Phase 1 (proposed, not authorized)

1. **Geometry API** — read positions/normals/UVs/faces/rigging on demand; counts already parsed; enforce memory caps and lazy loading.
2. **BRF writer** — serialize the document model; byte-identical round-trip for a corpus; selective object replacement.
3. **Item flags** — generate an offline symbol table from `header_items.py`; decode `itp_*`, `itc_*`, `itcf_*`; display in the UI (read-only).
4. **Mutation APIs** — edit in memory, write only to `workspace/`; no game writes.
5. **Corpus tests** — representative BRFs (armor, materials, textures, shaders, animations, composed meshes) + failure cases.
6. **Docs** — BRF writer spec, geometry model, flags reference.

### Backlog after Phase 1

- Phase 2: profiles, workspace lifecycle, backup catalogue/restore, manager UI.
- Phase 3+: viewport, mesh editor, materials, outfit editor, item editor, exporter, hardening, packaging.

---

## 12. Known Issues

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | Item `flags`/`capabilities` are raw numbers; no symbolic decoding | Medium | Planned Phase 1 |
| 2 | No BRF writer; projects cannot export meshes | High | Planned Phase 1 |
| 3 | Geometry buffers are skipped; only counts are available | Medium | Planned Phase 1 |
| 4 | UI is read-only; projects can be created via API but not edited | High | Planned Phase 1–2 |
| 5 | Duplicate material names resolve first-wins; BRF load order is LIKELY | Low | Documented; verify in Phase 2 |
| 6 | Glove `_L`/`_R` engine mirroring is LIKELY, not traced | Low | Documented |
| 7 | `module.ini` known-key catalogue is curated, not exhaustive | Low | Extend with engine 1.170 evidence |
| 8 | `WB-I-003` (no normal map) is noisy for vanilla assets | Low | UI filter in Phase 1 |
| 9 | `.sco` and `.sav` are uninvestigated | Low (out of scope) | — |

---

## 13. Technical Debt

| Area | Debt | Plan |
|---|---|---|
| `engine/validation/validate.js` | Mixed responsibilities (resolution + rules) in one file | Split when rules exceed ~20 |
| `brfIndex` cache | Whole-module JSON cache; 7.8 MB for VC | Per-pack cache only if it becomes a problem |
| Encoding | CP1252 fallback is silent; no per-file report in the UI | Surface in Phase 1 diagnostics |
| `module.ini` | Hand-curated known keys | Generate from engine evidence / module system |
| Frontend | No component framework; DOM helpers are ad hoc | Re-evaluate at Phase 3 (viewport) |
| Item model | `capabilities` kept as string; no BigInt helpers | Add helpers in Phase 1 |
| Tests | No golden-file corpus for BRF round-trip yet | Phase 1 |
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
| ADR-012 | Phase 0 overlap with master’s Phase 1–2 (parsers/detection) is retained, not rebuilt | **Pending approval** |

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

---

## 16. Testing Status

**Command:** `npm test` — **40 / 40 passing** (~4.4 s), zero dependencies.

| Suite | Tests | Coverage |
|---|---:|---|
| `unit/binaryReader` | 6 | bounds, strings, maybe-string presence, point order, trailing bytes |
| `unit/itemKinds` | 5 | parsing, stats, byte-perfect round-trip, re-render, classification, errors |
| `unit/moduleIni` | 2 | keys, comments, resources, versions, capabilities, duplicates |
| `unit/dds` | 3 | DDS header, bad magic, mesh naming |
| `unit/projectStore` | 4 | ids, create/load/list, backup-on-save, traversal rejection |
| `unit/validation` | 6 | missing mesh/material/texture/file, invalid DDS, shader warning |
| `integration/brf` | 6 | real BRFs, truncation, naming |
| `integration/pipeline` | 7 | installation, Native counts, chain, composed mesh, batch validation, all modules |
| `integration/api` | 2 | HTTP API, CSP, static, projects + backup, structured 404 |

Golden assertions: 620 items / 279 wearables; 7,243 meshes / 633 materials / 734 textures / 139 shaders; 0 parse errors; byte-identical `item_kinds1.txt` round-trip in all three modules.

**Not yet tested:** BRF writing (not implemented), geometry payloads, `.sco`/`.sav`, concurrent index builds, very large mods (>1 GB) under memory pressure.

---

## 17. Change Log

### 2026-11-06 — Master plan adopted

- Added `PROJECT_PLAN.md` as the canonical specification, roadmap, decision log and tracker.
- Recorded the 10-phase roadmap and the approval protocol.
- Documented the Phase 0 / Phase 1–2 overlap (ADR-012, pending approval).

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

**Phase 1 — Warband Resource Engine** (proposed; requires explicit approval).

### Proposed scope

| Work item | Deliverable | Exit criterion |
|---|---|---|
| Geometry API | lazily read positions/normals/UVs/faces/rigging | counts/positions match source; memory cap enforced |
| BRF writer | serialize the document model | byte-identical round-trip on a corpus of ≥20 real BRFs |
| Item flags | offline symbol table from `header_items.py` | known vanilla items decode to expected symbols |
| Mutation APIs | in-memory edits + workspace-only writes | game installation untouched; tests assert workspace paths |
| Corpus tests | fixtures + round-trip + failure cases | green in CI/local |
| Docs | writer spec, geometry model, flags reference | reviewed and linked from this plan |

### Explicitly out of Phase 1

3D viewport, mesh editor, materials UI, item editor UI, module deployment, backups UI.

### Decisions requested with this approval

1. **Roadmap reconciliation (ADR-012):** accept that Phase 0 already delivered the parsers/detection, and Phase 1 targets the remaining resource work (not a rebuild).
2. **BRF writing target:** byte-identical round-trip is the primary requirement; semantic equivalence is not sufficient unless documented.
3. **Module System source import:** defer Python 2 `module_items.py` import until Phase 7 (item editor) unless required earlier.

**Waiting for explicit user approval.**
