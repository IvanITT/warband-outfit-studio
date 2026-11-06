# Texture & material system (Phase 5)

The **Visor → Material** panel edits a mesh's BRF material, previews it with
diffuse/normal/specular maps and exports an override into `workspace/materials/`.

![Material editor](assets/materials-phase5.png)

## 1. Material model

`engine.getMaterialEditable(module, name)` returns:

```json
{
  "material": { "name": "mail_shirt_a", "brf": "C:/.../materials.brf", "sources": [] },
  "fields": {
    "shader": "specular_shader_skin_bump_high",
    "diffuseA": "mail_shirt_a",
    "diffuseB": "none",
    "bump": "mail_shirt_a_normalmap",
    "enviro": "none",
    "spec": "mail_shirt_a_specular",
    "specular": 16,
    "r": 15, "g": 15, "b": 15,
    "flags": 1824
  },
  "textures": { "diffuseA": { "file": {...}, "dds": {...} }, "bump": {...}, "spec": {...} },
  "shaders": ["...139 names..."],
  "meshes": [ ... ]
}
```

**Field scales (VERIFIED):**

- `r`, `g`, `b` are **0–255**, not 0–1 (e.g. `mail_shirt_a` = 15,15,15).
- `specular` is a raw float (1, 16, 2.5 …), not normalized.
- Texture fields are names without `.dds`; `none` means unused.
- `spec` is optional in the BRF (`LoadStringMaybe`); the editor keeps it as a
  string and writes presence from a non-empty value.

## 2. Editing

The Material panel exposes shader, colour, specular, diffuse/bump/spec names,
normal/spec/alpha/double-sided toggles and preview.

- **Shader select** lists every shader declared by the loaded BRFs (139 in
  Native); the current shader is always included.
- **Colour picker** converts 0–255 ⇄ hex.
- **Textures** are names; the datalist includes project textures and current
  values. The viewport resolves them from the module or the project.
- **Import DDS** writes the file into `workspace/textures/Textures/`, validates
  the header, registers it in the project and assigns it to the chosen role.
- **Guardar material** stores a project override; **Cargar** restores it;
  **Exportar material** merges and writes the BRF + textures.

## 3. Preview

| Channel | Implementation |
|---|---|
| Diffuse | DDS decoded client-side → `map`, sRGB |
| Normal | `normalMap` (screen-space tangents; `normalScale` 1) |
| Specular | used as `metalnessMap` with `metalness = 0.6` — an **approximation**, not the game shader |
| Alpha | `transparent` + `depthWrite=false` toggle |
| Sides | `DoubleSide` / `FrontSide` toggle |

Texture decode uses the Phase 3 decoder (DXT1/3/5, BC1–3). Results are cached
per viewer session and disposed when a new mesh is loaded.

## 4. Overrides

Project `materials[]` entry:

```json
{
  "schemaVersion": 1,
  "id": "mail_shirt_a",
  "source": { "moduleId": "Native", "material": "mail_shirt_a", "brf": "C:/.../materials.brf" },
  "fields": { "...": "..." },
  "editedAt": "..."
}
```

Project `textures[]` entry (imported DDS):

```json
{
  "name": "my_texture.dds",
  "workspaceId": "textures",
  "path": "Textures/my_texture.dds",
  "width": 1024, "height": 1024, "format": "DXT5",
  "sha256": "...", "mipmaps": 10
}
```

Validation rejects missing sources, an empty shader, non-finite numbers and
colours outside 0–255.

## 5. Export

1. Read the source BRF (installation guard).
2. Apply fields to the material and mark it dirty.
3. Serialize (untouched objects byte-identical).
4. Write `workspace/materials/<material>.brf`.
5. Copy every referenced texture:
   - project texture → read from its workspace;
   - otherwise resolve from the game installation;
   - write `workspace/materials/Textures/<name>.dds`.

Verified on `mail_shirt_a`: material `r/g/b = 64/128/192`, `specular = 2.5`,
3 textures copied, source SHA-256 unchanged.

## 6. API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/materials/:name/editable?module=` | fields, textures, shaders, meshes |
| GET/POST | `/api/projects/:id/materials` | list/save material overrides |
| GET/DELETE | `/api/projects/:id/materials/:name` | load/delete |
| POST | `/api/projects/:id/materials/:name/export` | merge and write BRF + textures |
| POST | `/api/workspaces/:id/textures` | import a base64 DDS |
| GET/POST | `/api/projects/:id/textures` | list/register project textures |
| DELETE | `/api/projects/:id/textures/:name?confirm=` | remove a texture entry |

## 7. Limits / technical debt

- Preview is an approximation; Warband's shader graph (specular maps, alpha
  modes, shader flags) is not reproduced.
- No texture **editing** (paint/resize/convert); only import/reference.
- Only DXT1/3/5 and BC1–3, first mip.
- Shader parameters/options are not edited, only the shader name.
- No material creation from scratch yet; overrides target existing materials.
- Imported textures are copied to a shared `textures` workspace; project
  deletion does not garbage-collect them.
- `spec` presence is approximated from a non-empty value.
