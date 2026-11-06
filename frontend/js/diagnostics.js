/** System diagnostics and recovery guidance (Phase 10). */

import { ApiError } from './api.js';
import { el } from './ui.js';

export function createDiagnosticsView(ctx) {
  const { api, dom, setStatus } = ctx;

  function errorText(error) {
    return error instanceof ApiError ? error.message : String(error);
  }

  async function load() {
    try {
      const [diagnostics, logs] = await Promise.all([api.diagnostics(), api.logs(160)]);
      render(diagnostics, logs);
      dom.health.className = `pill ${diagnostics.ok ? 'is-ok' : 'is-bad'}`;
      dom.health.textContent = diagnostics.ok ? 'Sistema OK' : 'Revisar avisos';
      setStatus(`Diagnóstico: ${diagnostics.checks.filter((check) => check.ok).length}/${diagnostics.checks.length} comprobaciones`);
    } catch (error) {
      dom.checks.replaceChildren(el('p', { class: 'muted', text: errorText(error) }));
      dom.log.textContent = errorText(error);
    }
  }

  function render(diagnostics, logs) {
    dom.checks.replaceChildren(...diagnostics.checks.map((check) => el('div', {
      class: `diag-check ${check.ok ? 'ok' : 'bad'}`,
    }, [
      el('span', { class: 'mark', text: check.ok ? '✓' : '!' }),
      el('span', { class: 'label', text: check.label }),
      el('span', { class: 'detail', text: check.detail }),
    ])));

    const memory = diagnostics.memory;
    dom.info.replaceChildren(...[
      ['Node.js', diagnostics.node],
      ['Plataforma', `${diagnostics.platform} ${diagnostics.arch}`],
      ['Proyecto', diagnostics.paths.projectRoot],
      ['Instalación', diagnostics.status.installation?.rootPath ?? 'no detectada'],
      ['Módulos', diagnostics.status.modules.map((module) => module.id).join(', ') || 'ninguno'],
      ['Memoria RSS', `${Math.round(memory.rss / 1024 / 1024)} MB`],
      ['Uptime', `${diagnostics.uptimeSeconds} s`],
      ['Inicialización', `${diagnostics.initMs} ms`],
    ].flatMap(([key, value]) => [
      el('span', { class: 'key', text: key }),
      el('span', { class: 'value', text: String(value) }),
    ]));

    dom.recovery.replaceChildren(...diagnostics.recovery.map((line) => el('div', {
      class: 'recovery-row',
      text: line,
    })));
    dom.log.textContent = logs.lines.length
      ? logs.lines.join('\n')
      : `Sin entradas de log todavía (${logs.file}).`;
  }

  function init() {
    dom.refresh?.addEventListener('click', load);
  }

  return { init, load };
}
