/**
 * Incremental cloud sync engine (Auto Sync).
 *
 * Full backups upload EVERY row — great as a checkpoint, too heavy to run on
 * every stock change. This engine pushes ONLY what changed:
 *
 *   stock out 2 iPhones → 1 transactions row + 1 products row
 *   → 1-2 Cloudflare API calls a few seconds later (not a full backup).
 *
 * How it works:
 *  - Every offline write (offline-service.ts) marks affected row ids in
 *    localStorage (sync-dirty.ts) and fires a 'ps-d1-dirty' window event.
 *  - This engine listens, debounces (rapid multi-sell bursts batch into ONE
 *    sync), then pushes changed rows via INSERT OR REPLACE (idempotent — a
 *    retried sync can never duplicate) and deletes by id.
 *  - After every push the ps_backup_meta counts are recomputed from the cloud
 *    itself, so restore's row-count integrity check stays valid.
 *  - If the cloud has no backup yet (or a table overflowed its dirty list),
 *    a FULL backup runs automatically instead.
 *  - Offline / failure: the dirty list stays untouched — the next event,
 *    going back online, or the periodic sweep retries automatically.
 */

import {
  CLOUD_TABLES,
  backupToD1,
  buildInsertStatements,
  d1Query,
  getD1Credentials,
  getEffectiveD1Credentials,
  readCloudMeta,
  runStatements,
  sanitizeText,
  serverManagedCloudPossible,
  upsertBillingSettingsRow,
  type CloudCounts,
  type CloudTable,
  type D1Credentials,
} from './cloud-d1';
import { getBillingSettingsOffline, getProfileOffline } from './offline-service';
import {
  clearSynced,
  getDirty,
  hasDirty,
  isAutoSyncEnabled,
  setLastAutoSync,
} from './sync-dirty';

const DIRTY_PREFIX = 'ps-d1-dirty:';
const EVENT_NAME = 'ps-d1-dirty';
/** Rapid multi-sell bursts batch into one sync. */
const DEBOUNCE_MS = 12_000;
/** Never push more than this many ids in one DELETE statement. */
const IDS_PER_DELETE = 50;
/** Statements per API call (parity with the full-backup uploader). */
const STATEMENTS_PER_CALL = 10;

// ---- Local row accessors (camelCase key in CLOUD_TABLES ↔ store accessor) ----

type Row = Record<string, unknown>;

async function getLocalRows(localKey: string, userId: string): Promise<Row[]> {
  const { offlineBills, offlineCategories, offlineCashEntries, offlineExpenses, offlineProducts, offlineServiceTransactions, offlineTransactions } = await import('./offline-db');
  const accessors: Record<string, (uid: string) => Promise<unknown[]>> = {
    categories: uid => offlineCategories.getAll(uid),
    products: uid => offlineProducts.getAll(uid),
    transactions: uid => offlineTransactions.getAll(uid),
    expenses: uid => offlineExpenses.getAll(uid),
    cashEntries: uid => offlineCashEntries.getAll(uid),
    serviceTransactions: uid => offlineServiceTransactions.getAll(uid),
    bills: uid => offlineBills.getAll(uid),
  };
  const get = accessors[localKey];
  if (!get) return [];
  const rows = await get(userId);
  return rows as Row[];
}

// ---- Scheduling ----

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const failStreak = new Map<string, number>();
let syncing = false;
let rerunUserId: string | null = null;
let initialized = false;

/**
 * Schedules a sync for this user (debounced). Safe to call from any write
 * path — no-op when auto sync is off, credentials are missing, or nothing
 * is pending.
 */
export function scheduleCloudSync(userId: string, delayMs: number = DEBOUNCE_MS): void {
  if (!userId || typeof window === 'undefined') return;
  if (!isAutoSyncEnabled(userId)) return;
  // Locally saved keys OR a possible server-managed cloud (the engine re-checks
  // properly — this is only a cheap pre-filter to avoid pointless timers).
  if (!getD1Credentials(userId) && !serverManagedCloudPossible()) return;
  if (!hasDirty(userId)) return;

  const existing = timers.get(userId);
  if (existing) clearTimeout(existing);

  // Backoff after repeated failures — never burn battery/API quota on a
  // persistent error; the periodic sweep keeps retrying meanwhile.
  const streak = failStreak.get(userId) || 0;
  const backoffMs = streak >= 3 ? Math.min((streak - 2) * 60_000, 600_000) : 0;

  const t = setTimeout(
    () => {
      timers.delete(userId);
      void runCloudSync(userId);
    },
    Math.max(delayMs, backoffMs)
  );
  timers.set(userId, t);
}

/**
 * Installs the global listeners (dirty-event, back-online, periodic sweep).
 * Call ONCE from the app shell. Safe to call multiple times.
 */
export function initCloudSync(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  // Fired by sync-dirty.markDirty on every offline write.
  window.addEventListener(EVENT_NAME, e => {
    const uid = (e as CustomEvent<string>).detail;
    if (typeof uid === 'string') scheduleCloudSync(uid);
  });

  // Connectivity back → flush whatever piled up while offline.
  window.addEventListener('online', () => {
    setTimeout(() => {
      for (const uid of dirtyUserIds()) scheduleCloudSync(uid, 1_500);
    }, 1_500);
  });

  // Periodic sweep — catches anything missed (timer lost to page kill, etc).
  window.setInterval(() => {
    for (const uid of dirtyUserIds()) scheduleCloudSync(uid, 2_000);
  }, 60_000);
}

function dirtyUserIds(): string[] {
  try {
    return Object.keys(localStorage)
      .filter(k => k.startsWith(DIRTY_PREFIX))
      .map(k => k.slice(DIRTY_PREFIX.length))
      .filter(uid => hasDirty(uid));
  } catch {
    return [];
  }
}

// ---- Engine ----

export interface SyncResult {
  ok: boolean;
  error?: string;
  /** True when a FULL backup ran instead of an incremental push. */
  fullBackup?: boolean;
}

export async function runCloudSync(userId: string): Promise<SyncResult> {
  if (!userId) return { ok: false, error: 'no user' };
  if (syncing) {
    rerunUserId = userId;
    return { ok: false, error: 'busy' };
  }
  if (typeof window === 'undefined' || !isAutoSyncEnabled(userId)) {
    return { ok: false, error: 'auto sync disabled' };
  }
  const creds = await getEffectiveD1Credentials(userId);
  if (!creds) return { ok: false, error: 'no credentials' };
  if (!hasDirty(userId)) return { ok: true };

  syncing = true;
  try {
    const dirty = getDirty(userId);
    const meta = await readCloudMeta(creds);

    // No backup yet (or a table overflowed) → full backup covers everything.
    if (!meta || dirty.fullResync.length > 0) {
      const profile = await getProfileOffline(userId);
      const res = await backupToD1(userId, creds, {
        userEmail: String(profile?.user?.email || ''),
        shopName: String(profile?.user?.shopName || ''),
      });
      if (!res.ok) throw new Error(res.error || 'Full backup failed');
      failStreak.delete(userId);
      setLastAutoSync(userId, Date.now());
      return { ok: true, fullBackup: true };
    }

    const syncedChanged: Record<string, string[]> = {};
    const syncedDeleted: Record<string, string[]> = {};

    for (const table of CLOUD_TABLES) {
      // 1. Changed rows → INSERT OR REPLACE (idempotent)
      const changedIds = dirty.changed[table.cloud] || [];
      if (changedIds.length > 0) {
        const all = await getLocalRows(table.local, userId);
        const byId = new Map(all.map(r => [String(r.id), r]));
        const rows = changedIds.map(id => byId.get(id)).filter(Boolean) as Row[];
        if (rows.length > 0) {
          const statements = buildInsertStatements(table, rows);
          for (let i = 0; i < statements.length; i += STATEMENTS_PER_CALL) {
            const r = await runStatements(creds, statements.slice(i, i + STATEMENTS_PER_CALL));
            if (!r.ok) throw new Error(r.error || 'Row upload failed');
          }
        }
        syncedChanged[table.cloud] = changedIds;
        // Marked changed but missing locally → deleted meanwhile; also delete in cloud.
        const missing = changedIds.filter(id => !byId.has(id));
        if (missing.length > 0) {
          await deleteCloudRows(creds, table.cloud, missing);
          (syncedDeleted[table.cloud] ||= []).push(...missing);
        }
      }

      // 2. Deleted rows → DELETE BY id
      const deletedIds = dirty.deleted[table.cloud] || [];
      if (deletedIds.length > 0) {
        await deleteCloudRows(creds, table.cloud, deletedIds);
        (syncedDeleted[table.cloud] ||= []).push(...deletedIds);
      }
    }

    // 3. Billing settings (single bound-param row, huge dataURLs safe)
    const bsIds = dirty.changed['ps_billing_settings'] || [];
    if (bsIds.length > 0) {
      const bs = (await getBillingSettingsOffline(userId)) as unknown as Row | null;
      const r = await upsertBillingSettingsRow(creds, userId, bs || {});
      if (!r.ok) throw new Error(r.error || 'Billing settings sync failed');
      syncedChanged['ps_billing_settings'] = bsIds;
    }

    // 4. Recompute meta counts FROM THE CLOUD so restore integrity stays exact.
    const counts = await countCloudRows(creds, userId);
    await writeMetaRow(creds, userId, meta, counts);

    // 5. Only now forget the synced ids (anything written during the run
    //    stays dirty and syncs next time).
    clearSynced(userId, { changed: syncedChanged, deleted: syncedDeleted });
    failStreak.delete(userId);
    setLastAutoSync(userId, Date.now());
    return { ok: true };
  } catch (e) {
    failStreak.set(userId, (failStreak.get(userId) || 0) + 1);
    return { ok: false, error: (e as Error).message || 'Sync failed' };
  } finally {
    syncing = false;
    if (rerunUserId) {
      const uid = rerunUserId;
      rerunUserId = null;
      scheduleCloudSync(uid, 3_000);
    }
  }
}

async function deleteCloudRows(creds: D1Credentials, table: string, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += IDS_PER_DELETE) {
    const chunk = ids
      .slice(i, i + IDS_PER_DELETE)
      .map(id => `'${sanitizeText(String(id)).replace(/'/g, "''")}'`)
      .join(', ');
    const r = await runStatements(creds, [`DELETE FROM ${table} WHERE id IN (${chunk})`]);
    if (!r.ok) throw new Error(r.error || 'Cloud delete failed');
  }
}

/** One round-trip: every table's row count in a single SELECT of subqueries. */
async function countCloudRows(
  creds: D1Credentials,
  userId: string
): Promise<CloudCounts> {
  const u = `'${sanitizeText(userId).replace(/'/g, "''")}'`;
  const sql = `SELECT
    (SELECT COUNT(*) FROM ps_categories WHERE user_id = ${u}) AS categories,
    (SELECT COUNT(*) FROM ps_products WHERE user_id = ${u}) AS products,
    (SELECT COUNT(*) FROM ps_transactions WHERE user_id = ${u}) AS transactions,
    (SELECT COUNT(*) FROM ps_expenses WHERE user_id = ${u}) AS expenses,
    (SELECT COUNT(*) FROM ps_cash_entries WHERE user_id = ${u}) AS cashEntries,
    (SELECT COUNT(*) FROM ps_service_transactions WHERE user_id = ${u}) AS serviceTransactions,
    (SELECT COUNT(*) FROM ps_bills WHERE user_id = ${u}) AS bills`;
  const r = await d1Query(creds, sql);
  if (!r.ok) throw new Error(r.error || 'Count failed');
  const row = r.rows?.[0] || {};
  const n = (v: unknown) => Number(v) || 0;
  return {
    categories: n(row.categories),
    products: n(row.products),
    transactions: n(row.transactions),
    expenses: n(row.expenses),
    cashEntries: n(row.cashEntries),
    serviceTransactions: n(row.serviceTransactions),
    bills: n(row.bills),
  };
}

async function writeMetaRow(
  creds: D1Credentials,
  userId: string,
  prevMeta: Row,
  counts: CloudCounts
): Promise<void> {
  const profile = await getProfileOffline(userId).catch(() => null);
  const totalRows =
    counts.categories + counts.products + counts.transactions +
    counts.expenses + counts.cashEntries + counts.serviceTransactions + counts.bills;
  const r = await d1Query(
    creds,
    `INSERT OR REPLACE INTO ps_backup_meta (id, user_id, user_email, shop_name, backed_up_at, total_rows, counts)
     VALUES (1, ?, ?, ?, ?, ?, ?)`,
    [
      String(prevMeta.user_id || userId),
      String(prevMeta.user_email || profile?.user?.email || ''),
      String(prevMeta.shop_name || profile?.user?.shopName || ''),
      new Date().toISOString(),
      totalRows,
      JSON.stringify(counts),
    ]
  );
  if (!r.ok) throw new Error(r.error || 'Meta update failed');
}

// Re-exported so the UI has one import site for everything auto-sync related.
export { isAutoSyncEnabled, setAutoSyncEnabled, getLastAutoSync, hasDirty } from './sync-dirty';
export type { DirtyState } from './sync-dirty';
export type { CloudTable } from './cloud-d1';
