/** Installation profiles modal. */

import { ApiError } from './api.js';
import { el, badge } from './ui.js';

/**
 * @param {{ api:any, dom:any, setStatus:(text:string)=>void, onChanged:()=>Promise<void> }} ctx
 */
export function createInstallations(ctx) {
  const { api, dom, setStatus, onChanged } = ctx;

  function errorText(error) {
    return error instanceof ApiError ? error.message : String(error);
  }

  async function refresh() {
    try {
      const data = await api.profiles();
      render(data);
    } catch (error) {
      dom.list.replaceChildren(el('p', { class: 'muted', text: errorText(error) }));
    }
  }

  function render(data) {
    const profiles = data.profiles ?? [];
    if (profiles.length === 0) {
      dom.list.replaceChildren(el('p', { class: 'muted', text: 'No hay instalaciones registradas.' }));
      return;
    }
    dom.list.replaceChildren(...profiles.map((profile) => {
      const active = profile.id === data.activeId;
      return el('div', { class: `profile-row${active ? ' is-active' : ''}` }, [
        el('div', {}, [
          el('div', { class: 'title' }, [
            el('span', { text: profile.label }),
            active ? badge('activa', 'accent') : null,
            profile.valid ? badge('válida', 'ok') : badge('inválida', 'bad'),
            badge(`v${profile.version ?? '?'}`),
            badge(`${profile.moduleCount} módulos`),
          ]),
          el('div', { class: 'path', text: profile.path }),
        ]),
        el('div', { class: 'actions' }, [
          active ? null : el('button', {
            class: 'ghost small',
            type: 'button',
            text: 'Activar',
            onclick: async () => {
              try {
                await api.activateProfile(profile.id);
                setStatus(`Instalación activa: ${profile.label}`);
                await onChanged();
                await refresh();
              } catch (error) {
                setStatus(`No se pudo activar: ${errorText(error)}`);
              }
            },
          }),
          el('button', {
            class: 'ghost small',
            type: 'button',
            text: 'Eliminar',
            onclick: async () => {
              const confirm = window.prompt(`Escribe "${profile.id}" para eliminar este perfil (no borra archivos del juego):`, '');
              if (confirm === null) return;
              try {
                await api.removeProfile(profile.id, confirm);
                setStatus(`Perfil eliminado: ${profile.label}`);
                await onChanged();
                await refresh();
              } catch (error) {
                setStatus(`No se pudo eliminar: ${errorText(error)}`);
              }
            },
          }),
        ]),
      ]);
    }));
  }

  function open() {
    dom.modal.hidden = false;
    refresh();
  }

  function close() {
    dom.modal.hidden = true;
  }

  async function submit(event) {
    event.preventDefault();
    const path = dom.pathInput.value.trim();
    const label = dom.labelInput.value.trim();
    if (!path) return;
    try {
      const result = await api.addProfile({ path, label: label || undefined });
      setStatus(result.created ? `Instalación añadida: ${result.profile.label}` : 'La instalación ya estaba registrada.');
      dom.pathInput.value = '';
      dom.labelInput.value = '';
      await onChanged();
      await refresh();
    } catch (error) {
      setStatus(`No se pudo añadir: ${errorText(error)}`);
    }
  }

  function init() {
    dom.close.addEventListener('click', close);
    dom.modal.addEventListener('click', (event) => {
      if (event.target === dom.modal) close();
    });
    dom.form.addEventListener('submit', submit);
    dom.validateAll.addEventListener('click', async () => {
      try {
        await api.validateProfiles();
        setStatus('Perfiles validados.');
        await onChanged();
        await refresh();
      } catch (error) {
        setStatus(`No se pudieron validar: ${errorText(error)}`);
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !dom.modal.hidden) close();
    });
  }

  return { init, open, close, refresh };
}
