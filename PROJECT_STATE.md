# Project state — WARBand Outfit Studio

> **Purpose:** handoff document for the next work session.  
> **Last updated:** 2026-11-06  
> **Current version:** `0.12.0`  
> **Current status:** Phase 0–10 complete; post-1.0 texture workflow implemented;
> no feature currently in progress; ready to start the next requested change.

---

## 1. Where the project is

| Item | Value |
|---|---|
| Local project | `C:\Github\warband-outfit-studio` |
| Repository | `https://github.com/IvanITT/warband-outfit-studio.git` |
| Current branch | `master` |
| Remote branch | `origin/master` |
| Branch state | `origin/master` is at `34bc8a4`; local `master` has one documentation commit ahead (this handoff file) |
| Existing branch | `Modificaciones` at `9380195` |
| Runtime | Node.js `v22.19.0` |
| Game installation | `C:\Games\Mount and Blade Complete Collection\Mount and Blade - Warband` |
| Server URL | `http://127.0.0.1:8791/` |

The project was moved from the Desktop to `C:\Github`; the old path no longer
exists. Any future work must use `C:\Github\warband-outfit-studio`.

### Git reference

Latest local commits (the handoff-document commit is added after this list):

```text
34bc8a4 feat: texture preview, DDS import/export and project texture library
9380195 docs: add GitHub README for first public version
14b682c launcher: add root executable with job-object server cleanup
c6aa9c2 phase-10-production: portable release, first-run setup, diagnostics and polish
555962a phase-9-hardening: retention, rollback, diff and module.ini integration
```

Tags:

```text
phase-0-foundation
phase-1-resource-engine
phase-2-module-manager
phase-3-viewport
phase-4-mesh-editor
phase-5-materials
phase-6-outfit-editor
phase-7-item-editor
phase-8-builder
phase-9-hardening
phase-10-production
```

Before starting a new session:

```bat
cd C:\Github\warband-outfit-studio
git status
git log --oneline -5
```

If publishing:

```bat
git push origin master
```

---

## 2. Canonical documentation

Read these in this order when resuming:

1. **`PROJECT_STATE.md`** — this handoff.
2. **`CHANGE.md`** — documental control for every post-1.0 change.
3. **`PROJECT_PLAN.md`** — canonical architecture, roadmap, ADRs, tests and decisions.
4. **`PROGRESS.md`** — historical phase journal.
5. **`README.md`** — public GitHub presentation.

Every new change must be added to `CHANGE.md` with date, version, type, state,
technical detail and verification.

---

## 3. Current feature state

### Completed roadmap

| Phase | Feature | State |
|---|---|---|
| 0 | Foundation, engine/UI split, tests | Complete |
| 1 | BRF writer, geometry, flags, workspaces | Complete |
| 2 | Profiles, resources, backups, manager UI | Complete |
| 3 | 3D viewport, DDS decoder | Complete |
| 4 | Mesh editor, project overrides, export | Complete |
| 5 | Materials, DDS import, material export | Complete |
| 6 | Bodies, outfits, slots, clipping, outfit projects | Complete |
| 7 | Item editor, item overrides, item export | Complete |
| 8 | Project builder, overlays, module copies | Complete |
| 9 | Retention, rollback, diff, module.ini integration | Complete |
| 10 | Portable release, setup, diagnostics, accessibility | Complete |

### Post-1.0 work

**Texture preview/import/export (`0.12.0`)** is implemented:

- Selecting a texture in **Recursos → Texturas** shows a real DDS preview.
- **Exportar DDS** downloads the raw texture.
- **Importar y guardar** imports a `.dds`, writes it under
  `workspace/textures/Textures/`, registers it in `project.textures[]`, and
  shows it as a project texture row.
- Project textures can be previewed and exported.
- Imported textures are available to the material editor for diffuse/bump/spec
  assignment, enabling new item/outfit/character workflows.
- New API: `GET /api/projects/:id/textures/:name/raw`.

### Security / safety invariants

- The Warband installation is **read-only**.
- Writes are limited to `projects/`, `workspace/`, `cache/` and `backups/`.
- No cloud, telemetry, accounts or npm runtime dependencies.
- Destructive actions require typed confirmation.
- Builds produce workspace artifacts; live game deployment remains manual.

---

## 4. How to run

### Normal launcher

```text
C:\Github\warband-outfit-studio\WARBand Outfit Studio.exe
```

- Starts `backend/server/index.js --open`.
- Uses `runtime\node.exe` if available, otherwise Node from `PATH`.
- Keeps the server inside a Windows Job Object with kill-on-close.
- Closing the launcher window stops the server and its child processes.

### Source/fallback launcher

```text
Warband Outfit Studio.cmd
```

### Manual

```bat
cd C:\Github\warband-outfit-studio
node backend\server\index.js --open
```

### Release

```bat
npm run release
```

Creates `dist/warband-outfit-studio-0.12.0/`; by default it bundles the current
Node runtime.

---

## 5. Test baseline

```bat
npm test
```

**115 / 115 tests passing** (about 7–8 seconds, varies with disk/CPU).

Important suites:

- BRF parser/writer and 219/219 byte-identical round-trips.
- Item parser/editor and real item export.
- Material editing/export and DDS import.
- Outfit bodies/rigid pose and outfit persistence.
- Build grouping, module.ini injection, rollback, diff and retention.
- Portable release structure and copied-server health check.
- API, backups, workspaces and path guards.

Tests use the real installation read-only and skip gracefully if it is absent.

---

## 6. Architecture and important files

```text
engine/       reusable Warband engine (no server/UI imports)
backend/      local HTTP server + JSON API
frontend/     vanilla HTML/CSS/JS + vendored Three.js
docs/         architecture, formats, guides, decisions
tests/        node:test unit and integration suites
tools/        index, release, launcher helpers
projects/     user project JSON files
workspace/    build/export outputs
backups/      automatic backups
cache/        derived index, DDS cache, logs
```

High-value files:

| Area | File |
|---|---|
| Engine facade | `engine/index.js` |
| BRF parser/writer | `engine/resources/brf.js` |
| BRF index | `engine/resources/brfIndex.js` |
| Geometry | `engine/resources/geometry.js` |
| Projects | `engine/projects/projectStore.js` |
| Workspaces | `engine/resources/workspace.js` |
| Item parser/editor | `engine/items/itemKinds.js`, `engine/items/itemFlags.js` |
| Skins/outfits | `engine/skins/skins.js`, `engine/outfit/clipping.js` |
| Backend routes | `backend/api/routes.js` |
| Frontend shell | `frontend/js/app.js` |
| Resource browser | `frontend/js/resources.js` |
| Mesh/material/outfit viewer | `frontend/js/viewer.js` |
| Item editor | `frontend/js/item-editor.js` |
| Build view | `frontend/js/build.js` |
| Diagnostics | `frontend/js/diagnostics.js` |
| Launcher source | `tools/launcher/Launcher.cs` |
| Launcher rebuild | `tools/build-launcher.cmd` |
| Release builder | `tools/build-release.js` |

---

## 7. Recent texture workflow details

### Preview

- `resources.js` imports `decodeDds` from `dds.js`.
- Selected textures are decoded client-side to RGBA and drawn to a `<canvas>`.
- Preview is shown over a checkerboard background.
- Project textures use the project raw endpoint.

### Export

- Module texture: `api.textureBuffer(module, name)`.
- Project texture: `api.projectTextureBuffer(projectId, name)`.
- Download is a Blob with `.dds` filename.

### Import

1. Select project.
2. Select `.dds`.
3. Enter destination name.
4. `api.createWorkspace({ label: 'textures', reuse: true })`.
5. `api.importTexture(workspaceId, name, base64)`.
6. `api.saveProjectTexture(projectId, imported)`.
7. Refresh project rows and select the new texture.

### Backend

- `engine.getProjectTextureFile(projectId, name)` reads the workspace file.
- `GET /api/projects/:id/textures/:name/raw` returns binary DDS.
- Project texture metadata lives in `project.textures[]`.

---

## 8. Known limitations / follow-ups

- Texture editing/painting is not in the app; external editing is required.
- Imported textures are project-scoped; the UI currently uses the project
  selector in the Resources view.
- No batch texture import/export yet.
- No texture deletion UI from the texture detail yet (project texture delete
  endpoint exists).
- No automatic material creation from an imported texture; assign it manually
  in the material editor.
- Build deployment to the live game remains manual.
- Build diff is byte/hash based, not semantic.
- Destructive confirmations still use `window.prompt`.
- Current release packaging uses a portable folder with optional bundled
  `node.exe`, not a single Node SEA binary.
- `origin/master` is at `34bc8a4`; the local handoff-document commit is ahead and can be pushed when ready.

---

## 9. Suggested next work

Prioritize based on user request. Likely candidates:

1. Texture library improvements:
   - delete/rename project textures;
   - import multiple DDS files;
   - assign imported texture directly to a material from the texture detail;
   - export selected materials/textures as a bundle.
2. Character creation workflow:
   - a dedicated “new character” preset combining body, outfit and materials.
3. Build/deployment:
   - optional module.ini rewrite beyond appending;
   - deployment handoff to a module folder.
4. UI/QA:
   - in-app confirmation dialogs;
   - accessibility and keyboard polish;
   - automated WebGL smoke test.

---

## 10. Resume checklist

```bat
cd C:\Github\warband-outfit-studio
git status
git log --oneline -5
npm test
```

Then:

1. Read the latest `CHANGE.md` entry.
2. Check `PROJECT_PLAN.md` §11 and §12.
3. Start `WARBand Outfit Studio.exe` or run the server manually.
4. Implement the requested change.
5. Add a new entry to `CHANGE.md`.
6. Run `npm test`.
7. Commit and, if requested, push.

**Current active task:** none. Waiting for the next requested improvement.
