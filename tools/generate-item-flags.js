#!/usr/bin/env node
/**
 * Generate the offline item-flag symbol table from the official Warband
 * Module System `header_items.py`.
 *
 * Usage:
 *   node tools/generate-item-flags.js --header "C:/path/Module_system 1.171/header_items.py"
 *
 * The generated file is committed so the application never needs Python.
 * Field masks (type, attachment, carry, shoot) are the ones declared by the
 * same header (`itp_attachment_mask`, `itcf_carry_mask`, `itcf_shoot_mask`).
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const headerPath = (() => {
  const index = process.argv.indexOf('--header');
  return index >= 0 ? process.argv[index + 1] : null;
})();

if (!headerPath) {
  console.error('usage: node tools/generate-item-flags.js --header <header_items.py>');
  process.exit(1);
}

const text = await readFile(headerPath, 'utf8');
const sha256 = createHash('sha256').update(text).digest('hex');

/** @type {Array<{name:string,value:bigint}>} */
const constants = [];
for (const line of text.split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(0x[0-9A-Fa-f]+|\d+)\s*(?:#.*)?$/);
  if (!match) continue;
  constants.push({ name: match[1], value: BigInt(match[2]) });
}

const TYPE_MASK = constants.find((c) => c.name === 'itp_type_mask')?.value ?? 0x1fn; // types go up to 0x14
const ATTACH_MASK = constants.find((c) => c.name === 'itp_attachment_mask')?.value ?? 0xf00n;
const CARRY_MASK = constants.find((c) => c.name === 'itcf_carry_mask')?.value ?? 0x7f0000000n;
const SHOOT_MASK = constants.find((c) => c.name === 'itcf_shoot_mask')?.value ?? 0xff000n;

function isMaskOrBits(name) {
  return /_mask$|_bits$/.test(name);
}

function hex(value) {
  return `0x${value.toString(16).toUpperCase()}`;
}

/**
 * @param {typeof constants} list
 * @param {bigint} fieldMask
 * @param {boolean} allowFieldMask
 */
function pickFieldValues(list, fieldMask, allowFieldMask = true) {
  const values = list.filter((c) => {
    if (isMaskOrBits(c.name)) return false;
    if ((c.value & ~fieldMask) !== 0n) return false;
    if (c.value === 0n) return false;
    if (!allowFieldMask && c.value === fieldMask) return false;
    return true;
  });
  return dedupe(values);
}

/**
 * Group constants by value, keeping declaration order for the canonical name.
 * @param {typeof constants} list
 */
function dedupe(list) {
  /** @type {Map<string,{name:string,value:bigint,aliases:string[]}>} */
  const byValue = new Map();
  for (const entry of list) {
    const key = entry.value.toString();
    const existing = byValue.get(key);
    if (existing) existing.aliases.push(entry.name);
    else byValue.set(key, { name: entry.name, value: entry.value, aliases: [] });
  }
  return [...byValue.values()].map((entry) => ({
    name: entry.name,
    value: entry.value.toString(),
    hex: hex(entry.value),
    aliases: entry.aliases,
  }));
}

const itp = constants.filter((c) => c.name.startsWith('itp_'));
const itc = constants.filter((c) => c.name.startsWith('itc_') || c.name.startsWith('itcf_'));

const types = dedupe(itp.filter((c) => c.name.startsWith('itp_type_')));
const attachmentValues = pickFieldValues(itp, ATTACH_MASK);
const carryValues = pickFieldValues(itc, CARRY_MASK);
const shootValues = pickFieldValues(itc, SHOOT_MASK);

function isItpFieldValue(value) {
  return (value & ATTACH_MASK) !== 0n && (value & ~ATTACH_MASK) === 0n;
}

function isItcFieldValue(value) {
  const inCarry = (value & CARRY_MASK) !== 0n && (value & ~CARRY_MASK) === 0n;
  const inShoot = (value & SHOOT_MASK) !== 0n && (value & ~SHOOT_MASK) === 0n;
  return inCarry || inShoot;
}

function isSingleBit(value) {
  return value !== 0n && (value & (value - 1n)) === 0n;
}

const flags = dedupe(
  itp.filter(
    (c) => !c.name.startsWith('itp_type_')
      && !isMaskOrBits(c.name)
      && !isItpFieldValue(c.value)
      && isSingleBit(c.value),
  ),
);

const capabilities = dedupe(
  itc.filter((c) => !isMaskOrBits(c.name) && !isItcFieldValue(c.value) && isSingleBit(c.value)),
);

const output = {
  source: path.basename(headerPath),
  sourceSha256: sha256,
  generatedAt: new Date().toISOString(),
  generator: 'tools/generate-item-flags.js',
  note: 'Generated from the official Module System header_items.py. Do not edit by hand.',
  fields: {
    type: { mask: TYPE_MASK.toString(), hex: hex(TYPE_MASK) },
    attachment: { mask: ATTACH_MASK.toString(), hex: hex(ATTACH_MASK) },
    carry: { mask: CARRY_MASK.toString(), hex: hex(CARRY_MASK) },
    shoot: { mask: SHOOT_MASK.toString(), hex: hex(SHOOT_MASK) },
  },
  types,
  attachment: attachmentValues,
  flags,
  carry: carryValues,
  shoot: shootValues,
  capabilities,
};

const outDir = path.join(projectRoot, 'engine', 'items', 'generated');
await mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, 'itemFlags.json');
await writeFile(outFile, JSON.stringify(output, null, 2) + '\n', 'utf8');

console.log(`wrote ${outFile}`);
console.log(`  source: ${output.source} (${sha256.slice(0, 12)}…)`);
console.log(`  types=${types.length} flags=${flags.length} attachment=${attachmentValues.length}`);
console.log(`  carry=${carryValues.length} shoot=${shootValues.length} capabilities=${capabilities.length}`);
