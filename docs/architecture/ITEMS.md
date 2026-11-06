# Item editor (Phase 7)

The **Prendas → Editar ítem** form edits an item record as a project override,
validates its mesh references and exports a merged `item_kinds1.txt` into a
workspace. The game installation is read-only.

![Item editor](assets/items-phase7.png)

## 1. Editable model

`engine.getItemEditable(module, id)` returns the complete item record plus
decoded symbols:

```json
{
  "item": {
    "id": "itm_mail_shirt",
    "name": "Mail_Shirt",
    "plural": "Mail_Shirts",
    "flags": 16842765,
    "capabilities": "0",
    "value": 1040,
    "modifierBits": 0,
    "weight": 19,
    "bodyArmor": 37,
    "meshes": [{ "name": "mail_shirt_a", "modifierBits": 0 }],
    "factions": [], "triggers": []
  },
  "flags": { "type": { "name": "itp_type_body_armor" }, "...": "..." },
  "capabilities": { "value": "0", "flags": [] }
}
```

`engine.getItemSchema()` exposes the generated symbol table: item types,
attachment modes, independent flags, carry/shoot enums and capabilities.
`GET /api/item-schema` is loaded once by the form.

Fields exposed by the form:

- identity: `id`, `name`, `plural`;
- `flags` (with an item-type selector) and `capabilities` (decimal 64-bit);
- `value`, `modifierBits`, `weight`, `abundance`;
- head/body/leg armor, difficulty, hit points, speed, missile speed, length,
  ammo, thrust and swing damage;
- mesh references and per-mesh modifier bits;
- factions and triggers are preserved from the base record and are not edited
  in this phase.

## 2. Validation

`engine.validateItemOverride` rejects:

| Code | Rule |
|---|---|
| `INVALID_ITEM` | malformed id, empty/whitespace name or plural |
| `INVALID_ITEM` | non-numeric or out-of-range stats |
| `INVALID_ITEM` | capabilities that are not a 0…2⁶⁴−1 decimal string |
| `INVALID_ITEM` | more than 64 mesh references |
| `INVALID_ITEM` | mesh name that does not resolve in the module |
| `INVALID_ITEM` | unknown item type nibble |
| `INVALID_ITEM` | duplicate id (module or another project override) |
| `INVALID_ITEM` | changing the id of an existing item |
| `INVALID_ITEM` | editing the same base item twice in one project |

Existing ids are immutable. A **new** item can choose its id; ids must match
`^itm_[a-z0-9_]+$`. New records start from a body-armor template and may have no
meshes until one is added.

## 3. Project overrides

`project.items[]` entries:

```json
{
  "schemaVersion": 1,
  "id": "itm_mail_shirt",
  "baseItemId": "itm_mail_shirt",
  "mode": "edit",
  "moduleId": "Native",
  "fields": { "name": "Edited_Mail_Shirt", "...": "..." },
  "meshes": [{ "name": "mail_shirt_a", "modifierBits": 0 }],
  "factions": [],
  "triggers": [],
  "updatedAt": "..."
}
```

For a new item, `baseItemId` is `null` and `mode` is `create`. Saving replaces
the override with the same item id; the project is backed up by
`ProjectStore`. Deleting an override requires typing its id.

## 4. Export

`engine.exportItemOverrides(projectId)`:

1. loads the original item document;
2. replaces each overridden base record with merged fields;
3. appends new records;
4. re-renders only touched headers (`renderItemHeader`);
5. preserves untouched raw headers, factions and triggers;
6. serializes `itemsfile version 3`;
7. writes `workspace/item-edits/item_kinds1.txt`.

The output is a workspace copy only; it is **not** deployed to the game.
Re-exporting updates the same workspace file and backs up its previous revision.

**VERIFIED:** editing `itm_mail_shirt` and adding `itm_test_new_armor` produces a
621-record file when Native starts at 620; parsing the result restores the
edited name/body armor and the new record; the source
`Modules/Native/item_kinds1.txt` SHA-256 is unchanged.

## 5. UI

In **Prendas**:

- select an item and click **Editar ítem**;
- choose/create a project in the form;
- edit fields and mesh references;
- **Guardar override** stores the project record;
- **Previsualizar en outfit** opens the Phase 6 outfit view with the base item
  in its slot;
- **Exportar items** writes the merged file;
- **Eliminar override** removes the record with typed confirmation;
- **Cerrar** returns to the item detail.

**+ Nuevo** opens a blank item form. New items can be saved and exported but
cannot be previewed through the module index until the exported file is
deployed and the index is rebuilt; the form reports this limitation.

## 6. API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/item-schema` | generated flag/type/capability symbol table |
| GET | `/api/items/:id/editable?module=` | full editable record + decoded symbols |
| GET/POST | `/api/projects/:id/items` | list/save item overrides |
| GET/DELETE | `/api/projects/:id/items/:itemId` | load/delete (typed confirmation) |
| POST | `/api/projects/:id/items/export` | merge and write a workspace `item_kinds1.txt` |

## 7. Limits

- Existing item ids cannot be changed; create a new item instead.
- Factions and triggers are preserved, not edited.
- Item deletion is not exposed; only project overrides can be removed.
- Preview uses the base module item, so edited mesh refs/names are not visible
  until export + module reload.
- No Module System `.py` output yet; the compiled `item_kinds1.txt` is written.
- Text is written as UTF-8 with CRLF; CP1252/UTF-8 byte identity is preserved
  for untouched records because their raw headers are reused.
