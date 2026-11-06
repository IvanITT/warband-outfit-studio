/** WARBand Outfit Studio — Phase 0 application shell. */

import { api, ApiError } from './api.js';

const state = {
  status: null,
  moduleId: 'Native',
  summary: null,
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
  installPill: document.getElementById('install-pill'),
  moduleSelect: document.getElementById('module-select'),
  itemCount: document.getElementById('item-count'),
  itemList: document.getElementById('item-list'),
  loadMore: document.getElementById('load-more'),
  search: document.getElementById('search'),
  slotFilters: document.getElementById('slot-filters'),
  detail: document.getElementById('detail'),
  validation: document.getElementById('validation'),
  validationSummary: document.getElementById('validation-summary'),
  engineStats: document.getElementById('engine-stats'),
  statusText: document.getElementById('status-text'),
};

/* ------------------------------------------------------------------ */
/* DOM helpers                                                        */
/* ------------------------------------------------------------------ */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const SLOT_LABEL = {
  body: 'Cuerpo',
  head: 'Cabeza',
  hand: 'Manos',
  foot: 'Pies',
  horse: 'Montura',
  shield: 'Escudo',
  goods: 'Mercancía',
};

const CATEGORY_LABEL = {
  armor: 'Armadura',
  clothing: 'Ropa',
  cape: 'Capa',
  other: 'Otro',
};

/** Warband stores spaces as `_`; show readable names without touching ids. */
function displayName(name) {
  return String(name).replace(/_/g, ' ');
}

function badge(text, tone = '') {
  return el('span', { class: `badge ${tone}`.trim(), text });
}

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */

async function init() {
  setStatus('Conectando con el motor…');
  try {
    state.status = await api.status();
  } catch (error) {
    renderFatal(error);
    return;
  }

  renderInstallation(state.status);
  renderModules();
  renderEngineStats();

  if (!state.status.ok) {
    setStatus('No se detectó una instalación de Warband.');
    renderModuleError(
      'No se encontró Mount & Blade: Warband',
      'El motor no pudo localizar `mb_warband.exe` y `Modules`. Ajusta `config/app.json` o define la variable `WARBAND_DIR`.',
    );
    return;
  }

  await loadModule(state.moduleId);
}

function renderInstallation(status) {
  const installation = status.installation;
  if (installation) {
    dom.installPill.className = 'pill is-ok';
    dom.installPill.textContent = `Warband ${installation.version ?? '?'} · ${installation.moduleCount} módulos`;
    dom.installPill.title = installation.rootPath;
  } else {
    dom.installPill.className = 'pill is-bad';
    dom.installPill.textContent = 'Sin instalación';
    dom.installPill.title = (status.candidates ?? []).map((c) => c.path).join('\n');
  }
}

function renderModules() {
  const modules = state.status?.modules ?? [];
  dom.moduleSelect.replaceChildren(
    ...modules.map((module) =>
      el('option', {
        value: module.id,
        text: `${module.id}${module.capabilities?.singlePlayer ? '' : ' (MP)'}`,
      }),
    ),
  );
  dom.moduleSelect.disabled = modules.length === 0;
  if (modules.some((module) => module.id === state.moduleId)) dom.moduleSelect.value = state.moduleId;
  dom.moduleSelect.addEventListener('change', async () => {
    state.moduleId = dom.moduleSelect.value;
    state.selectedId = null;
    state.detail = null;
    await loadModule(state.moduleId);
  });
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

/* ------------------------------------------------------------------ */
/* Module + items                                                     */
/* ------------------------------------------------------------------ */

async function loadModule(moduleId) {
  setStatus(`Cargando ${moduleId}…`);
  showDetailEmpty('Cargando catálogo de prendas…');
  try {
    state.summary = await api.summary(moduleId);
    state.items = [];
    state.total = 0;
    state.offset = 0;
    renderEngineStats();
    await loadItems(false);
    setStatus(`${state.summary.items.armor} prendas · ${state.summary.items.total} ítems en ${moduleId}`);
  } catch (error) {
    handleError(error, 'No se pudo cargar el módulo');
  }
}

async function loadItems(append) {
  if (state.loading) return;
  state.loading = true;
  dom.loadMore.disabled = true;
  try {
    const page = await api.items({
      module: state.moduleId,
      slot: state.slot,
      category: state.category,
      q: state.query,
      limit: state.limit,
      offset: append ? state.offset : 0,
    });
    state.total = page.total;
    state.offset = append ? state.offset + page.items.length : page.items.length;
    state.items = append ? [...state.items, ...page.items] : page.items;
    renderItemList();
    dom.itemCount.textContent = `${state.total}`;
    dom.loadMore.hidden = state.offset >= state.total;
    dom.loadMore.disabled = false;
  } catch (error) {
    handleError(error, 'No se pudo cargar la lista de ítems');
  } finally {
    state.loading = false;
  }
}

function renderItemList() {
  if (state.items.length === 0) {
    dom.itemList.replaceChildren(
      el('p', { class: 'muted', text: 'No hay ítems que coincidan con el filtro.' }),
    );
    return;
  }
  const rows = state.items.map((item) => {
    const armorValue = item.slot === 'head' ? item.armor.head : item.slot === 'foot' ? item.armor.leg : item.armor.body;
    return el(
      'button',
      {
        class: `item-row${item.id === state.selectedId ? ' is-selected' : ''}`,
        type: 'button',
        onclick: () => selectItem(item.id),
      },
      [
        el('span', { class: 'name', text: displayName(item.name) }),
        el('span', { class: 'id', text: item.id }),
        el('span', { class: 'meta' }, [
          el('span', { class: 'armor', text: armorValue ? String(armorValue) : '·' }),
          el('span', { class: 'slot', text: SLOT_LABEL[item.slot] ?? item.slot }),
        ]),
      ],
    );
  });
  dom.itemList.replaceChildren(...rows);
}

async function selectItem(id) {
  if (state.selectedId === id) return;
  state.selectedId = id;
  for (const row of dom.itemList.querySelectorAll('.item-row')) {
    row.classList.toggle('is-selected', row.querySelector('.id')?.textContent === id);
  }
  showDetailEmpty('Resolviendo cadena de recursos…');
  try {
    state.detail = await api.item(state.moduleId, id);
    renderDetail(state.detail);
    renderValidation(state.detail.chain);
    setStatus(`Cadena resuelta: ${state.detail.chain.meshes.length} malla(s)`);
  } catch (error) {
    handleError(error, 'No se pudo resolver el ítem');
  }
}

/* ------------------------------------------------------------------ */
/* Detail rendering                                                   */
/* ------------------------------------------------------------------ */

function showDetailEmpty(message) {
  dom.detail.replaceChildren(
    el('div', { class: 'empty-state' }, [
      el('div', { class: 'empty-icon', text: '◈' }),
      el('h2', { text: 'Cargando' }),
      el('p', { text: message }),
    ]),
  );
}

function renderDetail({ item, chain }) {
  const armorValue = item.slot === 'head' ? item.headArmor : item.slot === 'foot' ? item.legArmor : item.bodyArmor;
  const header = el('div', { class: 'detail-header' }, [
    el('div', { class: 'detail-title' }, [
      el('h2', { text: displayName(item.name) }),
      el('div', { class: 'item-id', text: item.id }),
      el('div', { class: 'badges' }, [
        badge(SLOT_LABEL[item.slot] ?? item.slot, 'accent'),
        badge(CATEGORY_LABEL[item.category] ?? item.category),
        badge(`${chain.meshes.length} malla${chain.meshes.length === 1 ? '' : 's'}`),
        chain.summary.errors > 0
          ? badge(`${chain.summary.errors} error${chain.summary.errors === 1 ? '' : 'es'}`, 'bad')
          : badge('Cadena válida', 'ok'),
      ]),
    ]),
  ]);

  const stats = el('div', { class: 'stats' }, [
    stat('Protección', armorValue, true),
    stat('Valor', item.value),
    stat('Peso', item.weight.toFixed(1)),
    stat('Dificultad', item.difficulty),
    stat('Cabeza', item.headArmor),
    stat('Cuerpo', item.bodyArmor),
    stat('Piernas', item.legArmor),
  ]);

  const chainSection = el('div', {}, [
    el('h3', { class: 'section-title', text: 'Cadena de recursos' }),
    el('div', { class: 'chain' }, chain.meshes.map(renderMeshNode)),
  ]);

  dom.detail.replaceChildren(header, stats, chainSection);
}

function stat(label, value, accent = false) {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'label', text: label }),
    el('div', { class: `value${accent ? ' accent' : ''}`, text: String(value) }),
  ]);
}

function renderMeshNode(mesh) {
  const geometry = mesh.geometry;
  const parts = [];
  if (geometry.vertexCount) parts.push(`${geometry.vertexCount} vértices`);
  if (geometry.faceCount) parts.push(`${geometry.faceCount} caras`);
  if (geometry.lodLevels.length) parts.push(`LOD ${geometry.lodLevels.join('/')}`);
  if (geometry.pieceCount) parts.push(`${geometry.pieceCount} piezas`);
  if (mesh.pair) parts.push('par _R');

  const head = el('div', { class: 'node-head' }, [
    el('span', { class: 'node-kind', text: 'Malla' }),
    el('span', { class: 'node-name', text: mesh.name }),
    el('span', { class: 'node-sub', text: parts.join(' · ') || (mesh.resolved ? 'sin geometría' : 'no encontrada') }),
  ]);

  const body = [el('div', { class: 'hint', text: mesh.brfFiles.map(shortPath).join('  ·  ') || 'sin BRF' })];

  if (mesh.material) {
    body.push(
      el('div', { class: 'texture-row' }, [
        el('span', { class: 'texture-role', text: 'Material' }),
        el('span', { class: 'texture-name', text: mesh.material.name }),
        el('span', { class: 'texture-dims', text: mesh.material.shader ?? '' }),
      ]),
    );
    for (const texture of mesh.material.textures) {
      body.push(renderTextureRow(texture));
    }
  } else if (mesh.resolved) {
    body.push(el('div', { class: 'hint', text: 'Sin material resuelto.' }));
  }

  return el('div', { class: 'node' }, [head, el('div', { class: 'node-body' }, body)]);
}

function renderTextureRow(texture) {
  const ok = texture.declared && texture.file?.exists && !texture.issues.length;
  const dims = texture.dds ? `${texture.dds.width}×${texture.dds.height} ${texture.dds.format}` : 'sin archivo';
  return el('div', { class: 'texture-row' }, [
    el('span', { class: 'texture-role', text: texture.role }),
    el('span', { class: `texture-name${ok ? '' : ' texture-missing'}`, text: texture.name }),
    el('span', { class: 'texture-dims', text: dims }),
  ]);
}

function shortPath(filePath) {
  const parts = String(filePath).split(/[\\/]/);
  return parts.slice(-2).join('/');
}

/* ------------------------------------------------------------------ */
/* Validation                                                         */
/* ------------------------------------------------------------------ */

function renderValidation(chain) {
  const { issues, summary } = chain;
  dom.validationSummary.textContent = `${summary.errors}E · ${summary.warnings}W · ${summary.infos}I`;

  if (issues.length === 0) {
    dom.validation.replaceChildren(
      el('div', { class: 'ok-state' }, [
        el('span', { class: 'mark-ok', text: '✓' }),
        el('div', { text: 'Sin incidencias detectadas.' }),
        el('div', { class: 'hint', text: 'Mallas, materiales, texturas y archivos DDS resueltos.' }),
      ]),
    );
    return;
  }

  dom.validation.replaceChildren(
    ...issues.map((entry) =>
      el('div', { class: `issue ${entry.severity}` }, [
        el('div', { class: 'code', text: `${entry.code} · ${entry.severity}` }),
        el('div', { class: 'title', text: entry.title }),
        el('div', { class: 'message', text: entry.message }),
      ]),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Errors + status                                                    */
/* ------------------------------------------------------------------ */

function setStatus(text) {
  dom.statusText.textContent = text;
}

function handleError(error, context) {
  const message = error instanceof ApiError ? error.message : String(error);
  setStatus(`${context}: ${message}`);
  if (error instanceof ApiError && error.code === 'INSTALLATION_NOT_FOUND') {
    renderModuleError('Sin instalación', message);
    return;
  }
  showDetailEmpty(`${context}: ${message}`);
}

function renderModuleError(title, message) {
  dom.detail.replaceChildren(
    el('div', { class: 'empty-state' }, [
      el('div', { class: 'empty-icon', text: '⚠' }),
      el('h2', { text: title }),
      el('p', { text: message }),
      el('p', { class: 'hint' }, [
        'Rutas probadas: ',
        ...(state.status?.candidates ?? []).slice(0, 6).map((candidate) => el('div', { class: 'mono', text: candidate.path })),
      ]),
    ]),
  );
}

function renderFatal(error) {
  dom.installPill.className = 'pill is-bad';
  dom.installPill.textContent = 'Servidor no disponible';
  renderModuleError('No se pudo contactar con el servidor local', String(error));
  setStatus('Error de conexión con el backend.');
}

/* ------------------------------------------------------------------ */
/* Filters                                                            */
/* ------------------------------------------------------------------ */

function wireFilters() {
  let timer = null;
  dom.search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = dom.search.value.trim();
      state.offset = 0;
      loadItems(false);
    }, 160);
  });

  dom.slotFilters.addEventListener('click', (event) => {
    const button = event.target.closest('.chip');
    if (!button) return;
    for (const chip of dom.slotFilters.querySelectorAll('.chip')) chip.classList.remove('is-active');
    button.classList.add('is-active');
    state.slot = button.dataset.slot ?? '';
    state.category = button.dataset.category ?? '';
    state.offset = 0;
    loadItems(false);
  });

  dom.loadMore.addEventListener('click', () => loadItems(true));
}

wireFilters();
init();
