/** WARBand Outfit Studio — application shell (Phase 2). */

import { api, ApiError } from './api.js';
import { el } from './ui.js';
import { createOutfitsView } from './outfits.js';
import { createResourcesView } from './resources.js';
import { createBackupsView } from './backups.js';
import { createWorkspacesView } from './workspaces.js';
import { createViewer } from './viewer.js';
import { createInstallations } from './installations.js';

const state = {
  status: null,
  view: 'outfits',
  moduleId: 'Native',
  summary: null,
  // outfits view state
  items: [],
  total: 0,
  offset: 0,
  limit: 500,
  slot: '',
  category: '',
  query: '',
  selectedId: null,
  detail: null,
  loading: false,
};

const dom = {
  statusText: document.getElementById('status-text'),
  installPill: document.getElementById('install-pill'),
  profileSelect: document.getElementById('profile-select'),
  moduleSelect: document.getElementById('module-select'),
  manageProfiles: document.getElementById('manage-profiles'),
  viewHint: document.getElementById('view-hint'),
  views: {
    outfits: document.getElementById('view-outfits'),
    resources: document.getElementById('view-resources'),
    viewer: document.getElementById('view-viewer'),
    workspaces: document.getElementById('view-workspaces'),
    backups: document.getElementById('view-backups'),
  },
  tabs: [...document.querySelectorAll('.viewtab')],
  // outfits
  itemCount: document.getElementById('item-count'),
  itemList: document.getElementById('item-list'),
  loadMore: document.getElementById('load-more'),
  search: document.getElementById('search'),
  slotFilters: document.getElementById('slot-filters'),
  detail: document.getElementById('detail'),
  validation: document.getElementById('validation'),
  validationSummary: document.getElementById('validation-summary'),
  engineStats: document.getElementById('engine-stats'),
  // resources
  resourceCount: document.getElementById('resource-count'),
  resourceSearch: document.getElementById('resource-search'),
  resourceTypes: document.getElementById('resource-types'),
  resourceList: document.getElementById('resource-list'),
  resourceMore: document.getElementById('resource-more'),
  resourceDetail: document.getElementById('resource-detail'),
  resourceRefs: document.getElementById('resource-refs'),
  resourceRefsCount: document.getElementById('resource-refs-count'),
  // viewer
  viewerCount: document.getElementById('viewer-count'),
  viewerSearch: document.getElementById('viewer-search'),
  viewerList: document.getElementById('viewer-list'),
  viewerMore: document.getElementById('viewer-more'),
  viewerCanvas: document.getElementById('viewer-canvas'),
  viewerTitle: document.getElementById('viewer-title'),
  viewerStatus: document.getElementById('viewer-status'),
  viewerReset: document.getElementById('viewer-reset'),
  viewerGrid: document.getElementById('viewer-grid'),
  viewerWire: document.getElementById('viewer-wire'),
  viewerFlip: document.getElementById('viewer-flip'),
  // backups
  backupsCount: document.getElementById('backups-count'),
  backupsList: document.getElementById('backups-list'),
  backupsRefresh: document.getElementById('backups-refresh'),
  // workspaces
  workspacesCount: document.getElementById('workspaces-count'),
  workspacesList: document.getElementById('workspaces-list'),
  workspaceCreate: document.getElementById('workspace-create'),
  workspaceLabel: document.getElementById('workspace-label'),
  workspacesRefresh: document.getElementById('workspaces-refresh'),
  // modal
  modal: document.getElementById('profiles-modal'),
  profilesList: document.getElementById('profiles-list'),
  profileForm: document.getElementById('profile-add'),
  profilePath: document.getElementById('profile-path'),
  profileLabel: document.getElementById('profile-label'),
  profilesClose: document.getElementById('profiles-close'),
  profilesValidate: document.getElementById('profiles-validate'),
};

function setStatus(text) {
  dom.statusText.textContent = text;
}

const outfits = createOutfitsView({
  api,
  state,
  dom: {
    itemCount: dom.itemCount,
    itemList: dom.itemList,
    loadMore: dom.loadMore,
    search: dom.search,
    slotFilters: dom.slotFilters,
    detail: dom.detail,
    validation: dom.validation,
    validationSummary: dom.validationSummary,
  },
  setStatus,
  onSummary: (summary) => {
    state.summary = summary;
    renderEngineStats();
  },
});

const resources = createResourcesView({
  api,
  state,
  dom: {
    count: dom.resourceCount,
    search: dom.resourceSearch,
    types: dom.resourceTypes,
    list: dom.resourceList,
    more: dom.resourceMore,
    detail: dom.resourceDetail,
    refs: dom.resourceRefs,
    refsCount: dom.resourceRefsCount,
  },
  setStatus,
  openItem,
  openViewer,
});

const backups = createBackupsView({
  api,
  dom: { count: dom.backupsCount, list: dom.backupsList, refresh: dom.backupsRefresh },
  setStatus,
});

const workspaces = createWorkspacesView({
  api,
  state,
  dom: {
    count: dom.workspacesCount,
    list: dom.workspacesList,
    create: dom.workspaceCreate,
    label: dom.workspaceLabel,
    refresh: dom.workspacesRefresh,
  },
  setStatus,
});

const viewer = createViewer({
  api,
  state,
  dom: {
    count: dom.viewerCount,
    search: dom.viewerSearch,
    list: dom.viewerList,
    more: dom.viewerMore,
    canvas: dom.viewerCanvas,
    title: dom.viewerTitle,
    status: dom.viewerStatus,
    reset: dom.viewerReset,
    grid: dom.viewerGrid,
    wire: dom.viewerWire,
    flip: dom.viewerFlip,
  },
  setStatus,
});

const installations = createInstallations({
  api,
  dom: {
    modal: dom.modal,
    list: dom.profilesList,
    form: dom.profileForm,
    pathInput: dom.profilePath,
    labelInput: dom.profileLabel,
    close: dom.profilesClose,
    validateAll: dom.profilesValidate,
  },
  setStatus,
  onChanged: refreshAll,
});

/* ------------------------------------------------------------------ */
/* Shell rendering                                                    */
/* ------------------------------------------------------------------ */

function renderProfiles() {
  const profiles = state.status?.profiles?.profiles ?? [];
  const activeId = state.status?.profiles?.activeId ?? null;
  dom.profileSelect.replaceChildren(
    ...(profiles.length
      ? profiles.map((profile) => el('option', {
          value: profile.id,
          text: `${profile.label}${profile.valid ? '' : ' (inválida)'}`,
        }))
      : [el('option', { value: '', text: 'Sin instalaciones' })]),
  );
  dom.profileSelect.disabled = profiles.length === 0;
  if (activeId) dom.profileSelect.value = activeId;
}

function renderInstallation() {
  const installation = state.status?.installation;
  if (installation) {
    dom.installPill.className = 'pill is-ok';
    dom.installPill.textContent = `Warband ${installation.version ?? '?'} · ${installation.moduleCount} módulos`;
    dom.installPill.title = installation.rootPath;
  } else {
    dom.installPill.className = 'pill is-bad';
    dom.installPill.textContent = 'Sin instalación';
    dom.installPill.title = (state.status?.candidates ?? []).map((candidate) => candidate.path).join('\n');
  }
}

function renderModules() {
  const modules = state.status?.modules ?? [];
  if (modules.length && !modules.some((module) => module.id === state.moduleId)) {
    state.moduleId = modules[0].id;
  }
  dom.moduleSelect.replaceChildren(
    ...modules.map((module) => el('option', {
      value: module.id,
      text: `${module.id}${module.capabilities?.singlePlayer ? '' : ' (MP)'}`,
    })),
  );
  dom.moduleSelect.disabled = modules.length === 0;
  if (modules.some((module) => module.id === state.moduleId)) dom.moduleSelect.value = state.moduleId;
}

function renderEngineStats() {
  const status = state.status;
  const summary = state.summary;
  const rows = [
    ['Instalación', status?.installation?.rootPath?.split(/[\\/]/).slice(-1)[0] ?? '—'],
    ['Versión', status?.installation?.version ?? '—'],
    ['Módulo', summary?.module?.id ?? state.moduleId],
    ['Ítems', summary ? String(summary.items.total) : '—'],
    ['Prendas', summary ? String(summary.items.armor) : '—'],
    ['BRF', summary ? String(summary.resources.brfFiles) : '—'],
    ['Mallas', summary ? String(summary.resources.meshes) : '—'],
    ['Materiales', summary ? String(summary.resources.materials) : '—'],
    ['Texturas', summary ? String(summary.resources.textures) : '—'],
    ['Índice', summary ? `${summary.resources.buildMs} ms` : '—'],
  ];
  dom.engineStats.replaceChildren(
    ...rows.flatMap(([key, value]) => [el('dt', { text: key }), el('dd', { text: value })]),
  );
}

function updateHint() {
  dom.viewHint.textContent = `${state.moduleId} · ${state.view}`;
}

/* ------------------------------------------------------------------ */
/* Views                                                              */
/* ------------------------------------------------------------------ */

async function loadCurrentView() {
  if (!state.status?.ok) return;
  if (state.view === 'outfits') await outfits.loadModule(state.moduleId);
  else if (state.view === 'resources') await resources.load(state.moduleId);
  else if (state.view === 'viewer') await viewer.loadList(state.moduleId);
  else if (state.view === 'workspaces') await workspaces.load();
  else await backups.load();
  updateHint();
}

async function switchView(view) {
  const previous = state.view;
  state.view = view;
  for (const tab of dom.tabs) tab.classList.toggle('is-active', tab.dataset.view === view);
  for (const [name, node] of Object.entries(dom.views)) node.hidden = name !== view;
  if (previous === 'viewer' && view !== 'viewer') viewer.setActive(false);
  if (view === 'outfits') {
    if (!state.summary) await outfits.loadModule(state.moduleId);
  } else if (view === 'resources') {
    await resources.load(state.moduleId);
  } else if (view === 'viewer') {
    viewer.setActive(true);
    await viewer.loadList(state.moduleId);
  } else if (view === 'workspaces') {
    await workspaces.load();
  } else {
    await backups.load();
  }
  updateHint();
}

function openItem(id) {
  switchView('outfits').then(() => outfits.selectItem(id));
}

function openViewer(meshName) {
  switchView('viewer').then(() => viewer.select(meshName));
}

async function refreshAll() {
  try {
    state.status = await api.status();
  } catch (error) {
    renderFatal(error);
    return;
  }
  renderProfiles();
  renderModules();
  renderInstallation();
  renderEngineStats();

  if (!state.status.ok) {
    dom.detail.replaceChildren(
      el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-icon', text: '⚠' }),
        el('h2', { text: 'No se encontró Mount & Blade: Warband' }),
        el('p', { text: 'Añade una instalación con el botón ⚙ o define WARBAND_DIR.' }),
      ]),
    );
    setStatus('No se detectó una instalación de Warband.');
    return;
  }
  await loadCurrentView();
}

/* ------------------------------------------------------------------ */
/* Wiring                                                             */
/* ------------------------------------------------------------------ */

function wireShell() {
  dom.tabs.forEach((tab) => tab.addEventListener('click', () => switchView(tab.dataset.view)));

  dom.moduleSelect.addEventListener('change', async () => {
    state.moduleId = dom.moduleSelect.value;
    state.selectedId = null;
    state.detail = null;
    state.summary = null;
    await loadCurrentView();
  });

  dom.profileSelect.addEventListener('change', async () => {
    const id = dom.profileSelect.value;
    if (!id) return;
    setStatus('Activando instalación…');
    try {
      await api.activateProfile(id);
      await refreshAll();
    } catch (error) {
      setStatus(`No se pudo activar la instalación: ${error instanceof ApiError ? error.message : String(error)}`);
    }
  });

  dom.manageProfiles.addEventListener('click', () => installations.open());
}

function renderFatal(error) {
  dom.installPill.className = 'pill is-bad';
  dom.installPill.textContent = 'Servidor no disponible';
  dom.detail.replaceChildren(
    el('div', { class: 'empty-state' }, [
      el('div', { class: 'empty-icon', text: '⚠' }),
      el('h2', { text: 'No se pudo contactar con el servidor local' }),
      el('p', { text: String(error) }),
    ]),
  );
  setStatus('Error de conexión con el backend.');
}

async function init() {
  setStatus('Conectando con el motor…');
  outfits.init();
  resources.init();
  backups.init();
  workspaces.init();
  viewer.init();
  installations.init();
  wireShell();

  try {
    state.status = await api.status();
  } catch (error) {
    renderFatal(error);
    return;
  }

  renderProfiles();
  renderModules();
  renderInstallation();
  renderEngineStats();
  updateHint();

  if (!state.status.ok) {
    setStatus('No se detectó una instalación de Warband. Usa ⚙ para añadir una.');
    dom.detail.replaceChildren(
      el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-icon', text: '⚠' }),
        el('h2', { text: 'No se encontró Mount & Blade: Warband' }),
        el('p', { text: 'El motor no localizó mb_warband.exe y Modules. Añade una instalación con ⚙.' }),
      ]),
    );
    return;
  }

  await outfits.loadModule(state.moduleId);
}

init();
