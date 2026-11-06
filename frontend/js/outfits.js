/** Outfits (clothing/armor) browser — the Phase 0/1 view. */

import { ApiError } from './api.js';
import {
  el, badge, stat, displayName, shortPath,
  SLOT_LABEL, CATEGORY_LABEL, emptyState,
} from './ui.js';

/**
 * @param {{ api:any, state:any, dom:any, setStatus:(text:string)=>void, onSummary:(summary:any)=>void }} ctx
 */
export function createOutfitsView(ctx) {
  const { api, state, dom, setStatus, onSummary } = ctx;

  function showDetailEmpty(message) {
    dom.detail.replaceChildren(emptyState('Cargando', message, '◈'));
  }

  function handleError(error, context) {
    const message = error instanceof ApiError ? error.message : String(error);
    setStatus(`${context}: ${message}`);
    if (error instanceof ApiError && error.code === 'INSTALLATION_NOT_FOUND') {
      dom.detail.replaceChildren(emptyState('Sin instalación', message, '⚠'));
      return;
    }
    showDetailEmpty(`${context}: ${message}`);
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
      dom.itemList.replaceChildren(el('p', { class: 'muted', text: 'No hay ítems que coincidan con el filtro.' }));
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
      const detail = await api.item(state.moduleId, id);
      state.detail = detail;
      renderDetail(detail);
      renderValidation(detail.chain);
      setStatus(`Cadena resuelta: ${detail.chain.meshes.length} malla(s)`);
    } catch (error) {
      handleError(error, 'No se pudo resolver el ítem');
    }
  }

  function renderDetail({ item, chain, flags, capabilities }) {
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

    dom.detail.replaceChildren(header, stats, renderFlags(flags, capabilities), chainSection);
  }

  function flagChip(symbol, tone = '') {
    if (!symbol) return null;
    return el('span', {
      class: `flag ${tone}`.trim(),
      text: symbol.name,
      title: symbol.aliases?.length ? `Alias: ${symbol.aliases.join(', ')}` : symbol.hex,
    });
  }

  function renderFlags(flags, capabilities) {
    const chips = [];
    if (flags?.type) chips.push(flagChip(flags.type, 'type'));
    if (flags?.attachment) chips.push(flagChip(flags.attachment, 'field'));
    for (const flag of flags?.flags ?? []) chips.push(flagChip(flag));
    if (flags?.unknownHex) chips.push(el('span', { class: 'flag unknown', text: `unknown ${flags.unknownHex}` }));

    const capChips = [];
    if (capabilities?.carry) capChips.push(flagChip(capabilities.carry, 'field'));
    if (capabilities?.shoot) capChips.push(flagChip(capabilities.shoot, 'field'));
    for (const flag of capabilities?.flags ?? []) capChips.push(flagChip(flag));
    if (capabilities?.unknownHex) capChips.push(el('span', { class: 'flag unknown', text: `unknown ${capabilities.unknownHex}` }));

    return el('details', { class: 'flags-box', open: true }, [
      el('summary', {}, [
        el('span', { text: 'Flags y capacidades' }),
        el('span', { class: 'flags-hex mono', text: `${flags?.hex ?? ''} · ${capabilities?.hex ?? ''}` }),
      ]),
      el('div', { class: 'flag-group' }, [
        el('span', { class: 'flag-label', text: 'Item' }),
        el('div', { class: 'flag-grid' }, chips),
      ]),
      el('div', { class: 'flag-group' }, [
        el('span', { class: 'flag-label', text: 'Capabilities' }),
        el('div', { class: 'flag-grid' }, capChips.length ? capChips : [el('span', { class: 'hint', text: 'Sin capacidades' })]),
      ]),
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
      for (const texture of mesh.material.textures) body.push(renderTextureRow(texture));
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

  async function loadModule(moduleId) {
    state.moduleId = moduleId;
    setStatus(`Cargando ${moduleId}…`);
    showDetailEmpty('Cargando catálogo de prendas…');
    try {
      state.summary = await api.summary(moduleId);
      state.items = [];
      state.total = 0;
      state.offset = 0;
      onSummary?.(state.summary);
      await loadItems(false);
      setStatus(`${state.summary.items.armor} prendas · ${state.summary.items.total} ítems en ${moduleId}`);
    } catch (error) {
      handleError(error, 'No se pudo cargar el módulo');
    }
  }

  function init() {
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

  return { init, loadModule, selectItem, state };
}
