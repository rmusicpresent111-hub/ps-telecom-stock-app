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
const CLOCK_OFFSET_MAX_MS = 60 * 60 * 1000; // ignore insane offsets (>1h)
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
    return { ok: false, error: isNetworkError(msg) ? 'offline' : 'fail' };
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

  const seen = new Map<string, number>();
  for (const p of pending) {
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
  for (const p of pending) void tx.store.delete(p.id);
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
    const ver = recordVersionEpoch(row);
    if (ver <= pushWm) continue; // unchanged since last push (device clock domain)
    const sv = typeof row._sv === 'number' ? row._sv : 0;
    if (sv && sv >= ver) continue; // echo guard: row came from the cloud unchanged
    // resurrection guard: a newer tombstone for this id exists — drop locally instead
    const t = tombstoneCache.get(tombKey(store, String(row.id)));
    if (t !== undefined && t >= ver) {
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
    const payload = stripForCloud(row);
    payload.id = row.id;
    payload.userId = (row.userId as string) ?? DEFAULT_USER_ID;
    if (JSON.stringify(payload).length > MAX_PAYLOAD_JSON) continue; // pathological row
    out.push({ store, id: String(row.id), payload, ver });
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
          `ON CONFLICT(user_id, store, id) DO UPDATE SET payload = excluded.payload, ` +
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
 * When a cloud category arrives whose name matches a local category with a
 * DIFFERENT id, keep a deterministic single row (older createdAt wins; tie →
 * smaller id wins): delete the loser, remap its products, and tombstone the
 * loser in the cloud so every device converges to one id.
 * Returns true when the incoming row was handled (adopted or skipped).
 */
async function adoptCategory(
  userId: string,
  payload: Record<string, unknown>,
  ver: number
): Promise<boolean> {
  const db = await getOfflineDB();
  const incomingId = String(payload.id);
  const incomingName = String(payload.name ?? '');
  const incomingCreated = String(payload.createdAt ?? '');
  if (!incomingName) return false;

  const locals = (await db.getAllFromIndex('categories', 'by-userId', userId)) as unknown as Row[];
  const twin = locals.find((c) => c.name === incomingName && c.id !== incomingId);
  if (!twin) return false;

  const twinCreated = String(twin.createdAt ?? '');
  const incomingWins =
    incomingCreated < twinCreated || (incomingCreated === twinCreated && incomingId < twin.id);

  const tx = db.transaction(['categories', 'products'], 'readwrite');
  const loser = incomingWins ? twin : null;
  if (loser) {
    // incoming wins: delete the local twin, remap its products
    void tx.objectStore('categories').delete(loser.id);
    const prods = await tx.objectStore('products').index('by-userId').getAll(userId);
    for (const p of prods) {
      if ((p as unknown as Row).categoryId === loser.id) {
        void tx.objectStore('products').put({
          ...(p as unknown as Row),
          categoryId: incomingId,
        } as unknown as OfflineDBSchema['products']['value']);
      }
    }
  }
  await tx.done;

  if (loser) {
    // clean the loser out of the cloud too (goes through the normal delete path)
    try {
      const dbp = await getOfflineDB();
      await dbp.put('pendingDeletes', {
        id: `categories:${loser.id}`,
        storeName: 'categories',
        itemId: loser.id,
        userId,
        deletedAt: Date.now(),
      });
    } catch {
      /* non-fatal */
    }
    return true; // incoming applied by the caller
  }

  // local twin wins: adopt the local id into the payload so both devices keep
  // ONE row (the local winner); the incoming (loser) cloud row gets tombstoned
  payload.id = twin.id;
  payload._sv = ver;
  payload._dirty = 0;
  payload._synced = Date.now();
  const tx2 = db.transaction('categories', 'readwrite');
  void tx2.objectStore('categories').put(payload as unknown as OfflineDBSchema['categories']['value']);
  await tx2.done;
  try {
    await db.put('pendingDeletes', {
      id: `categories:${incomingId}`,
      storeName: 'categories',
      itemId: incomingId,
      userId,
      deletedAt: Date.now(),
    });
  } catch {
    /* non-fatal */
  }
  return true;
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
          tombstoneCache.set(tombKey(tomb.sid, tomb.iid), ver);
          await applyLocalDelete(tomb.sid, tomb.iid);
          continue;
        }

        const store = r.store as SyncStore;
        if (!SYNCED_STORES.includes(store)) continue; // unknown store — ignore
        if (payload.id !== r.id) continue; // integrity: payload must match row key

        const t = tombstoneCache.get(tombKey(store, r.id));
        if (t !== undefined && t >= ver) continue; // deleted after this write — skip

        if (store === 'billingSettings') {
          const local = (await db.get('billingSettings', DEFAULT_USER_ID)) as unknown as
            | Row
            | undefined;
          if (local && typeof local._sv === 'number' && local._sv >= ver) continue;
          payload.userId = DEFAULT_USER_ID;
          payload._sv = ver;
          await db.put('billingSettings', payload as unknown as OfflineDBSchema['billingSettings']['value']);
          continue;
        }

        const local = (await db.get(store as 'products', r.id)) as unknown as Row | undefined;
        if (local) {
          const localDirty = typeof local._dirty === 'number' && local._dirty > 0;
          if (localDirty) continue; // never clobber an un-pushed local edit
          const localSv = typeof local._sv === 'number' ? local._sv : 0;
          if (localSv >= ver) continue; // already have this (or newer) version
        }

        // category adoption: a cloud category colliding with a same-name local
        // seed must not become a duplicate — deterministic winner keeps its id
        if (store === 'categories') {
          const adopted = await adoptCategory(DEFAULT_USER_ID, payload, ver);
          if (adopted) continue;
        }

        payload._sv = ver;
        payload._dirty = 0;
        payload._synced = Date.now();
        const tx = db.transaction(store as 'products', 'readwrite');
        void tx.store.put(payload as unknown as OfflineDBSchema['products']['value']);
        await tx.done;
      }
      if (rows.length < PULL_PAGE_LIMIT) break;
      pullWatermark = maxVer;
      await saveWatermark(WM_PULL, syncId, pullWatermark);
    }

    pullWatermark = maxVer;
    await saveWatermark(WM_PULL, syncId, pullWatermark);
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
        const t = tombstoneCache.get(tombKey(store, id));
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

async function hydrateTombCache(syncId: string): Promise<void> {
  const key = await requireKey();
  const rows = await d1QuerySafe<PullRow>(
    "SELECT store, id, payload, updated_at AS ver FROM sync_data WHERE user_id=? AND store='_tomb'",
    [syncId]
  );
  for (const r of rows) {
    const ver = Number(r.ver);
    if (typeof r.payload !== 'string' || !r.payload.startsWith('v1.')) continue;
    const payload = await decryptRow(key, r.payload);
    if (!payload) continue;
    const tomb = parseTombPayload(r, payload);
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
      await hydrateTombCache(syncId);
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
