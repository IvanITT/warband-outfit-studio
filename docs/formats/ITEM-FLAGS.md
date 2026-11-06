# Item flags and capabilities

**Status: VERIFIED** for the field layout, with the symbol table generated from the official Module System `header_items.py` (1.171).

## 1. Where the symbols come from

The engine does not guess flag names. It ships a generated table:

```
engine/items/generated/itemFlags.json
```

Provenance is recorded in the file itself:

- `source`: `header_items.py`
- `sourceSha256`: SHA-256 of the header used
- `generatedAt`, `generator`
- counts for types, flags, attachment, carry, shoot, capabilities

Regenerate after a Module System update (offline, one command):

```bat
node tools/generate-item-flags.js --header "C:\...\Module_system 1.171\header_items.py"
```

Runtime decoding is pure JavaScript and needs no Python.

## 2. Field masks

| Field | Mask | Source | Notes |
|---|---|---|---|
| Item type | `0x1F` | derived | `itp_type_*` values go up to `0x14` (5 bits) |
| Attachment mode | `0xF00` | `itp_attachment_mask` | values `0x100/0x200/0x300/0xF00` |
| Carry position | `0x7F0000000` | `itcf_carry_mask` | values span bits 28–34 |
| Shoot/throw mode | `0xFF000` | `itcf_shoot_mask` | values `0x1000`…`0x80000` |

**Enums are not bits.** `0x300` is `itp_force_attach_left_forearm`, not
“left hand + right hand”. `0x30000000` is `itcf_carry_dagger_front_left`, not
two carry flags. The decoder extracts the field first, then decodes the
remaining single-bit flags.

## 3. API

```js
import { decodeItemFlags, decodeCapabilities } from './engine/items/itemFlags.js';

decodeItemFlags(16842765);
// {
//   value: '16842765', hex: '0x101000D',
//   type: { name: 'itp_type_body_armor', hex: '0xD', aliases: [] },
//   attachment: null,
//   flags: [
//     { name: 'itp_merchandise', hex: '0x10000', aliases: [] },
//     { name: 'itp_covers_legs', hex: '0x1000000',
//       aliases: ['itp_doesnt_cover_hair', 'itp_can_penetrate_shield'] }
//   ],
//   unknownHex: null
// }
```

- Aliases are preserved: several header constants share the same bit and are
  context-dependent (`covers_legs` vs `doesnt_cover_hair` vs
  `can_penetrate_shield`). The canonical name is the first declaration; aliases
  are exposed for tooltips.
- Unknown bits are reported as `unknownHex`, never invented.

## 4. Where it is used

- `engine.getItemDetail()` returns `flags` and `capabilities` decoded.
- The item detail UI shows the type, attachment/carry/shoot fields, flags and
  capabilities as chips, with the raw hex and unknown-bit warnings.
- Tests assert real items (`itm_mail_shirt`, `itm_helmet_with_neckguard`) and the
  enum-vs-bit behaviour.

## 5. Verified examples

| Item | Raw flags | Type | Other |
|---|---|---|---|
| `itm_mail_shirt` | `0x0101000D` | `itp_type_body_armor` | `itp_merchandise`, `itp_covers_legs` |
| `itm_helmet_with_neckguard` | `0x0001000C` | `itp_type_head_armor` | `itp_merchandise` |
| `itm_no_item` | `0x00C00002` | `itp_type_one_handed_wpn` | `itp_primary`, `itp_secondary` |

`capabilities` is `0` for most armor items; weapons use the carry/shoot enums
and the single-bit capability flags.

## 6. Limits

- The table is complete for the constants declared in 1.171; engine-only bits
  (for example the top bit seen in `itm_no_item` capabilities) remain unknown
  and are surfaced as `unknownHex`.
- Damage-type encoding (`cut/pierce/blunt` inside packed stat values) is a
  separate mechanism and is not part of this table.
