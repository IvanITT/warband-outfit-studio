/** Asset index view: meshes, materials, textures and shaders. */

import { ApiError } from './api.js';
import { decodeDds } from './dds.js';
import { el, badge, stat, displayName, shortPath, emptyState } from './ui.js';

/**
 * @param {{ api:any, state:any, dom:any, setStatus:(text:string)=>void, openItem:(id:string)=>void }} ctx
 */
export function createResourcesView(ctx) {
  const { api, state, dom, setStatus, openItem, openViewer } = ctx;
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
    projectId: '',
    projects: [],
    projectTextures: [],
  };
  let texturePreviewToken = 0;

  function detailEmpty(title, message, icon = '▦') {
    dom.detail.replaceChildren(emptyState(title, message, icon));
  }

  function handleError(error, context) {
    const message = error instanceof ApiError ? error.message : String(error);
    setStatus(`${context}: ${message}`);
    detailEmpty('Error', `${context}: ${message}`, '⚠');
  }

  async function refreshProjects() {
    try {
      const data = await api.projects();
      view.projects = data.projects;
      if (!view.projects.some((project) => project.id === view.projectId)) {
        view.projectId = view.projects[0]?.id ?? '';
      }
      dom.project.replaceChildren(
        ...(view.projects.length
          ? view.projects.map((project) => el('option', {
            value: project.id,
            text: `${project.name} · ${project.target?.moduleId ?? 'sin módulo'}`,
          }))
          : [el('option', { value: '', text: 'Sin proyectos' })]),
      );
      dom.project.value = view.projectId;
    } catch {
      view.projects = [];
      view.projectId = '';
      dom.project.replaceChildren(el('option', { value: '', text: 'Sin proyectos' }));
    }
  }

  async function refreshProjectTextures() {
    if (!view.projectId) {
      view.projectTextures = [];
      return;
    }
    try {
      const data = await api.projectTextures(view.projectId);
      view.projectTextures = data.textures;
    } catch {
      view.projectTextures = [];
    }
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
    dom.projectRow.hidden = view.type !== 'texture';
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
      if (view.type === 'texture') {
        if (!append) await refreshProjects();
        await refreshProjectTextures();
      }
      renderList();
      dom.count.textContent = String(view.total + view.projectTextures.length);
      dom.more.hidden = view.offset >= view.total;
      dom.more.disabled = false;
      setStatus(`${view.total} ${view.type}(s) en ${moduleId}${view.projectTextures.length ? ` + ${view.projectTextures.length} de proyecto` : ''}`);
    } catch (error) {
      handleError(error, 'No se pudieron cargar los recursos');
    } finally {
      view.loading = false;
    }
  }

  function renderList() {
    const needle = view.q.toLowerCase();
    const projectRows = view.type === 'texture'
      ? view.projectTextures
        .filter((texture) => !needle || texture.name.toLowerCase().includes(needle))
        .map((texture) => el('button', {
          class: `resource-row${view.selected?.name === texture.name && view.selected?.source === 'project' ? ' is-selected' : ''}`,
          type: 'button',
          onclick: () => select('texture', texture.name, 'project'),
        }, [
          el('span', { class: 'name', text: texture.name }),
          el('span', {
            class: 'sub',
            text: `proyecto · ${texture.width}×${texture.height} · ${texture.format}`,
          }),
          el('span', { class: 'meta', text: 'proyecto' }),
        ]))
      : [];
    if (view.items.length === 0 && projectRows.length === 0) {
      dom.list.replaceChildren(el('p', { class: 'muted', text: 'No hay recursos que coincidan.' }));
      return;
    }
    dom.list.replaceChildren(
      ...projectRows,
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
          class: `resource-row${view.selected?.name === item.name && view.selected?.source !== 'project' ? ' is-selected' : ''}`,
          type: 'button',
          onclick: () => select(view.type, item.name, 'module'),
        }, [
          el('span', { class: 'name', text: item.name }),
          el('span', { class: 'sub', text: sub }),
          el('span', { class: 'meta', text: meta }),
        ]);
      }),
    );
  }

  async function select(type, name, source = 'module') {
    view.type = type;
    view.selected = { type, name, source };
    for (const row of dom.list.querySelectorAll('.resource-row')) {
      row.classList.toggle('is-selected', row.querySelector('.name')?.textContent === name);
    }
    detailEmpty('Cargando recurso…', name);
    try {
      if (type === 'texture' && source === 'project') {
        const texture = view.projectTextures.find((entry) => entry.name === name);
        if (!texture) throw new Error('La textura del proyecto ya no está registrada.');
        await renderTexture(name, {
          file: {
            exists: true,
            relativePath: `${texture.workspaceId}/${texture.path}`,
            filePath: texture.path,
            location: 'proyecto',
          },
          dds: {
            width: texture.width,
            height: texture.height,
            format: texture.format,
            mipmaps: texture.mipmaps,
          },
          sources: [],
          declared: true,
          materials: [],
        }, 'project');
        setStatus(`textura de proyecto: ${name}`);
        return;
      }
      const { detail } = await api.resource(state.moduleId, type, name);
      if (type === 'mesh') renderMesh(name, detail);
      else if (type === 'material') renderMaterial(name, detail);
      else if (type === 'texture') await renderTexture(name, detail, 'module');
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
      el('div', { class: 'viewer-launch' }, [
        el('button', { class: 'primary', type: 'button', text: 'Ver en visor 3D', onclick: () => openViewer(name) }),
      ]),
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

  function fileToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function exportTexture(name, source) {
    try {
      const buffer = source === 'project'
        ? await api.projectTextureBuffer(view.projectId, name)
        : await api.textureBuffer(state.moduleId, name);
      const fileName = name.toLowerCase().endsWith('.dds') ? name : `${name}.dds`;
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' }));
      const link = el('a', { href: url, download: fileName });
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`Textura exportada: ${fileName}`);
    } catch (error) {
      setStatus(`No se pudo exportar: ${error instanceof ApiError ? error.message : String(error)}`);
    }
  }

  async function importTextureFile(fileInput, nameInput, message) {
    try {
      if (!view.projectId) throw new Error('Selecciona o crea un proyecto primero.');
      const file = fileInput.files?.[0];
      if (!file) throw new Error('Selecciona un archivo .dds.');
      if (!file.name.toLowerCase().endsWith('.dds')) throw new Error('El archivo debe ser .dds.');
      const target = nameInput.value.trim() || file.name;
      const buffer = await file.arrayBuffer();
      const workspaceResult = await api.createWorkspace({
        label: 'textures',
        module: state.moduleId,
        reuse: true,
      });
      const imported = await api.importTexture(
        workspaceResult.workspace.id,
        target,
        fileToBase64(buffer),
      );
      await api.saveProjectTexture(view.projectId, imported);
      await refreshProjectTextures();
      renderList();
      message.textContent = `Textura importada como ${imported.name} ? ${imported.width}?${imported.height} ${imported.format}`;
      message.dataset.tone = 'ok';
      setStatus(`Textura importada: ${imported.name}`);
      await select('texture', imported.name, 'project');
    } catch (error) {
      const text = error instanceof ApiError ? error.message : String(error);
      message.textContent = `No se pudo importar: ${text}`;
      message.dataset.tone = 'error';
      setStatus(`Importación fallida: ${text}`);
    }
  }

  function renderTextureToolkit(name, source) {
    const projectSelect = el('select', { id: 'texture-import-project' }, [
      ...(view.projects.length
        ? view.projects.map((project) => el('option', {
          value: project.id,
          text: project.name,
        }))
        : [el('option', { value: '', text: 'Sin proyectos' })]),
    ]);
    projectSelect.value = view.projectId;
    projectSelect.addEventListener('change', async () => {
      view.projectId = projectSelect.value;
      if (dom.project) dom.project.value = view.projectId;
      await refreshProjectTextures();
      renderList();
    });

    const fileInput = el('input', {
      type: 'file',
      accept: '.dds',
      class: 'texture-import-file',
    });
    const nameInput = el('input', {
      type: 'text',
      class: 'texture-import-name',
      value: source === 'project'
        ? name
        : `${name.replace(/\.dds$/i, '')}_custom.dds`,
      placeholder: 'nueva_textura.dds',
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) nameInput.value = file.name;
    });
    const message = el('div', { class: 'texture-import-message' });
    const importButton = el('button', {
      class: 'primary',
      type: 'button',
      text: 'Importar y guardar',
      disabled: !view.projectId,
      onclick: () => importTextureFile(fileInput, nameInput, message),
    });

    return el('div', { class: 'texture-toolkit' }, [
      el('div', { class: 'texture-toolkit-row' }, [
        el('button', {
          class: 'ghost small',
          type: 'button',
          text: 'Exportar DDS',
          onclick: () => exportTexture(name, source),
        }),
        el('span', {
          class: 'hint',
          text: 'Descarga el DDS original para editarlo en un programa externo.',
        }),
      ]),
      el('h3', { class: 'section-title', text: 'Importar como nueva textura' }),
      el('div', { class: 'texture-import-grid' }, [
        el('label', {}, [el('span', { text: 'Proyecto' }), projectSelect]),
        el('label', {}, [el('span', { text: 'Archivo .dds' }), fileInput]),
        el('label', {}, [el('span', { text: 'Nombre destino' }), nameInput]),
        el('label', { class: 'texture-import-action' }, [el('span', { text: '' }), importButton]),
      ]),
      el('div', {
        class: 'hint',
        text: 'La textura queda registrada en el proyecto y disponible para materiales, ítems y outfits.',
      }),
      message,
    ]);
  }

  async function renderTexture(name, detail, source = 'module') {
    const token = ++texturePreviewToken;
    const preview = el('div', { class: 'texture-preview' }, [
      el('div', { class: 'texture-preview-loading', text: 'Cargando textura…' }),
    ]);
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
      el('h3', { class: 'section-title', text: 'Vista previa' }),
      preview,
      renderTextureToolkit(name, source),
      el('h3', { class: 'section-title', text: 'Resolución' }),
      info,
    );
    renderRefs('Materiales que la usan', detail.materials.map((material) => ({
      label: material.name,
      sub: material.shader,
      onClick: () => select('material', material.name),
    })));

    try {
      const buffer = source === 'project'
        ? await api.projectTextureBuffer(view.projectId, name)
        : await api.textureBuffer(state.moduleId, name);
      if (token !== texturePreviewToken) return;
      const dds = decodeDds(buffer);
      const canvas = el('canvas', {
        class: 'texture-canvas',
        width: dds.width,
        height: dds.height,
        'aria-label': `Vista previa de ${name}`,
      });
      const context = canvas.getContext('2d');
      context.putImageData(
        new ImageData(new Uint8ClampedArray(dds.data), dds.width, dds.height),
        0,
        0,
      );
      preview.replaceChildren(
        canvas,
        el('div', {
          class: 'texture-preview-meta',
          text: `${dds.width} × ${dds.height} · ${dds.format}`,
        }),
      );
    } catch (error) {
      if (token !== texturePreviewToken) return;
      preview.replaceChildren(
        el('div', {
          class: 'texture-preview-error',
          text: `No se pudo cargar la vista previa: ${error instanceof ApiError ? error.message : String(error)}`,
        }),
      );
    }
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

    dom.project?.addEventListener('change', async () => {
      view.projectId = dom.project.value;
      await refreshProjectTextures();
      renderList();
    });

    dom.projectNew?.addEventListener('click', async () => {
      const name = window.prompt('Nombre del proyecto de texturas:', 'Texturas');
      if (!name) return;
      try {
        const created = await api.createProject({ name, module: state.moduleId });
        view.projectId = created.project.id;
        await refreshProjects();
        await refreshProjectTextures();
        renderList();
        setStatus(`Proyecto creado: ${created.project.name}`);
      } catch (error) {
        setStatus(`No se pudo crear el proyecto: ${error instanceof ApiError ? error.message : String(error)}`);
      }
    });
  }

  function invalidate() {
    view.loadedFor = null;
  }

  return { init, load, select, invalidate, view };
}
