/** Workspace lifecycle view: create, list, delete. */

import { ApiError } from './api.js';
import { el, badge } from './ui.js';

/**
 * @param {{ api:any, state:any, dom:any, setStatus:(text:string)=>void }} ctx
 */
export function createWorkspacesView(ctx) {
  const { api, state, dom, setStatus } = ctx;

  function errorText(error) {
    return error instanceof ApiError ? error.message : String(error);
  }

  async function load() {
    try {
      const data = await api.workspaces();
      render(data.workspaces);
      setStatus(`${data.workspaces.length} workspace(s)`);
    } catch (error) {
      dom.list.replaceChildren(el('p', { class: 'muted', text: errorText(error) }));
    }
  }

  function render(workspaces) {
    dom.count.textContent = String(workspaces.length);
    if (workspaces.length === 0) {
      dom.list.replaceChildren(el('div', { class: 'backup-empty', text: 'No hay workspaces todavía. Crea uno para preparar recursos sin tocar el juego.' }));
      return;
    }
    dom.list.replaceChildren(
      el('div', { class: 'backup-section' }, [
        el('h3', { text: 'Workspaces' }),
        ...workspaces.map((workspace) => el('div', { class: 'backup-row' }, [
          el('div', {}, [
            el('div', { class: 'title' }, [
              el('span', { text: workspace.label }),
              badge(workspace.id),
              workspace.moduleId ? badge(workspace.moduleId, 'accent') : null,
            ]),
            el('div', { class: 'path', text: `workspace/${workspace.id}/` }),
          ]),
          el('div', { class: 'meta', text: `${workspace.files} archivo(s)\n${workspace.updatedAt ?? ''}` }),
          el('button', {
            class: 'ghost small',
            type: 'button',
            text: 'Eliminar',
            onclick: async () => {
              const confirm = window.prompt(
                `Esto borra el workspace y sus backups locales.\nEscribe "${workspace.id}" para confirmar:`,
                '',
              );
              if (confirm === null) return;
              try {
                await api.removeWorkspace(workspace.id, confirm);
                setStatus(`Workspace eliminado: ${workspace.id}`);
                await load();
              } catch (error) {
                setStatus(`No se pudo eliminar: ${errorText(error)}`);
              }
            },
          }),
        ])),
      ]),
    );
  }

  async function create() {
    const label = dom.label.value.trim();
    if (!label) {
      setStatus('Escribe un nombre para el workspace.');
      return;
    }
    try {
      const { workspace } = await api.createWorkspace({ label, module: state.moduleId });
      dom.label.value = '';
      setStatus(`Workspace creado: ${workspace.id}`);
      await load();
    } catch (error) {
      setStatus(`No se pudo crear: ${errorText(error)}`);
    }
  }

  function init() {
    dom.create.addEventListener('click', create);
    dom.label.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') create();
    });
    dom.refresh.addEventListener('click', () => load());
  }

  return { init, load };
}
