// @ts-check
/** Slug helpers shared by projects and workspaces. */

/**
 * @param {string} value
 * @param {string} [fallback]
 */
export function slugify(value, fallback = 'item') {
  return (
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || fallback
  );
}
