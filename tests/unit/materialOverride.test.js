import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMaterialOverride, referencedTextures } from '../../engine/resources/materialOverride.js';

const base = {
  id: 'mat',
  source: { moduleId: 'Native', material: 'mat', brf: 'C:/game/materials.brf' },
  fields: {
    shader: 'simple_shader',
    diffuseA: 'tex',
    diffuseB: 'none',
    bump: 'tex_n',
    enviro: 'none',
    spec: 'none',
    specular: 1,
    r: 1,
    g: 1,
    b: 1,
    flags: 0,
  },
};

test('accepts a complete material override', () => {
  assert.deepEqual(validateMaterialOverride(base), []);
});

test('rejects missing source, bad shader and out-of-range colours', () => {
  assert.ok(validateMaterialOverride({ fields: base.fields }).length > 0);
  assert.ok(validateMaterialOverride({ ...base, fields: { ...base.fields, shader: '' } }).some((issue) => issue.includes('shader')));
  assert.ok(validateMaterialOverride({ ...base, fields: { ...base.fields, r: 300 } }).some((issue) => issue.includes('between 0 and 255')));
  assert.ok(validateMaterialOverride({ ...base, fields: { ...base.fields, specular: 'x' } }).length > 0);
});

test('collects referenced textures and skips none', () => {
  assert.deepEqual(referencedTextures(base.fields), ['tex', 'tex_n']);
  assert.deepEqual(referencedTextures({ ...base.fields, spec: 'tex_s.dds' }), ['tex', 'tex_n', 'tex_s']);
});
