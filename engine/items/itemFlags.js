// @ts-check
/**
 * Symbolic decoding of item `flags` and `capabilities`.
 *
 * The table is generated offline from the official Module System
 * `header_items.py` and committed to `generated/itemFlags.json`, so runtime
 * never needs Python.
 *
 * Field semantics (VERIFIED from header_items.py):
 *   - item type is an enum in the low bits (`itp_type_*`, mask 0x1F)
 *   - attachment mode is an enum (`itp_attachment_mask` = 0xF00)
 *   - carry position is an enum (`itcf_carry_mask` = 0x7F000000)
 *   - shooting mode is an enum (`itcf_shoot_mask` = 0xFF000)
 *   - everything else is a set of independent single-bit flags
 *
 * Enums must be decoded as fields, never as independent bits: `0x300` is
 * "left forearm", not "left hand + right hand".
 */

import { readFileSync } from 'node:fs';

/** @type {any} */
const table = JSON.parse(readFileSync(new URL('./generated/itemFlags.json', import.meta.url), 'utf8'));

const TYPE_MASK = BigInt(table.fields.type.mask);
const ATTACH_MASK = BigInt(table.fields.attachment.mask);
const CARRY_MASK = BigInt(table.fields.carry.mask);
const SHOOT_MASK = BigInt(table.fields.shoot.mask);

/**
 * @typedef {Object} DecodedSymbol
 * @property {string} name
 * @property {string} hex
 * @property {string[]} aliases
 */

/**
 * @typedef {Object} DecodedFlags
 * @property {string} value        decimal input
 * @property {string} hex
 * @property {DecodedSymbol|null} type
 * @property {DecodedSymbol|null} attachment
 * @property {DecodedSymbol[]} flags
 * @property {string|null} unknownHex
 */

/**
 * @typedef {Object} DecodedCapabilities
 * @property {string} value
 * @property {string} hex
 * @property {DecodedSymbol|null} carry
 * @property {DecodedSymbol|null} shoot
 * @property {DecodedSymbol[]} flags
 * @property {string|null} unknownHex
 */

/** @param {string|number|bigint} value */
export function toBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  return BigInt(value);
}

/** @param {bigint} value */
export function hex(value) {
  return `0x${value.toString(16).toUpperCase()}`;
}

/**
 * @param {Array<{name:string,value:string,hex:string,aliases:string[]}>} list
 * @returns {Map<string, {name:string,value:bigint,hex:string,aliases:string[]}>}
 */
function indexByValue(list) {
  return new Map(list.map((entry) => [entry.value, { ...entry, value: BigInt(entry.value) }]));
}

const typesByValue = indexByValue(table.types);
const attachmentByValue = indexByValue(table.attachment);
const carryByValue = indexByValue(table.carry);
const shootByValue = indexByValue(table.shoot);

/** @param {Array<{name:string,value:string,hex:string,aliases:string[]}>} list */
function indexBits(list) {
  return list.map((entry) => ({ ...entry, value: BigInt(entry.value) }));
}

const flagBits = indexBits(table.flags);
const capabilityBits = indexBits(table.capabilities);

/**
 * @param {{name:string,value:bigint,hex:string,aliases:string[]}} entry
 * @returns {DecodedSymbol}
 */
function symbol(entry) {
  return { name: entry.name, hex: entry.hex, aliases: entry.aliases };
}

/**
 * @param {string|number|bigint} raw
 * @returns {DecodedFlags}
 */
export function decodeItemFlags(raw) {
  let remaining = toBigInt(raw);
  const original = remaining;

  const type = typesByValue.get((remaining & TYPE_MASK).toString()) ?? null;
  remaining &= ~TYPE_MASK;

  const attachment = attachmentByValue.get((remaining & ATTACH_MASK).toString()) ?? null;
  remaining &= ~ATTACH_MASK;

  const flags = [];
  for (const entry of flagBits) {
    if ((remaining & entry.value) === entry.value) {
      flags.push(symbol(entry));
      remaining &= ~entry.value;
    }
  }

  return {
    value: original.toString(),
    hex: hex(original),
    type: type ? symbol(type) : null,
    attachment: attachment ? symbol(attachment) : null,
    flags,
    unknownHex: remaining === 0n ? null : hex(remaining),
  };
}

/**
 * @param {string|number|bigint} raw
 * @returns {DecodedCapabilities}
 */
export function decodeCapabilities(raw) {
  let remaining = toBigInt(raw);
  const original = remaining;

  const carry = carryByValue.get((remaining & CARRY_MASK).toString()) ?? null;
  remaining &= ~CARRY_MASK;

  const shoot = shootByValue.get((remaining & SHOOT_MASK).toString()) ?? null;
  remaining &= ~SHOOT_MASK;

  const flags = [];
  for (const entry of capabilityBits) {
    if ((remaining & entry.value) === entry.value) {
      flags.push(symbol(entry));
      remaining &= ~entry.value;
    }
  }

  return {
    value: original.toString(),
    hex: hex(original),
    carry: carry ? symbol(carry) : null,
    shoot: shoot ? symbol(shoot) : null,
    flags,
    unknownHex: remaining === 0n ? null : hex(remaining),
  };
}

/** Metadata for documentation and tests. */
export const flagTable = {
  source: table.source,
  sourceSha256: table.sourceSha256,
  generatedAt: table.generatedAt,
  counts: {
    types: table.types.length,
    flags: table.flags.length,
    attachment: table.attachment.length,
    carry: table.carry.length,
    shoot: table.shoot.length,
    capabilities: table.capabilities.length,
  },
};
