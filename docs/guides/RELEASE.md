# Building a release

```bat
npm run release
```

The default output is `dist/warband-outfit-studio-<version>/`. It contains:

- `engine/`, `backend/`, `frontend/`, `docs/`
- `WARBand Outfit Studio.cmd`
- `runtime/node.exe` (unless `--no-runtime`)
- `config/app.example.json`
- empty `projects/`, `workspace/`, `cache/`, `backups/`
- `BUILD-INFO.json`

Options:

```bat
node tools/build-release.js --out "D:\Release\Warband Studio"
node tools/build-release.js --no-runtime
```

`--no-runtime` produces a smaller folder that requires Node.js 22+ on `PATH`.
The default bundles the current `node.exe` and a runtime notice, so the target
machine needs no developer toolchain.

## Verification

`tests/integration/release.test.js`:

1. builds a `--no-runtime` release in a temporary folder;
2. checks the launcher, server, engine, frontend, config, docs and writable
   directories;
3. imports the release server and requests `/api/health`.

The release uses the same zero-dependency stack; no `npm install` is required.

## Distribution notes

- The project writes only below its own folder by default.
- `config/app.example.json` is a template; the first-run wizard or known-path
  detection handles installation registration.
- If Node is bundled, keep `runtime/NODE-RUNTIME.txt` with the distribution.
- Builds are still workspace artifacts; live game deployment is manual.
