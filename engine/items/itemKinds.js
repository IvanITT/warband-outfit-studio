// @ts-check
/**
 * Reader for `item_kinds1.txt` ("itemsfile version 3").
 *
 * VERIFIED against `process_items.py` (Module System 1.171) and the Native
 * file:
 *
 *   itemsfile version 3
 *   <record count>
 *    itm_<id> <name> <plural> <n_meshes> (<mesh> <modifierBits>)*n
 *      <flags> <capabilities> <value> <modifierBits>
 *      <weight> <abundance> <headArmor> <bodyArmor> <legArmor> <difficulty>
 *      <hitPoints> <speedRating> <missileSpeed> <weaponLength> <maxAmmo>
 *      <thrustDamage> <swingDamage>
 *    <n_factions>
 *    [<faction id>...]
 *    <n_triggers>
 *    [<trigger line>...]
 *    <blank separator>
 *
 * `capabilities` is a 64-bit bitmask and therefore is kept as a decimal string
 * (JavaScript numbers lose precision above 2^53).
 *
 * The item slot is the low nibble of `flags` (itp_type_*).
 */

import { readTextFile, joinLinesCrlf } from '../util/textFile.js';

export const ITEM_TYPE = Object.freeze({
  0x0: 'none',
  0x1: 'horse',
  0x2: 'one_handed',
  0x3: 'two_handed',
  0x4: 'polearm',
  0x5: 'arrows',
  0x6: 'bolts',
  0x7: 'shield',
  0x8: 'bow',
  0x9: 'crossbow',
  0xa: 'thrown',
  0xb: 'goods',
  0xc: 'head',
  0xd: 'body',
  0xe: 'foot',
  0xf: 'hand',
  0x10: 'pistol',
  0x11: 'musket',
  0x12: 'bullets',
  0x13: 'animal',
  0x14: 'book',
});

const ARMOR_SLOTS = new Set(['head', 'body', 'foot', 'hand']);

/**
 * @typedef {Object} ItemMeshRef
 * @property {string} name
 * @property {number} modifierBits
 */

/**
 * @typedef {Object} ItemRecord
 * @property {number} index
 * @property {number} line
 * @property {string} id
 * @property {string} name
 * @property {string} plural
 * @property {number} flags
 * @property {string} capabilities
 * @property {number} value
 * @property {number} modifierBits
 * @property {number} weight
 * @property {number} abundance
 * @property {number} headArmor
 * @property {number} bodyArmor
 * @property {number} legArmor
 * @property {number} difficulty
 * @property {number} hitPoints
 * @property {number} speedRating
 * @property {number} missileSpeed
 * @property {number} weaponLength
 * @property {number} maxAmmo
 * @property {number} thrustDamage
 * @property {number} swingDamage
 * @property {ItemMeshRef[]} meshes
 * @property {number[]} factions
 * @property {string[]} triggers
 * @property {string} slot      head | body | foot | hand | <weapon type>
 * @property {boolean} isArmor
 * @property {string} category  armor | clothing | cape | other
 * @property {{header:string,factionsCount:string,factionIds:string,triggersCount:string,triggers:string[],separator:string|null}} raw
 */

/**
 * @typedef {Object} ItemDocument
 * @property {string} file
 * @property {string} format       e.g. "itemsfile version 3"
 * @property {number} declaredCount
 * @property {ItemRecord[]} items
 * @property {string[]} trailingLines
 * @property {string} encoding
 */

/**
 * Classify an item for the studio. Slot is VERIFIED from the flags nibble;
 * the clothing/cape categories are LIKELY heuristics documented in
 * docs/warband-analysis/FORMAT-MAP.md.
 * @param {number} flags
 * @param {string} id
 * @param {string} name
 * @param {number} bodyArmor
 */
export function classifyItem(flags, id, name, bodyArmor) {
  const type = ITEM_TYPE[flags & 0xf] ?? 'unknown';
  if (!ARMOR_SLOTS.has(type)) {
    return { slot: type, isArmor: false, category: 'other' };
  }
  let category = 'armor';
  if (type === 'body') {
    if (/cape|cloak/i.test(id) || /cape|cloak/i.test(name)) category = 'cape';
    else if (bodyArmor === 0) category = 'clothing';
  }
  return { slot: type, isArmor: true, category };
}

/**
 * @param {string} line
 * @param {number} lineNumber
 */
function parseHeader(line, lineNumber) {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 4 || !tokens[0].startsWith('itm_')) {
    throw new Error(`item_kinds1.txt:${lineNumber}: expected an itm_ record, got '${line.trim().slice(0, 60)}'`);
  }

  const meshCount = Number(tokens[3]);
  if (!Number.isInteger(meshCount) || meshCount < 0 || meshCount > 64) {
    throw new Error(`item_kinds1.txt:${lineNumber}: invalid mesh count ${tokens[3]}`);
  }
  const statStart = 4 + meshCount * 2;
  if (tokens.length < statStart + 17) {
    throw new Error(`item_kinds1.txt:${lineNumber}: expected ${statStart + 17} fields, got ${tokens.length}`);
  }

  /** @type {ItemMeshRef[]} */
  const meshes = [];
  for (let i = 0; i < meshCount; i += 1) {
    meshes.push({ name: tokens[4 + i * 2], modifierBits: Number(tokens[5 + i * 2]) });
  }

  const nums = tokens.slice(statStart, statStart + 17).map(Number);
  if (nums.some((n) => Number.isNaN(n))) {
    throw new Error(`item_kinds1.txt:${lineNumber}: non-numeric stat field`);
  }

  return {
    id: tokens[0],
    name: tokens[1],
    plural: tokens[2],
    meshes,
    flags: nums[0],
    capabilities: tokens[statStart + 1],
    value: nums[2],
    modifierBits: nums[3],
    weight: nums[4],
    abundance: nums[5],
    headArmor: nums[6],
    bodyArmor: nums[7],
    legArmor: nums[8],
    difficulty: nums[9],
    hitPoints: nums[10],
    speedRating: nums[11],
    missileSpeed: nums[12],
    weaponLength: nums[13],
    maxAmmo: nums[14],
    thrustDamage: nums[15],
    swingDamage: nums[16],
  };
}

/**
 * Parse `item_kinds1.txt`.
 * @param {string} filePath
 * @returns {Promise<ItemDocument>}
 */
export async function parseItemKindsFile(filePath) {
  const { lines, encoding } = await readTextFile(filePath);
  if (lines.length < 2) throw new Error('item_kinds1.txt: file is empty');

  const format = lines[0].trim();
  if (!format.startsWith('itemsfile version')) {
    throw new Error(`item_kinds1.txt: unsupported header '${format}'`);
  }
  const declaredCount = Number(lines[1].trim());
  if (!Number.isInteger(declaredCount) || declaredCount < 0) {
    throw new Error(`item_kinds1.txt: invalid record count '${lines[1]}'`);
  }

  /** @type {ItemRecord[]} */
  const items = [];
  let cursor = 2;

  for (let index = 0; index < declaredCount; index += 1) {
    if (cursor >= lines.length) {
      throw new Error(`item_kinds1.txt: expected ${declaredCount} records, found ${index}`);
    }
    const headerLine = lines[cursor];
    const headerLineNumber = cursor + 1;
    const parsed = parseHeader(headerLine, headerLineNumber);
    cursor += 1;

    if (cursor >= lines.length) throw new Error(`item_kinds1.txt:${headerLineNumber}: missing faction count`);
    const factionsCount = Number(lines[cursor].trim());
    if (!Number.isInteger(factionsCount) || factionsCount < 0) {
      throw new Error(`item_kinds1.txt:${cursor + 1}: invalid faction count '${lines[cursor]}'`);
    }
    const factionsCountRaw = lines[cursor];
    cursor += 1;

    /** @type {number[]} */
    const factions = [];
    let factionIdsRaw = '';
    if (factionsCount > 0) {
      if (cursor >= lines.length) throw new Error(`item_kinds1.txt:${headerLineNumber}: missing faction ids`);
      factionIdsRaw = lines[cursor];
      factions.push(...factionIdsRaw.trim().split(/\s+/).filter(Boolean).map(Number));
      if (factions.length !== factionsCount) {
        throw new Error(`item_kinds1.txt:${cursor + 1}: expected ${factionsCount} factions, got ${factions.length}`);
      }
      cursor += 1;
    }

    if (cursor >= lines.length) throw new Error(`item_kinds1.txt:${headerLineNumber}: missing trigger count`);
    const triggerCount = Number(lines[cursor].trim());
    if (!Number.isInteger(triggerCount) || triggerCount < 0) {
      throw new Error(`item_kinds1.txt:${cursor + 1}: invalid trigger count '${lines[cursor]}'`);
    }
    const triggersCountRaw = lines[cursor];
    cursor += 1;

    /** @type {string[]} */
    const triggers = [];
    for (let t = 0; t < triggerCount; t += 1) {
      if (cursor >= lines.length) throw new Error(`item_kinds1.txt:${headerLineNumber}: missing trigger ${t + 1}`);
      triggers.push(lines[cursor]);
      cursor += 1;
    }

    let separator = null;
    if (cursor < lines.length && lines[cursor].trim() === '') {
      separator = lines[cursor];
      cursor += 1;
    }

    const classification = classifyItem(parsed.flags, parsed.id, parsed.name, parsed.bodyArmor);

    items.push({
      index,
      line: headerLineNumber,
      id: parsed.id,
      name: parsed.name,
      plural: parsed.plural,
      flags: parsed.flags,
      capabilities: parsed.capabilities,
      value: parsed.value,
      modifierBits: parsed.modifierBits,
      weight: parsed.weight,
      abundance: parsed.abundance,
      headArmor: parsed.headArmor,
      bodyArmor: parsed.bodyArmor,
      legArmor: parsed.legArmor,
      difficulty: parsed.difficulty,
      hitPoints: parsed.hitPoints,
      speedRating: parsed.speedRating,
      missileSpeed: parsed.missileSpeed,
      weaponLength: parsed.weaponLength,
      maxAmmo: parsed.maxAmmo,
      thrustDamage: parsed.thrustDamage,
      swingDamage: parsed.swingDamage,
      meshes: parsed.meshes,
      factions,
      triggers,
      ...classification,
      raw: {
        header: headerLine,
        factionsCount: factionsCountRaw,
        factionIds: factionIdsRaw,
        triggersCount: triggersCountRaw,
        triggers,
        separator,
      },
    });
  }

  return {
    file: filePath,
    format,
    declaredCount,
    items,
    trailingLines: lines.slice(cursor),
    encoding,
  };
}

/**
 * Render one item header the same way `process_items.py` does.
 * @param {ItemRecord} item
 */
export function renderItemHeader(item) {
  const parts = [
    ' itm_' + item.id.replace(/^itm_/, ''),
    item.name,
    item.plural,
    String(item.meshes.length),
  ];
  for (const mesh of item.meshes) parts.push(mesh.name, String(mesh.modifierBits));
  parts.push(
    String(item.flags),
    item.capabilities,
    String(item.value),
    String(item.modifierBits),
    formatFixed(item.weight),
    String(item.abundance),
    String(item.headArmor),
    String(item.bodyArmor),
    String(item.legArmor),
    String(item.difficulty),
    String(item.hitPoints),
    String(item.speedRating),
    String(item.missileSpeed),
    String(item.weaponLength),
    String(item.maxAmmo),
    String(item.thrustDamage),
    String(item.swingDamage),
  );
  return parts.join(' ');
}

/** Module System float formatting (`%f`). */
function formatFixed(value) {
  return Number(value).toFixed(6);
}

/**
 * Serialize an item document.
 *
 * By default every untouched record is emitted from its original raw lines, so
 * loading and saving a vanilla file is byte-for-byte identical. If a record has
 * been modified in memory, pass `{ rerender: (item) => boolean }` to opt into
 * re-rendering its header.
 *
 * @param {ItemDocument} doc
 * @param {{ eol?: string, rerender?: (item: ItemRecord) => boolean }} [options]
 * @returns {string}
 */
export function serializeItemDocument(doc, options = {}) {
  const eol = options.eol ?? '\r\n';
  const rerender = options.rerender ?? (() => false);
  const lines = [doc.format, String(doc.items.length)];
  for (const item of doc.items) {
    lines.push(rerender(item) ? renderItemHeader(item) : item.raw.header);
    lines.push(item.raw.factionsCount);
    if (item.raw.factionIds) lines.push(item.raw.factionIds);
    lines.push(item.raw.triggersCount);
    for (const trigger of item.raw.triggers) lines.push(trigger);
    if (item.raw.separator !== null) lines.push(item.raw.separator);
  }
  lines.push(...doc.trailingLines);
  return eol === '\r\n' ? joinLinesCrlf(lines) : lines.join(eol) + eol;
}

