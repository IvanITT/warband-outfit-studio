/** Project build view (Phase 8). */

import { ApiError } from './api.js';
import { el } from './ui.js';

function errorText(error) {
  return error instanceof ApiError ? error.message : String(error);
}

export function createBuildView(ctx) {
  const { api, state, dom, setStatus } = ctx;
  let projects = [];
  let builds = [];
  let projectId = '';
  let busy = false;

  function message(text, tone = '') {
    if (!dom.buildResult) return;
    dom.buildResult.replaceChildren(el('div', { class: `build-message ${tone}`.trim(), text }));
  }

  function renderProjects() {
    if (!dom.buildProject) return;
    if (!projects.some((project) => project.id === projectId)) projectId = projects[0]?.id ?? '';
    dom.buildProject.replaceChildren(
      ...(projects.length
        ? projects.map((project) => el('option', {
          value: project.id,
          text: `${project.name} · ${project.target?.moduleId ?? 'sin módulo'}`,
        }))
        : [el('option', { value: '', text: 'No hay proyectos' })]),
    );
    dom.buildProject.value = projectId;
    dom.buildStart.disabled = !projectId || busy;
  }

  function renderBuildList() {
    if (!dom.buildList) return;
    dom.buildCount.textContent = String(builds.length);
    if (builds.length === 0) {
      dom.buildList.replaceChildren(el('p', { class: 'muted', text: 'Todavía no hay builds.' }));
      return;
    }
    dom.buildList.replaceChildren(...builds.map((build) => el('button', {
      class: 'build-row',
      type: 'button',
      onclick: () => showBuild(build.id),
    }, [
      el('span', { class: 'name', text: build.label ?? build.id }),
      el('span', { class: 'sub', text: `${build.projectName ?? build.projectId} · ${build.moduleId}` }),
      el('span', { class: 'meta', text: `${build.mode} · ${build.summary?.files ?? 0} archivo(s)` }),
    ])));
  }

  function renderManifest(manifest, log) {
    const summary = manifest.summary ?? {};
    const actions = el('div', { class: 'build-actions' }, [
      el('button', {
        class: 'ghost small',
        type: 'button',
        text: 'Ver diff',
        onclick: () => showDiff(manifest.id),
      }),
      el('button', {
        class: 'ghost small',
        type: 'button',
        text: 'Rollback al proyecto',
        onclick: () => rollback(manifest),
      }),
    ]);
    const fileRows = (manifest.files ?? []).map((file) => el('div', { class: 'build-file' }, [
      el('span', { class: 'kind', text: file.kind }),
      el('span', { class: 'path', text: file.target }),
      el('span', { class: 'bytes', text: `${file.bytes} B` }),
    ]));
    const children = [
      el('div', { class: 'build-result-head' }, [
        el('h2', { text: manifest.id }),
        el('div', { class: 'badges' }, [
          el('span', { class: 'badge accent', text: manifest.mode }),
          el('span', { class: 'badge', text: manifest.moduleId }),
          el('span', { class: 'badge ok', text: `${summary.files ?? 0} archivos` }),
        ]),
      ]),
      el('p', { class: 'hint', text: `Proyecto ${manifest.projectName ?? manifest.projectId} · ${manifest.createdAt}` }),
      el('div', { class: 'build-stats' }, [
        el('span', { text: `${manifest.overrides?.meshes ?? 0} mallas` }),
        el('span', { text: `${manifest.overrides?.materials ?? 0} materiales` }),
        el('span', { text: `${manifest.overrides?.items ?? 0} ítems` }),
        el('span', { text: manifest.moduleRoot }),
      ]),
    ];
    if (manifest.warnings?.length) {
      children.push(el('div', { class: 'build-warnings' }, manifest.warnings.map((warning) => el('div', { text: `⚠ ${warning}` }))));
    }
    children.push(
      el('h3', { class: 'section-title', text: 'Archivos' }),
      el('div', { class: 'build-files' }, fileRows.length ? fileRows : [el('p', { class: 'muted', text: 'Sin archivos.' })]),
      actions,
      el('details', { class: 'build-log' }, [
        el('summary', { text: 'Log de build' }),
        el('pre', { text: log }),
      ]),
    );
    dom.buildResult.replaceChildren(...children);
  }

  async function showDiff(buildId) {
    try {
      const diff = await api.buildDiff(buildId);
      const rows = diff.files.map((file) => {
        const status = !file.comparable ? 'n/a' : file.changed ? (file.sourceExists ? 'changed' : 'added') : 'same';
        return el('div', { class: `diff-row ${status}` }, [
          el('span', { class: 'status', text: status }),
          el('span', { class: 'path', text: file.target }),
          el('span', { class: 'bytes', text: file.comparable ? `${file.builtBytes} B` : 'sin baseline' }),
        ]);
      });
      dom.buildResult.append(
        el('div', { class: 'diff-table' }, [
          el('h3', { class: 'section-title', text: `Diff · ${diff.summary.changed} cambiados / ${diff.summary.added ?? 0} añadidos / ${diff.summary.unchanged} iguales` }),
          ...rows,
        ]),
      );
    } catch (error) {
      message(`No se pudo comparar: ${errorText(error)}`, 'error');
    }
  }

  async function rollback(manifest) {
    const confirm = window.prompt(`Escribe el id del build para restaurar el proyecto '${manifest.projectId}':`, '');
    if (confirm !== manifest.id) {
      message('Rollback cancelado.', 'warning');
      return;
    }
    try {
      await api.rollbackBuild(manifest.id, manifest.projectId, confirm);
      message(`Proyecto restaurado desde ${manifest.id}.`, 'ok');
      setStatus(`Rollback aplicado: ${manifest.id}`);
    } catch (error) {
      message(`No se pudo hacer rollback: ${errorText(error)}`, 'error');
    }
  }

  async function pruneBuilds() {
    const keep = Number(dom.buildKeep?.value ?? 5) || 5;
    const confirm = window.prompt(`Se conservarán los ${keep} builds más recientes. Escribe PRUNE_BUILDS para confirmar:`, '');
    if (confirm !== 'PRUNE_BUILDS') {
      message('Limpieza cancelada.', 'warning');
      return;
    }
    try {
      const result = await api.pruneBuilds(keep, confirm);
      await loadBuilds();
      message(`Builds eliminados: ${result.removed.length} · restantes: ${result.remaining}.`, 'ok');
    } catch (error) {
      message(`No se pudo limpiar: ${errorText(error)}`, 'error');
    }
  }

  async function showBuild(buildId) {
    try {
      const result = await api.build(buildId);
      renderManifest(result.manifest, result.log);
    } catch (error) {
      message(`No se pudo leer el build: ${errorText(error)}`, 'error');
    }
  }

  async function build() {
    if (!projectId || busy) return;
    busy = true;
    dom.buildStart.disabled = true;
    dom.buildStart.textContent = 'Construyendo…';
    message('Construyendo: validando overrides y escribiendo el workspace…');
    try {
      const result = await api.buildProject(projectId, {
        copyModule: Boolean(dom.buildCopyModule?.checked),
      });
      renderManifest(result.manifest, result.manifest ? '' : '');
      if (result.manifest) {
        const detail = await api.build(result.buildId);
        renderManifest(detail.manifest, detail.log);
      }
      await loadBuilds();
      setStatus(`Build creado: ${result.buildId}`);
    } catch (error) {
      const issues = error.details?.errors;
      message(
        `Build fallido: ${errorText(error)}${Array.isArray(issues) && issues.length ? `\n${issues.join('\n')}` : ''}`,
        'error',
      );
      setStatus(`Build fallido: ${errorText(error)}`);
    } finally {
      busy = false;
      dom.buildStart.disabled = !projectId;
      dom.buildStart.textContent = 'Construir';
    }
  }

  async function loadBuilds() {
    try {
      const result = await api.builds();
      builds = result.builds;
      renderBuildList();
    } catch (error) {
      builds = [];
      renderBuildList();
      message(`No se pudieron listar los builds: ${errorText(error)}`, 'error');
    }
  }

  async function load() {
    try {
      const result = await api.projects();
      projects = result.projects;
      renderProjects();
      await loadBuilds();
      if (!projects.length) {
        message('Crea un proyecto desde Prendas, Visor o el editor de ítems para construir.', 'warning');
      }
    } catch (error) {
      message(`No se pudieron cargar los proyectos: ${errorText(error)}`, 'error');
    }
  }

  function init() {
    dom.buildProject?.addEventListener('change', () => {
      projectId = dom.buildProject.value;
    });
    dom.buildStart?.addEventListener('click', build);
    dom.buildPrune?.addEventListener('click', pruneBuilds);
    dom.buildRefresh?.addEventListener('click', load);
  }

  return { init, load };
}
