/**
 * ensure-secrets.mjs — auto-create src/lib/d1-secrets.ts from the template
 * when it is missing (fresh clone / cleaned workspace).
 *
 * Why: d1-secrets.ts is GIT-IGNORED (the real token must never enter git), so
 * a fresh checkout or a cleaned workspace does not have it and the bundler
 * fails with "Module not found: './d1-secrets'" — killing the whole preview
 * build instead of just disabling cloud sync.
 *
 * Behaviour:
 *   - file exists           → do nothing (real values are never touched)
 *   - file missing          → copy d1-secrets.example.ts (PASTE_YOUR_ placeholders)
 *
 * With placeholders in place the app builds and runs 100% offline; cloud sync
 * simply stays dormant until real values are pasted (and scripts/build-apk.js
 * still hard-fails an APK build while placeholders remain, so a shipped APK
 * can never carry a dead sync).
 *
 * Idempotent, silent, safe to run on every dev/build boot. Works on
 * Windows/macOS/Linux (plain node:fs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'src', 'lib', 'd1-secrets.ts');
const EXAMPLE = path.join(ROOT, 'src', 'lib', 'd1-secrets.example.ts');

try {
  if (!fs.existsSync(TARGET)) {
    fs.copyFileSync(EXAMPLE, TARGET);
    console.log('\n✓ src/lib/d1-secrets.ts was missing — created from the template.');
    console.log('  (Placeholders inside → app runs fine offline; cloud sync stays OFF');
    console.log('   until you paste your real Cloudflare values into that file.)\n');
  }
} catch (err) {
  // Never block a build on this helper — worst case the bundler reports the
  // missing module with its own clear message.
  console.warn('ensure-secrets warning:', err?.message || err);
}
