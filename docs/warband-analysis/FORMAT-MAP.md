# Warband format map for clothing and armor

This document is the bridge between the REA analysis and the studio's data model.
Every claim is labelled:

- **VERIFIED** — reproduced against the installed game and/or the official Module System source.
- **LIKELY** — consistent with evidence but not controlled/experimentally confirmed.
- **UNKNOWN** — not investigated.
- **REQUIRES FURTHER RESEARCH**.

## 1. The pipeline

```
3D asset (artist)
    ↓ import
Mesh  (BRF "mesh", with material name)
    ↓ references
Material (BRF "material": shader + texture names)
    ↓ references
Texture (BRF "texture": .dds file name)
    ↓ resolves to
.dds file (Textures/)
    ↓ is referenced by
Item (item_kinds1.txt: mesh name + stats + flags)
    ↓ belongs to
Module (module.ini + all compiled .txt + assets)
    ↓ loaded by
Mount & Blade: Warband
```

**VERIFIED**: the five entities and their reference direction, for `itm_mail_shirt`:

| Step | Value | Found in |
|---|---|---|
| Item | `itm_mail_shirt` | `Modules/Native/item_kinds1.txt` |
| Mesh | `mail_shirt_a` | `CommonRes/armors_g.brf` |
| Material | `mail_shirt_a` | `CommonRes/materials.brf` |
| Textures | `mail_shirt_a.dds`, `_normalmap`, `_specular` | `CommonRes/textures.brf` |
| Files | same names | `Textures/*.dds` (1024×1024) |

## 2. Where each piece lives

| Concept | File | Notes | Confidence |
|---|---|---|---|
| Item definition | `Modules/<Mod>/item_kinds1.txt` | compiled text; slot in `flags & 0xF` | VERIFIED |
| Mesh / material / texture / shader | `*.brf` | global `CommonRes/` **and** module `Resource/` | VERIFIED |
| Texture files | `Textures/` (global) and `Modules/<Mod>/Textures/` | module wins over global | VERIFIED |
| Scene | `SceneObj/*.sco` | not part of the clothing chain | VERIFIED |
| Item source | `module_items.py` | requires the external Module System (Python 2) | VERIFIED |

A single item's chain can span **three different BRF files**. `armors_g.brf` contains only meshes; `materials.brf` only materials; `textures.brf` only textures. The engine (and the studio) therefore must merge every loaded BRF into one namespace.

## 3. Slots

Warband has no separate cape/clothing/accessory slot. The only wearable slots are:

| Slot | Type nibble | Armor field used |
|---|---|---|
| Head / helmet | `0xC` | `headArmor` |
| Body / clothing / cape | `0xD` | `bodyArmor` |
| Foot / boots | `0xE` | `legArmor` |
| Hand / gloves | `0xF` | `bodyArmor` |

- "Clothing" = body item with `bodyArmor == 0`. **LIKELY** (heuristic; some clothing may have small values).
- "Cape" = body item whose id/name contains `cape`/`cloak`. **LIKELY** (no engine flag).
- Gloves reference the `_L` mesh; the `_R` counterpart exists as a separate mesh. **VERIFIED** by names; the engine mirroring behaviour is **LIKELY** (not traced in the binary).

## 4. Mesh naming conventions

| Suffix | Meaning | Confidence |
|---|---|---|
| `.lod1`, `.lod2`, `.lod3` | level of detail | VERIFIED (engine + OpenBRF) |
| `.1`, `.2`, … | extra piece of a composed item | VERIFIED (engine + real files) |
| `.lodN.M` | LOD + piece | VERIFIED (real files) |
| `bo_` | collision body | VERIFIED (OpenBRF `IsNamedAsBody`) |
| `_L` / `_R` | left/right glove | LIKELY |
| `_f` / female variants | not used by Native armor | UNKNOWN |

A mesh resolves when the base **or any piece** exists. A composed item without a base mesh is valid.

## 5. Materials and textures

- A material has `diffuseA`, optional `diffuseB`, `bump`, `enviro`, `spec`, plus shader and colour/specular values. **VERIFIED** (BRF layout).
- Texture references in materials omit `.dds`; the BRF texture table includes it. **VERIFIED**.
- Materials often live in a shared pack (`materials.brf`) while meshes live in per-category packs (`armors_b..i.brf`, `helmets*.brf`, etc.). **VERIFIED**.
- The same material name can appear in more than one loaded BRF; the first loaded wins in the engine. **LIKELY** (load order by `module.ini`). The studio indexes all sources and shows the first.

## 6. What is not modelled yet

- **Item flags semantics** (`itp_*`, `itc_*`, `itcf_*`): raw values are exposed; symbolic decoding is Phase 1.
- **`modifierBits`** (item modifiers) and mesh `modifierBits`: parsed but not interpreted.
- **Skin/body/rigging relationship**: the mesh is rigged to a skeleton; the studio does not yet expose bones or weights.
- **Collision bodies (`bo_`)**: skipped.
- **3D preview**: no geometry is loaded yet; only counts.

## 7. Verification commands

```bat
node tools/build-index.js --module Native
node tools/inspect-brf.js "C:\Games\...\CommonRes\armors_g.brf"
npm test
```

The integration suite asserts the real counts: 7 243 meshes, 633 materials, 734 textures, 139 shaders; 620 items, 279 wearables.
