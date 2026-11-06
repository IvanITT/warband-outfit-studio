# Mesh editor (Phase 4)

The **Visor** tab now edits real Warband meshes. Edits stay in the project as
overrides and are exported into a **workspace** copy of the BRF; the game
installation is never modified.

![Mesh editor with a selected vertex](assets/mesh-editor-phase4.png)

## 1. Editable model

`frontend/js/mesh-edit.js` keeps the BRF structure instead of a flat triangle
soup:

| Field | Meaning |
|---|---|
| `positions` | shared positions (`x,y,z`), as stored in the BRF |
| `vertexPosition` | per render vertex, index into `positions` |
| `normals`, `uvs` | per render vertex (`uv` raw, V flipped only for display) |
| `indices` | face triplets indexing **render vertices** |
| `color`, `tangent`, `textureIndex`, `uv2` | preserved attributes for serialization |
| `rigging` | per-bone pairs referencing **position indices** |
| `frames` | vertex-animation frames (positions per position, normals per vertex) |

Editing a shared position moves every UV seam that uses it, matching
position-level editing in OpenBRF. Faces index the render-vertex list (VERIFIED
in Phase 3), so moving one vertex does not re-index faces.

## 2. Selection

- Click on the mesh: raycast against the rendered mesh.
- **Vértices**: selects the nearest corner of the hit triangle.
- **Caras**: selects the hit triangle.
- Shift/Ctrl/Meta toggles; clicking empty space clears.
- Overlay: orange points for vertices, translucent orange triangles for faces.
- Dragging (>5 px) orbits instead of selecting.

## 3. Transforms

| Control | Behaviour |
|---|---|
| Mode | move / rotate / scale |
| Axis | X / Y / Z / normal |
| Local | uses the average selected normal as the axis |
| Amount + step | numeric value, snapped to `step` |
| Pivot | centroid of the selected render vertices |

- **Move**: adds `axis * amount` to each selected position once (deduplicated).
- **Rotate**: Rodrigues rotation around the pivot; rotates normals too.
- **Scale**: uniform factor around the pivot.
- **Vertex-animation frames** are transformed together with the bind pose.
- **Rigged meshes**: transforms are allowed (vertex count does not change).

## 4. Topology operations

| Operation | Effect | Guard |
|---|---|---|
| Delete faces | removes selected triangles | allowed on rigged/framed meshes |
| Duplicate | copies selected faces with independent positions/vertices | blocked if rigged or framed |
| Mirror X | duplicates the whole mesh mirrored, reversed winding | blocked if rigged or framed |
| Extrude | per selected face: offset cap + three side quads | blocked if rigged or framed |
| Merge | remaps selected vertices to the first; drops degenerate faces | allowed (count unchanged) |
| Split | unwelds selected faces into new vertices | blocked if rigged or framed |

**Why the guards:** rigged meshes bind weights to position indices, and
vertex-animation frames store per-position data. Changing the vertex/position
count without weight/frame editing would corrupt them. This is the approved
Phase 4 decision; weight interpolation is deferred.

## 5. History

- Up to 25 snapshots in memory; undo/redo; reset to the original.
- Snapshots clone all typed arrays (meshes are small; a 782-vertex armor is a
  few hundred KB).
- Topology operations and undo clear the selection (indices may move).

## 6. Project overrides

`POST /api/projects/:id/meshes` stores an override:

```json
{
  "schemaVersion": 1,
  "id": "mail_shirt_a",
  "source": { "moduleId": "Native", "mesh": "mail_shirt_a", "brf": "C:/.../armors_g.brf" },
  "layout": 1,
  "stats": { "vertices": 782, "faces": 1240, "positions": 622, "frames": 2 },
  "arrays": { "positions": {"type":"Float32Array","count":1866,"data":"..."}, "...": {} },
  "rigging": [ { "boneIndex": 0, "pairs": [ { "vertexIndex": 0, "weight": 1 } ] } ],
  "frames": [ { "time": 0, "positions": {...}, "normals": {...} } ]
}
```

- The project owns the override; the base mesh/BRF is referenced, not modified.
- Saving a project creates the usual automatic backup.
- Loading an override replaces the working model; the original is still one
  **Restablecer** away.

## 7. Export

`POST /api/projects/:id/meshes/:meshId/export`:

1. loads the override;
2. reads the source BRF (installation path guard);
3. replaces the mesh geometry (`replaceMeshGeometry`);
4. serializes the BRF (untouched objects byte-identical);
5. writes `workspace/mesh-edits/<mesh>.brf` (atomic + backup + SHA-256).

Verified on `mail_shirt_a`: exactly **one position** and the corresponding
**frame position** changed, frames preserved, vertex/face counts unchanged,
source SHA-256 unchanged.

## 8. Validation

Before saving, the client checks ranges, finiteness, degenerate faces and
non-empty geometry. The engine re-validates on save (`buildGeometryFromOverride`)
and before export; layout must match the source mesh.

## 9. API added

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/meshes/:name/editable` | editable model arrays + rigging + frames |
| GET | `/api/projects/:id/meshes` | override summaries |
| POST | `/api/projects/:id/meshes` | save/replace an override |
| GET | `/api/projects/:id/meshes/:mesh` | full override |
| DELETE | `/api/projects/:id/meshes/:mesh?confirm=` | delete override |
| POST | `/api/projects/:id/meshes/:mesh/export` | merge and write to workspace |

## 10. Limits / technical debt

- No edge selection or edge loops (vertex + face only, per approval).
- Extrude is per-face; adjacent selected faces keep internal walls.
- No UV editing, weight editing, smoothing or subdivision.
- Overrides store a full geometry snapshot; a delta format is a future
  optimization.
- Meshes with vertex-animation frames allow transforms only.
- Overrides are available from the Visor project controls; outfit/item editing
  has its own project records rather than editing mesh overrides directly.
- No project-level diff/merge UI.
