# SESSION-START PROTOCOL — PS TELECOM (read before touching anything)

> **Why this file exists:** this sandbox has repeatedly restored **stale
> snapshots** between sessions. Effects the owner actually experienced:
> the app version silently rolled back ("features changed automatically"),
> and the **long-deleted lock/sync system resurrected** (site-lock, AppLock,
> firebase/cloud files) — the snapshotter even **auto-committed** those
> resurrected files as a junk commit with a bare-UUID subject.

## The 3-command protocol (run at every session start)

```bash
bun run guard:fix          # 1. detect + repair any rollback (reset/scrub/.env/hooks)
git status --short         # 2. confirm clean tree, HEAD == origin/main
git log --oneline -1       # 3. confirm the latest pushed version, e.g. v2.39.0
```

- Guard prints `✅ GUARD CLEAN` → tree is safe. Anything else → it repaired
  it; re-run `bun run guard:fix` and re-check.
- If the guard reports **DIVERGED** (non-junk local commits on a stale base),
  it will NOT auto-reset. Review those commits, then
  `node scripts/guard-check.js --fix --force-reset`.

## What the guard protects against

| Signature | Check | Auto-fix |
|---|---|---|
| deleted lock/sync files tracked or on disk | `git ls-files` + disk scan (22 files + 3 dirs) | reset --hard origin/main + file-by-file scrub |
| sandbox junk auto-commit (bare-UUID subject) | local-only commit subjects | reset --hard origin/main |
| HEAD behind origin/main | `git fetch` + rev-list | fast-forward reset |
| `.env` incomplete | 4 canonical vars | rebuilt verbatim |
| pre-commit hook lost | `core.hooksPath` | reinstall `.githooks` |

Additional hard layers (all committed to the repo so they survive resets):

- **`.githooks/pre-commit` + `.githooks/commit-msg`** — pre-commit blocks ANY
  commit staging resurrected dead files; commit-msg blocks bare-UUID junk
  auto-commit subjects. `core.hooksPath` is a local git config; if a restore
  wipes it, `guard-check.js --fix` reinstalls.
- **`scripts/build-apk.js` STEP G** + **`scripts/build-web-pages.js` STEP G** —
  every APK / web-mirror build runs the guard first and aborts on any finding,
  so a stale snapshot can never reach the owner's users.

## Never-resurrect list (deleted v2.29 → v2.37, must stay deleted)

`src/proxy.ts`, `src/middleware.ts`, `src/app/site-lock/`, `src/app/api/site-auth/`,
`src/app/api/route.ts`, `src/components/site-lock/`,
`src/components/{AppLockGate,SiteLockGate,SiteLockForm}.tsx`,
`src/components/admin/{AdminDataView,AdminPinGate,QuickSellModal}.tsx`,
`src/components/screens/{CloudSyncScreen,CloudBackupScreen}.tsx`,
`src/components/ui/{toast,toaster}.tsx`, `src/hooks/use-toast.ts`,
`src/lib/{admin-pin,app-lock,auto-restore,cloud-d1,cloud-sync,db,firebase,firebase-sync,sync-dirty}.ts`,
`src/store/appLockStore.ts`, `native/android/AppLockPlugin.java`, `.firebaserc`, `firebase.json`.

⚠️ ALIVE (do not confuse): `src/app/api/cloud/d1/route.ts` (Vercel sync
proxy), `src/lib/{d1-config,d1-sync}.ts` (D1 sync engine) and
`src/lib/d1-secrets.ts` (git-ignored self-heal material).

**History note:** 7 junk snapshot-commits (bare-UUID subjects, e.g. 01e5976)
already sit inside the pushed origin/main history — inert (their files are
deleted at the tip), never check them out, never cherry-pick across them.
`guard-check.js` lists them as a note on every run. The main junk trigger
(`.zscripts/dev.pid` churn → sandbox auto-commit) is fixed by keeping dev.pid
git-ignored — NEVER re-track it.

## Deployment triad — after ANY code change

1. `git push origin main` → **Vercel app** auto-deploys.
2. `WEB_BASE_PATH=/ps-telecom-stock-app node scripts/build-web-pages.js` then
   `GITHUB_TOKEN=$(cat /tmp/.ghtoken) sh scripts/deploy-web-pages.sh` →
   **GitHub Pages mirror** (tokenless static host, manual-only deploys!).
3. `node scripts/build-apk.js` → **APK** rebuild.

All three must serve the same version or the owner will report "feature not
live / changed automatically" again.

## Environment restore cheat-sheet (post-reset)

```bash
printf 'DATABASE_URL=file:/home/z/my-project/db/custom.db\nNEXT_PUBLIC_SYNC_ID=PS-MUAG-JEEB\nNEXT_PUBLIC_SYNC_PIN=9732881732\nNEXT_PUBLIC_SYNC_API_URL=https://ps-telecom-stock-app.vercel.app\n' > .env
git remote get-url origin | sed -n 's#https://rmusicpresent111-hub:\([^@]*\)@github.com/.*#\1#p' > /tmp/.ghtoken
rm -rf .next && (setsid nohup bun run dev > dev.log 2>&1 &)
# APK toolchain: export JAVA_HOME=/home/z/jdk21 ANDROID_HOME=/home/z/android-sdk
```
