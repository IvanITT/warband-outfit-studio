// @ts-check
/** Outfit clipping analysis from world-space bounding boxes. */

/**
 * @typedef {{min:number[],max:number[]}} Bbox
 * @typedef {{slot:string,itemId:string,bbox:Bbox|null}} OutfitItem
 */

/** @param {Bbox} a @param {Bbox} b */
function intersectionVolume(a, b) {
  const dx = Math.max(0, Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]));
  const dy = Math.max(0, Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]));
  const dz = Math.max(0, Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]));
  return dx * dy * dz;
}

/** @param {Bbox} b */
function volume(b) {
  return Math.max(0, b.max[0] - b.min[0]) * Math.max(0, b.max[1] - b.min[1]) * Math.max(0, b.max[2] - b.min[2]);
}

/**
 * @param {{ bodyBbox: Bbox|null, items: OutfitItem[] }} input
 */
export function analyzeOutfitClipping(input) {
  /** @type {Array<{severity:'warning'|'error'|'info', code:string, message:string, slot?:string}>} */
  const issues = [];
  const items = input.items.filter((item) => item.itemId);

  if (!input.bodyBbox) {
    issues.push({ severity: 'error', code: 'WB-O-001', message: 'Body bounds are unavailable.' });
    return { issues, summary: { errors: 1, warnings: 0 } };
  }

  for (const item of items) {
    if (!item.bbox) {
      issues.push({
        severity: 'error',
        code: 'WB-O-002',
        message: `Cannot compute bounds for ${item.itemId} (${item.slot}).`,
        slot: item.slot,
      });
      continue;
    }
    if (intersectionVolume(item.bbox, input.bodyBbox) <= 0) {
      issues.push({
        severity: 'warning',
        code: 'WB-O-003',
        message: `${item.itemId} (${item.slot}) does not intersect the body bounds — it may be detached or mis-scaled.`,
        slot: item.slot,
      });
    }
  }

  for (let a = 0; a < items.length; a += 1) {
    for (let b = a + 1; b < items.length; b += 1) {
      const first = items[a];
      const second = items[b];
      if (!first.bbox || !second.bbox) continue;
      // Armor legitimately encloses the body, arms and neck; body-vs-item
      // bounding boxes are not a useful clipping signal.
      if (first.slot === 'body' || second.slot === 'body') continue;
      const overlap = intersectionVolume(first.bbox, second.bbox);
      if (overlap <= 0) continue;
      const smaller = Math.min(volume(first.bbox), volume(second.bbox)) || 1;
      const ratio = overlap / smaller;
      if (ratio > 0.15) {
        issues.push({
          severity: 'warning',
          code: 'WB-O-004',
          message: `${first.itemId} (${first.slot}) and ${second.itemId} (${second.slot}) overlap ${(ratio * 100).toFixed(0)}% — possible clipping.`,
          slot: first.slot,
        });
      }
    }
  }

  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  return { issues, summary: { errors, warnings } };
}
