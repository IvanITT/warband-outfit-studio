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
