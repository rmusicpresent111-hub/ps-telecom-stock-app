#!/usr/bin/env node
/**
 * PS TELECOM AUTO-FIX PIPELINE (v2.47.0)
 * =======================================
 * "code e next bug ele jeno auto fix hoy" — this is that guarantee, in code.
 *
 * It runs the full repair train in one command (`bun run fix`) and is wired
 * into THREE layers so a newly-introduced bug gets repaired automatically:
 *
 *   1. LOCAL  — `bun run fix`            (developer runs it anytime)
 *   2. COMMIT — .githooks/pre-commit     (staged TS/TSX get eslint --fix'd
 *                                          and re-staged BEFORE the commit
 *                                          lands; type errors BLOCK the
 *                                          commit, so main never carries one)
 *   3. REPO   — .github/workflows/auto-fix.yml  (after every push to main:
 *                                          eslint --fix + guard repair, the
 *                                          result is committed back with
 *                                          [skip ci]; tsc failures show red)
 *
 * What it AUTO-FIXES (safe, deterministic):
 *   - every auto-fixable ESLint violation in src/ (unused vars, hook deps,
 *     import order, formatting-level bugs…)
 *   - the guard's whole repair set (resurrected dead files, missing .env
 *     vars, uninstalled hooks, junk state)
 * What it REPORTS (cannot be safely auto-fixed):
 *   - TypeScript type errors (exit code 1 so CI/hooks see them)
 *
 * Usage:
 *   bun run fix          # fix + verify
 *   bun run fix:check    # verify only, change nothing
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let step = 0;
function run(label, cmd, args, opts = {}) {
  step += 1;
  const tag = `[${step}/5]`;
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: opts.silent ? 'pipe' : 'inherit',
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const ok = res.status === 0;
  if (opts.silent) {
    const out = `${res.stdout || ''}${res.stderr || ''}`.trim();
    if (ok) console.log(`${tag} ✅ ${label}${out ? ` — ${out.split('\n').length} line(s) of output` : ''}`);
    else {
      console.log(`${tag} ⚠️  ${label} — exit ${res.status}`);
      if (out) console.log(out.split('\n').slice(0, 40).map((l) => `       ${l}`).join('\n'));
    }
  } else if (!ok) {
    console.log(`${tag} ⚠️  ${label} — exit ${res.status}`);
  } else {
    console.log(`${tag} ✅ ${label}`);
  }
  return { ok, res };
}

function main() {
  const checkOnly = process.argv.includes('--check') || process.argv.includes('check');
  console.log('🔧 PS TELECOM AUTO-FIX' + (checkOnly ? ' (check-only)' : ''));
  console.log('='.repeat(60));

  const hasNodeModules = require('fs').existsSync(path.join(ROOT, 'node_modules', '.bin'));
  if (!hasNodeModules) {
    console.log('⚠️  node_modules missing — run `bun install` first. Nothing to fix.');
    process.exit(1);
  }

  // 1) ESLint — the auto-fixable bug class (run twice: a fix can unlock more)
  //    NOTE: ESLint 9 flat config — no --ext flag; src/**/*.{ts,tsx} is covered
  //    by eslint.config.mjs patterns.
  const eslintArgs = ['eslint', 'src'];
  if (!checkOnly) {
    run('eslint --fix (pass 1)', 'bunx', [...eslintArgs, '--fix'], { silent: true });
    run('eslint --fix (pass 2)', 'bunx', [...eslintArgs, '--fix'], { silent: true });
  }

  // 2) Guard — dead-file resurrection, .env repair, hooks (skip in CI: no .env)
  if (!process.env.CI && !checkOnly) {
    run('guard repair', 'node', ['scripts/guard-check.js', '--fix'], { silent: true });
  }

  // 3) Lint verdict — anything NOT auto-fixable shows here
  const lint = run('lint verdict', 'bunx', eslintArgs, { silent: true });

  // 4) Type check — the hard gate
  const tsc = run('type check (tsc)', 'npx', ['tsc', '--noEmit'], { silent: true });
  if (tsc.ok) console.log('       tsc: 0 errors');

  console.log('='.repeat(60));
  if (checkOnly) {
    const clean = lint.ok && tsc.ok;
    console.log(clean ? '✅ CHECK: clean' : '❌ CHECK: problems found (see above)');
    process.exit(clean ? 0 : 1);
  }
  if (!lint.ok || !tsc.ok) {
    console.log('❌ AUTO-FIX: everything safely fixable is fixed, but the problems');
    console.log('   printed above cannot be auto-repaired. Fix them by hand.');
    process.exit(1);
  }
  console.log('✅ AUTO-FIX: tree repaired — lint 0, tsc 0.');
}

main();
