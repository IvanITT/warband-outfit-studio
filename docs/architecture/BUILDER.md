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

Errors use the normal envelope; build validation errors are HTTP 400 with
`details.errors`.

## 7. Verification

- `integration/build` (2):
  - real mesh + material + item overrides produce an overlay with 4+ artifacts;
  - material fields and item name are present in the output;
  - source BRF hashes remain unchanged;
  - invalid item mesh stops the build and creates no workspace.
- `integration/api` covers `POST /build`, `GET /builds` and `GET /builds/:id`.
- Full-copy mode was exercised on Native (75.6 MB, `module.ini` present).

## 8. Limitations

- The game installation is never written; deployment is manual.
- Overlay builds expect the module's `module.ini` to load the changed BRF
  basenames. Existing `load_resource` entries usually cover Native assets; a
  future phase can rewrite `module.ini` automatically.
- Changed CommonRes BRFs are placed in the module `Resource/` directory; a
  module copy must use a module that loads that basename.
- No automatic `module.ini` rewrite, build signing, diff viewer or rollback yet.
- Full-copy mode is intentionally explicit because modules can be large
  (Viking Conquest/Napoleonic Wars are multi-GB).
- Build workspaces are retained until manually removed; retention is Phase 9.
