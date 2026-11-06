/** Asset index view: meshes, materials, textures and shaders. */

import { ApiError } from './api.js';
import { el, badge, stat, displayName, shortPath, emptyState } from './ui.js';

/**
 * @param {{ api:any, state:any, dom:any, setStatus:(text:string)=>void, openItem:(id:string)=>void }} ctx
 */
export function createResourcesView(ctx) {
  const { api, state, dom, setStatus, openItem } = ctx;
  const view = {
    type: 'mesh',
    q: '',
    items: [],
    total: 0,
    offset: 0,
    limit: 100,
    selected: null,
    loading: false,
    loadedFor: null,
  };

  function detailEmpty(title, message, icon = '▦') {
    dom.detail.replaceChildren(emptyState(title, message, icon));
  }

  function handleError(error, context) {
    const message = error instanceof ApiError ? error.message : String(error);
    setStatus(`${context}: ${message}`);
    detailEmpty('Error', `${context}: ${message}`, '⚠');
  }

  async function load(moduleId, { append = false } = {}) {
    if (view.loading) return;
    view.loading = true;
    if (!append) {
      view.items = [];
      view.offset = 0;
      view.selected = null;
      dom.refs.replaceChildren(el('p', { class: 'muted', text: 'Selecciona un recurso para ver quién lo usa.' }));
      dom.refsCount.textContent = '—';
      detailEmpty('Cargando recursos…', `${view.type} de ${moduleId}`);
    }
    dom.more.disabled = true;
    try {
      const page = await api.resources({
        module: moduleId,
        type: view.type,
        q: view.q,
        limit: view.limit,
        offset: append ? view.offset : 0,
      });
      view.total = page.total;
      view.offset = append ? view.offset + page.items.length : page.items.length;
      view.items = append ? [...view.items, ...page.items] : page.items;
      view.loadedFor = moduleId;
      renderList();
      dom.count.textContent = String(view.total);
      dom.more.hidden = view.offset >= view.total;
      dom.more.disabled = false;
      setStatus(`${view.total} ${view.type}(s) en ${moduleId}`);
    } catch (error) {
      handleError(error, 'No se pudieron cargar los recursos');
    } finally {
      view.loading = false;
    }
  }

  function renderList() {
    if (view.items.length === 0) {
      dom.list.replaceChildren(el('p', { class: 'muted', text: 'No hay recursos que coincidan.' }));
      return;
    }
    dom.list.replaceChildren(
      ...view.items.map((item) => {
        const sub = view.type === 'mesh'
          ? `${item.material ?? 'sin material'} · ${item.vertexCount} v / ${item.faceCount} f`
          : view.type === 'material'
            ? `shader: ${item.shader}`
            : view.type === 'texture'
              ? (item.exists ? 'archivo presente' : 'archivo ausente')
              : 'shader';
        const meta = view.type === 'mesh' && item.lodLevel ? `lod${item.lodLevel}` : '';
        return el('button', {
          class: `resource-row${view.selected?.name === item.name ? ' is-selected' : ''}`,
          type: 'button',
          onclick: () => select(view.type, item.name),
        }, [
          el('span', { class: 'name', text: item.name }),
          el('span', { class: 'sub', text: sub }),
          el('span', { class: 'meta', text: meta }),
        ]);
      }),
    );
  }

  async function select(type, name) {
    view.type = type;
    view.selected = { type, name };
    for (const row of dom.list.querySelectorAll('.resource-row')) {
      row.classList.toggle('is-selected', row.querySelector('.name')?.textContent === name);
    }
    detailEmpty('Cargando recurso…', name);
    try {
      const { detail } = await api.resource(state.moduleId, type, name);
      if (type === 'mesh') renderMesh(name, detail);
      else if (type === 'material') renderMaterial(name, detail);
      else if (type === 'texture') renderTexture(name, detail);
      else renderShader(name, detail);
      setStatus(`${type}: ${name}`);
    } catch (error) {
      handleError(error, 'No se pudo cargar el recurso');
    }
  }

  function header(title, subtitle, badges = []) {
    return el('div', { class: 'detail-header' }, [
      el('div', { class: 'detail-title' }, [
        el('h2', { text: title }),
        el('div', { class: 'item-id', text: subtitle }),
        el('div', { class: 'badges' }, badges),
      ]),
    ]);
  }

  function textureRow(role, texture) {
    const dims = texture.dds
      ? `${texture.dds.width}×${texture.dds.height} ${texture.dds.format}`
      : texture.file?.exists ? 'sin cabecera' : 'sin archivo';
    return el('div', { class: 'texture-row' }, [
      el('span', { class: 'texture-role', text: role }),
      el('span', {
        class: `texture-name${texture.declared && texture.file?.exists ? '' : ' texture-missing'}`,
        text: texture.name,
      }),
      el('span', { class: 'texture-dims', text: dims }),
    ]);
  }

  function renderMesh(name, detail) {
    const primary = detail.primary;
    const stats = el('div', { class: 'stats' }, [
      stat('Vértices', primary.vertexCount, true),
      stat('Caras', primary.faceCount),
      stat('Layout', `v${primary.vertexVersion}`),
      stat('Rigged', primary.rigged ? 'sí' : 'no'),
      stat('LOD', primary.lodLevel || 'base'),
      stat('Pieza', primary.pieceIndex || 'base'),
    ]);

    const chain = [];
    if (detail.material) {
      chain.push(
        el('div', { class: 'node' }, [
          el('div', { class: 'node-head' }, [
            el('span', { class: 'node-kind', text: 'Material' }),
            el('span', { class: 'node-name', text: detail.material.name }),
            el('span', { class: 'node-sub', text: detail.material.shader }),
          ]),
          el('div', { class: 'node-body' }, Object.entries(detail.textures).map(([role, texture]) => textureRow(role, texture))),
        ]),
      );
    }
    chain.push(renderFamily('Base', detail.family.base));
    if (detail.family.lods.length) chain.push(renderFamily('LODs', detail.family.lods));
    if (detail.family.pieces.length) chain.push(renderFamily('Piezas', detail.family.pieces));

    dom.detail.replaceChildren(
      header(name, `${shortPath(primary.brf)} · ${primary.material}`,
        [badge('malla', 'accent'), badge(`v${primary.vertexVersion}`), primary.rigged ? badge('rigged') : badge('rígida')]),
      stats,
      el('h3', { class: 'section-title', text: 'Cadena y familia' }),
      el('div', { class: 'chain' }, chain),
    );
    renderRefs('Ítems que la usan', detail.usedByItems.map((item) => ({
      label: item.id,
      sub: displayName(item.name),
      onClick: () => openItem(item.id),
    })));
  }

  function renderFamily(title, entries) {
    return el('div', { class: 'node' }, [
      el('div', { class: 'node-head' }, [
        el('span', { class: 'node-kind', text: title }),
        el('span', { class: 'node-name', text: `${entries.length}` }),
        el('span', { class: 'node-sub', text: entries.map((entry) => entry.name).slice(0, 3).join(', ') }),
      ]),
      el('div', { class: 'node-body' }, entries.map((entry) =>
        el('div', { class: 'texture-row' }, [
          el('span', { class: 'texture-role', text: entry.lodLevel ? `lod${entry.lodLevel}` : entry.pieceIndex ? `pieza ${entry.pieceIndex}` : 'base' }),
          el('span', { class: 'texture-name', text: entry.name }),
          el('span', { class: 'texture-dims', text: `${entry.vertexCount} v` }),
        ]),
      )),
    ]);
  }

  function renderMaterial(name, detail) {
    const material = detail.material;
    const stats = el('div', { class: 'stats' }, [
      stat('Shader', material.shader, true),
      stat('Color', rgb(material.color)),
      stat('Specular', material.specular.toFixed(2)),
      stat('BRF', shortPath(material.brf)),
    ]);
    dom.detail.replaceChildren(
      header(name, shortPath(material.brf), [badge('material', 'accent')]),
      stats,
      el('h3', { class: 'section-title', text: 'Texturas' }),
      el('div', { class: 'node' }, [
        el('div', { class: 'node-body' }, Object.entries(detail.textures).map(([role, texture]) => textureRow(role, texture))),
      ]),
    );
    renderRefs('Mallas que lo usan', detail.meshes.map((mesh) => ({
      label: mesh.name,
      sub: `${mesh.vertexCount} v`,
      onClick: () => select('mesh', mesh.name),
    })));
  }

  function renderTexture(name, detail) {
    const stats = el('div', { class: 'stats' }, [
      stat('Ancho', detail.dds?.width ?? '—', true),
      stat('Alto', detail.dds?.height ?? '—'),
      stat('Formato', detail.dds?.format ?? '—'),
      stat('Mips', detail.dds?.mipmaps ?? '—'),
    ]);
    const info = el('div', { class: 'node' }, [
      el('div', { class: 'node-body' }, [
        el('div', { class: 'texture-row' }, [
          el('span', { class: 'texture-role', text: 'Archivo' }),
          el('span', { class: 'texture-name', text: detail.file.relativePath ?? 'no encontrado' }),
          el('span', { class: 'texture-dims', text: detail.file.location ?? '' }),
        ]),
        el('div', { class: 'texture-row' }, [
          el('span', { class: 'texture-role', text: 'BRF' }),
          el('span', { class: 'texture-name', text: detail.sources.map(shortPath).join(', ') || '—' }),
          el('span', { class: 'texture-dims', text: detail.declared ? 'declarada' : 'no declarada' }),
        ]),
      ]),
    ]);
    dom.detail.replaceChildren(
      header(name, detail.file.filePath ?? 'sin archivo',
        [badge('textura', 'accent'), detail.file.exists ? badge('archivo presente', 'ok') : badge('archivo ausente', 'bad')]),
      stats,
      el('h3', { class: 'section-title', text: 'Resolución' }),
      info,
    );
    renderRefs('Materiales que la usan', detail.materials.map((material) => ({
      label: material.name,
      sub: material.shader,
      onClick: () => select('material', material.name),
    })));
  }

  function renderShader(name, detail) {
    dom.detail.replaceChildren(
      header(name, `${detail.sources.length} BRF`, [badge('shader', 'accent')]),
      el('h3', { class: 'section-title', text: 'Origen' }),
      el('div', { class: 'node' }, [
        el('div', { class: 'node-body' }, detail.sources.map((source) =>
          el('div', { class: 'texture-row' }, [
            el('span', { class: 'texture-role', text: 'BRF' }),
            el('span', { class: 'texture-name', text: shortPath(source) }),
            el('span', { class: 'texture-dims', text: '' }),
          ]),
        )),
      ]),
    );
    renderRefs('Materiales que lo usan', detail.materials.map((material) => ({
      label: material.name,
      sub: shortPath(material.brf),
      onClick: () => select('material', material.name),
    })));
  }

  function renderRefs(title, refs) {
    dom.refsCount.textContent = String(refs.length);
    if (refs.length === 0) {
      dom.refs.replaceChildren(el('p', { class: 'muted', text: 'Sin referencias.' }));
      return;
    }
    dom.refs.replaceChildren(
      el('div', { class: 'hint', text: title }),
      ...refs.map((ref) => el('button', {
        class: 'ref-row',
        type: 'button',
        onclick: ref.onClick,
      }, [
        el('span', { class: 'ref-name', text: ref.label }),
        el('span', { class: 'ref-sub', text: ref.sub ?? '' }),
      ])),
    );
  }

  function rgb(color) {
    return `rgb(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)})`;
  }

  function init() {
    let timer = null;
    dom.search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        view.q = dom.search.value.trim();
        load(state.moduleId);
      }, 160);
    });

    dom.types.addEventListener('click', (event) => {
      const button = event.target.closest('.chip');
      if (!button) return;
      for (const chip of dom.types.querySelectorAll('.chip')) chip.classList.remove('is-active');
      button.classList.add('is-active');
      view.type = button.dataset.type;
      view.selected = null;
      load(state.moduleId);
    });

    dom.more.addEventListener('click', () => load(state.moduleId, { append: true }));
  }

  function invalidate() {
    view.loadedFor = null;
  }

  return { init, load, select, invalidate, view };
}
