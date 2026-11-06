import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveItemChain } from '../../engine/validation/validate.js';

const ITEM = {
  id: 'itm_test_armor',
  name: 'Test_Armor',
  flags: 0x0101000d,
  slot: 'body',
  category: 'armor',
  isArmor: true,
  value: 100,
  headArmor: 0,
  bodyArmor: 20,
  legArmor: 5,
  meshes: [{ name: 'test_mesh', modifierBits: 0 }],
};

function meshEntry(overrides = {}) {
  return {
    name: 'test_mesh',
    key: 'test_mesh',
    brf: 'C:/game/CommonRes/test.brf',
    flags: 0,
    material: 'test_material',
    vertexVersion: 2,
    vertexCount: 100,
    faceCount: 50,
    frameCount: 1,
    rigged: false,
    nameInfo: { base: 'test_mesh', lodLevel: 0, pieceIndex: 0, isLod: false, isCollisionBody: false },
    ...overrides,
  };
}

function makeIndex({ mesh = meshEntry(), material = null, textureDeclared = true, shader = true } = {}) {
  const family = mesh ? [mesh] : [];
  return {
    shaders: new Map(shader ? [['simple_shader', ['test.brf']]] : []),
    resolveMesh: (name) => ({
      name,
      direct: name.toLowerCase() === mesh?.name.toLowerCase() ? family : [],
      family,
      base: family,
      lods: [],
      pieces: [],
      exists: family.length > 0,
      info: { base: name, lodLevel: 0, pieceIndex: 0 },
    }),
    resolveMaterial: (name) => (material ? [{ ...material, brf: 'C:/game/CommonRes/materials.brf' }] : []),
    resolveTexture: (name) => (textureDeclared ? [{ name, brf: 'C:/game/CommonRes/textures.brf' }] : []),
  };
}

function makeTextures(exists = true) {
  return {
    resolve: (name) => ({
      name,
      filePath: exists ? `C:/game/Textures/${name}.dds` : null,
      relativePath: exists ? `Textures/${name}.dds` : null,
      exists,
      pages: [],
      alternatives: [],
      location: exists ? 'game' : null,
    }),
  };
}

const MATERIAL = {
  name: 'test_material',
  shader: 'simple_shader',
  diffuseA: 'test_diffuse',
  diffuseB: 'none',
  bump: 'test_normal',
  enviro: 'none',
  spec: 'none',
};

const readDds = async () => ({ width: 512, height: 512, format: 'DXT1', mipmaps: 1 });

test('reports a missing mesh', async () => {
  const chain = await resolveItemChain({ item: ITEM, index: makeIndex({ mesh: null }), textures: makeTextures(), readDds });
  assert.deepEqual(chain.issues.map((i) => i.code), ['WB-E-001']);
  assert.equal(chain.summary.errors, 1);
});

test('reports a missing material', async () => {
  const chain = await resolveItemChain({ item: ITEM, index: makeIndex({ material: null }), textures: makeTextures(), readDds });
  assert.ok(chain.issues.some((i) => i.code === 'WB-E-002'));
  assert.equal(chain.meshes[0].material, null);
});

test('reports undeclared and missing texture files', async () => {
  const index = makeIndex({ material: MATERIAL, textureDeclared: false });
  const chain = await resolveItemChain({ item: ITEM, index, textures: makeTextures(false), readDds });
  const codes = chain.issues.map((i) => i.code);
  assert.ok(codes.includes('WB-E-003'));
  assert.ok(codes.includes('WB-E-004'));
});

test('accepts a fully resolved chain', async () => {
  const chain = await resolveItemChain({
    item: ITEM,
    index: makeIndex({ material: MATERIAL }),
    textures: makeTextures(true),
    readDds,
  });
  assert.equal(chain.summary.errors, 0);
  assert.equal(chain.meshes[0].material.textures.length, 2);
  assert.equal(chain.meshes[0].material.textures[0].dds.width, 512);
});

test('reports invalid DDS files', async () => {
  const chain = await resolveItemChain({
    item: ITEM,
    index: makeIndex({ material: MATERIAL }),
    textures: makeTextures(true),
    readDds: async () => {
      throw new Error('bad header');
    },
  });
  assert.ok(chain.issues.some((i) => i.code === 'WB-E-005'));
});

test('warns when the shader is missing but does not fail', async () => {
  const chain = await resolveItemChain({
    item: ITEM,
    index: makeIndex({ material: MATERIAL, shader: false }),
    textures: makeTextures(true),
    readDds,
  });
  const issue = chain.issues.find((i) => i.code === 'WB-W-003');
  assert.ok(issue);
  assert.equal(issue.severity, 'warning');
});
