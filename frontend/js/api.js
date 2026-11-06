/** Typed-ish wrapper around the local JSON API. */

export class ApiError extends Error {
  constructor(message, { code = 'API_ERROR', status = 0, details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(`Respuesta no válida del servidor (${response.status})`, { status: response.status });
  }

  if (!response.ok || payload?.ok === false) {
    const error = payload?.error ?? {};
    throw new ApiError(error.message ?? `Error HTTP ${response.status}`, {
      code: error.code ?? 'HTTP_ERROR',
      status: response.status,
      details: error.details,
    });
  }
  return payload;
}

export const api = {
  status: () => request('/api/status'),
  diagnostics: () => request('/api/diagnostics'),
  logs: (lines = 200) => request(`/api/logs?lines=${encodeURIComponent(String(lines))}`),
  modules: () => request('/api/modules'),
  summary: (module) => request(`/api/modules/${encodeURIComponent(module)}/summary`),
  items: ({ module, slot, category, q, limit = 500, offset = 0 }) => {
    const params = new URLSearchParams({ module, limit: String(limit), offset: String(offset) });
    if (slot) params.set('slot', slot);
    if (category) params.set('category', category);
    if (q) params.set('q', q);
    return request(`/api/items?${params}`);
  },
  item: (module, id) => request(`/api/items/${encodeURIComponent(id)}?module=${encodeURIComponent(module)}`),
  itemEditable: (module, id) => request(
    `/api/items/${encodeURIComponent(id)}/editable?module=${encodeURIComponent(module)}`,
  ),
  itemSchema: () => request('/api/item-schema'),
  validate: (module, ids) => request('/api/validate', { method: 'POST', body: { module, ids } }),
  projects: () => request('/api/projects'),
  buildProject: (projectId, body = {}) => request(
    `/api/projects/${encodeURIComponent(projectId)}/build`,
    { method: 'POST', body },
  ),
  builds: () => request('/api/builds'),
  build: (buildId) => request(`/api/builds/${encodeURIComponent(buildId)}`),
  buildDiff: (buildId) => request(`/api/builds/${encodeURIComponent(buildId)}/diff`),
  rollbackBuild: (buildId, projectId, confirm) => request(
    `/api/builds/${encodeURIComponent(buildId)}/rollback`,
    { method: 'POST', body: { projectId, confirm } },
  ),
  pruneBuilds: (keep, confirm) => request('/api/builds/prune', {
    method: 'POST',
    body: { keep, confirm },
  }),
  pruneBackups: (keep, confirm) => request('/api/backups/prune', {
    method: 'POST',
    body: { keep, confirm },
  }),

  itemOverrides: (projectId) => request(`/api/projects/${encodeURIComponent(projectId)}/items`),
  itemOverride: (projectId, itemId) => request(
    `/api/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}`,
  ),
  saveItemOverride: (projectId, override) => request(
    `/api/projects/${encodeURIComponent(projectId)}/items`,
    { method: 'POST', body: { override } },
  ),
  removeItemOverride: (projectId, itemId, confirm) => request(
    `/api/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}?confirm=${encodeURIComponent(confirm)}`,
    { method: 'DELETE' },
  ),
  exportItemOverrides: (projectId, workspaceLabel) => request(
    `/api/projects/${encodeURIComponent(projectId)}/items/export`,
    { method: 'POST', body: { workspaceLabel } },
  ),
  createProject: (body) => request('/api/projects', { method: 'POST', body }),

  /* installation profiles */
  profiles: () => request('/api/profiles'),
  addProfile: (body) => request('/api/profiles', { method: 'POST', body }),
  activateProfile: (id) => request(`/api/profiles/${encodeURIComponent(id)}/activate`, { method: 'POST' }),
  removeProfile: (id, confirm) => request(
    `/api/profiles/${encodeURIComponent(id)}?confirm=${encodeURIComponent(confirm)}`,
    { method: 'DELETE' },
  ),
  validateProfiles: () => request('/api/profiles/validate', { method: 'POST' }),

  /* asset index */
  resources: ({ module, type, q, limit = 100, offset = 0 }) => {
    const params = new URLSearchParams({ module, type, limit: String(limit), offset: String(offset) });
    if (q) params.set('q', q);
    return request(`/api/resources?${params}`);
  },
  resource: (module, type, name) => request(
    `/api/resources/${type}/${encodeURIComponent(name)}?module=${encodeURIComponent(module)}`,
  ),
  meshGeometry: (module, name) => request(
    `/api/meshes/${encodeURIComponent(name)}/geometry?module=${encodeURIComponent(module)}`,
  ),
  outfitMeshRender: (module, name, { slot, role, bone } = {}) => {
    const params = new URLSearchParams({ module });
    if (slot) params.set('slot', slot);
    if (role) params.set('role', role);
    if (bone) params.set('bone', bone);
    return request(`/api/meshes/${encodeURIComponent(name)}/outfit-render?${params}`);
  },
  meshEditable: (module, name) => request(
    `/api/meshes/${encodeURIComponent(name)}/editable?module=${encodeURIComponent(module)}`,
  ),
  materialEditable: (module, name) => request(
    `/api/materials/${encodeURIComponent(name)}/editable?module=${encodeURIComponent(module)}`,
  ),
  textureBuffer: async (module, name) => {
    const response = await fetch(
      `/api/textures/${encodeURIComponent(name)}/raw?module=${encodeURIComponent(module)}`,
    );
    if (!response.ok) {
      let payload = null;
      try { payload = await response.json(); } catch { /* binary error */ }
      throw new ApiError(payload?.error?.message ?? `Textura no disponible (${response.status})`, {
        code: payload?.error?.code ?? 'TEXTURE_ERROR',
        status: response.status,
      });
    }
    return response.arrayBuffer();
  },

  /* backups */
  backups: () => request('/api/backups'),  restoreBackup: (body) => request('/api/backups/restore', { method: 'POST', body }),

  /* project mesh overrides */
  meshOverrides: (projectId) => request(`/api/projects/${encodeURIComponent(projectId)}/meshes`),
  meshOverride: (projectId, meshId) => request(
    `/api/projects/${encodeURIComponent(projectId)}/meshes/${encodeURIComponent(meshId)}`,
  ),
  saveMeshOverride: (projectId, override) => request(
    `/api/projects/${encodeURIComponent(projectId)}/meshes`,
    { method: 'POST', body: { override } },
  ),
  removeMeshOverride: (projectId, meshId, confirm) => request(
    `/api/projects/${encodeURIComponent(projectId)}/meshes/${encodeURIComponent(meshId)}?confirm=${encodeURIComponent(confirm)}`,
    { method: 'DELETE' },
  ),
  exportMeshOverride: (projectId, meshId, workspaceLabel) => request(
    `/api/projects/${encodeURIComponent(projectId)}/meshes/${encodeURIComponent(meshId)}/export`,
    { method: 'POST', body: { workspaceLabel } },
  ),

  /* project material overrides */
  materialOverrides: (projectId) => request(`/api/projects/${encodeURIComponent(projectId)}/materials`),
  materialOverride: (projectId, materialId) => request(
    `/api/projects/${encodeURIComponent(projectId)}/materials/${encodeURIComponent(materialId)}`,
  ),
  saveMaterialOverride: (projectId, override) => request(
    `/api/projects/${encodeURIComponent(projectId)}/materials`,
    { method: 'POST', body: { override } },
  ),
  removeMaterialOverride: (projectId, materialId, confirm) => request(
    `/api/projects/${encodeURIComponent(projectId)}/materials/${encodeURIComponent(materialId)}?confirm=${encodeURIComponent(confirm)}`,
    { method: 'DELETE' },
  ),
  exportMaterialOverride: (projectId, materialId, workspaceLabel) => request(
    `/api/projects/${encodeURIComponent(projectId)}/materials/${encodeURIComponent(materialId)}/export`,
    { method: 'POST', body: { workspaceLabel } },
  ),

  /* project textures */
  projectTextures: (projectId) => request(`/api/projects/${encodeURIComponent(projectId)}/textures`),
  projectTextureBuffer: async (projectId, name) => {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/textures/${encodeURIComponent(name)}/raw`,
    );
    if (!response.ok) {
      let payload = null;
      try { payload = await response.json(); } catch { /* binary error */ }
      throw new ApiError(payload?.error?.message ?? `Textura de proyecto no disponible (${response.status})`, {
        code: payload?.error?.code ?? 'TEXTURE_ERROR',
        status: response.status,
      });
    }
    return response.arrayBuffer();
  },
  saveProjectTexture: (projectId, texture) => request(
    `/api/projects/${encodeURIComponent(projectId)}/textures`,
    { method: 'POST', body: { texture } },
  ),
  removeProjectTexture: (projectId, name, confirm) => request(
    `/api/projects/${encodeURIComponent(projectId)}/textures/${encodeURIComponent(name)}?confirm=${encodeURIComponent(confirm)}`,
    { method: 'DELETE' },
  ),
  importTexture: (workspaceId, fileName, base64) => request(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/textures`,
    { method: 'POST', body: { fileName, data: base64 } },
  ),

  /* characters & outfits */
  skins: (module) => request(`/api/skins?module=${encodeURIComponent(module)}`),
  character: (module, skin) => request(
    `/api/characters?module=${encodeURIComponent(module)}&skin=${encodeURIComponent(skin)}`,
  ),
  outfitItemMeshes: (module, itemId) => request(
    `/api/outfit-items/${encodeURIComponent(itemId)}/meshes?module=${encodeURIComponent(module)}`,
  ),
  analyzeOutfit: (payload) => request('/api/outfits/analyze', { method: 'POST', body: payload }),
  outfits: (projectId) => request(`/api/projects/${encodeURIComponent(projectId)}/outfits`),
  saveOutfit: (projectId, outfit) => request(
    `/api/projects/${encodeURIComponent(projectId)}/outfits`,
    { method: 'POST', body: { outfit } },
  ),
  outfit: (projectId, outfitId) => request(
    `/api/projects/${encodeURIComponent(projectId)}/outfits/${encodeURIComponent(outfitId)}`,
  ),
  removeOutfit: (projectId, outfitId, confirm) => request(
    `/api/projects/${encodeURIComponent(projectId)}/outfits/${encodeURIComponent(outfitId)}?confirm=${encodeURIComponent(confirm)}`,
    { method: 'DELETE' },
  ),

  /* workspaces */
  workspaces: () => request('/api/workspaces'),
  createWorkspace: (body) => request('/api/workspaces', { method: 'POST', body }),  removeWorkspace: (id, confirm) => request(
    `/api/workspaces/${encodeURIComponent(id)}?confirm=${encodeURIComponent(confirm)}`,
    { method: 'DELETE' },
  ),
};
