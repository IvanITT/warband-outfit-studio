# `item_kinds1.txt` format

**Status: VERIFIED** from `process_items.py` (Module System 1.171), the REA analysis, and byte-perfect round-trip tests against all three installed modules.

```
itemsfile version 3
<record count>

 itm_<id> <name> <plural> <n_meshes> (<mesh> <modifierBits>)*n
   <flags> <capabilities> <value> <modifierBits>
   <weight> <abundance> <headArmor> <bodyArmor> <legArmor> <difficulty>
   <hitPoints> <speedRating> <missileSpeed> <weaponLength> <maxAmmo>
   <thrustDamage> <swingDamage>
 <n_factions>
 [<faction id>...]
 <n_triggers>
 [<trigger line>...]
 <blank separator>
```

- `capabilities` is a **64-bit** bitmask and must be kept as a decimal string in JavaScript (> 2^53).
- `weight` is written with `%f` (six decimals). `serializeItemDocument` reproduces untouched records from their raw lines, so the round-trip is byte-for-byte identical.
- The `n_factions` count and the faction ids are on separate lines; the ids line is omitted when the count is zero.
- Each trigger line is one simple trigger: `<period:float> <statement count> <opcode> <argc> <args>...`.

## Item type (low nibble of `flags`)

| Value | Type | Wearable |
|---:|---|---|
| 0x0 | none / invalid | no |
| 0x1 | horse | no |
| 0x2 | one handed | no |
| 0x3 | two handed | no |
| 0x4 | polearm | no |
| 0x5 | arrows | no |
| 0x6 | bolts | no |
| 0x7 | shield | no |
| 0x8 | bow | no |
| 0x9 | crossbow | no |
| 0xA | thrown | no |
| 0xB | goods | no |
| **0xC** | **head armor** | **yes** |
| **0xD** | **body armor** | **yes** |
| **0xE** | **foot armor** | **yes** |
| **0xF** | **hand armor** | **yes** |
| 0x10–0x12 | pistol / musket / bullets | no |
| 0x13–0x14 | animal / book | no |

The studio defines "wearable" as slots `head`, `body`, `foot`, `hand`. Verified counts in Native: 113 head, 132 body, 28 foot, 6 hand.

## Armor values

The stats block stores **already unpacked** values (the Module System packs them in `module_items.py` using `weight()`, `body_armor()`, etc.):

- `headArmor` → used by head items
- `bodyArmor` → used by body **and hand** items (gloves use the body armor value, e.g. `itm_leather_gloves` = 2)
- `legArmor` → used by foot items

## Categories (studio heuristics)

| Category | Rule | Confidence |
|---|---|---|
| `armor` | wearable slot with its slot armor value > 0 | VERIFIED (semantics) |
| `clothing` | body slot and `bodyArmor == 0` | LIKELY — name/value heuristic, not an engine flag |
| `cape` | body slot and id/name contains `cape` or `cloak` | LIKELY — Warband has no separate cape slot; capes are body armor items |

There is **no** `itp_type_cape`; `itm_coat_with_cape`, `itm_cloaked_tunic` and `itm_tunic_with_green_cape` are ordinary body armor records.

## Mesh references and naming

`n_meshes` usually is 1. The item references a **base mesh name**; Warband resolves LODs and pieces by naming convention:

| Pattern | Meaning |
|---|---|
| `mail_shirt_a` | base mesh |
| `mail_shirt_a.lod1`, `.lod2`, `.lod3` | LOD levels |
| `common_tulbent_b.1`, `.2` | extra pieces of a composed item |
| `common_tulbent_b.lod1.2` | LOD 1, piece 2 |
| `leather_gloves_L` / `_R` | left/right glove pair (the item references the `_L` mesh; `_R` is separate) |
| `bo_<name>` | collision body mesh (not an item mesh) |

A mesh name resolves if **either** the base mesh **or** any piece exists. `itm_sarranid_felt_head_cloth_b` references `common_tulbent_b`, which only exists as `.1` and `.2` pieces — a valid composed item. This case is reported as INFO `WB-I-001`, not as an error.

## Hardwired records

`module_items.py` warns that the first items are hardwired by the engine and their order must not change. Never reorder or delete low-index item records; append new items at the end.

## Flags reference

The full `itp_*` / `itc_*` / `itcf_*` constants live in the official Module System `header_items.py`. The studio currently exposes the raw `flags` value and the type nibble; a symbolic flag decoder is planned for Phase 1.
