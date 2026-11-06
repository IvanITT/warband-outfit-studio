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
  validate: (module, ids) => request('/api/validate', { method: 'POST', body: { module, ids } }),
  projects: () => request('/api/projects'),
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

  /* workspaces */
  workspaces: () => request('/api/workspaces'),
  createWorkspace: (body) => request('/api/workspaces', { method: 'POST', body }),  removeWorkspace: (id, confirm) => request(
    `/api/workspaces/${encodeURIComponent(id)}?confirm=${encodeURIComponent(confirm)}`,
    { method: 'DELETE' },
  ),
};
