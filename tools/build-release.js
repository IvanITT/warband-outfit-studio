#!/usr/bin/env node
/**
 * Build a portable release folder.
 *
 * The app has zero npm runtime dependencies. The release copies the engine,
 * backend, frontend and docs, creates empty writable data folders and writes a
 * launcher. By default it also bundles the running Node.js executable so the
 * destination machine does not need a developer toolchain (or Node installed).
 *
 *   node tools/build-release.js
 *   node tools/build-release.js --out dist/release --no-runtime
 */

import path from 'node:path';
import { cp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function copyIfExists(source, target) {
  if (!existsSync(source)) return false;
  await cp(source, target, { recursive: true, force: true });
  return true;
}

export async function buildRelease(options = {}) {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const version = packageJson.version;
  const outDir = path.resolve(options.outDir ?? path.join(root, 'dist', `warband-outfit-studio-${version}`));
  const includeRuntime = options.includeRuntime !== false && !process.argv.includes('--no-runtime');

  await mkdir(outDir, { recursive: true });
  for (const directory of ['engine', 'backend', 'frontend']) {
    await cp(path.join(root, directory), path.join(outDir, directory), { recursive: true, force: true });
  }
  for (const file of ['README.md', 'LICENSE', 'PROJECT_PLAN.md', 'PROGRESS.md', 'package.json']) {
    await copyIfExists(path.join(root, file), path.join(outDir, file));
  }
  await copyIfExists(path.join(root, 'docs'), path.join(outDir, 'docs'));
  await mkdir(path.join(outDir, 'config'), { recursive: true });
  await copyIfExists(path.join(root, 'config', 'app.example.json'), path.join(outDir, 'config', 'app.example.json'));
  for (const directory of ['projects', 'workspace', 'cache', 'backups']) {
    await mkdir(path.join(outDir, directory), { recursive: true });
  }

  let runtime = false;
  if (includeRuntime) {
    await mkdir(path.join(outDir, 'runtime'), { recursive: true });
    const nodeExe = process.execPath;
    const nodeStat = await stat(nodeExe);
    await cp(nodeExe, path.join(outDir, 'runtime', 'node.exe'));
    await writeFile(
      path.join(outDir, 'runtime', 'NODE-RUNTIME.txt'),
      [
        `Bundled Node.js ${process.version} (${nodeStat.size} bytes).`,
        'Node.js is distributed under the MIT license.',
        'https://nodejs.org/',
        '',
      ].join('\r\n'),
      'utf8',
    );
    runtime = true;
  }

  const launcher = [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'title WARBand Outfit Studio',
    '',
    'if exist "%~dp0runtime\\node.exe" (',
    '  "%~dp0runtime\\node.exe" backend\\server\\index.js --open',
    '  goto :done',
    ')',
    '',
    'where node >nul 2>nul',
    'if errorlevel 1 (',
    '  echo.',
    '  echo   Node.js is not bundled and no node.exe was found on PATH.',
    '  echo   Rebuild with the runtime or install Node.js 22+.',
    '  echo.',
    '  pause',
    '  exit /b 1',
    ')',
    'echo.',
    'echo   Starting WARBand Outfit Studio...',
    'node backend\\server\\index.js --open',
    '',
    ':done',
    'if errorlevel 1 (',
    '  echo.',
    '  echo   The server stopped with an error. Check the messages above.',
    '  pause',
    ')',
    '',
  ].join('\r\n');
  await writeFile(path.join(outDir, 'WARBand Outfit Studio.cmd'), launcher, 'utf8');

  const info = {
    name: 'WARBand Outfit Studio',
    version,
    createdAt: new Date().toISOString(),
    node: process.version,
    bundledRuntime: runtime,
    entrypoint: 'WARBand Outfit Studio.cmd',
    runtimeEntrypoint: 'backend/server/index.js',
    writableDirectories: ['projects', 'workspace', 'cache', 'backups'],
  };
  await writeFile(path.join(outDir, 'BUILD-INFO.json'), JSON.stringify(info, null, 2), 'utf8');
  return { outDir, version, bundledRuntime: runtime, info };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = await buildRelease({ outDir: argValue('--out') ?? undefined });
  console.log(`Release: ${result.outDir}`);
  console.log(`Version: ${result.version}`);
  console.log(`Bundled runtime: ${result.bundledRuntime ? 'yes' : 'no (uses node on PATH)'}`);
}
