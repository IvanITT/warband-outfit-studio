// @ts-check
/**
 * Asset-chain validation for clothing/armor items.
 *
 * The chain modelled here is:
 *
 *   Item -> Mesh(es) -> Material -> Texture(s) -> .dds file(s)
 *
 * Every rule must be able to point at the entity that failed (item, mesh,
 * material or texture) so the UI can navigate to it.
 */

import { SEVERITY, issue } from './rules.js';

/**
 * @typedef {Object} ResolvedTexture
 * @property {string} role          diffuseA | diffuseB | bump | enviro | spec
 * @property {string} name
 * @property {boolean} declared      Declared by at least one BRF.
 * @property {string|null} brf
 * @property {import('../resources/textureResolver.js').TextureHit|null} file
 * @property {{width:number,height:number,format:string,mipmaps:number}|null} dds
 * @property {string[]} issues       Rule codes emitted at this node.
 */

/**
 * @typedef {Object} ResolvedMaterial
 * @property {string} name
 * @property {boolean} resolved
 * @property {string|null} brf
 * @property {string|null} shader
 * @property {ResolvedTexture[]} textures
 * @property {string[]} issues
 */

/**
 * @typedef {Object} ResolvedMesh
 * @property {string} name
 * @property {boolean} resolved
 * @property {{baseCount:number,lodLevels:number[],pieceCount:number,vertexVersion:number|null,vertexCount:number,faceCount:number}} geometry
 * @property {string[]} brfFiles
 * @property {ResolvedMaterial|null} material
 * @property {ResolvedMesh|null} pair   `_R` counterpart for gloves.
 * @property {string[]} issues
 */

/**
 * @typedef {Object} ItemChain
 * @property {{id:string,name:string,slot:string,category:string,value:number,armor:{head:number,body:number,leg:number}}} item
 * @property {ResolvedMesh[]} meshes
 * @property {Array<ReturnType<typeof issue>>} issues
 * @property {{errors:number,warnings:number,infos:number}} summary
 */

const TEXTURE_ROLES = [
  ['diffuseA', 'diffuse'],
  ['diffuseB', 'diffuse (secondary)'],
  ['bump', 'normal'],
  ['spec', 'specular'],
  ['enviro', 'environment'],
];

/**
 * @param {ResolvedTexture[]} textures
 * @param {string} role
 */
function findTexture(textures, role) {
  return textures.find((texture) => texture.role === role);
}

/**
 * @param {object} context
 * @param {import('../items/itemKinds.js').ItemRecord} context.item
 * @param {any} context.index
 * @param {any} context.textures
 * @param {Map<string, any>} [context.ddsCache]
 * @param {(filePath:string)=>Promise<any>} [context.readDds]
 * @returns {Promise<ItemChain>}
 */
export async function resolveItemChain(context) {
  const { item, index, textures, ddsCache, readDds } = context;
  /** @type {Array<ReturnType<typeof issue>>} */
  const issues = [];
  /** @type {ResolvedMesh[]} */
  const meshes = [];

  for (const meshRef of item.meshes) {
    const resolution = index.resolveMesh(meshRef.name);
    /** @type {string[]} */
    const meshIssues = [];
    /** @type {string[]} */
    const brfFiles = [...new Set([...resolution.direct, ...resolution.family].map((/** @type {any} */ entry) => entry.brf))];

    const primary = resolution.direct[0] ?? resolution.base[0] ?? resolution.pieces[0] ?? null;

    if (!resolution.exists) {
      issues.push(
        issue('WB-E-001', `Mesh '${meshRef.name}' is not defined in any loaded BRF.`, {
          entity: { type: 'mesh', name: meshRef.name },
        }),
      );
      meshIssues.push('WB-E-001');
      meshes.push({
        name: meshRef.name,
        resolved: false,
        geometry: { baseCount: 0, lodLevels: [], pieceCount: 0, vertexVersion: null, vertexCount: 0, faceCount: 0 },
        brfFiles,
        material: null,
        pair: null,
        issues: meshIssues,
      });
      continue;
    }

    if (resolution.base.length === 0 && resolution.pieces.length > 0) {
      issues.push(
        issue('WB-I-001', `Mesh '${meshRef.name}' is composed of ${resolution.pieces.length} piece(s) with no base mesh.`, {
          entity: { type: 'mesh', name: meshRef.name },
        }),
      );
      meshIssues.push('WB-I-001');
    }

    const lodLevels = [...new Set(resolution.lods.map((/** @type {any} */ entry) => entry.nameInfo.lodLevel))].sort((a, b) => a - b);
    for (let expected = 1; expected <= Math.max(0, ...lodLevels); expected += 1) {
      if (!lodLevels.includes(expected)) {
        issues.push(
          issue('WB-W-004', `Mesh '${meshRef.name}' has LOD ${lodLevels.join(', ')} but is missing LOD ${expected}.`, {
            entity: { type: 'mesh', name: meshRef.name },
          }),
        );
        meshIssues.push('WB-W-004');
        break;
      }
    }

    if (primary && (primary.vertexCount === 0 || primary.faceCount === 0)) {
      issues.push(
        issue('WB-W-001', `Mesh '${primary.name}' has ${primary.vertexCount} vertices and ${primary.faceCount} faces.`, {
          entity: { type: 'mesh', name: primary.name },
        }),
      );
      meshIssues.push('WB-W-001');
    }

    let material = null;
    if (primary) {
      const materialEntries = index.resolveMaterial(primary.material);
      const materialEntry = materialEntries[0] ?? null;
      if (!materialEntry) {
        issues.push(
          issue('WB-E-002', `Mesh '${primary.name}' references material '${primary.material}', which is not defined.`, {
            entity: { type: 'material', name: primary.material, mesh: primary.name },
          }),
        );
        meshIssues.push('WB-E-002');
      } else {
        const shaderExists = index.shaders.has((materialEntry.shader ?? '').toLowerCase());
        if (!shaderExists) {
          issues.push(
            issue('WB-W-003', `Material '${materialEntry.name}' uses shader '${materialEntry.shader}', not found in loaded BRFs.`, {
              entity: { type: 'material', name: materialEntry.name },
            }),
          );
          meshIssues.push('WB-W-003');
        }

        /** @type {ResolvedTexture[]} */
        const resolvedTextures = [];
        for (const [role, label] of TEXTURE_ROLES) {
          const textureName = materialEntry[role];
          if (!textureName || textureName === 'none') continue;

          const declared = index.resolveTexture(textureName);
          const file = textures.resolve(textureName);
          /** @type {string[]} */
          const textureIssues = [];

          if (declared.length === 0) {
            issues.push(
              issue('WB-E-003', `Material '${materialEntry.name}' (${label}) references texture '${textureName}', not declared by any BRF.`, {
                entity: { type: 'texture', name: textureName, material: materialEntry.name },
              }),
            );
            textureIssues.push('WB-E-003');
          }
          if (!file.exists) {
            issues.push(
              issue('WB-E-004', `Texture '${textureName}' is declared but no .dds file exists for it.`, {
                entity: { type: 'texture', name: textureName, material: materialEntry.name },
              }),
            );
            textureIssues.push('WB-E-004');
          }

          let dds = null;
          if (file.exists && file.filePath && readDds) {
            try {
              if (ddsCache?.has(file.filePath)) dds = ddsCache.get(file.filePath);
              else {
                dds = await readDds(file.filePath);
                ddsCache?.set(file.filePath, dds);
              }
            } catch (error) {
              issues.push(
                issue('WB-E-005', `Texture '${textureName}' exists but is not a readable DDS: ${error instanceof Error ? error.message : String(error)}`, {
                  entity: { type: 'texture', name: textureName, material: materialEntry.name },
                }),
              );
              textureIssues.push('WB-E-005');
            }
          }

          if (role === 'bump') {
            // no-op; absence is reported once per mesh below
          }

          resolvedTextures.push({
            role,
            name: textureName,
            declared: declared.length > 0,
            brf: declared[0]?.brf ?? null,
            file,
            dds: dds ? { width: dds.width, height: dds.height, format: dds.format, mipmaps: dds.mipmaps } : null,
            issues: textureIssues,
          });
        }

        if (!findTexture(resolvedTextures, 'bump')) {
          issues.push(
            issue('WB-I-003', `Material '${materialEntry.name}' has no normal map.`, {
              entity: { type: 'material', name: materialEntry.name },
            }),
          );
          meshIssues.push('WB-I-003');
        }

        material = {
          name: materialEntry.name,
          resolved: true,
          brf: materialEntry.brf,
          shader: materialEntry.shader,
          textures: resolvedTextures,
          issues: meshIssues.slice(),
        };
      }
    }

    meshes.push({
      name: meshRef.name,
      resolved: true,
      geometry: {
        baseCount: resolution.base.length,
        lodLevels,
        pieceCount: resolution.pieces.length,
        vertexVersion: primary?.vertexVersion ?? null,
        vertexCount: primary?.vertexCount ?? 0,
        faceCount: primary?.faceCount ?? 0,
      },
      brfFiles,
      material,
      pair: null,
      issues: meshIssues,
    });

    // Glove pairs: items reference the left mesh; the right counterpart is a
    // mesh naming convention, not a separate item. VERIFIED by file names.
    if (/_L$/i.test(meshRef.name)) {
      const rightName = meshRef.name.replace(/_L$/i, '_R');
      const right = index.resolveMesh(rightName);
      const self = meshes[meshes.length - 1];
      if (right.exists) {
        self.pair = {
          name: rightName,
          resolved: true,
          geometry: { baseCount: right.base.length, lodLevels: [], pieceCount: right.pieces.length, vertexVersion: null, vertexCount: 0, faceCount: 0 },
          brfFiles: [...new Set([...right.direct, ...right.family].map((/** @type {any} */ entry) => entry.brf))],
          material: null,
          pair: null,
          issues: [],
        };
        issues.push(issue('WB-I-002', `Glove mesh '${meshRef.name}' has right-hand counterpart '${rightName}'.`, {
          entity: { type: 'mesh', name: rightName },
        }));
        self.issues.push('WB-I-002');
      }
    }
  }

  // Armor-specific sanity checks.
  const slotArmor = {
    head: item.headArmor,
    body: item.bodyArmor,
    foot: item.legArmor,
    hand: item.bodyArmor,
  };
  if (item.isArmor && item.slot in slotArmor) {
    const value = slotArmor[/** @type {keyof typeof slotArmor} */ (item.slot)];
    const expectedZero = item.category === 'clothing' || item.category === 'cape' ? item.slot === 'body' : false;
    if (!expectedZero && value === 0) {
      issues.push(
        issue('WB-W-002', `Item '${item.id}' has no armor value for slot '${item.slot}'.`, {
          entity: { type: 'item', name: item.id },
        }),
      );
    }
  }
  if (!item.isArmor && item.slot === 'unknown') {
    issues.push(issue('WB-W-005', `Item '${item.id}' uses unknown type nibble 0x${(item.flags & 0xf).toString(16)}.`, {
      entity: { type: 'item', name: item.id },
    }));
  }

  const summary = { errors: 0, warnings: 0, infos: 0 };
  for (const entry of issues) {
    if (entry.severity === SEVERITY.ERROR) summary.errors += 1;
    else if (entry.severity === SEVERITY.WARNING) summary.warnings += 1;
    else summary.infos += 1;
  }

  return {
    item: {
      id: item.id,
      name: item.name,
      slot: item.slot,
      category: item.category,
      value: item.value,
      armor: { head: item.headArmor, body: item.bodyArmor, leg: item.legArmor },
    },
    meshes,
    issues,
    summary,
  };
}

/**
 * Validate a set of item ids and aggregate the result.
 * @param {{ items: import('../items/itemKinds.js').ItemRecord[], index:any, textures:any, ids:string[], ddsCache?:Map<string,any>, readDds?:(p:string)=>Promise<any> }} context
 */
export async function validateItems(context) {
  const byId = new Map(context.items.map((item) => [item.id, item]));
  const results = [];
  const missing = [];
  for (const id of context.ids) {
    const item = byId.get(id);
    if (!item) {
      missing.push(id);
      continue;
    }
    results.push(await resolveItemChain({ ...context, item }));
  }
  const summary = results.reduce(
    (acc, result) => {
      acc.errors += result.summary.errors;
      acc.warnings += result.summary.warnings;
      acc.infos += result.summary.infos;
      return acc;
    },
    { errors: 0, warnings: 0, infos: 0 },
  );
  return { results, summary, missing };
}
