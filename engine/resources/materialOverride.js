// @ts-check
/**
 * Material overrides (Phase 5).
 *
 * A material override edits a BRF material entry and references textures by
 * name. Exporting merges the material into a copy of the source BRF inside
 * `workspace/` and copies the referenced DDS files next to it.
 */

import { parseBrf, serializeBrf } from './brf.js';

export const MATERIAL_FIELDS = [
  'shader', 'diffuseA', 'diffuseB', 'bump', 'enviro', 'spec',
];

/**
 * @param {any} override
 * @returns {string[]}
 */
export function validateMaterialOverride(override) {
  const issues = [];
  if (!override?.source?.material) issues.push('source.material is required');
  if (!override?.source?.brf) issues.push('source.brf is required');
  const fields = override?.fields;
  if (!fields || typeof fields !== 'object') {
    issues.push('fields are required');
    return issues;
  }
  for (const key of MATERIAL_FIELDS) {
    if (fields[key] !== undefined && typeof fields[key] !== 'string') {
      issues.push(`${key} must be a string`);
    }
  }
  if (fields.shader !== undefined && !fields.shader) issues.push('shader cannot be empty');
  for (const key of ['specular', 'r', 'g', 'b']) {
    if (fields[key] !== undefined) {
      const value = Number(fields[key]);
      if (!Number.isFinite(value)) issues.push(`${key} must be a finite number`);
      if ((key === 'r' || key === 'g' || key === 'b') && (value < 0 || value > 255)) {
        issues.push(`${key} must be between 0 and 255`);
      }
    }
  }
  if (fields.flags !== undefined && (!Number.isInteger(fields.flags) || fields.flags < 0)) {
    issues.push('flags must be a non-negative integer');
  }
  return issues;
}

/**
 * Apply the override to a parsed BRF document.
 * @param {import('./brf.js').BrfDocument} doc
 * @param {any} override
 */
export function applyMaterialOverride(doc, override) {
  const material = doc.materials.find((candidate) => candidate.name === override.source.material);
  if (!material) {
    const error = new Error(`Material '${override.source.material}' was not found in the source BRF.`);
    // @ts-expect-error machine-readable
    error.code = 'MATERIAL_NOT_FOUND';
    throw error;
  }
  const f = override.fields;
  if (f.shader !== undefined) material.shader = f.shader;
  if (f.diffuseA !== undefined) material.diffuseA = f.diffuseA;
  if (f.diffuseB !== undefined) material.diffuseB = f.diffuseB;
  if (f.bump !== undefined) material.bump = f.bump;
  if (f.enviro !== undefined) material.enviro = f.enviro;
  if (f.spec !== undefined) {
    material.spec = f.spec;
    material.specPresent = Boolean(f.spec && f.spec !== 'none');
  }
  if (f.specular !== undefined) material.specular = Number(f.specular);
  if (f.r !== undefined) material.r = Number(f.r);
  if (f.g !== undefined) material.g = Number(f.g);
  if (f.b !== undefined) material.b = Number(f.b);
  if (f.flags !== undefined) material.flags = Number(f.flags);
  material.dirty = true;
  return material;
}

/**
 * Merge a material override into a source BRF buffer.
 * @param {Buffer} sourceBuffer
 * @param {any} override
 * @param {{ file?: string }} [options]
 */
export function applyMaterialOverrideToBrf(sourceBuffer, override, options = {}) {
  const issues = validateMaterialOverride(override);
  if (issues.length > 0) {
    const error = new Error(`Material override is invalid: ${issues.join('; ')}`);
    // @ts-expect-error machine-readable
    error.code = 'INVALID_MATERIAL_OVERRIDE';
    throw error;
  }
  const doc = parseBrf(sourceBuffer, options);
  const material = applyMaterialOverride(doc, override);
  return { doc, material, buffer: serializeBrf(doc, sourceBuffer) };
}

/** @param {any} fields */
export function referencedTextures(fields) {
  const names = new Set();
  for (const key of ['diffuseA', 'diffuseB', 'bump', 'enviro', 'spec']) {
    const value = fields[key];
    if (value && value !== 'none') names.add(value.replace(/\.dds$/i, ''));
  }
  return [...names];
}
