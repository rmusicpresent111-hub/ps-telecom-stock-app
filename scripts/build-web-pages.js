/**
 * build-web-pages.js — GitHub Pages web mirror build ("PS TELECOM Web").
 *
 * Usage:  node scripts/build-web-pages.js        (or: npm run build:pages)
 *
 * What it does differently from `next build`:
 *   1. Moves src/app/api aside (static export cannot include route handlers —
 *      same trick scripts/build-apk.js uses) and restores it afterwards.
 *   2. Sets WEB_BASE_PATH (default /ps-telecom-stock-app) → Next basePath +
 *      NEXT_PUBLIC_BASE_PATH for client code (manifest link, SW registration).
 *   3. Sets NEXT_PUBLIC_STATIC_HOST=1 → the D1 sync engines stay dormant on
 *      the mirror (browsers cannot reach api.cloudflare.com from a static
 *      host: no CORS headers + 405 preflight) and the UI shows a calm notice.
 *   4. TEMPORARILY replaces src/lib/d1-secrets.ts with the safe template so
 *      the REAL Cloudflare token is never bundled into a publicly hosted
 *      mirror — the mirror never calls the API anyway. The real file is
 *      restored right after the build (fail-safe, even on build errors).
 *   5. Writes out/.nojekyll (GitHub Pages must serve the _next/ folder) and
 *      duplicates index.html as 404.html.
 *
 * Deploy: push the out/ contents to the gh-pages branch (see worklog or
 * scripts/deploy-web-pages.sh).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = path.join(ROOT, 'src', 'app', 'api');
const TEMP_API = path.join(ROOT, '.api-routes-pages-temp');
const SECRETS = path.join(ROOT, 'src', 'lib', 'd1-secrets.ts');
const EXAMPLE = path.join(ROOT, 'src', 'lib', 'd1-secrets.example.ts');
const OUT = path.join(ROOT, 'out');

const BASE = process.env.WEB_BASE_PATH || '/ps-telecom-stock-app';
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
console.log(`\n🌐 PS TELECOM ${version} — GitHub Pages web mirror build (basePath ${BASE})\n`);

const movedApi = fs.existsSync(API_DIR);
const realSecrets = fs.existsSync(SECRETS) ? fs.readFileSync(SECRETS, 'utf8') : null;
const realIsTemplate = realSecrets !== null && realSecrets.includes('PASTE_YOUR_');

const restore = () => {
  try {
    if (movedApi && fs.existsSync(TEMP_API)) fs.renameSync(TEMP_API, API_DIR);
  } catch (e) {
    console.error('⚠️  could not restore src/app/api — move it back manually:', e.message);
  }
  try {
    if (realSecrets !== null && !realIsTemplate) fs.writeFileSync(SECRETS, realSecrets);
  } catch (e) {
    console.error('⚠️  could not restore d1-secrets.ts — paste your real values back!', e.message);
  }
};
process.on('exit', restore);
process.on('SIGINT', () => process.exit(130));

async function main() {
  try {
    // 4. ship the tokenless template instead of the real credentials
    if (realSecrets !== null && !realIsTemplate) {
      fs.copyFileSync(EXAMPLE, SECRETS);
      console.log('• d1-secrets.ts → safe template for this public build (real file restored after)');
    }

    // 1. move API routes aside
    if (movedApi) fs.renameSync(API_DIR, TEMP_API);

    // build
    console.log('• next build (static export)…');
    execFileSync('npx', ['next', 'build'], {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        WEB_BASE_PATH: BASE,
        NEXT_PUBLIC_BASE_PATH: BASE,
        NEXT_PUBLIC_STATIC_HOST: '1',
      },
    });

    // 5. GitHub Pages glue
    if (fs.existsSync(path.join(OUT, 'index.html'))) {
      fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
      fs.copyFileSync(path.join(OUT, 'index.html'), path.join(OUT, '404.html'));
      const index = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
      if (!index.includes(`${BASE}/_next/`)) {
        console.error(`\n❌ index.html does not reference ${BASE}/_next/ — basePath not applied?`);
        process.exitCode = 1;
        return;
      }
      console.log(`\n✅ Web mirror ready in ./out (served under ${BASE}) — deploy out/ to the gh-pages branch.`);
    } else {
      console.error('\n❌ out/index.html missing — static export failed.');
      process.exitCode = 1;
    }
  } catch (e) {
    console.error('\n❌ web mirror build failed:', e.message);
    process.exitCode = 1;
  }
}

main();
