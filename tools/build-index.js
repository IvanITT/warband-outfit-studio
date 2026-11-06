#!/usr/bin/env node
/**
 * Pre-build the WARBand Engine index (items + BRF + textures) for one or all
 * modules. Useful before opening the UI, and as a smoke test of the engine.
 *
 *   node tools/build-index.js
 *   node tools/build-index.js --module "Viking Conquest"
 *   node tools/build-index.js --no-cache
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../engine/index.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const useCache = !args.includes('--no-cache');
const requested = valueOf('--module');

console.log('WARBand Engine — index builder');
const engine = await createEngine({ projectRoot, cache: useCache });
const status = engine.getStatus();
if (!status.ok) {
  console.error('No Warband installation detected.');
  for (const candidate of status.candidates) console.error(`  ${candidate.valid ? '✓' : '·'} ${candidate.path}`);
  process.exit(1);
}
console.log(`Installation: ${status.installation.rootPath}`);
console.log(`Version: ${status.installation.version ?? 'unknown'}`);
console.log(`Modules: ${engine.modules.map((module) => module.id).join(', ')}\n`);

const targets = requested
  ? engine.modules.filter((module) => module.id === requested || module.slug === requested)
  : engine.modules;

if (targets.length === 0) {
  console.error(`Module '${requested}' not found.`);
  process.exit(1);
}

for (const module of targets) {
  const started = performance.now();
  try {
    const summary = await engine.getModuleSummary(module.id);
    console.log(`✓ ${module.id}`);
    console.log(`    items: ${summary.items.total} (${summary.items.armor} wearables)`);
    console.log(`    BRF: ${summary.resources.brfFiles} files, ${summary.resources.meshes} meshes, ` +
      `${summary.resources.materials} materials, ${summary.resources.textures} textures`);
    console.log(`    parse errors: ${summary.resources.parseErrors} · cache hits: ${summary.resources.cachedFiles}`);
    console.log(`    ${Math.round(performance.now() - started)} ms\n`);
  } catch (error) {
    console.error(`✗ ${module.id}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
