#!/usr/bin/env node
/**
 * Export a BRF into workspace/, optionally changing a mesh material.
 * The game installation is only read.
 *
 *   node tools/export-brf.js "C:/.../CommonRes/armors_g.brf" --workspace demo
 *   node tools/export-brf.js "C:/.../CommonRes/armors_g.brf" --workspace demo \
 *        --mesh mail_shirt_a --material test_material
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../engine/index.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const brfPath = args[0];

function flag(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

if (!brfPath || brfPath.startsWith('--')) {
  console.error('usage: node tools/export-brf.js <file.brf> --workspace <label> [--mesh <name> --material <name>] [--relative <path>]');
  process.exit(1);
}

const engine = await createEngine({ projectRoot });
const status = engine.getStatus();
if (!status.ok) {
  console.error('No Warband installation detected.');
  process.exit(1);
}

const label = flag('--workspace') ?? 'brf-export';
const mesh = flag('--mesh');
const material = flag('--material');
const relativePath = flag('--relative') ?? path.basename(brfPath);

const workspace = await engine.createWorkspace(label, { reuse: true });
const result = await engine.exportBrf(workspace.id, path.resolve(brfPath), {
  relativePath,
  meshPatches: mesh ? [{ mesh, material: material ?? undefined }] : [],
});

console.log(`workspace: ${workspace.id}`);
console.log(`source:    ${result.sourceBrf}`);
console.log(`output:    ${result.file}`);
console.log(`bytes:     ${result.bytes}`);
console.log(`sha256:    ${result.sha256}`);
console.log(`patched:   ${result.patchedMeshes} mesh(es); meshes=${result.meshes} materials=${result.materials}`);
