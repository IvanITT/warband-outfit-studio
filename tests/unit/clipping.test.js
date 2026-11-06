import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeOutfitClipping } from '../../engine/outfit/clipping.js';

const box = (min, max) => ({ min, max });
const body = box([-1, -1, -1], [1, 2, 1]);

test('accepts items contained in the body bounds and ignores body-item pair overlap', () => {
  const result = analyzeOutfitClipping({
    bodyBbox: body,
    items: [
      { slot: 'body', itemId: 'armor', bbox: box([-0.8, -0.5, -0.4], [0.8, 1.2, 0.4]) },
      { slot: 'head', itemId: 'helmet', bbox: box([-0.2, 1.3, -0.2], [0.2, 1.7, 0.2]) },
      { slot: 'hand', itemId: 'gloves', bbox: box([-0.9, 1.2, -0.2], [-0.5, 1.4, 0.2]) },
    ],
  });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.summary, { errors: 0, warnings: 0 });
});

test('reports an item that does not intersect the body bounds', () => {
  const result = analyzeOutfitClipping({
    bodyBbox: body,
    items: [{ slot: 'foot', itemId: 'boots', bbox: box([5, 0, 0], [6, 1, 1]) }],
  });
  assert.equal(result.summary.warnings, 1);
  assert.equal(result.issues[0].code, 'WB-O-003');
});

test('reports overlap between two non-body wearables', () => {
  const result = analyzeOutfitClipping({
    bodyBbox: body,
    items: [
      { slot: 'head', itemId: 'helmet', bbox: box([-0.2, 1.4, -0.2], [0.2, 1.8, 0.2]) },
      { slot: 'hand', itemId: 'gloves', bbox: box([0, 1.4, 0], [0.4, 1.6, 0.4]) },
    ],
  });
  assert.equal(result.summary.warnings, 1);
  assert.equal(result.issues[0].code, 'WB-O-004');
  assert.match(result.issues[0].message, /helmet/);
});

test('reports missing item bounds and missing body bounds', () => {
  const missingItem = analyzeOutfitClipping({
    bodyBbox: body,
    items: [{ slot: 'head', itemId: 'broken', bbox: null }],
  });
  assert.equal(missingItem.issues[0].code, 'WB-O-002');
  assert.equal(missingItem.summary.errors, 1);

  const missingBody = analyzeOutfitClipping({ bodyBbox: null, items: [] });
  assert.equal(missingBody.issues[0].code, 'WB-O-001');
  assert.equal(missingBody.summary.errors, 1);
});
