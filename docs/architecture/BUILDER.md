# Project builder (Phase 8)

The **Build** view turns a project's mesh, material and item overrides into a
workspace artifact with a manifest, build log and file hashes.

The game installation is **read-only**. A build never writes into it. A full
module copy is produced inside `workspace/`, ready to be inspected or copied
manually.

## 1. Build modes

| Mode | What is written | Use |
|---|---|---|
| `overlay` | Only changed assets under `Modules/<module>/...` plus `build.json` / `build.log` | Review a build; apply manually |
| `module` | First a complete copy of the source module, then the same overlay | A deployable module tree in the workspace |

The UI exposes the mode as **Copia completa del módulo**.

## 2. Pipeline

```
project
  ├─ mesh overrides      -> apply to source BRF (one output per BRF)
  ├─ material overrides  -> apply to source material BRF + reference textures
  └─ item overrides      -> merge into item_kinds1.txt
        │
        ▼
validation gate (no workspace write on error)
        │
        ▼
workspace/build-<project>-<timestamp>/
  Modules/<module>/Resource/<brf>       changed BRFs
  Modules/<module>/Textures/<dds>       referenced textures
  Modules/<module>/item_kinds1.txt      merged item file
  build.json                            manifest + hashes
  build.log                             human-readable log
```

Meshes and materials that share a source BRF are grouped and applied
sequentially, so one output BRF contains all changes. Items are merged by the
Phase 7 serializer.

## 3. Validation gate

A build stops before creating a workspace when:

- a mesh override cannot be applied/validated;
- a material override or a referenced texture is missing;
- an item override fails `validateItemOverride`;
- two artifacts target the same file with different content;
- the project has no asset overrides and `copyModule` is false.

Failures return `BUILD_VALIDATION_FAILED` with `details.errors`. The source game
files are never touched.

## 4. Build manifest

```json
{
  "schemaVersion": 1,
  "id": "build-my-project-2026-11-06T...",
  "projectId": "my-project",
  "projectName": "My Project",
  "moduleId": "Native",
  "moduleRoot": "Modules/Native",
  "mode": "overlay",
  "createdAt": "...",
  "sourceInstallation": "C:/Games/.../Mount and Blade - Warband",
  "overrides": { "meshes": 1, "materials": 1, "items": 1 },
  "summary": { "files": 6, "meshes": 1, "materials": 1, "items": 1 },
  "warnings": [],
  "errors": [],
  "files": [
    {
      "kind": "material",
      "source": "CommonRes/materials.brf",
      "target": "Modules/Native/Resource/materials.brf",
      "bytes": 1234,
      "sha256": "..."
    }
  ]
}
```

`build.log` repeats the summary and file list in a human-readable form.

## 5. UI

Open **Build**:

- choose a project;
- optionally enable **Copia completa del módulo**;
- click **Construir**;
- inspect the validation result, manifest, file list, hashes and build log;
- click a previous build in the left list to reopen it.

The view does not deploy to the game. A `module` build is a complete module
tree inside the workspace and must be copied manually if the author wants to
use it.

## 6. API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/projects/:id/build` | `{ copyModule?, label? }` → build manifest |
| GET | `/api/builds` | list build workspaces |
| GET | `/api/builds/:id` | manifest + build log |
| GET | `/api/builds/:id/diff` | source vs built byte/hash diff |
| POST | `/api/builds/:id/rollback` | restore `project.json` from a build |
| POST | `/api/builds/prune` | keep the newest N builds |
| POST | `/api/backups/prune` | keep the newest N backups per group |

Errors use the normal envelope; build validation errors are HTTP 400 with
`details.errors`.

## 7. Recovery and retention

- Every build stores `project.json`, the exact project snapshot used for the
  build. `POST /api/builds/:id/rollback` restores that snapshot through
  `ProjectStore.save`, which first backs up the current project. Confirmation is
  the build id.
- `POST /api/builds/prune` requires `confirm: "PRUNE_BUILDS"` and keeps the
  newest `keep` build workspaces. Older folders are deleted via the guarded
  WorkspaceStore API.
- `POST /api/backups/prune` requires `confirm: "PRUNE_BACKUPS"` and keeps the
  newest `keep` project backups per project and workspace backups per
  workspace file. It does not remove live projects/workspaces.
- `GET /api/builds/:id/diff` compares each manifest file's built bytes and
  SHA-256 with its source where a source path exists. Texture entries sourced
  from a project/game are marked non-comparable.
- Missing `load_resource` entries are appended to the built `module.ini` so an
  overlay that moves a CommonRes pack into module `Resource/` is loaded.
  Existing entries are never removed or reordered.

## 8. Verification

- `integration/build` (3):
  - real mesh + material + item overrides produce an overlay with 4+ artifacts;
  - material fields and item name are present in the output;
  - source BRF hashes remain unchanged;
  - `module.ini` receives a missing `load_resource` entry;
  - rollback restores the build's project snapshot;
  - diff reports changed files;
  - retention keeps one build and deletes older workspaces;
  - invalid item mesh stops the build and creates no workspace.
- `integration/api` covers build create/list/detail/diff/prune.
- Full-copy mode was exercised on Native (75.6 MB, `module.ini` present).
- `unit/projectStore` and `unit/workspace` cover backup pruning.

## 9. Limitations

- The game installation is never written; deployment is manual.
- `module.ini` integration only appends missing `load_resource` entries; it does
  not remove or reorder existing entries.
- Changed CommonRes BRFs are placed in the module `Resource/` directory; a
  module copy must use a module that loads that basename.
- Diff is byte/hash based; it does not visually compare meshes or textures.
- Rollback restores the project snapshot, not previously built workspace files;
  rebuild after a rollback when a new artifact is needed.
- Full-copy mode is intentionally explicit because modules can be large
  (Viking Conquest/Napoleonic Wars are multi-GB).
- Backup pruning leaves empty `.backups` timestamp folders until a later
  cleanup pass.
