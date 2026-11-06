/** WARBand Outfit Studio — application shell (Phase 2). */

import { api, ApiError } from './api.js';
import { el } from './ui.js';
import { createOutfitsView } from './outfits.js';
import { createResourcesView } from './resources.js';
import { createBackupsView } from './backups.js';
import { createWorkspacesView } from './workspaces.js';
import { createViewer } from './viewer.js';
import { createBuildView } from './build.js';
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
    build: document.getElementById('view-build'),
    workspaces: document.getElementById('view-workspaces'),
    backups: document.getElementById('view-backups'),
  },
  tabs: [...document.querySelectorAll('.viewtab')],
  // outfits
  itemCount: document.getElementById('item-count'),
  itemNew: document.getElementById('item-new'),
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
  // build
  buildCount: document.getElementById('build-count'),
  buildProject: document.getElementById('build-project'),
  buildCopyModule: document.getElementById('build-copy-module'),
  buildStart: document.getElementById('build-start'),
  buildPrune: document.getElementById('build-prune'),
  buildKeep: document.getElementById('build-keep'),
  buildRefresh: document.getElementById('build-refresh'),
  buildList: document.getElementById('build-list'),
  buildResult: document.getElementById('build-result'),
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
  editModeVertex: document.getElementById('edit-mode-vertex'),
  editModeFace: document.getElementById('edit-mode-face'),
  editSelection: document.getElementById('edit-selection'),
  editMessage: document.getElementById('edit-message'),
  editTransform: document.getElementById('edit-transform'),
  editAxis: document.getElementById('edit-axis'),
  editLocal: document.getElementById('edit-local'),
  editAmount: document.getElementById('edit-amount'),
  editStep: document.getElementById('edit-step'),
  editApply: document.getElementById('edit-apply'),
  editDelete: document.getElementById('edit-delete'),
  editDuplicate: document.getElementById('edit-duplicate'),
  editMirror: document.getElementById('edit-mirror'),
  editExtrude: document.getElementById('edit-extrude'),
  editMerge: document.getElementById('edit-merge'),
  editSplit: document.getElementById('edit-split'),
  editUndo: document.getElementById('edit-undo'),
  editRedo: document.getElementById('edit-redo'),
  editReset: document.getElementById('edit-reset'),
  viewerProject: document.getElementById('viewer-project'),
  viewerProjectNew: document.getElementById('viewer-project-new'),
  viewerSave: document.getElementById('viewer-save'),
  viewerLoad: document.getElementById('viewer-load'),
  viewerExport: document.getElementById('viewer-export'),
  viewerTabMesh: document.getElementById('viewer-tab-mesh'),
  viewerTabMaterial: document.getElementById('viewer-tab-material'),
  viewerTabOutfit: document.getElementById('viewer-tab-outfit'),
  viewerMeshPanel: document.getElementById('viewer-mesh-panel'),
  viewerMaterialPanel: document.getElementById('viewer-material-panel'),
  viewerOutfitPanel: document.getElementById('viewer-outfit-panel'),
  viewerEditbar: document.getElementById('viewer-editbar'),
  outfitSkin: document.getElementById('outfit-skin'),
  outfitProject: document.getElementById('outfit-project'),
  outfitList: document.getElementById('outfit-list'),
  outfitName: document.getElementById('outfit-name'),
  outfitSlotBody: document.getElementById('outfit-slot-body'),
  outfitSlotHead: document.getElementById('outfit-slot-head'),
  outfitSlotHand: document.getElementById('outfit-slot-hand'),
  outfitSlotFoot: document.getElementById('outfit-slot-foot'),
  outfitTransformSlot: document.getElementById('outfit-transform-slot'),
  outfitX: document.getElementById('outfit-x'),
  outfitY: document.getElementById('outfit-y'),
  outfitZ: document.getElementById('outfit-z'),
  outfitScale: document.getElementById('outfit-scale'),
  outfitApplyTransform: document.getElementById('outfit-apply-transform'),
  outfitRefresh: document.getElementById('outfit-refresh'),
  outfitPreset: document.getElementById('outfit-preset'),
  outfitAnalyze: document.getElementById('outfit-analyze'),
  outfitSave: document.getElementById('outfit-save'),
  outfitLoad: document.getElementById('outfit-load'),
  outfitDelete: document.getElementById('outfit-delete'),
  outfitExportSnapshot: document.getElementById('outfit-export-snapshot'),
  outfitMessage: document.getElementById('outfit-message'),
  outfitClipping: document.getElementById('outfit-clipping'),
  matName: document.getElementById('mat-name'),
  matShader: document.getElementById('mat-shader'),
  matColor: document.getElementById('mat-color'),
  matSpecular: document.getElementById('mat-specular'),
  matDiffuseA: document.getElementById('mat-diffuseA'),
  matBump: document.getElementById('mat-bump'),
  matSpec: document.getElementById('mat-spec'),
  matTextureList: document.getElementById('mat-texture-list'),
  matFile: document.getElementById('mat-file'),
  matRole: document.getElementById('mat-role'),
  matImport: document.getElementById('mat-import'),
  matNormalToggle: document.getElementById('mat-normal-toggle'),
  matSpecToggle: document.getElementById('mat-spec-toggle'),
  matAlphaToggle: document.getElementById('mat-alpha-toggle'),
  matDoubleToggle: document.getElementById('mat-double-toggle'),
  matPreview: document.getElementById('mat-preview'),
  matSave: document.getElementById('mat-save'),
  matLoad: document.getElementById('mat-load'),
  matExport: document.getElementById('mat-export'),
  matMessage: document.getElementById('mat-message'),
  // backups
  backupsCount: document.getElementById('backups-count'),
  backupsList: document.getElementById('backups-list'),
  backupsRefresh: document.getElementById('backups-refresh'),
  backupsPrune: document.getElementById('backups-prune'),
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
    itemNew: dom.itemNew,
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
  previewItem: (itemId, slot) => previewItem(itemId, slot),
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

const buildView = createBuildView({
  api,
  state,
  dom: {
    count: dom.buildCount,
    project: dom.buildProject,
    copyModule: dom.buildCopyModule,
    start: dom.buildStart,
    refresh: dom.buildRefresh,
    list: dom.buildList,
    result: dom.buildResult,
    buildCount: dom.buildCount,
    buildProject: dom.buildProject,
    buildCopyModule: dom.buildCopyModule,
    buildStart: dom.buildStart,
    buildPrune: dom.buildPrune,
    buildKeep: dom.buildKeep,
    buildRefresh: dom.buildRefresh,
    buildList: dom.buildList,
    buildResult: dom.buildResult,
  },
  setStatus,
});

const backups = createBackupsView({
  api,
  dom: { count: dom.backupsCount, list: dom.backupsList, refresh: dom.backupsRefresh, prune: dom.backupsPrune },
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
    resetCamera: dom.viewerReset,
    grid: dom.viewerGrid,
    wire: dom.viewerWire,
    flip: dom.viewerFlip,
    modeVertex: dom.editModeVertex,
    modeFace: dom.editModeFace,
    selectionCount: dom.editSelection,
    message: dom.editMessage,
    transform: dom.editTransform,
    axis: dom.editAxis,
    local: dom.editLocal,
    amount: dom.editAmount,
    step: dom.editStep,
    apply: dom.editApply,
    delete: dom.editDelete,
    duplicate: dom.editDuplicate,
    mirror: dom.editMirror,
    extrude: dom.editExtrude,
    merge: dom.editMerge,
    split: dom.editSplit,
    undo: dom.editUndo,
    redo: dom.editRedo,
    reset: dom.editReset,
    project: dom.viewerProject,
    projectNew: dom.viewerProjectNew,
    save: dom.viewerSave,
    load: dom.viewerLoad,
    export: dom.viewerExport,
    tabMesh: dom.viewerTabMesh,
    tabMaterial: dom.viewerTabMaterial,
    tabOutfit: dom.viewerTabOutfit,
    meshPanel: dom.viewerMeshPanel,
    materialPanel: dom.viewerMaterialPanel,
    outfitPanel: dom.viewerOutfitPanel,
    editbar: dom.viewerEditbar,
    outfitSkin: dom.outfitSkin,
    outfitProject: dom.outfitProject,
    outfitList: dom.outfitList,
    outfitName: dom.outfitName,
    outfitSlotBody: dom.outfitSlotBody,
    outfitSlotHead: dom.outfitSlotHead,
    outfitSlotHand: dom.outfitSlotHand,
    outfitSlotFoot: dom.outfitSlotFoot,
    outfitTransformSlot: dom.outfitTransformSlot,
    outfitX: dom.outfitX,
    outfitY: dom.outfitY,
    outfitZ: dom.outfitZ,
    outfitScale: dom.outfitScale,
    outfitApplyTransform: dom.outfitApplyTransform,
    outfitRefresh: dom.outfitRefresh,
    outfitPreset: dom.outfitPreset,
    outfitAnalyze: dom.outfitAnalyze,
    outfitSave: dom.outfitSave,
    outfitLoad: dom.outfitLoad,
    outfitDelete: dom.outfitDelete,
    outfitExportSnapshot: dom.outfitExportSnapshot,
    outfitMessage: dom.outfitMessage,
    outfitClipping: dom.outfitClipping,
    matName: dom.matName,
    matShader: dom.matShader,
    matColor: dom.matColor,
    matSpecular: dom.matSpecular,
    matDiffuseA: dom.matDiffuseA,
    matBump: dom.matBump,
    matSpec: dom.matSpec,
    matTextureList: dom.matTextureList,
    matFile: dom.matFile,
    matRole: dom.matRole,
    matImport: dom.matImport,
    matNormalToggle: dom.matNormalToggle,
    matSpecToggle: dom.matSpecToggle,
    matAlphaToggle: dom.matAlphaToggle,
    matDoubleToggle: dom.matDoubleToggle,
    matPreview: dom.matPreview,
    matSave: dom.matSave,
    matLoad: dom.matLoad,
    matExport: dom.matExport,
    matMessage: dom.matMessage,
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
  else if (state.view === 'build') await buildView.load();
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
  } else if (view === 'build') {
    await buildView.load();
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

async function previewItem(itemId, slot) {
  await switchView('viewer');
  await viewer.previewItem(itemId, slot);
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
  buildView.init();
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
