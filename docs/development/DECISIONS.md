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


## ADR-013 — BRF writer: raw-range copy + dirty re-encode

**Decision:** the writer copies the original byte range of every untouched
object and only re-encodes objects explicitly marked dirty.

**Rationale:** byte-identical round-trips are the strongest possible regression
test, and they let the studio modify one mesh without modelling animations and
collision bodies it does not understand yet. All 219 `CommonRes` BRFs
round-trip exactly.

**Consequences:** the writer needs the original buffer. Dirty animations/bodies
are rejected with a clear error until modelled.

## ADR-014 — Lazy geometry, no cache

**Decision:** geometry is read on demand per mesh, with allocation limits; the
index stores metadata only.

**Rationale:** a module can contain 23k meshes (Viking Conquest); eagerly
loading vertex data would waste hundreds of MB for a UI that displays one item.
The Phase 3 viewport will reveal whether an LRU cache is needed.

**Consequences:** each `getMeshGeometry` re-reads the BRF file. Acceptable for
inspection; revisited when rendering whole outfits.

## ADR-015 — Workspaces are the only write target

**Decision:** all generated bytes go through `WorkspaceStore`; it rejects
absolute/traversal paths, writes atomically, and backs up overwritten files with
a SHA-256 record.

**Rationale:** §10 of the project brief; a bug must never corrupt the game.

**Consequences:** Phase 8 deployment will build on the same store rather than a
new write path.

## ADR-016 — Commit the generated flag table, no runtime Python

**Decision:** `tools/generate-item-flags.js` produces
`engine/items/generated/itemFlags.json`; the file is committed with source
SHA-256 and generator metadata.

**Rationale:** the app must run offline without Python 2; regenerating is a
deliberate developer action.

**Consequences:** update the table when adopting a newer Module System; tests
assert its shape and a few real decodes.

## ADR-017 — Enums are decoded as fields, not bits

**Decision:** item type, attachment, carry and shoot are decoded as masked
enums before single-bit flags.

**Rationale:** VERIFIED from `header_items.py`: e.g. `0x30000000` is one carry
mode, not two flags. A bit-only decoder silently produces wrong labels.

**Consequences:** decoding needs the field masks; unknown field values are
reported as unknown rather than decomposed.

## ADR-018 — Profiles live in machine-local config

**Decision:** installation profiles are stored in `config/profiles.json`
(git-ignored); the active profile drives the engine.

**Rationale:** the repository must not contain user-specific absolute paths, and
the tool must support several installations. Bootstrap from env/config/known
paths avoids an empty first run.

**Consequences:** cloning the repo never carries a machine path; deleting the
file re-triggers auto-detection.

## ADR-019 — Destructive actions require typed confirmation

**Decision:** profile removal, workspace deletion and backup restore require the
entity id as an explicit `confirm` value. Restores first back up the current
state.

**Rationale:** these operations can destroy work; a boolean dialog is too easy
to click through. The id is visible in the UI and unambiguous.

**Consequences:** API clients must pass the id; the UI prompts for it. Tests
cover wrong-value rejection.

## ADR-020 — Keep every backup in Phase 2

**Decision:** no automatic pruning; all project and workspace backups are kept.

**Rationale:** disk cost is small (JSON/binary snapshots) and recovery matters
more than tidiness. Pruning needs usage evidence and safe policies.

**Consequences:** Phase 9 adds retention and rollback UX; until then the list
may grow.

## ADR-021 — Vendor Three.js instead of loading it at runtime

**Decision:** pin Three.js 0.169.0 under `frontend/vendor/three/`, including its
MIT licence; no CDN or package install.

**Rationale:** the application must work offline, and the dependency surface
must stay auditable. A local copy is a build-time choice, not a runtime service.

**Consequences:** ~1.3 MB in the repository; updates are deliberate and tested.

## ADR-022 — Decode DDS in the browser

**Decision:** the server serves raw DDS bytes; `frontend/js/dds.js` decodes
DXT1/DXT3/DXT5 to RGBA for a `DataTexture`.

**Rationale:** avoids an image-conversion service or native dependency, keeps
the texture pipeline local and lets the UI reuse the same bytes the game uses.
Only the first mip is decoded.

**Consequences:** unsupported DDS variants fall back to material colour; a
larger decoder can replace the module later without touching the engine.

## ADR-023 — Custom orbit controls, no addon or import map

**Decision:** implement orbit/pan/zoom in `viewer-controls.js` instead of
vendoring `OrbitControls`.

**Rationale:** the Three.js addon imports the bare specifier `three`, which
requires an import map (inline script, weakened CSP) or a bundler. The custom
controls are ~100 lines, fully local, and sufficient for inspection.

**Consequences:** no damping/inertia or touch gestures yet; add them if the
viewport becomes a primary workflow.



## ADR-024 — Edit shared positions, not a triangle soup

**Decision:** the editable model keeps the BRF position array and a
`vertexPosition` indirection; transforms move shared positions, faces index
render vertices.

**Rationale:** this preserves UV seams, rigging indices and the original
topology while still allowing per-vertex selection. Rebuilding a flat triangle
mesh would duplicate positions and break rigging.

**Consequences:** moving one vertex moves every UV seam that shares the position
(same as position editing in OpenBRF). Topology operations add positions and
remap explicitly.

## ADR-025 — Project overrides, not edited game files

**Decision:** edits are stored as project overrides that reference the source
BRF; export merges the override into a copy under `workspace/`.

**Rationale:** ?10 safety. The installation is never written; projects can be
versioned/backed up like any other project data.

**Consequences:** overrides carry a full geometry snapshot (base64). A delta
format is a future optimization; export currently writes one changed mesh per
BRF copy.

## ADR-026 — Block vertex-count topology on rigged/framed meshes

**Decision:** duplicate/mirror/extrude/split are rejected on meshes with rigging
or vertex-animation frames; delete/merge and transforms remain available.

**Rationale:** rigging weights reference position indices and frames store
per-position data. Without weight/frame editing, changing counts would corrupt
the asset. This is safer than silently dropping data.

**Consequences:** Phase 5 (weights) can lift the rigging restriction; frame
topology stays blocked until frame editing exists.


## ADR-027 - Material colours are raw 0-255 values

**Decision:** the material editor treats `r/g/b` as 0-255 and preserves
`specular` as a raw float.

**Rationale:** VERIFIED on the installed assets: `mail_shirt_a` stores
`r=g=b=15` and `specular=16`, while other materials use 0 or 228. A 0-1
assumption would corrupt every material with a non-zero colour.

**Consequences:** the colour picker converts 0-255 <-> hex; validation allows
0-255; preview divides by 255 for Three.js.

## ADR-028 - Imported textures live in a workspace and a project registry

**Decision:** DDS imports are written to `workspace/textures/Textures/` and
registered in `project.textures[]`; material overrides reference names.

**Rationale:** the engine must never depend on arbitrary user paths after
import, and exports need deterministic sources. The project registry records
the hash and dimensions.

**Consequences:** deleting a project does not garbage-collect the shared
workspace yet; Phase 9 can add retention.

## ADR-029 - Approximate normal/spec preview

**Decision:** the viewport previews diffuse as `map`, normal as `normalMap`
and the specular map as a `metalnessMap` with a toggle.

**Rationale:** Warband shaders are not available in Three.js; a faithful
reimplementation is out of scope. The approximation is useful for judging
texture orientation and normal-map presence, and is explicitly labelled.

**Consequences:** specular intensity is not physically accurate; Phase 6+
can add a custom shader if the preview becomes a blocker.

## ADR-030 — Native bodies from `skins.txt` and `skel_human`

**Decision:** the outfit editor uses the module's real `skins.txt` and the
`skel_human` skeleton from `CommonRes/skeletons.brf`; it does not substitute a
mannequin.

**Rationale:** real body dimensions are required to judge armor fit and
proportions. Native exposes both `man` and `woman` with six body parts each.
The skeleton file is small, cached per engine process and read-only.

**Consequences:** only skins present in the selected module can be previewed;
custom skeletons need the same `skel_human` bone names for rigid-mesh posing.

## ADR-031 — Bind matrices for rigid meshes, stored positions for skinned meshes

**Decision:** a mesh with no rigging (head, hands, helmets, gloves) is moved
from bone-local space into bind pose with the bone's global matrix. A mesh with
rigging (body, armor, boots) already stores bind-pose positions and is rendered
as authored.

**Rationale:** VERIFIED on Native: `male_head`/`neckguard_helm_new` have empty
`rigging[]` and head-local coordinates; `man_body`/`mail_shirt_a` are rigged and
their raw bboxes already match the torso. Applying bone matrices to skinned
meshes would double-transform them (bbox y rose to ~2.99).

**Consequences:** no runtime skinning or animation; the rigid/skinned branch is
the current approximation and must be revisited when skeleton posing is added.

## ADR-032 — Outfits reference item ids

**Decision:** project `outfits[]` entries store `{ id, name, moduleId,
bodySkin, entries, transforms }` where `entries` contains item ids per slot.

**Rationale:** item records and meshes are already indexed by the engine;
copying them would duplicate data and drift. Validation can re-resolve every
id at load/save time and report missing or wrong-slot items.

**Consequences:** an outfit may become invalid if a module changes; loading
fails with a structured error rather than silently omitting the item.

## ADR-033 — Bounding-box clipping heuristic

**Decision:** clipping reports (a) items whose bbox does not intersect the body
bbox and (b) non-body item pairs whose bbox overlap exceeds 15% of the smaller
volume. Body-vs-item containment is **not** reported.

**Rationale:** armor normally encloses the body, arms and neck; a bbox overlap
between a mail shirt and gloves is expected and not actionable. Mesh-level
collision is out of scope for Phase 6. The heuristic is cheap and catches the
common failure — a detached or mis-scaled accessory.

**Consequences:** false negatives are possible for genuine surface clipping;
Phase 9 can add vertex/triangle proximity without changing the API shape.

## ADR-034 — Item overrides reference a base record; existing ids are immutable

**Decision:** a project `items[]` override may edit an existing record
(`baseItemId` set) or create a new one (`baseItemId: null`). Existing item ids
cannot be changed, and duplicate ids are rejected.

**Rationale:** Warband item ids are referenced by troops, factions, scripts and
dialogs. Renaming one in place would silently break external references, and
duplicate ids make resolution order-dependent. A new id is the safe operation.

**Consequences:** renaming an existing item requires creating a replacement and
migrating references in a later item/deployment phase.

## ADR-035 — Export compiled `item_kinds1.txt` to a workspace

**Decision:** the item editor exports the merged **compiled** item file to
`workspace/item-edits/item_kinds1.txt`; it does not emit Module System `.py`
source and does not deploy to the game.

**Rationale:** the engine already parses/serializes the compiled format with
byte-identical preservation of untouched records. This keeps the export
deterministic and avoids a Python dependency. Deployment remains Phase 8.

**Consequences:** mod authors who maintain `.py` sources must mirror the change
there until a later Module System writer exists.

## ADR-036 — Validate item references, save overrides separately

**Decision:** saving an item override validates its id, numeric ranges,
capability string, flag type and every mesh reference against the module index.
The original installation file is never edited; only the project override and
workspace export are written.

**Rationale:** broken mesh names are the most common item-authoring error and
should be caught before a build. Project overrides also make edits reversible and
backed up like all other project data.

**Consequences:** a new item cannot reference a mesh that has not been indexed
yet (for example, a mesh in an unbuilt BRF); the author must first make the mesh
available to the module.

## ADR-037 — Builds write only to workspaces; deployment stays manual

**Decision:** the Phase 8 builder writes an overlay or a full module copy under
`workspace/`. It never writes into the Warband installation. A full module copy
is the deployable artifact; applying it is a deliberate manual action.

**Rationale:** the project's safety invariant is that the game installation is
read-only. A bug in a build must not be able to corrupt a live module. A
workspace tree can be inspected, backed up and copied deliberately.

**Consequences:** there is no one-click "install into game" action yet. This is
intentional until a later packaging phase and a user-controlled deployment
target exist.

## ADR-038 — Group overrides by source BRF

**Decision:** mesh and material overrides that share a source BRF are applied
sequentially to one buffer and written as one output BRF. Artifacts that target
the same path with different content fail the build.

**Rationale:** writing each override independently would overwrite earlier
changes in the same pack. Grouping reflects how BRF files actually store many
objects.

**Consequences:** a build can report a target collision; the author must resolve
it before writing. Textures with identical content are deduplicated.

## ADR-039 — Full module copies are explicit

**Decision:** overlay mode is the default. A full module copy is an explicit
checkbox/API option because installed modules range from 75 MB to more than
2 GB.

**Rationale:** silently copying multi-gigabyte content on every build is a poor
default; overlays are fast and sufficient for review.

**Consequences:** authors who want a standalone deployable module choose the
full-copy mode; the build manifest records the mode.
