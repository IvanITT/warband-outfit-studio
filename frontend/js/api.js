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

  /* backups */
  backups: () => request('/api/backups'),
  restoreBackup: (body) => request('/api/backups/restore', { method: 'POST', body }),

  /* workspaces */
  workspaces: () => request('/api/workspaces'),
  createWorkspace: (body) => request('/api/workspaces', { method: 'POST', body }),
  removeWorkspace: (id, confirm) => request(
    `/api/workspaces/${encodeURIComponent(id)}?confirm=${encodeURIComponent(confirm)}`,
    { method: 'DELETE' },
  ),
};
