/**
 * build-web-static.mjs — plain static export (`npm run build:web`).
 *
 * Next.js static export CANNOT include route handlers (src/app/api/**),
 * so — exactly like build-web-pages.js and build-apk.js already do —
 * this script moves src/app/api aside, runs `next build`, and restores
 * it in a fail-safe exit handler (even on Ctrl+C / crash).
 *
 * The dev server, Vercel and any server-hosted deployment are unaffected:
 * they never run this script.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, 'src', 'app', 'api');
const TEMP = path.join(ROOT, '.api-routes-web-temp');

let restored = false;

function restore() {
  if (restored) return;
  restored = true;
  try {
    if (fs.existsSync(TEMP)) {
      if (!fs.existsSync(API_DIR)) fs.renameSync(TEMP, API_DIR);
      else fs.rmSync(TEMP, { recursive: true, force: true });
    }
  } catch (e) {
    console.error('⚠️  could not restore src/app/api — move it back manually:', e.message);
  }
}

process.on('exit', restore);
for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException']) {
  try {
    process.on(sig, restore);
  } catch {
    /* older runtimes */
  }
}

const moved = fs.existsSync(API_DIR);
if (moved) {
  fs.renameSync(API_DIR, TEMP);
  console.log('[build-web] src/app/api moved aside (static export cannot bundle route handlers)');
}

try {
  const res = spawnSync('npx', ['next', 'build'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exitCode = res.status ?? 1;
} finally {
  restore();
}
