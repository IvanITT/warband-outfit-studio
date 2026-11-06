# WARBand Outfit Studio

A **local, self-contained development environment for Mount & Blade: Warband clothing and armor assets**.

WARBand Outfit Studio reads a real Warband installation, resolves the full asset chain

```
Item → Mesh → Material → Texture → .dds file
```

and gives modders a safe place to inspect, validate and (in later phases) create, edit and export wearable assets.

- **Phase 0 (current): architecture, engine foundation, read-only inspection, validation.**
- No cloud services, no telemetry, no external runtime dependencies.
- Never writes to the game installation.

---

## Requirements

- Windows (the target game platform), Node.js **22+**.
- A Mount & Blade: Warband installation (tested with GOG *Complete Collection*, engine 1.170).

## Quick start

```bat
Warband Outfit Studio.cmd
```

or manually:

```bat
node backend\server\index.js --open
```

The server binds to `127.0.0.1:8791` (next free port if busy) and opens the UI.

Configure the installation by copying `config/app.example.json` to `config/app.json` and setting `installationPath`, or with the `WARBAND_DIR` environment variable. `config/app.json` is machine-specific and git-ignored.

## Tests

```bat
npm test
```

40 tests: unit tests with synthetic fixtures and integration tests against the real installation (read-only). If the game is not installed, integration tests are skipped automatically.

## Useful commands

```bat
node tools/build-index.js                 :: pre-build the BRF/texture index
node tools/build-index.js --module "Viking Conquest"
node tools/inspect-brf.js "C:\...\CommonRes\armors_g.brf"
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
- [Data model](docs/architecture/DATA-MODEL.md)
- [Warband format map for clothing/armor](docs/warband-analysis/FORMAT-MAP.md)
- [BRF format](docs/formats/BRF.md) · [Items](docs/formats/ITEMS.md) · [DDS](docs/formats/DDS.md)
- [Setup](docs/development/SETUP.md) · [Decisions](docs/development/DECISIONS.md)
- [Progress log](PROGRESS.md)

## Safety

- The engine opens game files read-only.
- Projects are written to `projects/` inside this repository.
- Saving an existing project copies the previous revision to `backups/projects/`.
- Exporting into a module is **not implemented** in Phase 0. When it is, it will require explicit confirmation and a hash-recorded backup.

## Status

Phase 0 complete. See [PROGRESS.md](PROGRESS.md) for the implementation status matrix and Phase 1 scope.
