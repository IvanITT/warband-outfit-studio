/** Backup catalogue view (projects + workspace files). */

import { ApiError } from './api.js';
import { el } from './ui.js';

/**
 * @param {{ api:any, dom:any, setStatus:(text:string)=>void }} ctx
 */
export function createBackupsView(ctx) {
  const { api, dom, setStatus } = ctx;
  let loaded = false;

  function bytesLabel(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function row({ title, path, meta, sha, onRestore }) {
    return el('div', { class: 'backup-row' }, [
      el('div', {}, [
        el('div', { class: 'title', text: title }),
        el('div', { class: 'path', text: path }),
      ]),
      el('div', { class: 'meta', text: `${meta}\n${sha ? `sha256 ${sha.slice(0, 12)}…` : ''}` }),
      el('button', { class: 'ghost small', type: 'button', text: 'Restaurar', onclick: onRestore }),
    ]);
  }

  async function restore(entry) {
    const expected = entry.kind === 'project' ? entry.id : entry.workspaceId;
    const confirm = window.prompt(
      `Restaurar esta copia sobrescribirá el estado actual.\n\nEscribe "${expected}" para confirmar:`,
      '',
    );
    if (confirm === null) return;
    try {
      if (entry.kind === 'project') {
        await api.restoreBackup({ kind: 'project', path: entry.path, confirm });
      } else {
        await api.restoreBackup({ kind: 'workspace', workspaceId: entry.workspaceId, path: entry.path, confirm });
      }
      setStatus(`Copia restaurada: ${expected}`);
      await load();
    } catch (error) {
      setStatus(`No se pudo restaurar: ${error instanceof ApiError ? error.message : String(error)}`);
    }
  }

  async function load() {
    try {
      const data = await api.backups();
      render(data);
      loaded = true;
      setStatus(`${data.projects.length} copias de proyecto · ${data.workspaces.length} de workspace`);
    } catch (error) {
      dom.list.replaceChildren(
        el('p', { class: 'muted', text: `No se pudieron cargar las copias: ${error instanceof ApiError ? error.message : String(error)}` }),
      );
    }
  }

  function render(data) {
    const sections = [];

    const projectSection = el('div', { class: 'backup-section' }, [
      el('h3', { text: `Proyectos (${data.projects.length})` }),
    ]);
    if (data.projects.length === 0) {
      projectSection.append(el('div', { class: 'backup-empty', text: 'Todavía no hay copias de proyectos.' }));
    } else {
      projectSection.append(...data.projects.map((entry) => row({
        title: `${entry.name} · ${entry.id}`,
        path: entry.path,
        meta: `${entry.createdAt ?? entry.updatedAt} · ${bytesLabel(entry.bytes)}`,
        sha: entry.sha256,
        onRestore: () => restore(entry),
      })));
    }
    sections.push(projectSection);

    const workspaceSection = el('div', { class: 'backup-section' }, [
      el('h3', { text: `Workspaces (${data.workspaces.length})` }),
    ]);
    if (data.workspaces.length === 0) {
      workspaceSection.append(el('div', { class: 'backup-empty', text: 'Todavía no hay copias de workspace.' }));
    } else {
      workspaceSection.append(...data.workspaces.map((entry) => row({
        title: `${entry.workspaceId} · ${entry.file}`,
        path: entry.path,
        meta: `${entry.backedUpAt ?? ''} · ${bytesLabel(entry.bytes)}`,
        sha: entry.sha256,
        onRestore: () => restore(entry),
      })));
    }
    sections.push(workspaceSection);

    dom.list.replaceChildren(...sections);
    dom.count.textContent = String(data.projects.length + data.workspaces.length);
  }

  function init() {
    dom.refresh.addEventListener('click', () => load());
  }

  async function ensureLoaded() {
    if (!loaded) await load();
    else await load();
  }

  return { init, load, ensureLoaded };
}
