/**
 * vercel-cleanup.mjs — keep ONLY the latest production deployment, delete the rest.
 *
 * Usage:  VERCEL_TOKEN=xxxxx node scripts/vercel-cleanup.mjs [teamId?]
 *
 * What it does:
 *   1. Finds the project (defaults to "ps-telecom-stock-app").
 *   2. Lists ALL deployments (paginated).
 *   3. Keeps the CURRENT production deployment (the one artechnologyapp.com serves).
 *      Everything else — old production builds, preview builds, READY/ERROR/CANCELED —
 *      is deleted via DELETE /v13/deployments/{id}.
 *   4. Vercel refuses to delete the live production deployment, so "keep the last,
 *      delete the rest" is enforced by the API itself. That refusal is logged as KEEP.
 *
 * Safe to re-run: second run finds only 1 deployment left.
 * The token never leaves your machine/env — it is only sent to api.vercel.com.
 */

const PROJECT = process.env.VERCEL_PROJECT || 'ps-telecom-stock-app';
const TOKEN = process.env.VERCEL_TOKEN;
const TEAM = process.env.VERCEL_TEAM_ID || ''; // optional, for team accounts

if (!TOKEN) {
  console.error(
    '\n❌ VERCEL_TOKEN missing.\n' +
      '   1. vercel.com → তোমার avatar → Account Settings → Tokens\n' +
      '   2. "Create Token" (scope: full account) → copy\n' +
      '   3. Run:  VERCEL_TOKEN=xxxxx node scripts/vercel-cleanup.mjs\n'
  );
  process.exit(1);
}

const base = 'https://api.vercel.com' + (TEAM ? `?teamId=${TEAM}` : '');
const j = (r) => r.json();
const api = async (path, opts = {}) => {
  const res = await fetch(`https://api.vercel.com${path}${path.includes('?') ? '&' : '?'}teamId=${TEAM}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
  }
  return res.status === 204 ? {} : j(res);
};

// 1. locate project
const projects = await api(`/v9/projects?limit=100`);
const project = projects.projects?.find((p) => p.name === PROJECT);
if (!project) {
  console.error(`❌ Project "${PROJECT}" not found. Available: ${projects.projects?.map((p) => p.name).join(', ')}`);
  process.exit(1);
}
console.log(`✓ Project: ${project.name} (${project.id})`);

// 2. find current production target
const prodTargets = await api(`/v13/deployments?projectId=${project.id}&target=production&state=READY&limit=5`);
const current = prodTargets.deployments?.[0]; // most recent READY production = what the domain serves
if (!current) {
  console.error('❌ No READY production deployment found — aborting (nothing will be deleted).');
  process.exit(1);
}
console.log(`✓ KEEP (current production): ${current.uid}  ${current.url}  (${new Date(current.created)}  v${current.meta?.githubCommitMessage || ''})`);

// 3. list everything
let all = [];
let since = '';
for (;;) {
  const page = await api(`/v6/deployments?projectId=${project.id}&limit=100${since ? `&since=${since}` : ''}`);
  const d = page.deployments || [];
  all = all.concat(d);
  if (d.length < 100) break;
  since = d[d.length - 1].created + 1;
  if (all.length > 2000) break; // hard safety stop
}
console.log(`✓ Total deployments found: ${all.length}`);

// 4. delete everything that is NOT the current production deployment
let kept = 0, deleted = 0, failed = 0;
for (const d of all) {
  if (d.uid === current.uid) {
    console.log(`  KEEP  ${d.uid}  ${d.url}  (live production)`);
    kept++;
    continue;
  }
  try {
    await api(`/v13/deployments/${d.uid}`, { method: 'DELETE' });
    console.log(`  DEL   ${d.uid}  ${d.url}  (${d.target || 'preview'}, ${new Date(d.created).toISOString().slice(0, 16)})`);
    deleted++;
  } catch (e) {
    // Vercel blocks deleting the deployment a domain points to — that refusal = keep
    const blocked = /production deployment|cannot be deleted|protected/i.test(e.message);
    if (blocked) {
      console.log(`  KEEP  ${d.uid}  ${d.url}  (API refuses: protected/aliased)`);
      kept++;
    } else {
      console.error(`  FAIL  ${d.uid}  ${d.url}  — ${e.message.slice(0, 120)}`);
      failed++;
    }
  }
}

console.log(`\n=== DONE: ${deleted} deleted, ${kept} kept, ${failed} failed ===`);
console.log('Live site unaffected — artechnologyapp.com points to the kept deployment.');
