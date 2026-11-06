#!/usr/bin/env node
/**
 * Dump the structure of one BRF file. Development aid for the engine.
 *
 *   node tools/inspect-brf.js "C:/Games/.../CommonRes/armors_g.brf"
 */

import { parseBrfFile } from '../engine/resources/brf.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/inspect-brf.js <file.brf>');
  process.exit(1);
}

const doc = await parseBrfFile(file);
console.log(`file: ${file}`);
console.log(`version: ${doc.version}`);
console.log(`bytes: ${doc.bytesRead}/${doc.fileBytes}`);
console.log(`counts: ${JSON.stringify(doc.counts)}`);
console.log(`token order: ${doc.tokenOrder.join(' → ')}`);
console.log('\nmeshes:');
for (const mesh of doc.meshes) {
  console.log(`  ${mesh.name.padEnd(38)} material=${mesh.material.padEnd(28)} v${mesh.vertexVersion} ` +
    `verts=${mesh.vertexCount} faces=${mesh.faceCount} lod=${mesh.nameInfo.lodLevel} piece=${mesh.nameInfo.pieceIndex}`);
}
if (doc.materials.length) {
  console.log('\nmaterials:');
  for (const material of doc.materials) {
    console.log(`  ${material.name.padEnd(34)} shader=${material.shader.padEnd(22)} diffuseA=${material.diffuseA} bump=${material.bump}`);
  }
}
if (doc.textures.length) {
  console.log('\ntextures:');
  for (const texture of doc.textures) {
    console.log(`  ${texture.name} (frames=${texture.frames})`);
  }
}
