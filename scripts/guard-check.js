/**
 * guard-check.js — PS TELECOM resurrection guard.
 *
 * This sandbox has repeatedly restored STALE snapshots between sessions:
 *   - package.json / app version rolled back (e.g. v2.39.0 → v2.31-based tree)
 *   - the DELETED lock/sync system resurrected (src/proxy.ts, site-lock,
 *     AppLock*, firebase*, cloud-*, auto-restore, sync-dirty, use-toast …)
 *   - the sandbox then auto-committed the resurrected files as a junk commit
 *     whose subject is a bare UUID (e.g. "5866c3c7-1177-4b9e-…")
 * That is exactly how the owner experiences "features changed automatically"
 * and "deleted data came back".
 *
 * This guard detects every known rollback signature and --fix repairs it:
 *   1. dead files tracked or lying untracked on disk      → hard finding
 *   2. local-only commits with a bare-UUID subject        → hard finding (junk)
 *   3. HEAD behind origin/main (stale snapshot)           → hard finding
 *   4. .env incomplete (4 canonical vars)                 → soft finding
 *   5. core.hooksPath not set to .githooks                → soft finding
 *
 * Usage:
 *   node scripts/guard-check.js            check only (exit 0 clean / 1 soft / 2 hard)
 *   node scripts/guard-check.js --fix      repair what is safe to repair
 *   node scripts/guard-check.js --fix --force-reset
 *                                          also hard-reset a DIVERGED tree
 *                                          (behind origin + non-junk local commits)
 *
 * Build scripts run this in check-only mode and abort on any finding.
 * Docs: SESSION-START.md
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIX = process.argv.includes('--fix');
const FORCE_RESET = process.argv.includes('--force-reset');

// Canonical .env (rebuilt verbatim by --fix when incomplete).
const CANONICAL_ENV = [
  'DATABASE_URL=file:/home/z/my-project/db/custom.db',
  'NEXT_PUBLIC_SYNC_ID=PS-MUAG-JEEB',
  'NEXT_PUBLIC_SYNC_PIN=9732881732',
  'NEXT_PUBLIC_SYNC_API_URL=https://ps-telecom-stock-app.vercel.app',
].join('\n') + '\n';

// The lock/sync system deleted across v2.29→v2.37 — must NEVER exist again.
// NOTE: src/app/api/cloud/d1/route.ts (Vercel sync proxy) is ALIVE — never add it here.
//       src/lib/d1-secrets.ts is git-ignored self-heal material — never add it here.
const DEAD_FILES = [
  '.firebaserc',
  'firebase.json',
  'native/android/AppLockPlugin.java',
  'src/app/api/route.ts',
  'src/app/site-lock/page.tsx',
  'src/components/AppLockGate.tsx',
  'src/components/SiteLockForm.tsx',
  'src/components/SiteLockGate.tsx',
  'src/components/admin/AdminDataView.tsx',
  'src/components/admin/AdminPinGate.tsx',
  'src/components/admin/QuickSellModal.tsx',
  'src/components/screens/CloudBackupScreen.tsx',
  'src/components/screens/CloudSyncScreen.tsx',
  'src/components/ui/toast.tsx',
  'src/components/ui/toaster.tsx',
  'src/hooks/use-toast.ts',
  'src/lib/admin-pin.ts',
  'src/lib/app-lock.ts',
  'src/lib/auto-restore.ts',
  'src/lib/cloud-d1.ts',
  'src/lib/cloud-sync.ts',
  'src/lib/db.ts',
  'src/lib/firebase-sync.ts',
  'src/lib/firebase.ts',
  'src/lib/sync-dirty.ts',
  'src/middleware.ts',
  'src/proxy.ts',
  'src/store/appLockStore.ts',
];
const DEAD_DIRS = [
  'src/app/site-lock',
  'src/app/api/site-auth',
  'src/components/site-lock',
];

// The sandbox auto-commit of a resurrected snapshot uses a bare-UUID subject.
const JUNK_SUBJECT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s*$/i;

const git = (args, opts = {}) =>
  execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8', timeout: 45000, ...opts }).trim();

const findings = { hard: [], soft: [] };
const notes = [];
const hard = (msg) => findings.hard.push(msg);
const soft = (msg) => findings.soft.push(msg);

function banner(text) {
  console.log(`\n🛡  PS TELECOM resurrection guard — ${text}`);
}

// ---------------------------------------------------------------- checks ----
function checkDeadFiles(trackedList, offline) {
  let trackedHits = [];
  let residueHits = [];
  for (const rel of DEAD_FILES) {
    if (trackedList.includes(rel)) trackedHits.push(rel);
    else if (fs.existsSync(path.join(ROOT, rel))) residueHits.push(rel);
  }
  for (const dir of DEAD_DIRS) {
    if (trackedList.some((f) => f.startsWith(dir + '/'))) trackedHits.push(dir + '/');
    else if (fs.existsSync(path.join(ROOT, dir))) residueHits.push(dir + '/');
  }
  if (trackedHits.length) {
    hard(`dead files TRACKED in git (${trackedHits.length}): ${trackedHits.join(', ')}`);
  }
  if (residueHits.length) {
    hard(`dead files lying untracked on disk (${residueHits.length}): ${residueHits.join(', ')}`);
  }
  if (!trackedHits.length && !residueHits.length) {
    console.log('✅ dead lock/sync system: absent (tracked + disk)');
  } else if (offline) {
    notes.push('offline: dead-file finding is fully local — trustworthy');
  }
  return { trackedHits, residueHits };
}

function checkGitState(offline) {
  let junk = [];
  let localOnly = [];
  let behind = 0;

  const subjects = git('log --format=%s -n 40').split('\n').filter(Boolean);
  // local-only commits (need origin/main ref; skip if fetch failed)
  if (!offline) {
    try {
      // %x09 = tab separator (a literal space here would be split by the shell)
      const log = git('log origin/main..HEAD --format="%H%x09%s"');
      for (const line of log.split('\n').filter(Boolean)) {
        const tab = line.indexOf('\t');
        if (tab < 0) continue;
        const hash = line.slice(0, tab);
        const subject = line.slice(tab + 1);
        if (JUNK_SUBJECT_RE.test(subject)) junk.push(`${hash.slice(0, 7)} ${subject}`);
        else localOnly.push(hash);
      }
      behind = Number(git('rev-list --count HEAD..origin/main') || '0');
    } catch {
      offline = true;
      notes.push('origin/main comparison failed — stale check skipped');
    }
  }
  if (offline) {
    // offline fallback: junk UUID subjects anywhere in recent local history
    junk = junk.concat(
      subjects.filter((s) => JUNK_SUBJECT_RE.test(s)).map((s) => `(offline-scan) ${s}`),
    );
  }

  if (junk.length) {
    hard(`junk auto-commit(s) present — sandbox resurrected + committed a stale snapshot: ${junk.join(' | ')}`);
  } else {
    console.log('✅ no junk (bare-UUID) auto-commits in local-only history');
  }

  // history hygiene: junk subjects already inside the PUSHED origin/main
  // history can't be fixed locally (a rewrite would churn every SHA) — emit
  // a note, never a finding. New junk landing at the origin tip is still
  // caught by the dead-file check above.
  if (!offline) {
    try {
      const remoteSubjects = git('log origin/main --format=%s -n 60').split('\n').filter(Boolean);
      const remoteJunk = remoteSubjects.filter((s) => JUNK_SUBJECT_RE.test(s));
      if (remoteJunk.length) {
        notes.push(`${remoteJunk.length} known junk snapshot-commit(s) already inside pushed origin/main history (inert — files deleted at tip; never check them out): ${remoteJunk.map((s) => `${s.slice(0, 13)}…`).join(', ')}`);
      } else {
        console.log('✅ pushed origin/main history: no junk snapshot-commits');
      }
    } catch { /* non-fatal */ }
  }

  if (!offline) {
    if (behind > 0) {
      if (localOnly.length === 0) {
        hard(`HEAD is ${behind} commit(s) behind origin/main with no local work — stale snapshot restore`);
      } else {
        hard(`DIVERGED: ${behind} behind origin/main AND ${localOnly.length} non-junk local commit(s) — stale base with work on top (inspect before any --force-reset): ${localOnly.map((c) => c.slice(0, 7)).join(', ')}`);
      }
    } else if (localOnly.length > 0) {
      notes.push(`unpushed local commits: ${localOnly.map((c) => c.slice(0, 7)).join(', ')} (normal mid-session state — not a rollback)`);
    } else {
      console.log('✅ HEAD == origin/main (no rollback)');
    }
  } else {
    notes.push('offline: origin/main comparison skipped');
  }
  return { junk, localOnly, behind };
}

function checkEnv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) { soft('.env missing'); return false; }
  const cur = fs.readFileSync(p, 'utf8');
  const missing = ['DATABASE_URL', 'NEXT_PUBLIC_SYNC_ID', 'NEXT_PUBLIC_SYNC_PIN', 'NEXT_PUBLIC_SYNC_API_URL']
    .filter((k) => !new RegExp(`^${k}=\\S+`, 'm').test(cur));
  if (missing.length) { soft(`.env incomplete — missing: ${missing.join(', ')}`); return false; }
  console.log('✅ .env complete (4 canonical vars)');
  return true;
}

function checkHooks() {
  let hp = '';
  try { hp = git('config core.hooksPath'); } catch { /* unset */ }
  const both = fs.existsSync(path.join(ROOT, '.githooks', 'pre-commit')) &&
    fs.existsSync(path.join(ROOT, '.githooks', 'commit-msg'));
  if (hp === '.githooks' && both) {
    console.log('✅ resurrection hooks installed (core.hooksPath=.githooks: pre-commit + commit-msg)');
    return true;
  }
  if (!both) soft('.githooks/pre-commit or .githooks/commit-msg missing from the tree');
  soft(`core.hooksPath is "${hp || '(unset)'}" — resurrection hooks NOT active`);
  return false;
}

// ------------------------------------------------------------------ fix -----
function repair({ junk, localOnly, behind }, residueHits) {
  if (junk.length > 0 || behind > 0) {
    if (localOnly.length > 0 && !FORCE_RESET) {
      console.log(`\n⚠️  DIVERGED tree — ${localOnly.length} non-junk local commit(s) present. NOT auto-resetting to protect possible in-progress work.`);
      console.log('   Review them, then run: node scripts/guard-check.js --fix --force-reset');
    } else {
      // SAFETY: stash uncommitted work so nothing is destroyed by the reset
      // (never auto-popped — recoverable via: git stash list)
      const dirty = git('status --porcelain');
      if (dirty) {
        try {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          git(`stash push --include-untracked -m "guard-auto-stash pre-reset ${stamp}"`);
          console.log(`🧷 uncommitted work stashed for safety ("git stash list" to inspect) — guard-auto-stash pre-reset ${stamp}`);
        } catch (e) {
          console.log(`⚠️  could not stash (${e.message.split('\n')[0]}) — continuing with reset`);
        }
      }
      console.log('\n🔧 git reset --hard origin/main …');
      try {
        git('reset --hard origin/main');
        console.log('✅ HEAD restored to origin/main');
      } catch (e) {
        console.log(`❌ reset failed: ${e.message.split('\n')[0]} — manual review needed`);
      }
    }
  }
  // scrub untracked dead residue file-by-file (never a blanket clean)
  for (const rel of residueHits) {
    const abs = path.join(ROOT, rel);
    try {
      fs.rmSync(abs, { recursive: true, force: true });
      console.log(`🧹 removed dead residue: ${rel}`);
    } catch (e) {
      console.log(`⚠️  could not remove ${rel}: ${e.message}`);
    }
  }
  if (!checkEnv()) {
    fs.writeFileSync(path.join(ROOT, '.env'), CANONICAL_ENV);
    console.log('🔧 .env rebuilt with the 4 canonical vars');
  }
  if (!checkHooks()) {
    git('config core.hooksPath .githooks');
    console.log('🔧 core.hooksPath=.githooks installed');
  }
}

// ----------------------------------------------------------------- main -----
function main() {
  banner(`checking tree${FIX ? ' (fix mode)' : ''}\n`);

  // version visibility
  let version = '?';
  try { version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch {}
  console.log(`📦 package.json version: ${version}`);

  // tracked list
  let trackedList = [];
  let offline = false;
  try {
    trackedList = git('ls-files').split('\n').filter(Boolean);
  } catch { offline = true; }

  // fetch (best-effort, 45s cap inside git())
  if (!offline) {
    try { git('fetch origin main'); } catch {
      offline = true;
      notes.push('git fetch failed — origin/main comparison skipped (offline?)');
    }
  }

  const dead = checkDeadFiles(trackedList, offline);
  const gitState = checkGitState(offline);
  checkEnv();
  checkHooks();

  if (notes.length) {
    console.log('\nℹ️  notes:');
    for (const n of notes) console.log(`   - ${n}`);
  }

  console.log('\n' + '─'.repeat(64));
  if (findings.hard.length === 0 && findings.soft.length === 0) {
    console.log('✅ GUARD CLEAN — tree is current origin/main, no rollback signatures.');
    process.exit(0);
  }
  if (findings.hard.length) {
    console.log('❌ HARD FINDINGS (rollback / pollution):');
    for (const f of findings.hard) console.log(`   ❌ ${f}`);
  }
  if (findings.soft.length) {
    console.log('⚠️  SOFT FINDINGS (configuration):');
    for (const f of findings.soft) console.log(`   ⚠️  ${f}`);
  }

  if (FIX) {
    repair(gitState, dead.residueHits);
    // re-verify after repair
    console.log('\n🔎 re-verifying after repair…');
    let ok = true;
    try {
      const reTracked = git('ls-files').split('\n').filter(Boolean);
      for (const rel of DEAD_FILES) if (reTracked.includes(rel) || fs.existsSync(path.join(ROOT, rel))) ok = false;
      for (const dir of DEAD_DIRS) if (reTracked.some((f) => f.startsWith(dir + '/')) || fs.existsSync(path.join(ROOT, dir))) ok = false;
      let behind2 = 0;
      try { behind2 = Number(git('rev-list --count HEAD..origin/main') || '0'); } catch {}
      if (behind2 > 0 && FORCE_RESET) ok = false;
      checkEnv() || (ok = false);
      checkHooks() || (ok = false);
    } catch (e) {
      console.log(`⚠️  re-verify error: ${e.message}`);
      ok = false;
    }
    console.log(ok ? '\n✅ GUARD: repaired — tree clean now.' : '\n❌ GUARD: problems remain — manual review needed (see findings above).');
    process.exit(ok ? 0 : 2);
  }

  console.log('\nRun "bun run guard:fix" to repair (docs: SESSION-START.md).');
  process.exit(findings.hard.length ? 2 : 1);
}

try {
  main();
} catch (e) {
  console.error('\n❌ GUARD INTERNAL ERROR:', e.message);
  console.error('   Treat as a FAILED check — build steps abort. Inspect manually.');
  process.exit(3);
}
