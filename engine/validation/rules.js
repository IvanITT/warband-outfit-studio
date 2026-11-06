// @ts-check
/**
 * Validation rule catalogue.
 *
 * Codes are stable and meant to be consumed by the UI and by future CI tools.
 * "VERIFIED" rules are grounded in the Warband format analysis; heuristics are
 * marked in the description.
 */

export const SEVERITY = Object.freeze({
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
});

export const RULES = Object.freeze({
  'WB-E-001': {
    severity: SEVERITY.ERROR,
    title: 'Missing mesh',
    description: 'The item references a mesh that does not exist in any loaded BRF (base, LOD or piece).',
  },
  'WB-E-002': {
    severity: SEVERITY.ERROR,
    title: 'Missing material',
    description: 'A mesh references a material that is not defined in any loaded BRF.',
  },
  'WB-E-003': {
    severity: SEVERITY.ERROR,
    title: 'Missing texture reference',
    description: 'A material references a texture name that no BRF declares.',
  },
  'WB-E-004': {
    severity: SEVERITY.ERROR,
    title: 'Missing texture file',
    description: 'A BRF declares a texture but the corresponding .dds file is not on disk.',
  },
  'WB-E-005': {
    severity: SEVERITY.ERROR,
    title: 'Invalid DDS file',
    description: 'The texture file exists but its DDS header cannot be parsed.',
  },
  'WB-E-006': {
    severity: SEVERITY.ERROR,
    title: 'Duplicate asset identifier',
    description: 'The project defines two assets with the same name.',
  },
  'WB-W-001': {
    severity: SEVERITY.WARNING,
    title: 'Mesh without geometry',
    description: 'The resolved mesh has zero vertices or zero faces.',
  },
  'WB-W-002': {
    severity: SEVERITY.WARNING,
    title: 'Armor value is zero',
    description: 'An armor-slot item declares no protection value for its slot.',
  },
  'WB-W-003': {
    severity: SEVERITY.WARNING,
    title: 'Missing shader',
    description: 'The material uses a shader that no loaded BRF declares (the engine falls back to a default).',
  },
  'WB-W-004': {
    severity: SEVERITY.WARNING,
    title: 'LOD chain gap',
    description: 'A LOD level exists but an earlier level is missing.',
  },
  'WB-W-005': {
    severity: SEVERITY.WARNING,
    title: 'Unknown item slot',
    description: 'The item type nibble is not one of the known itp_type_* values.',
  },
  'WB-I-001': {
    severity: SEVERITY.INFO,
    title: 'Composed mesh (pieces only)',
    description: 'The item mesh is built from `.N` pieces without a base mesh. This is a valid Warband convention.',
  },
  'WB-I-002': {
    severity: SEVERITY.INFO,
    title: 'Glove pair',
    description: 'Glove items reference the `_L` mesh; the `_R` counterpart is detected separately.',
  },
  'WB-I-003': {
    severity: SEVERITY.INFO,
    title: 'No normal map',
    description: 'The material has no bump/normal map. Common in vanilla assets.',
  },
  'WB-I-004': {
    severity: SEVERITY.INFO,
    title: 'Animated texture',
    description: 'The texture is animated; numbered page files are expected.',
  },
});

/**
 * @param {keyof typeof RULES} code
 * @param {string} message
 * @param {object} [extra]
 */
export function issue(code, message, extra = {}) {
  const rule = RULES[code];
  if (!rule) throw new Error(`Unknown validation code ${code}`);
  return { code, severity: rule.severity, title: rule.title, message, ...extra };
}
