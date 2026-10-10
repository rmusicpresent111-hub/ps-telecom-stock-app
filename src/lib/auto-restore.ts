/**
 * Boot-time auto-restore — makes a fresh browser/device show the shop's data
 * automatically, with zero taps.
 *
 * WHY: every browser "origin" (the Vercel deploy link, the preview, the APK
 * WebView) has its own empty IndexedDB. The cloud backup (Cloudflare D1) is
 * what carries data across origins — this module pulls it on boot WHENEVER
 * the local database is completely empty, so opening the deploy link simply
 * shows the same data as everywhere else.
 *
 * Safety rules:
 *  - NEVER touches a device that already has ANY data (the emptiness check
 *    runs first; an unreadable database also counts as "not empty").
 *  - Runs at most once per successful outcome per origin (localStorage flag),
 *    except while the cloud is still empty — so the flow "back up on the
 *    phone → open the deploy link later" just works.
 *  - A deliberate in-app Reset marks the flag so wiped data is not silently
 *    resurrected on the next boot (see markAutoRestoreSkipped).
 *  - Transient failures (network/timeout) do NOT set the flag — the next
 *    boot retries; permanent configuration errors do.
 */

import {
  d1Query,
  getD1Credentials,
  getEffectiveD1Credentials,
  restoreFromD1,
} from './cloud-d1';
import {
  offlineBills,
  offlineCategories,
  offlineCashEntries,
  offlineExpenses,
  offlineProducts,
  offlineServiceTransactions,
  offlineTransactions,
} from './offline-db';

const FLAG_PREFIX = 'ps-auto-restore:';

export type AutoRestoreOutcome =
  | 'restored'
  | 'cloud-empty'
  | 'skipped-has-data'
  | 'skipped-flag'
  | 'skipped-no-creds'
  | 'error';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Best-effort only — worst case auto-restore runs once more next boot.
  }
}

/** Cheap full-count across every data store (fail-safe: error → NOT empty). */
async function localDataIsEmpty(userId: string): Promise<boolean> {
  try {
    const [cats, prods, txns, exps, cash, svc, bills] = await Promise.all([
      offlineCategories.getAll(userId),
      offlineProducts.getAll(userId),
      offlineTransactions.getAll(userId),
      offlineExpenses.getAll(userId),
      offlineCashEntries.getAll(userId),
      offlineServiceTransactions.getAll(userId),
      offlineBills.getAll(userId),
    ]);
    return (
      cats.length + prods.length + txns.length + exps.length +
      cash.length + svc.length + bills.length
    ) === 0;
  } catch {
    return false;
  }
}

/**
 * Marks auto-restore as "handled" for this origin. Called by the in-app Reset
 * flow so a deliberate wipe is never undone automatically.
 */
export function markAutoRestoreSkipped(userId: string): void {
  if (!userId) return;
  safeSet(FLAG_PREFIX + userId, 'skipped');
}

/** True when a previous outcome already settled auto-restore for this origin. */
export function isAutoRestoreSettled(userId: string): boolean {
  return !!userId && !!safeGet(FLAG_PREFIX + userId);
}

// One auto-restore at a time (boot() can theoretically run twice — effect
// re-fires on store hydration — and two concurrent full-replace imports
// would be wasteful, though idempotent).
let running = false;

/**
 * Restores the cloud backup into an EMPTY local database. Never throws.
 * Returns what happened so the splash screen can show a status line.
 */
export async function autoRestoreIfEmpty(userId: string): Promise<AutoRestoreOutcome> {
  if (!userId || typeof window === 'undefined' || running) return 'skipped-flag';
  running = true;
  try {
    if (safeGet(FLAG_PREFIX + userId)) return 'skipped-flag';

    if (!(await localDataIsEmpty(userId))) {
      // This device has data → auto-restore is permanently irrelevant here.
      safeSet(FLAG_PREFIX + userId, 'has-data');
      return 'skipped-has-data';
    }

    // Explicitly saved keys win; on web hosting the server-managed sentinel
    // covers the "no keys on this device" case (env-backed proxy).
    const creds = await getEffectiveD1Credentials(userId);
    if (!creds) {
      // APK without saved keys — nothing to pull from. Permanent: no server.
      safeSet(FLAG_PREFIX + userId, 'no-creds');
      return 'skipped-no-creds';
    }
    // Cloud-reachability pre-check: without LOCAL keys the sentinel relies on
    // the proxy having env credentials — detect that once, quietly.
    if (!getD1Credentials(userId)) {
      const probe = await d1Query(creds, 'SELECT 1 AS ok');
      if (!probe.ok) {
        if (probe.errorCode === 'missing_creds') {
          // No server-managed cloud configured → permanent on this origin.
          safeSet(FLAG_PREFIX + userId, 'no-server-cloud');
        }
        // Anything else (network hiccup etc.) → retry on next boot.
        return 'skipped-no-creds';
      }
    }

    const res = await restoreFromD1(userId, creds);
    if (res.ok) {
      safeSet(FLAG_PREFIX + userId, 'restored');
      return 'restored';
    }
    if (res.empty) {
      // Cloud has no backup yet — do NOT settle: a backup made later should
      // be picked up automatically on the next boot.
      return 'cloud-empty';
    }
    // Definitive failure (bad ids / token / corrupted backup) → settle so we
    // stop retrying every boot. Transient errors (timeout/network) don't.
    const err = res.error || '';
    const transient = /timed out|network|failed to fetch/i.test(err);
    if (!transient) safeSet(FLAG_PREFIX + userId, 'error');
    return 'error';
  } catch {
    return 'error';
  } finally {
    running = false;
  }
}
