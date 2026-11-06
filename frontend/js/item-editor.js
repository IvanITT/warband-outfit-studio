/** Item editor form (Phase 7).
 *
 * The editor is rendered inside the existing item-detail pane so the list,
 * asset chain and validation view stay available. It edits a project override;
 * exporting merges all project item overrides into a workspace copy of
 * `item_kinds1.txt`.
 */

import { ApiError } from './api.js';
import { el, displayName } from './ui.js';

const TEXT_FIELDS = ['name', 'plural'];
const NUMBER_FIELDS = [
  'flags', 'value', 'modifierBits', 'weight', 'abundance', 'headArmor',
  'bodyArmor', 'legArmor', 'difficulty', 'hitPoints', 'speedRating',
  'missileSpeed', 'weaponLength', 'maxAmmo', 'thrustDamage', 'swingDamage',
];
const FIELD_LABELS = {
  name: 'Nombre',
  plural: 'Plural',
  flags: 'Flags',
  capabilities: 'Capabilities',
  value: 'Valor',
  modifierBits: 'Modifier bits',
  weight: 'Peso',
  abundance: 'Abundancia',
  headArmor: 'Armadura cabeza',
  bodyArmor: 'Armadura cuerpo',
  legArmor: 'Armadura piernas',
  difficulty: 'Dificultad',
  hitPoints: 'Puntos de golpe',
  speedRating: 'Velocidad',
  missileSpeed: 'Velocidad proyectil',
  weaponLength: 'Longitud',
  maxAmmo: 'Munición',
  thrustDamage: 'Daño estocada',
  swingDamage: 'Daño corte',
};

function field(label, input) {
  return el('label', { class: 'editor-field' }, [
    el('span', { text: label }),
    input,
  ]);
}

function numberField(name, value, step = '1') {
  return el('input', {
    type: 'number',
    step,
    'data-field': name,
    value: String(value ?? 0),
  });
}

export function createItemEditor(ctx) {
  const { api, state, dom, setStatus, onClose, previewItem } = ctx;

  let schema = null;
  let projects = [];
  let projectId = '';
  let baseItem = null;
  let mode = 'edit';
  let messageNode = null;

  function message(text, tone = '') {
    if (!messageNode) return;
    messageNode.textContent = text;
    messageNode.dataset.tone = tone;
  }

  async function loadGlobals() {
    if (!schema) schema = await api.itemSchema();
    const data = await api.projects();
    projects = data.projects;
    if (!projects.some((project) => project.id === projectId)) {
      projectId = projects[0]?.id ?? '';
    }
  }

  function blankForm() {
    return {
      id: 'itm_new_item',
      baseItemId: null,
      mode: 'create',
      fields: {
        name: 'new_item',
        plural: 'new_items',
        flags: 0x0D,
        capabilities: '0',
        value: 0,
        modifierBits: 0,
        weight: 0,
        abundance: 0,
        headArmor: 0,
        bodyArmor: 0,
        legArmor: 0,
        difficulty: 0,
        hitPoints: 0,
        speedRating: 0,
        missileSpeed: 0,
        weaponLength: 0,
        maxAmmo: 0,
        thrustDamage: 0,
        swingDamage: 0,
      },
      meshes: [],
      factions: [],
      triggers: [],
      notes: '',
    };
  }

  function fromRecord(item) {
    const fields = {};
    for (const key of [...TEXT_FIELDS, 'capabilities', ...NUMBER_FIELDS]) {
      fields[key] = item[key];
    }
    return {
      id: item.id,
      baseItemId: item.id,
      mode: 'edit',
      fields,
      meshes: item.meshes.map((mesh) => ({ ...mesh })),
      factions: [...(item.factions ?? [])],
      triggers: [...(item.triggers ?? [])],
      notes: '',
    };
  }

  function fromOverride(override, fallback) {
    return {
      ...fallback,
      id: override.id,
      baseItemId: override.baseItemId ?? null,
      mode: override.baseItemId ? 'edit' : 'create',
      fields: { ...fallback.fields, ...(override.fields ?? {}) },
      meshes: (override.meshes ?? fallback.meshes).map((mesh) => ({ ...mesh })),
      factions: [...(override.factions ?? fallback.factions ?? [])],
      triggers: [...(override.triggers ?? fallback.triggers ?? [])],
      notes: override.notes ?? '',
    };
  }

  async function loadOverride() {
    if (!projectId || !baseItem) return null;
    try {
      const result = await api.itemOverride(projectId, baseItem.id);
      return result.override;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'ITEM_OVERRIDE_NOT_FOUND') return null;
      throw error;
    }
  }

  function describeFlags(value) {
    if (!schema) return [];
    const bits = BigInt(Math.max(0, Number(value) || 0));
    const parts = [];
    const type = schema.types.find((entry) => (bits & BigInt(schema.fields.type.mask)) === BigInt(entry.value));
    if (type) parts.push(type.name.replace(/^itp_type_/, ''));
    const attachment = schema.attachment.find((entry) => (bits & BigInt(schema.fields.attachment.mask)) === BigInt(entry.value));
    if (attachment) parts.push(attachment.name.replace(/^itp_/, ''));
    for (const entry of schema.flags) {
      if ((bits & BigInt(entry.value)) === BigInt(entry.value)) parts.push(entry.name.replace(/^itp_/, ''));
    }
    return parts;
  }

  function readForm() {
    const fields = {};
    for (const name of [...TEXT_FIELDS, ...NUMBER_FIELDS]) {
      const input = dom.detail.querySelector(`[data-field="${name}"]`);
      fields[name] = name === 'name' || name === 'plural'
        ? input?.value.trim() ?? ''
        : Number(input?.value ?? 0);
    }
    const capabilitiesInput = dom.detail.querySelector('[data-field="capabilities"]');
    fields.capabilities = capabilitiesInput?.value.trim() ?? '0';

    const meshes = [];
    for (const row of dom.detail.querySelectorAll('.editor-mesh-row')) {
      const name = row.querySelector('[data-mesh-name]')?.value.trim();
      const bits = Number(row.querySelector('[data-mesh-bits]')?.value ?? 0);
      if (name) meshes.push({ name, modifierBits: Number.isFinite(bits) ? bits : 0 });
    }

    return {
      schemaVersion: 1,
      id: dom.detail.querySelector('[data-field="id"]')?.value.trim() ?? '',
      baseItemId: mode === 'edit' ? baseItem?.id ?? null : null,
      mode,
      moduleId: state.moduleId,
      fields,
      meshes,
      factions: [...(render.currentForm?.factions ?? baseItem?.factions ?? [])],
      triggers: [...(render.currentForm?.triggers ?? baseItem?.triggers ?? [])],
      notes: '',
    };
  }

  function renderMeshRows(container, meshes) {
    container.replaceChildren();
    const addRow = (mesh = { name: '', modifierBits: 0 }) => {
      const row = el('div', { class: 'editor-mesh-row' }, [
        el('input', {
          type: 'text',
          'data-mesh-name': '',
          placeholder: 'nombre de malla',
          value: mesh.name ?? '',
        }),
        el('input', {
          type: 'number',
          'data-mesh-bits': '',
          value: String(mesh.modifierBits ?? 0),
          title: 'modifierBits',
        }),
        el('button', {
          class: 'ghost small',
          type: 'button',
          text: '×',
          title: 'Quitar malla',
          onclick: () => row.remove(),
        }),
      ]);
      container.append(row);
    };
    for (const mesh of meshes) addRow(mesh);
    if (meshes.length === 0) {
      container.append(el('p', { class: 'hint', text: 'Sin mallas. Añade al menos una para que el ítem tenga geometría.' }));
    }
    return addRow;
  }

  function render() {
    const form = mode === 'edit' && baseItem
      ? fromRecord(baseItem)
      : blankForm();
    if (mode === 'edit' && baseItem) {
      // loadOverride is handled before render; currentForm is attached below.
    }
    const current = render.currentForm ?? form;
    const fields = current.fields;

    messageNode = el('div', { class: 'editor-message', id: 'item-editor-message' });

    const projectSelect = el('select', { id: 'item-editor-project' }, [
      ...(projects.length
        ? projects.map((project) => el('option', { value: project.id, text: project.name }))
        : [el('option', { value: '', text: 'Sin proyectos' })]),
    ]);
    projectSelect.value = projectId;
    projectSelect.addEventListener('change', async () => {
      projectId = projectSelect.value;
      try {
        const override = await loadOverride();
        render.currentForm = override
          ? fromOverride(override, fromRecord(baseItem))
          : (baseItem ? fromRecord(baseItem) : blankForm());
        render();
      } catch (error) {
        message(`No se pudo cargar el override: ${errorText(error)}`, 'error');
      }
    });

    const newProject = el('button', {
      class: 'ghost small',
      type: 'button',
      text: '+ Proyecto',
      onclick: async () => {
        const name = window.prompt('Nombre del proyecto:', 'Item edits');
        if (!name) return;
        try {
          const created = await api.createProject({ name, module: state.moduleId });
          await loadGlobals();
          projectId = created.project.id;
          render.currentForm = baseItem ? fromRecord(baseItem) : blankForm();
          render();
        } catch (error) {
          message(`No se pudo crear el proyecto: ${errorText(error)}`, 'error');
        }
      },
    });

    const projectRow = el('div', { class: 'editor-project-row' }, [
      el('span', { class: 'editor-label', text: 'Proyecto' }),
      projectSelect,
      newProject,
    ]);

    const idInput = el('input', {
      type: 'text',
      'data-field': 'id',
      value: current.id,
      readonly: mode === 'edit' ? 'readonly' : undefined,
      class: mode === 'edit' ? 'is-readonly' : '',
    });
    if (mode === 'edit') idInput.title = 'El id de un ítem existente no se puede cambiar.';

    const formGrid = el('div', { class: 'editor-grid' }, [
      field('ID', idInput),
      field('Nombre', el('input', { type: 'text', 'data-field': 'name', value: fields.name ?? '' })),
      field('Plural', el('input', { type: 'text', 'data-field': 'plural', value: fields.plural ?? '' })),
      field('Tipo', renderTypeSelect(fields.flags, fields)),
      field('Flags', numberField('flags', fields.flags)),
      ...NUMBER_FIELDS.filter((name) => name !== 'flags').map((name) => field(
        FIELD_LABELS[name] ?? name,
        numberField(name, fields[name], name === 'weight' ? '0.1' : '1'),
      )),
      field('Capabilities', el('input', {
        type: 'text',
        'data-field': 'capabilities',
        value: String(fields.capabilities ?? '0'),
        placeholder: 'decimal de 64 bits',
      })),
    ]);

    const flagsInput = formGrid.querySelector('[data-field="flags"]');
    const typeSelect = formGrid.querySelector('[data-type-select]');
    const flagHint = el('div', { class: 'editor-flag-hint' });
    const updateFlagHint = () => {
      flagHint.textContent = describeFlags(flagsInput.value).join(' · ') || 'Sin flags simbólicos';
    };
    flagsInput.addEventListener('input', () => {
      const typeValue = String(Number(flagsInput.value) & Number(schema.fields.type.mask));
      if ([...typeSelect.options].some((option) => option.value === typeValue)) typeSelect.value = typeValue;
      updateFlagHint();
    });
    typeSelect.addEventListener('change', () => {
      const mask = BigInt(schema.fields.type.mask);
      const value = BigInt(Math.max(0, Number(flagsInput.value) || 0));
      flagsInput.value = String((value & ~mask) | BigInt(typeSelect.value));
      updateFlagHint();
    });
    updateFlagHint();

    const meshList = el('div', { class: 'editor-mesh-list' });
    const addRow = renderMeshRows(meshList, current.meshes);
    const addMesh = el('button', {
      class: 'ghost small',
      type: 'button',
      text: '+ Añadir malla',
      onclick: () => {
        if (meshList.querySelector('.hint')) meshList.replaceChildren();
        addRow({ name: '', modifierBits: 0 });
      },
    });

    const save = el('button', {
      class: 'primary',
      type: 'button',
      text: 'Guardar override',
      onclick: () => saveOverride(),
    });
    const preview = el('button', {
      class: 'ghost small',
      type: 'button',
      text: 'Previsualizar en outfit',
      onclick: () => previewCurrent(),
    });
    const exportButton = el('button', {
      class: 'ghost small',
      type: 'button',
      text: 'Exportar items',
      onclick: () => exportAll(),
    });
    const remove = el('button', {
      class: 'ghost small danger',
      type: 'button',
      text: 'Eliminar override',
      onclick: () => deleteOverride(),
    });
    const close = el('button', {
      class: 'ghost small',
      type: 'button',
      text: 'Cerrar',
      onclick: () => closeEditor(),
    });

    const editor = el('div', { class: 'item-editor' }, [
      el('div', { class: 'editor-head' }, [
        el('div', {}, [
          el('h2', { text: mode === 'edit' ? `Editar ${baseItem?.id ?? ''}` : 'Nuevo ítem' }),
          el('p', { class: 'hint', text: 'El original no se modifica: guarda un override y expórtalo a un workspace.' }),
        ]),
        close,
      ]),
      projectRow,
      el('div', { class: 'editor-section' }, [
        el('h3', { class: 'section-title', text: 'Identidad y estadísticas' }),
        formGrid,
        flagHint,
      ]),
      el('div', { class: 'editor-section' }, [
        el('h3', { class: 'section-title', text: 'Mallas' }),
        meshList,
        addMesh,
      ]),
      el('div', { class: 'editor-actions' }, [
        save,
        preview,
        exportButton,
        remove,
      ]),
      messageNode,
    ]);

    dom.detail.replaceChildren(editor);
    setStatus(`Editor de ítems: ${current.id}`);
  }

  function renderTypeSelect(flags, fields) {
    const value = String(Number(flags) & Number(schema.fields.type.mask));
    const select = el('select', { 'data-type-select': '' }, schema.types.map((entry) => el('option', {
      value: entry.value,
      text: entry.name.replace(/^itp_type_/, ''),
    })));
    select.value = value;
    if (!select.value) {
      select.append(el('option', { value, text: `desconocido (${value})` }));
      select.value = value;
    }
    return select;
  }

  function errorText(error) {
    return error instanceof ApiError ? error.message : String(error);
  }

  async function saveOverride() {
    try {
      if (!projectId) throw new Error('Selecciona o crea un proyecto.');
      const override = readForm();
      await api.saveItemOverride(projectId, override);
      render.currentForm = {
        ...override,
        baseItemId: override.baseItemId,
      };
      mode = override.baseItemId ? 'edit' : 'create';
      message(`Override guardado: ${override.id}`, 'ok');
      setStatus(`Item override guardado: ${override.id}`);
    } catch (error) {
      message(`No se pudo guardar: ${errorText(error)}`, 'error');
    }
  }

  async function previewCurrent() {
    try {
      if (mode !== 'edit' || !baseItem) {
        message('Guarda y exporta un ítem nuevo antes de previsualizarlo.', 'warning');
        return;
      }
      if (!previewItem) throw new Error('El visor no está disponible.');
      await previewItem(baseItem.id, baseItem.slot);
      message('Previsualización enviada al visor (assets base del módulo).', 'ok');
    } catch (error) {
      message(`No se pudo previsualizar: ${errorText(error)}`, 'error');
    }
  }

  async function exportAll() {
    try {
      if (!projectId) throw new Error('Selecciona o crea un proyecto.');
      const result = await api.exportItemOverrides(projectId, 'item-edits');
      message(`Exportado en ${result.workspaceId}/${result.file.split(/[\\/]/).pop()} (${result.overrides} override(s)).`, 'ok');
      setStatus(`Items exportados: ${result.workspaceId}`);
    } catch (error) {
      message(`No se pudo exportar: ${errorText(error)}`, 'error');
    }
  }

  async function deleteOverride() {
    try {
      if (!projectId) throw new Error('Selecciona o crea un proyecto.');
      const itemId = baseItem?.id ?? render.currentForm?.id;
      if (!itemId) throw new Error('No hay un override que eliminar.');
      const confirm = window.prompt(`Escribe el id para eliminar el override '${itemId}':`, '');
      if (confirm !== itemId) {
        message('Eliminación cancelada.', 'warning');
        return;
      }
      await api.removeItemOverride(projectId, itemId, confirm);
      if (baseItem) {
        render.currentForm = fromRecord(baseItem);
        render();
      } else {
        render.currentForm = blankForm();
        render();
      }
      message(`Override eliminado: ${itemId}`, 'ok');
    } catch (error) {
      message(`No se pudo eliminar: ${errorText(error)}`, 'error');
    }
  }

  function closeEditor() {
    onClose?.();
  }

  async function open(detail) {
    baseItem = detail.item;
    mode = 'edit';
    try {
      await loadGlobals();
      const override = await loadOverride();
      render.currentForm = override ? fromOverride(override, fromRecord(baseItem)) : fromRecord(baseItem);
      render();
    } catch (error) {
      dom.detail.replaceChildren(el('p', { class: 'muted', text: `No se pudo abrir el editor: ${errorText(error)}` }));
    }
  }

  async function openNew() {
    baseItem = null;
    mode = 'create';
    try {
      await loadGlobals();
      render.currentForm = blankForm();
      render();
    } catch (error) {
      dom.detail.replaceChildren(el('p', { class: 'muted', text: `No se pudo abrir el editor: ${errorText(error)}` }));
    }
  }

  return { open, openNew };
}
