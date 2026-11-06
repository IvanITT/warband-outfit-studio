// @ts-check
/**
 * Local HTTP server for WARBand Outfit Studio.
 *
 * - Binds to 127.0.0.1 only.
 * - Zero runtime dependencies (node:http + node:fs).
 * - JSON API under /api, static frontend for everything else.
 */

import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson } from '../../engine/util/fsx.js';
import { createEngine } from '../../engine/index.js';
import { createApi } from '../api/routes.js';
import { serveStatic } from './static.js';

export const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const FRONTEND_DIR = path.join(PROJECT_ROOT, 'frontend');
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<any>}
 */
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body too large');
      // @ts-expect-error machine-readable
      error.code = 'BAD_REQUEST';
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON body');
    // @ts-expect-error machine-readable
    error.code = 'BAD_REQUEST';
    throw error;
  }
}

/** @param {string} code */
function statusFor(code) {
  switch (code) {
    case 'BAD_REQUEST':
      return 400;
    case 'INVALID_INSTALLATION':
    case 'CONFIRMATION_REQUIRED':
    case 'PATH_OUTSIDE_BACKUP':
    case 'INVALID_OVERRIDE':
    case 'LAYOUT_MISMATCH':
    case 'INVALID_MATERIAL_OVERRIDE':
    case 'INVALID_DDS':
    case 'INVALID_OUTFIT':
    case 'INVALID_ITEM':
    case 'NO_ITEM_OVERRIDES':
    case 'MISSING_TEXTURE':
      return 400;
    case 'BACKUP_CORRUPT':
      return 409;
    case 'NOT_FOUND':
    case 'MODULE_NOT_FOUND':
    case 'ITEM_NOT_FOUND':
    case 'PROFILE_NOT_FOUND':
    case 'MESH_NOT_FOUND':
    case 'MATERIAL_NOT_FOUND':
    case 'TEXTURE_NOT_FOUND':
    case 'SHADER_NOT_FOUND':
    case 'MESH_OVERRIDE_NOT_FOUND':
    case 'MATERIAL_OVERRIDE_NOT_FOUND':
    case 'PROJECT_TEXTURE_NOT_FOUND':
    case 'SKINS_NOT_FOUND':
    case 'SKIN_NOT_FOUND':
    case 'SKELETON_NOT_FOUND':
    case 'OUTFIT_NOT_FOUND':
    case 'ITEM_OVERRIDE_NOT_FOUND':
      return 404;
    case 'INSTALLATION_NOT_FOUND':
      return 503;
    default:
      return 500;
  }
}

/**
 * @param {any} res
 * @param {number} status
 * @param {any} payload
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

/**
 * @param {{ projectRoot?: string, host?: string, port?: number, installationPath?: string, cache?: boolean }} [options]
 */
export async function startServer(options = {}) {
  const projectRoot = options.projectRoot ?? PROJECT_ROOT;
  /** @type {any} */
  let config = {};
  try {
    config = await readJson(path.join(projectRoot, 'config', 'app.json'));
  } catch {
    config = {};
  }

  const engine = await createEngine({
    projectRoot,
    installationPath: options.installationPath ?? process.env.WARBAND_DIR ?? config.installationPath,
    cache: options.cache ?? config?.cache?.enabled !== false,
  });
  const api = createApi(engine);

  const server = http.createServer(async (req, res) => {
    const started = performance.now();
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
    );

    if (!url.pathname.startsWith('/api/')) {
      try {
        await serveStatic(res, FRONTEND_DIR, url.pathname);
      } catch (error) {
        sendJson(res, 500, { ok: false, error: { code: 'STATIC_ERROR', message: String(error) } });
      }
      return;
    }

    try {
      const body = req.method === 'POST' || req.method === 'PUT' ? await readJsonBody(req) : null;
      const result = await api.route(req, res, url.pathname.replace(/\/$/, ''), url.searchParams, body);
      if (result && result.__binary) {
        res.writeHead(200, {
          'Content-Type': result.contentType ?? 'application/octet-stream',
          'Content-Length': result.body.length,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          ...(result.headers ?? {}),
        });
        res.end(result.body);
        return;
      }
      sendJson(res, 200, result);
    } catch (error) {
      const code = /** @type {any} */ (error)?.code ?? 'INTERNAL_ERROR';
      const status = statusFor(code);
      if (status >= 500) {
        console.error(`[api] ${req.method} ${url.pathname} failed:`, error);
      }
      sendJson(res, status, {
        ok: false,
        error: {
          code,
          message: error instanceof Error ? error.message : String(error),
          details: /** @type {any} */ (error)?.details ?? null,
        },
        meta: { durationMs: Math.round(performance.now() - started) },
      });
    }
  });

  const host = options.host ?? process.env.HOST ?? config?.http?.host ?? '127.0.0.1';
  const preferredPort = Number(options.port ?? process.env.PORT ?? config?.http?.port ?? 8791);

  /** @type {number} */
  let port = 0;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = preferredPort + attempt;
    try {
      await new Promise((resolve, reject) => {
        const onError = (/** @type {any} */ error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve(null);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(candidate, host);
      });
      port = candidate;
      const address = server.address();
      if (address && typeof address === 'object') port = address.port;
      break;
    } catch (error) {
      if (/** @type {any} */ (error)?.code !== 'EADDRINUSE' || attempt === 9) throw error;
    }
  }

  const url = `http://${host}:${port}/`;
  return { server, engine, url, port, host };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const started = await startServer();
  console.log('');
  console.log('  WARBand Outfit Studio — Phase 7');
  console.log(`  ${started.url}`);
  if (!started.engine.installation) {
    console.log('  WARNING: no Warband installation detected. See /api/status for candidates.');
  } else {
    console.log(`  Installation: ${started.engine.installation.rootPath}`);
    console.log(`  Version: ${started.engine.installation.version ?? 'unknown'} — ${started.engine.modules.length} modules`);
  }
  console.log('  Press Ctrl+C to stop.');
  console.log('');

  if (process.argv.includes('--open')) {
    const url = started.url;
    const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
  }

  const shutdown = () => {
    started.server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
