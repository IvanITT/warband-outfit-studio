# Outfit & armor editor (Phase 6)

The **Visor → Outfit** tab composes a shaded character from a real Native body,
attaches head/body/hand/foot items, applies per-slot offsets, checks obvious
bounding-box problems and stores the result in a project.

![Outfit editor](assets/outfits-phase6.png)

## 1. Character bodies

`engine/skins/skins.js` parses `skins.txt`. Native declares two skins:

| Skin | Body | Calf | Hand | Head | Skeleton |
|---|---|---|---|---|---|
| `man` | `man_body` | `man_calf_l` | `m_handL` | `male_head` | `skel_human` |
| `woman` | `woman_body` | `woman_calf_l` | `f_handL` | `female_head` | `skel_human` |

The parser consumes every field (face keys, hair/beard meshes, textures,
voices, constraints) so later records stay aligned. **VERIFIED:** Native parses
to exactly two skins and `getCharacter` resolves six parts per body:

```
body · calf_l · calf_r · hand_l · hand_r · head
```

The `_r` counterparts are derived from the `_l` / `L` names and verified to
exist in the BRF index.

## 2. Bind-pose assembly (rigid vs skinned)

Warband meshes use two storage conventions:

1. **Rigged meshes** (`rigging[]` non-empty): positions are already in bind-pose
   character space. `man_body`, body armor, boots and most foot/body items fall
   here.
2. **Rigid meshes** (`rigging[]` empty): positions are bone-local. The head,
   hands, helmets and gloves fall here.

For rigid meshes the engine parses `CommonRes/skeletons.brf`, finds
`skel_human` (20 bones), computes

```
global[bone] = global[parent] × [ x y z t ]
```

and applies the matching global matrix to positions and normals. Bone mapping:

| Role | Bone |
|---|---|
| `hand_l` / `hand_r` | `hand.L` / `hand.R` |
| `calf_l` / `calf_r` | `calf.L` / `calf.R` |
| `head` | `head` |
| head item | `head` |
| hand item ending `_L` / `_R` | `hand.L` / `hand.R` |
| body/foot item | no transform (rigged) |

**VERIFIED:** `male_head` raw bbox `y = -0.109…0.133`; after the head matrix it
is `y = 1.497…1.824`. `mail_shirt_a` is already at the torso and is unchanged.
Matrices are cached per engine process.

Items with multiple visual pieces are expanded to the base mesh plus all
`.N` pieces at LOD 0. LODs are excluded. Gloves load both `_L` and `_R`.

## 3. Slots and transforms

| Slot | Accepts | Notes |
|---|---|---|
| `body` | body armor, clothing, capes | one body item; cape is a body item in Native |
| `head` | helmets, hats, hoods | |
| `hand` | gloves, gauntlets, mittens | both L/R meshes |
| `foot` | boots, shoes, greaves | |

One item per slot. The editor exposes per-slot `x/y/z` translation and uniform
`scale`; values are stored in `transforms` and applied to the slot group.

**Preset** fills every slot with the first available item of that slot. It is a
starting point, not a curated historical outfit.

## 4. Outfit record

```json
{
  "schemaVersion": 1,
  "id": "knight-demo",
  "name": "Knight Demo",
  "moduleId": "Native",
  "bodySkin": "man",
  "entries": {
    "body": "itm_mail_shirt",
    "head": "itm_helmet_with_neckguard",
    "hand": "itm_leather_gloves",
    "foot": "itm_leather_boots"
  },
  "transforms": {
    "head": { "x": 0, "y": 0.02, "z": 0, "scale": 1 }
  },
  "updatedAt": "2026-11-06T..."
}
```

Outfits live in `project.outfits[]`. Saving validates:
- required `id`, `name`, `moduleId`;
- every referenced item exists in the module;
- each item's slot matches its entry key;
- transform values are finite.

Deleting requires the exact outfit id as confirmation (ADR-019).

## 5. Clipping report

`engine/outfit/clipping.js` implements the accepted simple heuristic:

1. **Detached item** (`WB-O-003`): the item bbox does not intersect the body
   bbox at all.
2. **Pair overlap** (`WB-O-004`): two non-body items overlap by more than 15%
   of the smaller bbox volume.

Missing item/body bounds produce errors `WB-O-002` / `WB-O-001`.

Body-vs-item overlap is deliberately **not** reported: armor normally encloses
the arms and neck, so a shirt/glove bbox overlap is expected. This is a
bounding-box heuristic, not a surface collision test (ADR-033).

## 6. Viewport and snapshot

Outfit mode hides the single-mesh edit bar and shows a group with the body and
equipped items. Camera framing uses the combined bbox; grid/wireframe/V-flip
apply to the outfit materials and geometry. **Exportar PNG** renders the current
view synchronously and downloads `outfit-<slug>.png`; this is a browser
download, not yet a workspace artifact.

## 7. API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/skins?module=` | parse `skins.txt` |
| GET | `/api/characters?module=&skin=man` | resolved body parts |
| GET | `/api/outfit-items/:id/meshes?module=` | item base/pieces/glove pair |
| GET | `/api/meshes/:name/outfit-render?module=&slot=&role=` | posed rigid mesh arrays |
| POST | `/api/outfits/analyze` | `{ bodyBbox, items[] } → issues` |
| GET/POST | `/api/projects/:id/outfits` | list/save outfits |
| GET/DELETE | `/api/projects/:id/outfits/:outfitId` | load/delete (confirmation) |

The pose endpoint returns `posed: { bone, applied }`, so callers can verify
whether a mesh was rigid or skinned.

## 8. Verification

- **108/108** tests pass; new suites cover skins, outfit persistence and
  clipping.
- `man` and `woman` resolve six parts each.
- `leather_gloves` → `leather_gloves_L` + `_R`, helmet → `neckguard_helm_new`,
  mail shirt → `mail_shirt_a`.
- UI: `Knight Demo` (11 pieces) saved, reloaded and analyzed with **0** warnings;
  screenshot captured.
- Snapshot export produced a 56,713-byte PNG.
- Game installation was read-only; no BRF, item or texture was modified.

## 9. Limitations

- Bind pose only; no animation, IK, skeleton rotation or weight editing.
- Rigid/skinned classification relies on empty `rigging[]`, verified on Native
  but not traced through the game executable.
- One item per slot; no layered garments, separate cape slot or female-specific
  armor retargeting.
- Body armor is shown on both skins without reshaping; the female fit is
  approximate.
- Clipping is bbox-only and can miss real surface intersections.
- Snapshot is a browser download; it is not tracked by projects.
- Glove `_L`/`_R` mirroring is still classified **LIKELY** (F-07), although
  loading both sides is verified to produce a complete pair.
