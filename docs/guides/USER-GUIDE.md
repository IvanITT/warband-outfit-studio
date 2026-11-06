# WARBand Outfit Studio — User guide

## 1. Start

Run `WARBand Outfit Studio.cmd` from the repository or a release folder.

- On first run, the installation wizard opens. Select the folder containing
  `mb_warband.exe` and `Modules`.
- The app binds only to `127.0.0.1`.
- A release with the bundled runtime does not require Node.js on the target PC.
  A release without it uses `node` from `PATH`.

## 2. First-run checklist

1. Register the Warband installation.
2. Choose the module (`Native`, `Viking Conquest`, `Napoleonic Wars`).
3. Open **Sistema** and confirm all checks are green.
4. If the installation is missing, use **⚙** or restart to reopen the wizard.

## 3. Views

| View | Purpose |
|---|---|
| **Prendas** | Browse items, inspect asset chains, edit item overrides |
| **Recursos** | Search meshes, materials, textures and shaders |
| **Visor** | Inspect meshes, edit materials and compose outfits |
| **Build** | Validate and build a project into a workspace, diff and rollback |
| **Workspaces** | Create/delete scratch workspaces |
| **Sistema** | Health checks, environment, logs and recovery guidance |
| **Copias** | Restore project/workspace backups and prune old revisions |

## 4. Editing workflow

1. Select an item in **Prendas**.
2. Edit its record and save a project override.
3. Optionally edit its mesh/material in **Visor** and save those overrides.
4. Compose preview outfits in **Visor → Outfit**.
5. Open **Build**, choose the project and build.
6. Review the manifest, **Ver diff**, and the build log.
7. Use **Rollback al proyecto** to restore the exact overrides used by a build.
8. Use **Copias** to restore or prune backups and **Sistema** to inspect logs.

The game installation is never modified by any of these steps.

## 5. Build output

- `overlay` writes only changed files under
  `workspace/build-.../Modules/<module>/`.
- `Copia completa del módulo` first copies the entire module and then applies
  the overlay, producing a deployable module tree inside the workspace.
- Builds include `project.json`, `build.json` and `build.log`.
- Missing `load_resource` entries are appended to the built `module.ini`.

## 6. Recovery

| Problem | Action |
|---|---|
| Bad project edit | **Copias → Restaurar** the previous project revision |
| Bad mesh/material/BRF edit | **Copias → Restaurar** the workspace file |
| Bad build | **Build → Rollback al proyecto**, then rebuild |
| Wrong installation | **⚙** and activate another profile |
| Server issue | **Sistema** → health checks and log tail |

All restores create a backup of the current state first.

## 7. Safety

- No cloud, telemetry or external runtime dependencies.
- Writes stay under `projects/`, `workspace/`, `cache/` and `backups/`.
- The game installation is read-only; deployment of a build is a deliberate
  manual copy.
