# WARBand Outfit Studio

A **local, self-contained development environment for Mount & Blade: Warband clothing and armor assets**.

WARBand Outfit Studio reads a real Warband installation, resolves the full asset chain

```
Item → Mesh → Material → Texture → .dds file
```

and gives modders a safe place to inspect, validate and (in later phases) create, edit and export wearable assets.

- **Phase 10 (current): production polish — portable release, first-run setup, diagnostics/logs, recovery guidance and accessibility.**
- No cloud services, no telemetry, no external runtime dependencies.
- Never writes to the game installation.

---

## Requirements

- Windows (the target game platform), Node.js **22+**.
- A Mount & Blade: Warband installation (tested with GOG *Complete Collection*, engine 1.170).

## Quick start

Double-click **`WARBand Outfit Studio.exe`** at the project root. It starts
the local server, opens the browser and keeps the server in a Windows Job
Object; closing the launcher window stops the server and its child processes.
`Warband Outfit Studio.cmd` is kept as a source/fallback launcher.

The server binds to `127.0.0.1:8791` (next free port if busy) and opens the UI.

Views: **Prendas** (items + item editor), **Recursos** (mesh/material/texture/shader index), **Visor** (mesh/material/outfit editor), **Build**, **Workspaces** (create/delete), **Copias** (backup catalogue and restore). The gear button manages installation profiles.

Configure the installation by copying `config/app.example.json` to `config/app.json` and setting `installationPath`, or with the `WARBAND_DIR` environment variable. `config/app.json` is machine-specific and git-ignored.

## Tests

```bat
npm test
```

115 tests: unit tests with synthetic fixtures and integration tests against the real installation (read-only). If the game is not installed, integration tests are skipped automatically.

## Useful commands

```bat
node tools/build-index.js                 :: pre-build the BRF/texture index
node tools/build-index.js --module "Viking Conquest"
node tools/inspect-brf.js "C:\...\CommonRes\armors_g.brf"
node tools/export-brf.js "C:\...\CommonRes\armors_g.brf" --workspace demo
node tools/generate-item-flags.js --header "C:\...\Module_system 1.171\header_items.py"
```

## Project layout

```
engine/       Warband Engine (installation, modules, BRF, items, textures, validation, projects)
backend/      local HTTP server + JSON API (zero dependencies)
frontend/     vanilla HTML/CSS/JS UI (no build step)
docs/         architecture, format reference, development notes
tests/        node:test unit + integration suites
tools/        CLI utilities built on the engine
projects/     user projects (JSON)
cache/        derived BRF index cache (safe to delete)
backups/      automatic project backups
```

## Documentation

- [Project plan (canonical)](PROJECT_PLAN.md)
- [Architecture](docs/architecture/ARCHITECTURE.md)
- [Game & module manager](docs/architecture/MANAGER.md)
- [3D viewport](docs/architecture/VIEWPORT.md)
- [Mesh editor](docs/architecture/MESH-EDITOR.md)
- [Textures & materials](docs/architecture/MATERIALS.md)
- [Outfits & armor](docs/architecture/OUTFITS.md)
- [Item editor](docs/architecture/ITEMS.md)
- [Builder](docs/architecture/BUILDER.md)
- [User guide](docs/guides/USER-GUIDE.md) · [Release guide](docs/guides/RELEASE.md)
- [Data model](docs/architecture/DATA-MODEL.md)
- [Warband format map for clothing/armor](docs/warband-analysis/FORMAT-MAP.md)
- [BRF format](docs/formats/BRF.md) · [Items](docs/formats/ITEMS.md) · [DDS](docs/formats/DDS.md)
- [Setup](docs/development/SETUP.md) · [Decisions](docs/development/DECISIONS.md)
- [Progress log](PROGRESS.md)

## Safety

- The engine opens game files read-only.
- Projects are written to `projects/` inside this repository.
- Saving an existing project copies the previous revision to `backups/projects/`.
- Builds write overlays or full module copies under `workspace/`; the game installation is still never modified. Live deployment is intentionally manual and outside the current build pipeline.

## Status

Phase 10 complete — the 0–10 roadmap is feature-complete. See [PROGRESS.md](PROGRESS.md) and [PROJECT_PLAN.md](PROJECT_PLAN.md).
