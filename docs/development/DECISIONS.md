# Technical decisions (ADRs)

## ADR-001 — Node.js 22 + native ESM

**Decision:** implement the engine, the server and the tooling in Node.js 22 with ES modules. No transpiler.

**Context:** Node 22.19 is already installed on the target machine; REA also runs on Node. The engine needs fast binary parsing and filesystem access, and the UI needs a local server.

**Consequences:** one language for engine/backend/tools; no build step; JSDoc + `// @ts-check` provides editor type checking. TypeScript was rejected for Phase 0 because Node 22 does not strip types natively without flags, and adding a compiler toolchain would slow the build/feedback loop.

## ADR-002 — Zero runtime dependencies

**Decision:** no npm packages at runtime. Backend uses `node:http`; tests use `node:test`; frontend uses browser APIs.

**Context:** the application must work offline and be maintainable for years; Warband modding tools have a long tail and dependency rot is a real risk.

**Consequences:** ~0 install time, no supply-chain surface, trivial packaging. Cost: we implement routing, static serving and DOM helpers ourselves (small, auditable).

## ADR-003 — Read-only game access, separate workspace

**Decision:** the engine never writes inside the installation. Projects, cache and backups live in the repository.

**Rationale:** §10 of the project brief. A bug must never corrupt a game install.

**Consequences:** export/deploy needs a dedicated, explicitly confirmed subsystem (Phase 3) with hash-recording and dry-run validation.

## ADR-004 — Own BRF parser instead of shelling out to OpenBRF

**Decision:** implement the BRF reader in `engine/resources/brf.js` from the verified format, not by invoking OpenBRF.

**Context:** the tool must run headless, index 219 files in under a second and be testable. OpenBRF is a Qt GUI application (GPL) and cannot be embedded.

**Consequences:** we own the parser and its tests. The format knowledge was derived from the OpenBRF source (GPL) as documentation; no code was copied. BRF **writing** is deferred; if needed, it will be implemented from the same spec.

## ADR-005 — Persistent per-file BRF cache

**Decision:** cache parsed BRF summaries in `cache/brf-index-v2-<install>-<module>.json`, keyed by file size + mtime + parser version.

**Measured:** 147.5 MB / 219 files → ~0.5 s cold, ~0.2 s warm (including app startup and index merge).

**Consequences:** first launch is slightly slower; subsequent launches are instant. The cache is safe to delete; a corrupt cache is ignored.

## ADR-006 — Vanilla frontend, no framework

**Decision:** HTML + CSS + ES modules, no React/Vue/Svelte, no bundler.

**Rationale:** Phase 0 has a small number of views; a framework would add build complexity without solving a real problem. The UI is not the reusable asset — the engine is.

**Consequences:** DOM helpers are hand-written; when the 3D viewport and complex editors arrive (Phase 2), we can introduce a small local library **only if** it demonstrably reduces complexity. Three.js will be vendored locally (no CDN) to keep offline operation.

## ADR-007 — Local-only HTTP server on 127.0.0.1

**Decision:** bind to loopback, random fallback ports, no authentication.

**Rationale:** the app is single-user and local; authentication would be security theatre. Binding to loopback prevents network exposure.

**Consequences:** do not run on a shared/public interface. CSP and path-traversal protection are enabled anyway.

## ADR-008 — JSON project format with schema version

**Decision:** projects are human-readable JSON with `schemaVersion` and stable ids.

**Rationale:** diffable, inspectable, migration-friendly; no database.

**Consequences:** large binary assets are referenced by path, not embedded. Phase 1 will add asset import/copy rules.

## ADR-009 — Version detection from `rgl_log.txt`

**Decision:** report the engine version from `rgl_log.txt` (`Version: 1.170`), not from the executable's file version (which is `1.0.0.0`).

**Rationale:** the PE version resource is not the game build. The engine writes its own version to the log.

**Consequences:** if the log is missing/stale, version is `null` and the UI shows "unknown"; the analysis docs record the expected value.

## ADR-010 — Validation codes are part of the public contract

**Decision:** stable codes (`WB-E-001`, ...) with severity + entity, independent of wording.

**Rationale:** the UI, tests and future CI must be able to assert behaviour without parsing messages.

**Consequences:** adding a rule is additive; changing a code is a breaking change.

## Open decisions for Phase 1

- Whether to port the Module System compiler to Python 3 / JS, or to shell out to Python 2.7.
- How to model item flags symbolically (generated table from `header_items.py`).
- Whether the 3D viewport uses Three.js or a minimal WebGL renderer.
- Project asset storage: copy-on-import vs reference-in-place (needs a checksum policy).
