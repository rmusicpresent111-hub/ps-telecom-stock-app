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
 *   4. TEMPORARILY hides the git-ignored .env file so NEXT_PUBLIC_CF_* /
 *      NEXT_PUBLIC_SYNC_* secrets are NEVER baked into this publicly hosted
 *      mirror (the mirror never calls the API anyway). The real file is
 *      restored right after the build (fail-safe, even on build errors).
 *      (v2.19.0: replaces the old src/lib/d1-secrets.ts swap.)
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
// the site password gate (Next 16 proxy / legacy middleware) can't run in a
// static export either — move whichever exists aside during the build
const MW_PAIRS = [
  ['src/proxy.ts', '.proxy-pages-temp'],
  ['src/middleware.ts', '.middleware-pages-temp'],
].map(([f, t]) => [path.join(ROOT, f), path.join(ROOT, t)]);
const ENV_FILE = path.join(ROOT, '.env');
const ENV_HIDDEN = path.join(ROOT, '.env.pages-build-hidden');
const OUT = path.join(ROOT, 'out');

const BASE = process.env.WEB_BASE_PATH || '/ps-telecom-stock-app';
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
console.log(`\n🌐 PS TELECOM ${version} — GitHub Pages web mirror build (basePath ${BASE})\n`);

const movedApi = fs.existsSync(API_DIR);
const movedMw = MW_PAIRS.some(([f]) => fs.existsSync(f));
const realEnv = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : null;

/**
 * Collect the real secret VALUES from .env (for the leak scan below). The
 * scan runs on EVERY export — a stale Turbopack cache can leak an OLDER
 * credential even when the current .env is hidden or placeholder-only.
 */
const readEnvValue = (content, name) => {
  if (content === null) return '';
  const m = content.match(new RegExp(`^\\s*${name}\\s*=(.*)$`, 'm'));
  return m ? m[1].trim() : '';
};
const secretNames = [
  'NEXT_PUBLIC_CF_ACCOUNT_ID',
  'NEXT_PUBLIC_CF_DATABASE_ID',
  'NEXT_PUBLIC_CF_API_TOKEN',
  'NEXT_PUBLIC_SYNC_PIN',
  'CLOUDFLARE_D1_API_TOKEN',
];
const isPlaceholderVal = (v) => !v || /PASTE[._-]?YOUR|CHANGE[._-]?ME/i.test(v);
const rawNeedles = secretNames
  .map((n) => readEnvValue(realEnv, n))
  .filter((v) => !isPlaceholderVal(v));

/**
 * A needle that ALSO exists verbatim in the tracked source is a
 * source-hardcoded default — e.g. the factory adminPin ('9732881732')
 * printed inside the i18n strings — not a build-time secret. It ships in
 * every bundle (APK, Vercel, this mirror) regardless of .env, so scanning
 * for it only produces false positives that abort legitimate mirror
 * deploys. Real secrets (Cloudflare tokens, a changed sync PIN that lives
 * ONLY in .env) never appear in src/ and keep hard-failing the deploy.
 */
const srcDir = path.join(ROOT, 'src');
const valueInSource = (value) => {
  const stack = [srcDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (fs.readFileSync(p, 'utf8').includes(value)) return true;
    }
  }
  return false;
};
const needles = rawNeedles.filter((v) => {
  if (valueInSource(v)) {
    console.log(`• leak-scan note: value ${v.slice(0, 4)}… also exists in src/ (source-hardcoded default) — not treated as a secret`);
    return false;
  }
  return true;
});

const restore = () => {
  try {
    if (movedApi && fs.existsSync(TEMP_API)) fs.renameSync(TEMP_API, API_DIR);
    for (const [orig, tmp] of MW_PAIRS) {
      if (fs.existsSync(tmp)) {
        if (!fs.existsSync(orig)) fs.renameSync(tmp, orig);
        else fs.rmSync(tmp, { recursive: true, force: true });
      }
    }
  } catch (e) {
    console.error('⚠️  could not restore src/app/api or the site-gate proxy — move them back manually:', e.message);
  }
  try {
    if (realEnv !== null && fs.existsSync(ENV_HIDDEN)) {
      fs.renameSync(ENV_HIDDEN, ENV_FILE);
    }
  } catch (e) {
    console.error('⚠️  could not restore .env — rename .env.pages-build-hidden back to .env!', e.message);
  }
};
process.on('exit', restore);
process.on('SIGINT', () => process.exit(130));

async function main() {
  try {
    // 4. hide the real .env so no secret is baked into this public build
    if (realEnv !== null) {
      fs.renameSync(ENV_FILE, ENV_HIDDEN);
      console.log('• .env hidden for this public build (restored right after)');
    }
    // Turbopack's persistent cache is shared between `next dev` and
    // `next build` — a dev session that compiled REAL env values can hand
    // the export a stale compilation carrying the secrets even though the
    // file on disk is now hidden (observed in practice). The public mirror
    // build is one-shot, so purge ALL artifacts unconditionally.
    fs.rmSync(path.join(ROOT, '.next'), { recursive: true, force: true });
    console.log('• .next build artifacts purged (export recompiles without secrets)');

    // 1. move API routes aside
    if (movedApi) fs.renameSync(API_DIR, TEMP_API);
    // 1b. site-gate proxy aside too (static export cannot run it)
    for (const [src, tmp] of MW_PAIRS) {
      if (fs.existsSync(src)) fs.renameSync(src, tmp);
    }

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
      // 5b. LEAK SCAN — hard-fail if any real credential reached the public
      // export. Runs on EVERY export (not only when .env currently holds
      // real values — a stale cache can leak an OLDER credential).
      //   needles: the actual secret VALUES from .env (when real)
      //            + a generic Cloudflare API-token shape (cfut_…)
      const genericToken = /cfut_[A-Za-z0-9]{16,}/;
      let leaked = false;
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) {
            walk(p);
          } else {
            const text = fs.readFileSync(p, 'utf8');
            if (needles.some((s) => text.includes(s)) || genericToken.test(text)) {
              console.error(`❌ SECRET LEAK in public export: ${p} — deploy aborted.`);
              leaked = true;
            }
          }
        }
      };
      walk(OUT);
      if (leaked) {
        process.exitCode = 1;
        return;
      }
      console.log('• leak scan clean — no real credentials in out/');

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
