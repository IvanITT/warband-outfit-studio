# Setup and development

## Requirements

- Windows 10/11 (the game's platform).
- **Node.js 22+** (`node -v`). No npm install is required: there are no dependencies.
- Mount & Blade: Warband installed. Tested with the GOG *Complete Collection*, engine **1.170**.

## Configure the installation

Priority order used by the engine:

1. `WARBAND_DIR` environment variable
2. `installationPath` in `config/app.json` (local, git-ignored)
3. well-known paths (`C:/Games/...`, Program Files, Steam, GOG, Documents)

Create the local configuration from the committed example:

```bat
copy config\app.example.json config\app.json
```

```json
{
  "installationPath": "C:/Games/Mount and Blade Complete Collection/Mount and Blade - Warband",
  "http": { "host": "127.0.0.1", "port": 8791 },
  "defaultModule": "Native"
}
```

Forward slashes are recommended in JSON. `installationPath` may be `null` when auto-detection finds the game.

On first run the engine stores the detected installation in `config/profiles.json`
(git-ignored). Additional installations can be added from the UI (gear button)
and switched at any time.

## Run

```bat
Warband Outfit Studio.cmd
```

or:

```bat
node backend\server\index.js --open
```

Without `--open` the URL is printed and must be opened manually. The server tries ports 8791–8800.

## Tests

```bat
npm test
npm run test:unit
npm run test:integration
```

- Unit tests use synthetic fixtures in temp directories.
- Integration tests read the real installation and **never write to it**.
- If `mb_warband.exe` is missing, integration tests are skipped with a reason, not failed.

Expected Phase 2 result: **74 passing**.

## CLI tools

```bat
:: Build / warm the index for every module
node tools\build-index.js

:: One module (exact id or slug)
node tools\build-index.js --module "Viking Conquest"

:: Ignore the cache (cold run, useful for benchmarking)
node tools\build-index.js --no-cache

:: Inspect a BRF file
node tools\inspect-brf.js "C:\Games\...\CommonRes\armors_g.brf"

:: Serialize a BRF into workspace/ (optionally patch a mesh material)
node tools\export-brf.js "C:\Games\...\CommonRes\armors_g.brf" --workspace demo
node tools\export-brf.js "C:\Games\...\CommonRes\armors_g.brf" --workspace demo ^
     --mesh mail_shirt_a --material test_material

:: Regenerate the item-flag table from the official Module System header
node tools\generate-item-flags.js --header "C:\...\Module_system 1.171\header_items.py"
```

## Project files

```
projects/        project JSON (user data)
backups/         automatic project backups
cache/           BRF index cache (derived, safe to delete)
workspace/       working copies written by the engine (BRF exports, backups)
config/profiles.json  local installation profiles (created on first run)
```

`cache/`, `projects/*.json`, `backups/`, `workspace/*` and `config/profiles.json` are git-ignored.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "No installation detected" | Check `config/app.json`; use forward slashes; or set `WARBAND_DIR`. `/api/status` lists every probed path. |
| Port in use | The server automatically tries the next port; read the printed URL. |
| `MODULE_NOT_FOUND` | The module folder has no `item_kinds1.txt` (e.g. a broken module). Check the folder name. |
| Slow first load | Cold BRF parse (~0.5 s). The cache makes subsequent loads fast. Delete `cache/*.json` to force a rebuild. |
| Text shows `_` instead of spaces | Expected: Warband stores spaces as `_`; a display formatter is Phase 1. |
| Accented strings look wrong | `Native/strings.txt` has 2 CP1252 bytes. The engine detects encoding per file; do not re-save it as UTF-8. |
| Node too old | `node -v` must be 22 or newer. |

## Safety rules for contributors

1. Never add code that writes into the game installation in Phase 0/1.
2. Any new parser needs unit tests **and** an integration test against real files.
3. Any new validation rule needs a stable code and a test.
4. A new module in `engine/` must not import from `backend/` or `frontend/`.
5. Keep `npm test` green and dependency-free.

## Where things live

| Need | File |
|---|---|
| Engine facade | `engine/index.js` |
| BRF reader | `engine/resources/brf.js` |
| Item reader/writer | `engine/items/itemKinds.js` |
| Cross-file index | `engine/resources/brfIndex.js` |
| Validation rules | `engine/validation/rules.js` |
| Project storage | `engine/projects/projectStore.js` |
| Installation profiles | `engine/installation/profileStore.js` |
| Workspace lifecycle | `engine/resources/workspace.js` |
| Asset index API | `engine/index.js` (`listResources`, `getResourceDetail`) |
| Backup API | `projectStore.listBackups/restoreBackup`, `workspace.listBackups/restoreBackup` |
| HTTP routes | `backend/api/routes.js` |
| UI | `frontend/js/app.js` |
