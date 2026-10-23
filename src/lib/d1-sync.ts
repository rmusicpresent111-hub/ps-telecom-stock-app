/**
 * Cloudflare D1 sync engine — PS TELECOM multi-device sync (SECURE v2).
 *
 * Architecture (offline-first, IndexedDB stays the source of truth):
 *  - ACCOUNT: one shop = one Sync ID + PIN. connectSync() registers it in
 *    D1 `sync_accounts` (create) or verifies it (join from another device).
 *    The engine is dormant ('off') until an account is connected.
 *  - E2E ENCRYPTION: every payload is AES-256-GCM encrypted with a key
 *    derived from the PIN (sync-crypto.ts). The D1 token inside the APK
 *    therefore exposes nothing readable. Forged rows fail auth → skipped.
 *  - PUSH: local writes fire notifyLocalDataChanged → near-instant push
 *    (1s micro-batch; ≤5s max wait during continuous writes) of records
 *    newer than the push watermark, then an immediate pull-back. Deletes
 *    go through the local
 *    `pendingDeletes` queue and become ENCRYPTED tombstone rows in the
 *    `_tomb` store (outsiders cannot forge deletions).
 *  - PULL: every 12s (+ boot / network-online / app focus), rows newer than
 *    the pull watermark are decrypted and applied last-writer-wins via the
 *    cloud version (_sv). Rows with un-pushed local edits are never
 *    overwritten.
 *  - INTEGRITY PASS (v2.17.0): after every pull, a watermark-FREE id-diff
 *    runs for EVERY store: any row that exists in the cloud but not locally
 *    is fetched + applied, and any local row missing in the cloud is
 *    re-asserted — so a row can never stay "lost" because of a watermark
 *    edge case. Categories additionally ride the same pass every cycle.
 *  - SERVER-DOMAIN VERSIONS (v2.17.0): outgoing pushes carry
 *    ver = max(record updatedAt, server-normalised now) — a device with a
 *    wrong clock can no longer write rows that other devices' pull
 *    watermarks permanently skip (the real "kokhono ashe kokhono ashe na").
 *  - CONDITIONAL UPSERT (v2.17.0): the cloud only overwrites a payload when
 *    the incoming version is newer — a late push of a stale row can no
 *    longer clobber the cloud's newer copy.
 *  - MERGE ALIASES (v2.17.0): when two devices create the same-named
 *    category, adoption collapses them into one deterministic row and the
 *    loser's id is recorded in a persisted alias map — the zombie row can
 *    never resurrect as a duplicate, and every product pointing at the
 *    loser is rewired to the winner on every device (with a dirty bump so
 *    the fix propagates cloud-wide).
 *  - CATEGORIES ARE IMMORTAL (v2.14.0): no code path deletes a category —
 *    local, remote or heal. Legacy category tombstones are purged from the
 *    cloud at boot and never cached, so a stale delete marker can never hide
 *    a live category row from any device (the "categories vanish" bug).
 *  - SELF-HEAL: if an attacker wipes or poisons cloud rows, devices restore:
 *      (a) rows missing in the cloud are re-asserted from local copies
 *      (b) rows that fail decryption ("poison") are force-overwritten
 *    Heal runs at boot and every 6h.
 *  - CLOCK SKEW: every cycle reads D1 server time; pushes carry a
 *    server-normalised timestamp so wrong device clocks still converge.
 *
 * D1 REST notes (verified against the live API):
 *  - one statement per request: {sql, params[]} (array-of-statements bodies
 *    are NOT accepted) → batching = multi-row INSERT ... VALUES (...),(...)
 *  - UPSERT guard: ON CONFLICT ... updated_at = MAX(existing+1, excluded)
 *    keeps cloud versions monotonic (last push wins, never regresses)
 *  - 100 bound parameters max per statement → 16 rows × 5 params per batch
 */

import { getOfflineDB, type OfflineDBSchema } from './offline-db';
import { onLocalDataChanged, onLocalWipe } from './sync-events';
import { DEFAULT_USER_ID } from './local-auth';
import {
  D1_QUERY_URL,
  D1_API_TOKEN,
  D1_ACCOUNT_ID,
  D1_DATABASE_ID,
  getSyncAccount,
  setSyncAccount,
  clearSyncAccount,
  onSyncAccountChanged,
  isStaticWebHost,
  SYNC_ID_RE,
} from './d1-config';
import {
  deriveEncKey,
  encryptRow,
  decryptRow,
  hashPinForAccount,
  safeEqualHex,
  randomSalt,
} from './sync-crypto';

// ============ tunables ============

const POLL_INTERVAL_MS = 12_000; // "realtime" cadence for other devices' changes
const PUSH_DEBOUNCE_MS = 1_000; // near-instant push right after add/edit/delete
const PUSH_MAX_WAIT_MS = 5_000; // continuous writes can't postpone a push beyond this
const REQUEST_TIMEOUT_MS = 25_000;
const RETRY_DELAY_MS = 2_500;
const PULL_PAGE_LIMIT = 400;
const PUSH_ROWS_PER_STMT = 16; // 16 rows × 5 params = 80 (D1 limit: 100 params)
const PUSH_CONCURRENCY = 3;
// Trust clock offsets up to 48h: a phone with a badly-wrong clock (auto-time
// off, battery pull) must still get server-normalised timestamps, otherwise
// its pushes land below every other device's pull watermark and those rows
// NEVER propagate ("category kokhono ashe kokhono ashe na").
const CLOCK_OFFSET_MAX_MS = 48 * 60 * 60 * 1000;
const HEAL_INTERVAL_MS = 6 * 60 * 60 * 1000; // self-heal sweep every 6h
const HEAL_MAX_MISSING = 1000; // cap re-asserts per heal sweep
const MAX_PAYLOAD_JSON = 200_000; // skip pathological rows (JSON chars)

const SYNCED_STORES = [
  'categories',
  'products',
  'transactions',
  'expenses',
  'cashEntries',
  'serviceTransactions',
  'bills',
  'staffPayments',
  'billingSettings',
] as const;
type SyncStore = (typeof SYNCED_STORES)[number];

/** Encrypted tombstone rows live in this pseudo-store inside sync_data. */
const TOMB_STORE = '_tomb';

const wmKey = (base: string, syncId: string): string => `${base}:${syncId}`;
const WM_PULL = 'd2-pull';
const WM_PUSH = 'd2-push';
const WM_HEAL = 'd2-heal';

// ============ status surface (UI) ============

export type D1SyncState = 'off' | 'idle' | 'syncing' | 'error' | 'offline';

export interface D1SyncStatus {
  state: D1SyncState;
  lastSyncAt: number; // epoch ms (0 = never)
  lastError: string | null;
}

let status: D1SyncStatus = { state: 'off', lastSyncAt: 0, lastError: null };
const statusListeners = new Set<(s: D1SyncStatus) => void>();

function setStatus(patch: Partial<D1SyncStatus>): void {
  status = { ...status, ...patch };
  statusListeners.forEach((fn) => {
    try {
      fn(status);
    } catch {
      /* listener errors are non-fatal */
    }
  });
}

export function getD1SyncStatus(): D1SyncStatus {
  return status;
}

export function subscribeD1Status(fn: (s: D1SyncStatus) => void): () => void {
  statusListeners.add(fn);
  return () => {
    statusListeners.delete(fn);
  };
}

// ============ low-level transport ============

type Row = Record<string, unknown> & { id: string };

function isNetworkError(msg?: string): boolean {
  if (!msg) return false;
  return /timeout|failed to fetch|network|offline|unavailable|aborted|dns|socket/i.test(msg);
}

interface D1ResponseShape {
  result?: { results?: unknown[]; success?: boolean }[];
  success?: boolean;
  errors?: { code?: number; message?: string }[];
}

/**
 * True when the compiled-in secrets are the ensure-secrets.mjs TEMPLATE
 * placeholders (PASTE_YOUR_*) — i.e. a build made without the git-ignored
 * d1-secrets.ts (every Vercel build). Relaying placeholders to the proxy used
 * to make Cloudflare answer "Could not route to /accounts/PASTE_YOUR_ACCOUNT_ID/…"
 * ("সংযোগ ব্যর্থ হয়েছে") because non-empty body fields beat the env fallback.
 * Template build → send EMPTY creds instead, so the proxy falls back to the
 * deployment's own CLOUDFLARE_* environment variables (server-managed mode).
 * Real-value builds (sandbox preview, self-hosted) relay the constants as before.
 */
const templateSecrets = /PASTE_YOUR/i.test(`${D1_ACCOUNT_ID} ${D1_DATABASE_ID} ${D1_API_TOKEN}`);

/** Cached native-runtime probe (CapacitorHttp patches fetch → CORS-free). */
let nativeRt: boolean | null = null;
async function isNativeRuntime(): Promise<boolean> {
  if (nativeRt === null) {
    try {
      const { Capacitor } = await import('@capacitor/core');
      nativeRt = Capacitor.isNativePlatform();
    } catch {
      nativeRt = false;
    }
  }
  return nativeRt;
}

/**
 * One D1 statement per request (the API rejects statement arrays).
 *
 * Transport:
 *  - Native (APK): plain fetch — CapacitorHttp patches fetch natively, so the
 *    direct api.cloudflare.com call bypasses WebView CORS entirely.
 *  - Browser (dev server / Vercel / Workers hosting): plain fetch CANNOT call
 *    api.cloudflare.com (no CORS headers + 405 preflight) — the statement is
 *    relayed through the same-origin /api/cloud/d1 proxy instead, which answers
 *    the normalized { ok, rows } shape.
 */
async function d1Query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const native = await isNativeRuntime();
  // Timeout via Promise.race (NOT AbortController): CapacitorHttp's native
  // fetch on Android ignores abort signals — race works identically everywhere.
  const exec = (async () => {
    const res = native
      ? await fetch(D1_QUERY_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${D1_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sql, params }),
        })
      : await fetch('/api/cloud/d1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Template build (Vercel): empty creds → proxy env fallback.
          // Real build: relay the compiled-in keys (self-hosted hosting
          // without CLOUDFLARE_* env vars keeps working).
          body: JSON.stringify({
            accountId: templateSecrets ? '' : D1_ACCOUNT_ID,
            databaseId: templateSecrets ? '' : D1_DATABASE_ID,
            apiToken: templateSecrets ? '' : D1_API_TOKEN,
            sql,
            params,
          }),
        });
    const body = (await res
      .json()
      .catch(() => null)) as (D1ResponseShape & {
      ok?: boolean;
      rows?: Record<string, unknown>[];
      error?: string;
    }) | null;
    if (!res.ok || !body) {
      const apiMsg = body?.error || body?.errors?.[0]?.message || `HTTP ${res.status}`;
      throw new Error(`D1: ${apiMsg}`);
    }
    // Browser path → same-origin proxy answers the normalized shape.
    if (typeof body.ok === 'boolean') {
      if (body.ok !== true) throw new Error(`D1: ${body.error || 'statement failed'}`);
      return (body.rows ?? []) as T[];
    }
    // Native path → raw Cloudflare response.
    if (body.success !== true) {
      const apiMsg = body?.errors?.[0]?.message || 'D1: request failed';
      throw new Error(`D1: ${apiMsg}`);
    }
    const first = body?.result?.[0];
    if (!first || first.success !== true) throw new Error('D1: statement failed');
    return (first.results ?? []) as T[];
  })();
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('D1: request timeout')), REQUEST_TIMEOUT_MS);
  });
  return Promise.race([exec, timeout]);
}

/** Query with automatic schema repair + one retry (survives table drops). */
async function d1QuerySafe<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    return await d1Query<T>(sql, params);
  } catch (err) {
    if (/no such table/i.test((err as Error)?.message || '')) {
      await ensureSchema();
      return d1Query<T>(sql, params);
    }
    throw err;
  }
}

async function ensureSchema(): Promise<void> {
  await d1Query(
    `CREATE TABLE IF NOT EXISTS sync_data (
      user_id TEXT NOT NULL, store TEXT NOT NULL, id TEXT NOT NULL,
      payload TEXT NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, store, id))`
  );
  await d1Query('CREATE INDEX IF NOT EXISTS idx_sd_ver ON sync_data(user_id, updated_at)');
  await d1Query(
    `CREATE TABLE IF NOT EXISTS sync_accounts (
      sync_id TEXT PRIMARY KEY, salt TEXT NOT NULL, code_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL, last_login INTEGER NOT NULL DEFAULT 0)`
  );
  // legacy table kept only so old rows (if any) never error the engine
  await d1Query(
    `CREATE TABLE IF NOT EXISTS sync_tombstones (
      user_id TEXT NOT NULL, store TEXT NOT NULL, id TEXT NOT NULL,
      deleted_at INTEGER NOT NULL, PRIMARY KEY (user_id, store, id))`
  );
}

// ============ engine state ============

let started = false; // engine lifecycle (independent of account presence)
let syncing = false;
let pushAgainAfterCycle = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let clockOffsetMs = 0; // serverNow - localNow (refreshed each cycle)
let clockOffsetUpdatedAt = 0;
let pullWatermark = 0; // server domain (sync_data.updated_at)
let pushWatermark = 0; // DEVICE domain — pushes are selected by record time > this
let lastHealAt = 0;
let lastServerNow = 0;
let encKey: CryptoKey | null = null; // AES-GCM payload key for the connected account
let currentSyncId = '';
const tombstoneCache = new Map<string, number>(); // "store:id" → deleted_at (server domain)
const poisonedRows = new Set<string>(); // "store:id" — cloud rows that failed decryption
let tombVerLast = 0; // monotonic generator for outgoing tombstone versions

// v2.17.0 — category merge aliases: loserId → winnerId (chain-resolved).
// Persisted per sync account in syncMeta so merged categories can never
// resurrect as duplicates on ANY pull path, on ANY device.
const catAlias = new Map<string, string>();

function nowMs(): number {
  return Date.now() + clockOffsetMs;
}

function recordVersionEpoch(row: Record<string, unknown>): number {
  const raw = (row.updatedAt ?? row.createdAt ?? 0) as string | number | undefined;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const t = raw.length === 10 ? new Date(`${raw}T00:00:00`).getTime() : new Date(raw).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function tombKey(store: string, id: string): string {
  return `${store}:${id}`;
}

function stripForCloud(row: Record<string, unknown>): Record<string, unknown> {
  const { _synced: _s, _dirty: _d, _sv: _v, ...rest } = row;
  return rest;
}

async function requireKey(): Promise<CryptoKey> {
  if (!encKey) throw new Error('sync: not connected');
  return encKey;
}

// ============ watermark persistence (syncMeta store) ============

async function loadWatermarks(syncId: string): Promise<void> {
  const db = await getOfflineDB();
  const rows = await db.getAll('syncMeta');
  const kPull = wmKey(WM_PULL, syncId);
  const kPush = wmKey(WM_PUSH, syncId);
  const kHeal = wmKey(WM_HEAL, syncId);
  for (const r of rows) {
    if (r.userId !== syncId) continue;
    const v = typeof r.data === 'number' ? r.data : 0;
    if (r.key === kPull) pullWatermark = v;
    else if (r.key === kPush) pushWatermark = v;
    else if (r.key === kHeal) lastHealAt = v;
  }
}

async function saveWatermark(base: string, syncId: string, value: number): Promise<void> {
  const db = await getOfflineDB();
  const key = wmKey(base, syncId);
  await db.put('syncMeta', { key, userId: syncId, lastSync: value, data: value });
}

async function resetWatermarks(syncId: string): Promise<void> {
  pullWatermark = 0;
  pushWatermark = 0;
  lastHealAt = 0;
  tombstoneCache.clear();
  poisonedRows.clear();
  await saveWatermark(WM_PULL, syncId, 0);
  await saveWatermark(WM_PUSH, syncId, 0);
  await saveWatermark(WM_HEAL, syncId, 0);
}

// ============ category merge aliases (v2.17.0) ============

function catAliasMetaKey(syncId: string): string {
  return `cat-alias:${syncId}`;
}

async function loadCatAlias(syncId: string): Promise<void> {
  try {
    const db = await getOfflineDB();
    const row = await db.get('syncMeta', catAliasMetaKey(syncId));
    const data = (row?.data ?? {}) as Record<string, string>;
    catAlias.clear();
    for (const [k, v] of Object.entries(data)) {
      if (typeof k === 'string' && typeof v === 'string') catAlias.set(k, v);
    }
  } catch {
    catAlias.clear();
  }
}

async function saveCatAlias(syncId: string): Promise<void> {
  try {
    const db = await getOfflineDB();
    await db.put('syncMeta', {
      key: catAliasMetaKey(syncId),
      userId: syncId,
      lastSync: Date.now(),
      data: Object.fromEntries(catAlias),
    });
  } catch {
    /* alias persistence is best-effort; the in-memory map still guards this session */
  }
}

/** Resolve a (possibly chained) loser id to its final winner id. */
function resolveCatAlias(id: string): string {
  let cur = id;
  for (let i = 0; i < 10 && catAlias.has(cur); i++) cur = catAlias.get(cur) as string;
  return cur;
}

// ============ clock sync (server domain) ============

async function refreshClockOffset(): Promise<void> {
  try {
    const t = await d1Query<{ t: number }>(
      "SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS t"
    );
    const serverNow = Number(t[0]?.t ?? 0);
    if (serverNow > 0) {
      const offset = serverNow - Date.now();
      if (Math.abs(offset) < CLOCK_OFFSET_MAX_MS) {
        clockOffsetMs = offset;
        clockOffsetUpdatedAt = Date.now();
      }
      lastServerNow = serverNow;
    }
  } catch {
    /* clock sync is best-effort; pushes proceed with local stamps */
  }
}

// ============ account connect / disconnect ============

export type ConnectMode = 'create' | 'join';
export type ConnectResult = { ok: boolean; error?: string };

function validateConnectInput(syncId: string, pin: string, mode: ConnectMode): string | null {
  if (!SYNC_ID_RE.test(syncId)) return 'bad-id';
  const min = mode === 'create' ? 6 : 4;
  if (typeof pin !== 'string' || pin.length < min || pin.length > 128) return 'bad-pin';
  return null;
}

/**
 * Register (mode='create') or verify (mode='join') a shop sync account in
 * D1, store it locally and start the engine. Errors (for the UI):
 *   bad-id, bad-pin, taken, not-found, wrong-pin, offline
 */
export async function connectSync(
  syncIdRaw: string,
  pin: string,
  mode: ConnectMode
): Promise<ConnectResult> {
  if (isStaticWebHost()) return { ok: false, error: 'static-host' };
  const syncId = syncIdRaw.trim();
  const inputErr = validateConnectInput(syncId, pin, mode);
  if (inputErr) return { ok: false, error: inputErr };

  try {
    await ensureSchema();
    if (mode === 'create') {
      const exists = await d1Query('SELECT 1 AS x FROM sync_accounts WHERE sync_id=?', [syncId]);
      if (exists.length > 0) return { ok: false, error: 'taken' };
      const salt = randomSalt();
      const hash = await hashPinForAccount(pin, salt);
      try {
        await d1Query(
          'INSERT INTO sync_accounts (sync_id, salt, code_hash, created_at, last_login) VALUES (?,?,?,?,?)',
          [syncId, salt, hash, Date.now(), Date.now()]
        );
      } catch (err) {
        if (/unique|constraint/i.test((err as Error)?.message || '')) {
          return { ok: false, error: 'taken' };
        }
        throw err;
      }
    } else {
      const rows = await d1Query<{ salt: string; code_hash: string }>(
        'SELECT salt, code_hash FROM sync_accounts WHERE sync_id=?',
        [syncId]
      );
      const row = rows[0];
      if (!row || typeof row.salt !== 'string' || typeof row.code_hash !== 'string') {
        return { ok: false, error: 'not-found' };
      }
      const hash = await hashPinForAccount(pin, row.salt);
      if (!safeEqualHex(hash, row.code_hash)) return { ok: false, error: 'wrong-pin' };
    }

    // fresh connect → start from watermark 0 so the device fills/republishes
    currentSyncId = syncId;
    encKey = await deriveEncKey(syncId, pin);
    await resetWatermarks(syncId);
    setSyncAccount({ syncId, pin, createdAt: Date.now() });
    setStatus({ state: 'idle', lastError: null });
    void beginCycle(true);
    return { ok: true };
  } catch (err) {
    const msg = (err as Error)?.message || 'connect failed';
    setStatus({ state: isNetworkError(msg) ? 'offline' : 'error', lastError: msg });
    if (isNetworkError(msg)) return { ok: false, error: 'offline' };
    // Deployment has no cloud credentials at all (preview URL / local clone
    // without CLOUDFLARE_* env vars — the proxy answers "Missing accountId,
    // databaseId or apiToken (and no server-managed cloud is configured)").
    // Distinct, actionable code instead of a generic "fail".
    if (/missing accountId|server-managed cloud/i.test(msg)) return { ok: false, error: 'no-server-cloud' };
    return { ok: false, error: 'fail' };
  }
}

/** Stop syncing on this device (cloud copy is kept for the other devices). */
export function disconnectSync(): void {
  clearSyncAccount();
  encKey = null;
  currentSyncId = '';
  stopEngineTimers();
  setStatus({ state: 'off', lastSyncAt: 0, lastError: null });
}

// ============ PUSH ============

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface PushItem {
  store: SyncStore | typeof TOMB_STORE;
  id: string;
  payload: Record<string, unknown>;
  ver: number;
}

/** Push pending local deletes as encrypted `_tomb` rows + drop cloud rows. */
async function pushPendingDeletes(syncId: string): Promise<void> {
  const key = await requireKey();
  const db = await getOfflineDB();
  const pending = (await db.getAll('pendingDeletes')).filter((p) => p.userId === DEFAULT_USER_ID);
  if (pending.length === 0) return;

  // 🔒 v2.13.1: categories are never cloud-deleted. Purge any legacy queued
  // entries from the adoption-tombstone era without pushing them.
  const legacyCats = pending.filter((p) => p.storeName === 'categories');
  const active = pending.filter((p) => p.storeName !== 'categories');
  if (legacyCats.length > 0) {
    try {
      const txp = db.transaction('pendingDeletes', 'readwrite');
      for (const p of legacyCats) void txp.store.delete(p.id);
      await txp.done;
    } catch {
      /* non-fatal */
    }
  }
  if (active.length === 0) return;

  const seen = new Map<string, number>();
  for (const p of active) {
    const k = tombKey(p.storeName, p.itemId);
    seen.set(k, Math.max(seen.get(k) ?? 0, p.deletedAt));
  }

  const items: PushItem[] = [];
  for (const [k, deletedAt] of seen.entries()) {
    const idx = k.indexOf(':');
    const storeName = k.slice(0, idx);
    const itemId = k.slice(idx + 1);
    tombVerLast = Math.max(tombVerLast + 1, nowMs(), deletedAt);
    items.push({
      store: TOMB_STORE,
      id: `t:${storeName}:${itemId}`,
      payload: { sid: storeName, iid: itemId, at: deletedAt },
      ver: tombVerLast,
    });
  }
  await pushDataItems(syncId, items, key);

  // remove the cloud data rows these tombstones hide (OR-groups of pairs)
  const pairs = [...seen.keys()].map((k) => {
    const idx = k.indexOf(':');
    return { storeName: k.slice(0, idx), itemId: k.slice(idx + 1) };
  });
  for (const group of chunk(pairs, 20)) {
    const conds = group.map(() => '(store=? AND id=?)').join(' OR ');
    const params: unknown[] = [syncId];
    for (const it of group) params.push(it.storeName, it.itemId);
    await d1QuerySafe(`DELETE FROM sync_data WHERE user_id=? AND (${conds})`, params);
  }

  // clear the local queue + refresh the resurrection-guard cache
  const tx = db.transaction('pendingDeletes', 'readwrite');
  for (const p of active) void tx.store.delete(p.id);
  await tx.done;
  for (const [k, deletedAt] of seen.entries()) tombstoneCache.set(k, deletedAt);
}

function collectPushCandidates(
  store: SyncStore,
  rows: Record<string, unknown>[],
  pushWm: number
): PushItem[] {
  const out: PushItem[] = [];
  for (const row of rows) {
    const recordVer = recordVersionEpoch(row);
    if (recordVer <= pushWm) continue; // unchanged since last push (device clock domain)
    // v2.17.0 SERVER-DOMAIN VERSIONS: the outgoing cloud version is normalised
    // to push time (server clock). Previously the cloud version was the origin
    // device's LOCAL record time — a device with a behind clock wrote rows
    // below every other device's pull watermark, so those rows NEVER arrived
    // ("kokhono ashe kokhono ashe na"). Selection stays record-based (only
    // re-edited rows are picked); only the published version is normalised.
    const pushVer = Math.max(recordVer, nowMs());
    const sv = typeof row._sv === 'number' ? row._sv : 0;
    if (sv && sv >= pushVer) continue; // echo guard: row came from the cloud unchanged
    // resurrection guard: a newer tombstone for this id exists — drop locally instead.
    // 🔒 v2.14.0: the guard NEVER applies to categories — they are immortal,
    // so a stale tombstone must not block publishing a live category either.
    if (store !== 'categories') {
      const t = tombstoneCache.get(tombKey(store, String(row.id)));
      if (t !== undefined && t >= pushVer) {
        void (async () => {
          try {
            const db = await getOfflineDB();
            await db.delete(store as 'products', row.id as string);
          } catch {
            /* non-fatal */
          }
        })();
        continue;
      }
    }
    const payload = stripForCloud(row);
    payload.id = row.id;
    payload.userId = (row.userId as string) ?? DEFAULT_USER_ID;
    if (JSON.stringify(payload).length > MAX_PAYLOAD_JSON) continue; // pathological row
    out.push({ store, id: String(row.id), payload, ver: pushVer });
  }
  return out;
}

async function pushDataItems(
  syncId: string,
  items: PushItem[],
  key: CryptoKey
): Promise<void> {
  if (items.length === 0) return;
  // encrypt first (sequential — WebCrypto handles throughput fine)
  const encrypted: { store: string; id: string; blob: string; ver: number }[] = [];
  for (const it of items) {
    const blob = await encryptRow(key, it.payload);
    encrypted.push({ store: it.store, id: it.id, blob, ver: it.ver });
  }
  const batches = chunk(encrypted, PUSH_ROWS_PER_STMT);
  let idx = 0;
  const worker = async (): Promise<void> => {
    while (idx < batches.length) {
      const my = idx++;
      const batch = batches[my];
      const placeholders = batch.map(() => '(?,?,?,?,?)').join(',');
      const params: unknown[] = [];
      for (const it of batch) {
        params.push(syncId, it.store, it.id, it.blob, it.ver);
      }
      await d1QuerySafe(
        `INSERT INTO sync_data (user_id, store, id, payload, updated_at) VALUES ${placeholders} ` +
          `ON CONFLICT(user_id, store, id) DO UPDATE SET ` +
          // v2.17.0 CONDITIONAL payload: a late push of a STALE row must never
          // clobber the cloud's newer copy (the old unconditional
          // "payload = excluded.payload" let an out-of-order device silently
          // revert newer data). The version still advances (MAX guard) so the
          // winning payload gets re-pulled by everyone and everything converges.
          `payload = CASE WHEN excluded.updated_at > sync_data.updated_at THEN excluded.payload ELSE sync_data.payload END, ` +
          `updated_at = MAX(sync_data.updated_at + 1, excluded.updated_at)`,
        params
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(PUSH_CONCURRENCY, batches.length) }, worker));
}

async function pushOnce(syncId: string): Promise<{ ok: boolean; error?: string }> {
  if (!getSyncAccount() || !encKey) return { ok: false, error: 'no-account' };
  if (syncing) {
    pushAgainAfterCycle = true;
    return { ok: true, error: 'busy' };
  }
  syncing = true;
  setStatus({ state: 'syncing' });
  const cycleStartDeviceMs = Date.now();
  try {
    // v2.17.0 clock-jump guard: the push watermark lives in the DEVICE clock
    // domain. If the clock jumped BACKWARDS (manual change, NTP correction),
    // the watermark sits in the future and every new row would be skipped
    // forever. Reset once — re-pushing is safe (idempotent conditional UPSERTs).
    if (pushWatermark > Date.now() + 60_000) pushWatermark = 0;

    if (Date.now() - clockOffsetUpdatedAt > 10 * 60 * 1000) await refreshClockOffset();

    await pushPendingDeletes(syncId);

    const db = await getOfflineDB();
    const all: PushItem[] = [];
    for (const store of SYNCED_STORES) {
      let rows: Record<string, unknown>[];
      if (store === 'billingSettings') {
        const r = await db.get('billingSettings', DEFAULT_USER_ID);
        rows = r ? [r as unknown as Record<string, unknown>] : [];
      } else {
        rows = (await db.getAllFromIndex(store, 'by-userId', DEFAULT_USER_ID)) as unknown as Record<
          string,
          unknown
        >[];
      }
      all.push(...collectPushCandidates(store, rows, pushWatermark));
    }

    await pushDataItems(syncId, all, encKey);

    pushWatermark = cycleStartDeviceMs;
    await saveWatermark(WM_PUSH, syncId, pushWatermark);
    lastServerNow = lastServerNow || nowMs();
    setStatus({ state: 'idle', lastSyncAt: lastServerNow, lastError: null });
    return { ok: true };
  } catch (err) {
    const msg = (err as Error)?.message || 'push failed';
    const offline = isNetworkError(msg);
    setStatus({ state: offline ? 'offline' : 'error', lastError: msg });
    return { ok: false, error: msg };
  } finally {
    syncing = false;
  }
}

export async function pushToD1(userId: string): Promise<{ ok: boolean; error?: string }> {
  const syncId = currentSyncId || getSyncAccount()?.syncId;
  if (!syncId || !encKey) return { ok: false, error: 'no-account' };
  void userId;
  const first = await pushOnce(syncId);
  if (first.ok) return first;
  if (first.error !== 'busy' && isNetworkError(first.error)) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return pushOnce(syncId);
  }
  return first;
}

let pushBurstStart = 0; // when the current pending push burst began

/** Push immediately; on success pull right back so the device converges fast. */
function firePushNow(userId: string): void {
  pushTimer = null;
  pushBurstStart = 0;
  void pushToD1(userId).then((res) => {
    if (!res.ok) return;
    // our own change just landed in the cloud — grab other devices' updates now
    const syncId = currentSyncId || getSyncAccount()?.syncId;
    if (syncId && encKey) void pullOnce(syncId);
  });
}

function schedulePush(userId: string): void {
  if (!getSyncAccount()) return;
  const now = Date.now();
  if (pushTimer) {
    // writes keep arriving — reschedule, but never beyond PUSH_MAX_WAIT_MS
    if (now - pushBurstStart < PUSH_MAX_WAIT_MS) {
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => firePushNow(userId), PUSH_DEBOUNCE_MS);
    }
    return;
  }
  pushBurstStart = now;
  pushTimer = setTimeout(() => firePushNow(userId), PUSH_DEBOUNCE_MS);
}

// ============ PULL ============

interface PullRow {
  store: string;
  id: string;
  payload: string;
  ver: number;
}

/**
 * Apply one decrypted tombstone payload ({sid, iid}) with integrity checks.
 * Returns false when the row looks forged/corrupt (caller treats it as poison).
 */
function parseTombPayload(row: PullRow, payload: Record<string, unknown>): { sid: string; iid: string } | null {
  const sid = payload.sid;
  const iid = payload.iid;
  if (typeof sid !== 'string' || typeof iid !== 'string') return null;
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(sid)) return null;
  if (row.id !== `t:${sid}:${iid}`) return null;
  return { sid, iid };
}

async function applyLocalDelete(store: string, id: string): Promise<void> {
  const db = await getOfflineDB();
  const local = (await db.get(store as 'products', id)) as unknown as Row | undefined;
  if (!local) return;
  const localDirty = typeof local._dirty === 'number' && local._dirty > 0;
  if (localDirty) return; // local edit pending — it re-pushes and wins via MAX guard
  const tx = db.transaction(store as 'products', 'readwrite');
  void tx.store.delete(id);
  await tx.done;
}

/**
 * Rewire every local product from category `fromId` to `toId` and BUMP the
 * rows (updatedAt + _dirty) so the fix re-pushes and reaches every device.
 * v2.17.0: the old code remapped without bumping — products that had already
 * been pushed kept their broken categoryId in the cloud forever, so on other
 * devices the product's category looked "missing" (kokhono ashe kokhono na).
 */
async function remapCategoryProducts(fromId: string, toId: string): Promise<number> {
  const db = await getOfflineDB();
  const prods = (await db.getAllFromIndex('products', 'by-userId', DEFAULT_USER_ID)) as unknown as Row[];
  const nowIso = new Date().toISOString();
  const dirty = Date.now();
  let n = 0;
  const tx = db.transaction('products', 'readwrite');
  for (const p of prods) {
    if (p.categoryId !== fromId) continue;
    void tx.store.put({ ...p, categoryId: toId, updatedAt: nowIso, _dirty: dirty } as unknown as Row);
    n++;
  }
  await tx.done;
  return n;
}

/**
 * When a cloud category arrives whose name matches a local category with a
 * DIFFERENT id, keep a deterministic single row (older createdAt wins; tie ->
 * smaller id wins) and record the loser in the alias map.
 *
 * v2.17.0 fixes vs the old adoption:
 *  - name match is CASE-INSENSITIVE + trimmed (matches ensureCategoryOffline,
 *    so "Mobile" and "mobile" from two devices collapse instead of duplicating)
 *  - the loser is recorded in the persisted ALIAS MAP - its zombie cloud row
 *    can never resurrect as a live duplicate later (e.g. after the winner is
 *    renamed and the name no longer matches)
 *  - EVERY local product pointing at EITHER loser id is rewired to the winner
 *    with a dirty bump - the old code only remapped in one of the two
 *    branches and never re-pushed, leaving orphan products whose category
 *    looked "missing" on other devices
 *  - the local-wins branch no longer overwrites the local winner's data with
 *    the loser's payload (that silently reverted the owner's tile image)
 * Returns 'applied' (caller should put the incoming payload), 'skipped'
 * (incoming row must be dropped) or 'new' (no twin - normal apply).
 */
async function adoptCategory(
  userId: string,
  payload: Record<string, unknown>,
  syncId: string
): Promise<'applied' | 'skipped' | 'new'> {
  const incomingId = String(payload.id);

  // zombie re-arrival: this id already lost a merge - never a live row again
  if (catAlias.has(incomingId)) return 'skipped';

  const db = await getOfflineDB();
  const incomingName = String(payload.name ?? '').trim().toLowerCase();
  const incomingCreated = String(payload.createdAt ?? '');
  if (!incomingName) return 'new';

  const locals = (await db.getAllFromIndex('categories', 'by-userId', userId)) as unknown as Row[];
  const twin = locals.find(
    (c) => String(c.name ?? '').trim().toLowerCase() === incomingName && c.id !== incomingId
  );
  if (!twin) return 'new';

  const twinCreated = String(twin.createdAt ?? '');
  const incomingWins =
    incomingCreated < twinCreated || (incomingCreated === twinCreated && incomingId < twin.id);

  if (incomingWins) {
    // incoming wins: delete the local twin, remap its products, adopt its id
    await remapCategoryProducts(twin.id, incomingId);
    const tx = db.transaction('categories', 'readwrite');
    void tx.objectStore('categories').delete(twin.id);
    await tx.done;
    catAlias.set(twin.id, incomingId);
    await saveCatAlias(syncId);
    // v2.13.1: NO cloud tombstone for the loser - the loser's cloud row
    // simply stays behind as an inert zombie; the alias map (and every
    // device's adoption) skips it on every path forever.
    return 'applied';
  }

  // local twin wins: keep the local row UNTOUCHED (the old code overwrote it
  // with the incoming payload, silently reverting the owner's icon/image),
  // rewire any local product that already references the incoming (loser) id,
  // and remember the loser so it can never come back.
  await remapCategoryProducts(incomingId, twin.id);
  catAlias.set(incomingId, twin.id);
  await saveCatAlias(syncId);
  return 'skipped';
}

/**
 * Apply one decrypted DATA row (store already validated) to IndexedDB.
 * Shared by the watermark pull AND the watermark-free integrity pass so both
 * paths enforce the exact same guards:
 *  - payload integrity (payload.id must match the row key)
 *  - tombstone guard (categories exempt — immortal since v2.14.0)
 *  - billingSettings single-row upsert
 *  - "never clobber an un-pushed local edit" + cloud-version gate
 *  - category merge adoption + zombie alias skip
 *  - v2.17.0: userId forced to DEFAULT_USER_ID (one shop = one sync account;
 *    legacy rows with odd userId values used to land invisible forever)
 * Returns true when the row was applied.
 */
async function applyPulledRow(
  store: string,
  id: string,
  ver: number,
  payload: Record<string, unknown>,
  key: CryptoKey
): Promise<boolean> {
  if (!(SYNCED_STORES as readonly string[]).includes(store)) return false;
  if (payload.id !== id) return false; // integrity: payload must match row key

  // categories skip the tombstone guard — a legacy delete marker must never
  // hide a live category row from a fresh device.
  if (store !== 'categories') {
    const t = tombstoneCache.get(tombKey(store, id));
    if (t !== undefined && t >= ver) return false; // deleted after this write — skip
  }

  const db = await getOfflineDB();

  if (store === 'billingSettings') {
    const local = (await db.get('billingSettings', DEFAULT_USER_ID)) as unknown as Row | undefined;
    if (local && typeof local._sv === 'number' && local._sv >= ver) return false;
    payload.userId = DEFAULT_USER_ID;
    payload._sv = ver;
    await db.put('billingSettings', payload as unknown as OfflineDBSchema['billingSettings']['value']);
    return true;
  }

  const local = (await db.get(store as 'products', id)) as unknown as Row | undefined;
  if (local) {
    const localDirty = typeof local._dirty === 'number' && local._dirty > 0;
    if (localDirty) return false; // never clobber an un-pushed local edit
    const localSv = typeof local._sv === 'number' ? local._sv : 0;
    if (localSv >= ver) return false; // already have this (or newer) version
  }

  // category adoption: a cloud category colliding with a same-name local
  // seed must not become a duplicate — deterministic winner keeps its id
  if (store === 'categories') {
    const res = await adoptCategory(DEFAULT_USER_ID, payload, currentSyncId);
    if (res === 'skipped') return false;
    // 'applied' | 'new' → fall through and put the payload
  }

  // v2.17.0: a product may arrive STILL pointing at a category id that lost
  // a merge on THIS device (the product was pushed before the loser's other
  // device adopted). Rewire through the alias map or it lands as an orphan
  // whose category looks "missing" forever.
  if (store === 'products' && typeof payload.categoryId === 'string') {
    const resolved = resolveCatAlias(payload.categoryId);
    if (resolved !== payload.categoryId) payload.categoryId = resolved;
  }

  payload._sv = ver;
  payload._dirty = 0;
  payload._synced = Date.now();
  payload.userId = DEFAULT_USER_ID; // v2.17.0: legacy userId rows stay visible
  const tx = db.transaction(store as 'products', 'readwrite');
  void tx.store.put(payload as unknown as OfflineDBSchema['products']['value']);
  await tx.done;
  return true;
}

/**
 * v2.17.0 INTEGRITY PASS — the "a row can never stay lost" guarantee.
 *
 * Runs at most once a minute (NOT on every 12s pull — the /api/cloud/d1
 * proxy rate-limits per IP), WATERMARK-FREE, for every store:
 *  (1) ONE combined id-list query diffs every store against the cloud;
 *      any row that exists in the cloud but not locally is fetched and
 *      applied — a watermark skip, a version collision or a fresh-device
 *      race can no longer leave a category/product invisible;
 *  (2) any local row missing in the cloud is re-asserted immediately
 *      (tombstone-guarded for deletable stores) — the owner never waits
 *      up to 6h for the heal sweep.
 * Healthy devices pay ONE tiny id-only SELECT per minute.
 */
const INTEGRITY_INTERVAL_MS = 60_000;
let lastIntegrityAt = 0;

async function integrityPass(syncId: string, key: CryptoKey): Promise<void> {
  const db = await getOfflineDB();
  let fixed = 0;
  try {
    // ONE combined id-list for every synced store (rate-limit friendly)
    const storeList = SYNCED_STORES.map((s) => `'${s}'`).join(',');
    const cloudRows = await d1QuerySafe<{ store: string; id: string }>(
      `SELECT store, id FROM sync_data WHERE user_id=? AND store IN (${storeList})`,
      [syncId]
    );
    const cloudIds = new Map<string, Set<string>>();
    for (const r of cloudRows) {
      let set = cloudIds.get(r.store);
      if (!set) cloudIds.set(r.store, (set = new Set()));
      set.add(String(r.id));
    }

    for (const store of SYNCED_STORES) {
      let locals: Record<string, unknown>[];
      if (store === 'billingSettings') {
        const r = await db.get('billingSettings', DEFAULT_USER_ID);
        locals = r ? [r as unknown as Record<string, unknown>] : [];
      } else {
        locals = (await db.getAllFromIndex(store, 'by-userId', DEFAULT_USER_ID)) as unknown as Record<
          string,
          unknown
        >[];
      }
      const localIds = new Set(locals.map((r) => String(r.id)));
      const cloudIdSet = cloudIds.get(store) ?? new Set<string>();

      // (1) cloud rows missing locally -> fetch + apply (watermark-independent)
      const missingIds = [...cloudIdSet].filter((id) => !localIds.has(id));
      for (const group of chunk(missingIds, 20)) {
        const ph = group.map(() => '?').join(',');
        const rows = await d1QuerySafe<PullRow>(
          `SELECT store, id, payload, updated_at AS ver FROM sync_data WHERE user_id=? AND store=? AND id IN (${ph})`,
          [syncId, store, ...group]
        );
        for (const r of rows) {
          let payload: Record<string, unknown> | null = null;
          try {
            if (typeof r.payload === 'string' && r.payload.startsWith('v1.')) {
              payload = await decryptRow(key, r.payload);
            } else if (typeof r.payload === 'string' && r.payload.startsWith('{')) {
              payload = JSON.parse(r.payload) as Record<string, unknown>;
            }
          } catch {
            payload = null;
          }
          if (!payload) {
            poisonedRows.add(tombKey(r.store, r.id)); // heal later (self-heal sweep)
            continue;
          }
          const ok = await applyPulledRow(r.store, r.id, Number(r.ver), payload, key);
          if (ok) fixed++;
        }
      }

      // (2) local rows missing in the cloud -> re-assert immediately
      const extra: PushItem[] = [];
      for (const row of locals) {
        const id = String(row.id);
        if (cloudIdSet.has(id)) continue;
        if (store === 'categories' && catAlias.has(id)) continue; // merged loser — never re-assert
        const recordVer = recordVersionEpoch(row);
        const pushVer = Math.max(recordVer, nowMs());
        if (store !== 'categories') {
          const t = tombstoneCache.get(tombKey(store, id));
          if (t !== undefined && t >= pushVer) continue; // legitimately deleted elsewhere
        }
        const payload = stripForCloud(row);
        payload.id = id;
        payload.userId = (row.userId as string) ?? DEFAULT_USER_ID;
        if (JSON.stringify(payload).length > MAX_PAYLOAD_JSON) continue;
        extra.push({ store, id, payload, ver: pushVer });
        if (extra.length >= 50) break;
      }
      if (extra.length > 0) {
        await pushDataItems(syncId, extra, key);
        fixed += extra.length;
      }
    }
    if (fixed > 0) console.info(`[d1-sync] integrity pass restored ${fixed} rows`);
  } catch (err) {
    // never break the pull cycle on integrity failures
    console.warn('[d1-sync] integrity pass failed:', (err as Error)?.message);
  }
}

async function pullOnce(syncId: string): Promise<{ ok: boolean; error?: string }> {
  if (isStaticWebHost()) return { ok: false, error: 'static-host' };
  if (!getSyncAccount() || !encKey) return { ok: false, error: 'no-account' };
  if (syncing) return { ok: true, error: 'busy' };
  syncing = true;
  setStatus({ state: 'syncing' });
  const key = encKey;
  try {
    if (Date.now() - clockOffsetUpdatedAt > 10 * 60 * 1000) await refreshClockOffset();

    const db = await getOfflineDB();
    let maxVer = pullWatermark;

    for (;;) {
      const rows = await d1QuerySafe<PullRow>(
        'SELECT store, id, payload, updated_at AS ver FROM sync_data WHERE user_id=? AND updated_at>? ORDER BY updated_at ASC LIMIT ?',
        [syncId, pullWatermark, PULL_PAGE_LIMIT]
      );
      for (const r of rows) {
        const ver = Number(r.ver);
        maxVer = Math.max(maxVer, ver);

        // ── decrypt (E2E); plaintext tolerated for legacy rows ──
        let payload: Record<string, unknown> | null = null;
        if (typeof r.payload === 'string' && r.payload.startsWith('v1.')) {
          payload = await decryptRow(key, r.payload);
        } else if (typeof r.payload === 'string' && r.payload.startsWith('{')) {
          try {
            payload = JSON.parse(r.payload) as Record<string, unknown>;
          } catch {
            payload = null;
          }
        }
        if (!payload) {
          poisonedRows.add(tombKey(r.store, r.id)); // heal later (self-heal sweep)
          continue; // forged/corrupt row — inert, never touches device data
        }

        // ── tombstone rows (encrypted deletes) ──
        if (r.store === TOMB_STORE) {
          const tomb = parseTombPayload(r, payload);
          if (!tomb) continue; // integrity check failed — ignore
          if (tomb.sid === 'categories') {
            // 🔒 v2.14.0 CATEGORIES ARE IMMORTAL: category tombstones are not
            // even cached. History: the adoption flow tombstoned 149+
            // categories and devices executed them — wiping the owner's list
            // device by device; worse, a cached tombstone hid the category's
            // own data row from fresh devices (the "sometimes missing" bug).
            // Legacy cloud tomb rows are purged at boot (hydrateTombCache);
            // this branch is the defensive path for rows seen mid-session.
            continue;
          }
          tombstoneCache.set(tombKey(tomb.sid, tomb.iid), ver);
          await applyLocalDelete(tomb.sid, tomb.iid);
          continue;
        }

        // v2.17.0: one shared apply path for the watermark pull AND the
        // integrity pass (same guards everywhere, no drift between them).
        await applyPulledRow(r.store, r.id, ver, payload, key);
      }
      if (rows.length < PULL_PAGE_LIMIT) break;
      pullWatermark = maxVer;
      await saveWatermark(WM_PULL, syncId, pullWatermark);
    }

    pullWatermark = maxVer;
    await saveWatermark(WM_PULL, syncId, pullWatermark);

    // v2.17.0: watermark-free existence check both ways — a row can never
    // stay lost because of a watermark/version edge case. Rate-limit friendly:
    // at most once a minute, not on every 12s pull.
    if (Date.now() - lastIntegrityAt >= INTEGRITY_INTERVAL_MS) {
      lastIntegrityAt = Date.now();
      await integrityPass(syncId, key);
    }

    lastServerNow = lastServerNow || nowMs();
    setStatus({ state: 'idle', lastSyncAt: lastServerNow, lastError: null });
    return { ok: true };
  } catch (err) {
    const msg = (err as Error)?.message || 'pull failed';
    const offline = isNetworkError(msg);
    setStatus({ state: offline ? 'offline' : 'error', lastError: msg });
    return { ok: false, error: msg };
  } finally {
    syncing = false;
    if (pushAgainAfterCycle) {
      pushAgainAfterCycle = false;
      schedulePush(DEFAULT_USER_ID);
    }
  }
}

// ============ SELF-HEAL (survives cloud vandalism) ============

/**
 * Re-assert this device's data into the cloud when the cloud copy was
 * vandalised: (a) rows deleted from the cloud are re-pushed from local
 * copies; (b) rows whose ciphertext failed decryption are force-overwritten.
 */
async function healPass(syncId: string): Promise<void> {
  if (!encKey) return;
  const key = encKey;
  const db = await getOfflineDB();

  try {
    // (b) force-overwrite poisoned rows (failed decryption during pulls)
    if (poisonedRows.size > 0) {
      const targets = [...poisonedRows].slice(0, 200);
      for (const k of targets) {
        const idx = k.indexOf(':');
        const store = k.slice(0, idx);
        const id = k.slice(idx + 1);
        let local: Record<string, unknown> | undefined;
        if (store === 'billingSettings') {
          const r = await db.get('billingSettings', DEFAULT_USER_ID);
          local = r ? (r as unknown as Record<string, unknown>) : undefined;
        } else if ((SYNCED_STORES as readonly string[]).includes(store)) {
          const r = await db.get(store as 'products', id);
          local = r ? (r as unknown as Record<string, unknown>) : undefined;
        }
        if (!local) continue;
        const payload = stripForCloud(local);
        payload.id = id;
        payload.userId = (local.userId as string) ?? DEFAULT_USER_ID;
        const blob = await encryptRow(key, payload);
        // force: payload = ours, ver = poison+1 (monotonic) so pulls re-fetch it
        await d1QuerySafe(
          `UPDATE sync_data SET payload=?, updated_at=MAX(updated_at+1, ?) WHERE user_id=? AND store=? AND id=?`,
          [blob, nowMs(), syncId, store, id]
        );
      }
      for (const k of targets) poisonedRows.delete(k);
    }

    // (a) re-push local rows that vanished from the cloud
    let pushed = 0;
    for (const store of SYNCED_STORES) {
      if (pushed >= HEAL_MAX_MISSING) break;
      const cloudIds = new Set(
        (
          await d1QuerySafe<{ id: string }>(
            'SELECT id FROM sync_data WHERE user_id=? AND store=?',
            [syncId, store]
          )
        ).map((r) => String(r.id))
      );
      let locals: Record<string, unknown>[];
      if (store === 'billingSettings') {
        const r = await db.get('billingSettings', DEFAULT_USER_ID);
        locals = r ? [r as unknown as Record<string, unknown>] : [];
      } else {
        locals = (await db.getAllFromIndex(store, 'by-userId', DEFAULT_USER_ID)) as unknown as Record<
          string,
          unknown
        >[];
      }
      const missing: PushItem[] = [];
      for (const row of locals) {
        const id = String(row.id);
        if (cloudIds.has(id)) continue;
        // 🔒 v2.14.0: categories always re-assert — tombstones never block them
        const t = store === 'categories' ? undefined : tombstoneCache.get(tombKey(store, id));
        const ver = recordVersionEpoch(row);
        if (t !== undefined && t >= ver) continue; // legitimately deleted elsewhere
        const payload = stripForCloud(row);
        payload.id = id;
        payload.userId = (row.userId as string) ?? DEFAULT_USER_ID;
        if (JSON.stringify(payload).length > MAX_PAYLOAD_JSON) continue;
        missing.push({ store, id, payload, ver: Math.max(ver, nowMs()) });
        if (missing.length + pushed >= HEAL_MAX_MISSING) break;
      }
      if (missing.length > 0) {
        await pushDataItems(syncId, missing, key);
        pushed += missing.length;
      }
    }

    lastHealAt = Date.now();
    await saveWatermark(WM_HEAL, syncId, lastHealAt);
    if (pushed > 0) console.info(`[d1-sync] self-heal re-pushed ${pushed} rows`);
  } catch (err) {
    console.warn('[d1-sync] heal failed:', (err as Error)?.message);
  }
}

// ============ wipe (Reset All Data) ============

async function wipeCloudData(syncId: string): Promise<void> {
  try {
    await d1QuerySafe('DELETE FROM sync_data WHERE user_id=?', [syncId]);
    await d1QuerySafe('DELETE FROM sync_tombstones WHERE user_id=?', [syncId]);
    await resetWatermarks(syncId);
  } catch (err) {
    console.warn('[d1-sync] cloud wipe failed:', (err as Error)?.message);
  }
}

// ============ lifecycle ============

/** Manual "Sync Now": pull other devices' changes, then push local ones. */
export async function syncNowD1(userId: string): Promise<{ ok: boolean; error?: string }> {
  const syncId = currentSyncId || getSyncAccount()?.syncId;
  if (!syncId || !encKey) return { ok: false, error: 'no-account' };
  void userId;
  const pulled = await pullOnce(syncId);
  if (!pulled.ok) return pulled;
  return pushOnce(syncId);
}

/**
 * v2.17.0 one-time-per-boot normalization: every synced row MUST carry
 * userId = DEFAULT_USER_ID. Legacy rows with a foreign/undefined userId are
 * invisible to every by-userId query AND never pushed (push reads the same
 * index) — a silent permanent "category/product missing" on that device.
 */
async function normalizeUserIds(): Promise<void> {
  const db = await getOfflineDB();
  let fixed = 0;
  try {
    for (const store of SYNCED_STORES) {
      if (store === 'billingSettings') continue; // keyed by userId itself
      const all = (await db.getAll(store as 'products')) as unknown as Row[];
      const tx = db.transaction(store as 'products', 'readwrite');
      for (const r of all) {
        if (r.userId === DEFAULT_USER_ID) continue;
        void tx.store.put({ ...r, userId: DEFAULT_USER_ID } as unknown as Row);
        fixed++;
      }
      await tx.done;
    }
    if (fixed > 0) console.info(`[d1-sync] normalized userId on ${fixed} legacy rows`);
  } catch (err) {
    console.warn('[d1-sync] userId normalization failed:', (err as Error)?.message);
  }
}

async function hydrateTombCache(syncId: string): Promise<void> {
  const key = await requireKey();
  // 🔒 v2.14.0: PURGE legacy category tombstones from the cloud FIRST.
  // The duplicate-adoption era queued a pendingDelete for every merged
  // category twin — 152 `t:categories:*` rows were observed in production.
  // Any fresh device that pulled such a tombstone before the category's data
  // row then SKIPPED that row ("deleted after write") and the category never
  // appeared — "kokhono ashe kokhono ashe na". Categories have no delete
  // path anymore, so these rows are pure poison: one boot wipes them all.
  try {
    await d1QuerySafe(
      "DELETE FROM sync_data WHERE user_id=? AND store='_tomb' AND id LIKE 't:categories:%'",
      [syncId]
    );
  } catch {
    /* purge is best-effort; the per-row guards below still protect pulls */
  }
  const rows = await d1QuerySafe<PullRow>(
    "SELECT store, id, payload, updated_at AS ver FROM sync_data WHERE user_id=? AND store='_tomb'",
    [syncId]
  );
  for (const r of rows) {
    if (r.id.startsWith('t:categories:')) continue; // defensive: purge may have failed
    const ver = Number(r.ver);
    if (typeof r.payload !== 'string' || !r.payload.startsWith('v1.')) continue;
    const payload = await decryptRow(key, r.payload);
    if (!payload) continue;
    const tomb = parseTombPayload(r, payload);
    if (tomb && tomb.sid === 'categories') continue; // belt & suspenders
    if (tomb) tombstoneCache.set(tombKey(tomb.sid, tomb.iid), ver);
  }
}

async function beginCycle(fullStart: boolean): Promise<void> {
  if (isStaticWebHost()) return; // static mirror → engine stays dormant
  const acct = getSyncAccount();
  if (!acct) return;
  const syncId = acct.syncId;
  try {
    if (fullStart) {
      await loadWatermarks(syncId);
      await loadCatAlias(syncId); // merged-category zombies must skip every pull
      await hydrateTombCache(syncId);
      await normalizeUserIds(); // legacy rows with a foreign userId are invisible forever
    }
    await pullOnce(syncId); // fill this device with everything first
    if (Date.now() - lastHealAt > HEAL_INTERVAL_MS) {
      await healPass(syncId); // self-heal: restore vandalised cloud rows
    }
    await pushOnce(syncId); // then publish anything local
  } catch (err) {
    const msg = (err as Error)?.message || 'sync boot failed';
    setStatus({ state: isNetworkError(msg) ? 'offline' : 'error', lastError: msg });
  }
}

function stopEngineTimers(): void {
  if (pollTimer) clearInterval(pollTimer);
  if (pushTimer) clearTimeout(pushTimer);
  pollTimer = null;
  pushTimer = null;
  pushBurstStart = 0;
}

export function startD1Sync(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  // local writes → near-instant push (1s micro-batch) + pull right after
  onLocalDataChanged((userId) => schedulePush(userId || DEFAULT_USER_ID));
  // Reset All Data → wipe the cloud mirror so it can't flow back
  onLocalWipe((userId) => {
    const syncId = currentSyncId || getSyncAccount()?.syncId;
    if (syncId) void wipeCloudData(syncId);
    void userId;
  });

  // account connect/disconnect (from the Profile UI) starts/stops the engine
  onSyncAccountChanged(() => {
    const acct = getSyncAccount();
    if (acct && acct.syncId !== currentSyncId) {
      currentSyncId = acct.syncId;
      void deriveEncKey(acct.syncId, acct.pin).then((k) => {
        encKey = k;
        return beginCycle(true);
      });
    } else if (!acct && currentSyncId) {
      currentSyncId = '';
      encKey = null;
      stopEngineTimers();
      setStatus({ state: 'off', lastSyncAt: 0, lastError: null });
    }
  });

  // boot: if an account is already connected, resume syncing
  const acct = getSyncAccount();
  if (acct) {
    currentSyncId = acct.syncId;
    void deriveEncKey(acct.syncId, acct.pin).then((k) => {
      encKey = k;
      return beginCycle(true);
    });
  } else {
    setStatus({ state: 'off', lastSyncAt: 0, lastError: null });
  }

  // realtime-ish pull loop + instant pull on focus / connectivity
  pollTimer = setInterval(() => {
    const syncId = currentSyncId || getSyncAccount()?.syncId;
    if (!syncId || !encKey) return;
    void (async () => {
      const pulled = await pullOnce(syncId);
      if (pulled.ok && Date.now() - lastHealAt > HEAL_INTERVAL_MS) {
        await healPass(syncId);
      }
    })();
  }, POLL_INTERVAL_MS);
  window.addEventListener('online', () => {
    const syncId = currentSyncId || getSyncAccount()?.syncId;
    if (syncId && encKey) void pullOnce(syncId);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const syncId = currentSyncId || getSyncAccount()?.syncId;
    if (syncId && encKey) void pullOnce(syncId);
  });
}

export function stopD1Sync(): void {
  stopEngineTimers();
  started = false;
}
