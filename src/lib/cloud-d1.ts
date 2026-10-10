/**
 * Cloudflare D1 cloud-backup engine (client side).
 *
 * Stores a faithful copy of the local (IndexedDB) shop data in the user's OWN
 * Cloudflare D1 database. On the web it talks through the /api/cloud/d1 proxy
 * route; inside the native APK (Capacitor) there is no Next.js server, so it
 * calls api.cloudflare.com directly with the same JSON body.
 *
 * Design:
 *  - Backup  = DELETE user rows on cloud + INSERT all local rows (full replace).
 *  - Restore = SELECT all cloud rows + importBackupOffline() (full local replace).
 *  - Every row keeps its original `userId` in the cloud, and a meta row records
 *    which account made the backup — so restore works even on a brand-new phone
 *    with a fresh account (rows are remapped to the current user on import).
 *  - Crash safety: the meta row is written with "_incomplete": true BEFORE any
 *    destructive step and only overwritten with real counts at the very end —
 *    a backup interrupted mid-way can never be restored as if it were complete.
 *  - Credentials are stored per user (ps-d1-creds:<userId>), so two accounts on
 *    one device never share Cloudflare access. Legacy shared keys are migrated
 *    on first read.
 */

import { exportBackupOffline, importBackupOffline } from './offline-service';
import { clearDirty } from './sync-dirty';

// ============ CREDENTIALS (localStorage, per user) ============

export interface D1Credentials {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

export interface CloudMeta {
  backedUpAt: string;
  userEmail: string;
  shopName: string;
  totalRows: number;
}

// Legacy (pre per-user) keys — still read for migration, always cleared.
const CREDS_KEY_LEGACY = 'ps-d1-creds';
const LAST_BACKUP_KEY_LEGACY = 'ps-d1-last-backup';
const credsKey = (userId: string) => `ps-d1-creds:${userId}`;
const lastBackupKey = (userId: string) => `ps-d1-last-backup:${userId}`;

function parseCreds(raw: string | null): D1Credentials | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<D1Credentials>;
    if (c.accountId && c.databaseId && c.apiToken) {
      return { accountId: c.accountId, databaseId: c.databaseId, apiToken: c.apiToken };
    }
  } catch {
    // Corrupted record — treat as missing.
  }
  return null;
}

/**
 * Reads the D1 credentials for a user.
 * - With userId: reads the per-user key first; if absent, falls back to the
 *   legacy shared key and MIGRATES it (writes the per-user key, deletes the
 *   legacy key + legacy last-backup marker).
 * - Without userId: reads only the legacy shared key (best effort).
 */
export function getD1Credentials(userId?: string): D1Credentials | null {
  if (userId) {
    const own = parseCreds(safeGet(credsKey(userId)));
    if (own) return own;

    // Legacy fallback + one-time migration
    const legacy = parseCreds(safeGet(CREDS_KEY_LEGACY));
    if (legacy) {
      try {
        localStorage.setItem(credsKey(userId), JSON.stringify(legacy));
        localStorage.removeItem(CREDS_KEY_LEGACY);
        const legacyBackup = safeGet(LAST_BACKUP_KEY_LEGACY);
        if (legacyBackup) {
          localStorage.setItem(lastBackupKey(userId), legacyBackup);
          localStorage.removeItem(LAST_BACKUP_KEY_LEGACY);
        }
      } catch {
        // Migration is best-effort; the legacy record stays readable.
      }
      return legacy;
    }
    return null;
  }
  return parseCreds(safeGet(CREDS_KEY_LEGACY));
}

export function saveD1Credentials(creds: D1Credentials, userId: string): void {
  try {
    localStorage.setItem(credsKey(userId), JSON.stringify(creds));
  } catch {
    // Storage full/blocked — nothing sensible to do here.
  }
}

/** Clears this user's credentials (and always removes the legacy shared keys). */
export function clearD1Credentials(userId?: string): void {
  try {
    if (userId) {
      localStorage.removeItem(credsKey(userId));
      localStorage.removeItem(lastBackupKey(userId));
    }
    localStorage.removeItem(CREDS_KEY_LEGACY);
    localStorage.removeItem(LAST_BACKUP_KEY_LEGACY);
  } catch {
    // Ignore storage failures on cleanup.
  }
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseLastBackup(raw: string | null, userId: string): number {
  if (!raw) return 0;
  try {
    const v = JSON.parse(raw) as { userId?: string; at?: number };
    return v && typeof v.at === 'number' && (!v.userId || v.userId === userId) ? v.at : 0;
  } catch {
    return 0;
  }
}

/** Timestamp (ms) of the last successful cloud backup by this user (0 = never). */
export function getD1LastBackup(userId: string): number {
  const own = safeGet(lastBackupKey(userId));
  if (own) return parseLastBackup(own, userId);
  // Legacy fallback + one-time migration.
  const legacy = safeGet(LAST_BACKUP_KEY_LEGACY);
  if (legacy) {
    try {
      localStorage.setItem(lastBackupKey(userId), legacy);
      localStorage.removeItem(LAST_BACKUP_KEY_LEGACY);
    } catch {
      // Ignore.
    }
    return parseLastBackup(legacy, userId);
  }
  return 0;
}

function setD1LastBackup(userId: string): void {
  try {
    localStorage.setItem(lastBackupKey(userId), JSON.stringify({ userId, at: Date.now() }));
  } catch {
    // Ignore.
  }
}

// ============ NATIVE (APK) DETECTION ============

let nativeCheck: Promise<boolean> | null = null;
/** Cached result of the native check — readable synchronously. */
let nativePlatformCached = false;

/**
 * True when running inside a native Capacitor shell (the Android APK).
 * Detected lazily via a dynamic import so the web bundle stays unchanged and
 * SSR never touches the module.
 */
function isNativeCapacitor(): Promise<boolean> {
  if (!nativeCheck) {
    nativeCheck = (async () => {
      try {
        const mod = (await import('@capacitor/core')) as {
          Capacitor?: { isNativePlatform?: () => boolean };
        };
        const native = typeof mod.Capacitor?.isNativePlatform === 'function'
          ? mod.Capacitor.isNativePlatform()
          : false;
        nativePlatformCached = native;
        return native;
      } catch {
        return false; // @capacitor/core unavailable → plain web.
      }
    })();
  }
  return nativeCheck;
}

/**
 * Synchronous best-effort native flag (false until the async check resolves —
 * safe: the worst case is one extra sync attempt that the async path vetoes).
 */
export function isNativePlatformCached(): boolean {
  return nativePlatformCached;
}

// ============ SERVER-MANAGED CLOUD (env-backed credentials) ============

/**
 * Sentinel credentials for the "server-managed" cloud mode: on a server
 * hosting (Vercel) the /api/cloud/d1 proxy fills the empty fields from the
 * deployment's own environment variables, so the browser never needs (or
 * sees) the Cloudflare keys. NEVER send these through the DIRECT Cloudflare
 * REST path — there the empty token would simply fail (guarded below).
 */
export const SERVER_MANAGED_CREDS: D1Credentials = {
  accountId: '',
  databaseId: '',
  apiToken: '',
};

/** True when the sentinel looks like a real credential set. */
export function isServerManaged(creds: D1Credentials): boolean {
  return !creds.accountId && !creds.databaseId && !creds.apiToken;
}

// ============ SETUP CODE (one-paste credential transfer) ============

/**
 * Encodes the credentials into a single paste-able "setup code" so the owner
 * can connect any of their other devices in seconds (Cloud Sync screen →
 * paste the code). The code is plain base64 of the credential JSON — it
 * carries the same secret as the API token itself, so it must only be shared
 * with the owner's OWN devices.
 */
export function encodeSetupCode(creds: D1Credentials): string {
  try {
    if (typeof btoa !== 'function') return '';
    const json = JSON.stringify({
      accountId: creds.accountId,
      databaseId: creds.databaseId,
      apiToken: creds.apiToken,
    });
    return btoa(json);
  } catch {
    return '';
  }
}

/**
 * Parses a setup code (or a pasted raw credential JSON) back into complete
 * credentials. Returns null for anything that is not a full, well-formed set.
 */
export function decodeSetupCode(raw: string): D1Credentials | null {
  const s = (raw || '').trim();
  if (!s) return null;
  const parse = (json: string): D1Credentials | null => {
    try {
      const c = JSON.parse(json) as Partial<D1Credentials>;
      if (c.accountId && c.databaseId && c.apiToken) {
        return {
          accountId: String(c.accountId).trim(),
          databaseId: String(c.databaseId).trim(),
          apiToken: String(c.apiToken).trim(),
        };
      }
    } catch {
      // Not JSON.
    }
    return null;
  };
  // Tolerate a directly pasted JSON object as well as the base64 code.
  if (s.startsWith('{')) return parse(s);
  try {
    if (typeof atob !== 'function') return null;
    return parse(atob(s.replace(/\s+/g, '')));
  } catch {
    return null;
  }
}

/**
 * Cheap synchronous check used by the sync scheduler: on the web (non-native)
 * the server-managed mode is POSSIBLE (the engine re-verifies properly later);
 * inside the APK it never is — there only locally saved keys can work.
 */
export function serverManagedCloudPossible(): boolean {
  return typeof window !== 'undefined' && !nativePlatformCached;
}

/**
 * Resolves the credentials any cloud operation should use for this user:
 *  1. Locally saved keys (entered on this device) — always win.
 *  2. Web (server hosting): the server-managed sentinel — the proxy injects
 *     the deployment's env credentials. Works with zero user setup on Vercel.
 *  3. Native APK / no server: null — the user must save their own keys first.
 */
export async function getEffectiveD1Credentials(userId: string): Promise<D1Credentials | null> {
  const own = getD1Credentials(userId);
  if (own) return own;
  if (typeof window === 'undefined') return null;
  if (await isNativeCapacitor()) return null;
  return SERVER_MANAGED_CREDS;
}

// ============ LOW-LEVEL QUERY ============

export interface D1QueryResult {
  ok: boolean;
  rows?: Record<string, unknown>[];
  changes?: number;
  error?: string;
  /** Stable machine code so the UI can show a translated message. */
  errorCode?: string;
}

const CF_DIRECT_BASE = 'https://api.cloudflare.com/client/v4';
const QUERY_TIMEOUT_MS = 30_000; // parity with the server-side proxy timeout

/**
 * Flipped permanently once the same-origin proxy proves to be missing
 * (HTTP 404/405 — happens on static-export hosting without a Next.js server).
 * After that every web query goes straight to the Cloudflare REST API.
 */
let webDirectMode = false;

/**
 * Executes one SQL statement. Exported for cloud-sync.ts (meta/counts rows
 * use bound params).
 *
 * Transport:
 *  - Web (server hosting, e.g. Vercel): POSTs to the same-origin /api/cloud/d1
 *    proxy (no CORS, creds relayed per request, never stored server-side).
 *  - Web (static export hosting, e.g. GitHub Pages): the proxy route does not
 *    exist there — the first 404/405 from the proxy permanently switches the
 *    session to direct Cloudflare REST calls (same as native mode).
 *  - Native APK: the Next.js server does not exist inside the app bundle, so
 *    the proxy route is unreachable — the query goes straight to the official
 *    Cloudflare REST API instead (same body shape, Bearer token auth).
 */
export async function d1Query(
  creds: D1Credentials,
  sql: string,
  params?: unknown[]
): Promise<D1QueryResult> {
  const native = await isNativeCapacitor();
  const direct = native || webDirectMode;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let url: string;
  let body: string;

  if (direct) {
    headers.Authorization = `Bearer ${creds.apiToken}`;
    body = JSON.stringify(params && params.length > 0 ? { sql, params } : { sql });
    url = `${CF_DIRECT_BASE}/accounts/${encodeURIComponent(creds.accountId)}/d1/database/${encodeURIComponent(creds.databaseId)}/query`;
  } else {
    body = JSON.stringify({ ...creds, sql, params });
    url = '/api/cloud/d1';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    let payload: D1QueryResult | null = null;
    let text: string | null = null;
    try {
      text = await res.text();
      payload = JSON.parse(text) as D1QueryResult;
    } catch {
      payload = null;
    }
    if (!res.ok || !payload || typeof payload.ok !== 'boolean') {
      // Proxy missing (static-export hosting) → flip to direct mode once and
      // retry the same statement through the Cloudflare REST API.
      if (!native && !webDirectMode && (res.status === 404 || res.status === 405)) {
        webDirectMode = true;
        return d1Query(creds, sql, params);
      }
      // Direct mode returns the RAW Cloudflare response — normalize it here.
      if (direct && text) return normalizeCloudflareResponse(text, res.status);
      return { ok: false, error: payload?.error || `Request failed (HTTP ${res.status})` };
    }
    return payload;
  } catch (e) {
    const err = e as Error;
    const timedOut = err.name === 'AbortError';
    return {
      ok: false,
      error: timedOut ? 'Cloudflare request timed out' : err.message || 'Network error',
      ...(timedOut ? { errorCode: 'timeout' as const } : {}),
    };
  } finally {
    // Never leave a stray 30s abort timer behind, even when fetch throws.
    clearTimeout(timer);
  }
}

/**
 * Stable error codes the client UI maps to translated, friendly messages.
 * Keep in sync with /api/cloud/d1 (server proxy) and the i18n keys.
 */
type CloudErrorCode = 'ids_wrong' | 'token_invalid' | 'ids_malformed' | 'rate_limit' | 'missing_creds';

/**
 * Maps raw Cloudflare API failures to short, actionable messages a shop owner
 * can act on. Kept in sync with the server-side proxy's mapping (web path).
 */
function friendlyCloudflareError(
  status: number,
  cfMsg: string | undefined,
  rawText: string
): { message: string; code?: CloudErrorCode } {
  const lower = `${cfMsg || ''} ${rawText}`.toLowerCase();
  if (status === 404 || lower.includes('could not route') || lower.includes('7003')) {
    return { message: `Account ID or Database ID is wrong — please re-copy both from Cloudflare${cfMsg ? ` (${cfMsg})` : ''}`, code: 'ids_wrong' };
  }
  if (status === 403 || lower.includes('authentication error') || lower.includes('unauthorized') || lower.includes('9109') || lower.includes('10000')) {
    return { message: `API token is invalid, expired, or missing the "D1 Edit" permission${cfMsg ? ` (${cfMsg})` : ''}`, code: 'token_invalid' };
  }
  if (status === 400 && lower.includes('invalid')) {
    return { message: `Account ID or Database ID looks malformed — paste the ID only, without any extra text${cfMsg ? ` (${cfMsg})` : ''}`, code: 'ids_malformed' };
  }
  if (status === 429) {
    return { message: 'Cloudflare rate limit reached — please wait a minute and try again', code: 'rate_limit' };
  }
  return { message: cfMsg || (rawText.length < 400 ? rawText : `Cloudflare API returned HTTP ${status}`) };
}

/**
 * Normalizes a raw Cloudflare /query response (used only on the native path,
 * where there is no server-side proxy to do it). Mirrors the proxy's mapping,
 * including the friendly error translation.
 */
function normalizeCloudflareResponse(text: string, status: number): D1QueryResult {
  let parsed: {
    success?: boolean;
    errors?: { message?: string }[];
    result?: unknown;
  } | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.success === false) {
    const cfMsg = parsed?.errors?.[0]?.message;
    const friendly = friendlyCloudflareError(status, cfMsg, text);
    return { ok: false, error: friendly.message, errorCode: friendly.code };
  }
  const resultArr = Array.isArray(parsed.result) ? parsed.result : [parsed.result];
  const rows: Record<string, unknown>[] = [];
  let changes = 0;
  for (const r of resultArr) {
    const rr = r as { results?: unknown[]; meta?: { changes?: number } } | null;
    if (rr && Array.isArray(rr.results)) {
      for (const row of rr.results) {
        if (row && typeof row === 'object') rows.push(row as Record<string, unknown>);
      }
    }
    if (rr?.meta && typeof rr.meta.changes === 'number') changes += rr.meta.changes;
  }
  return { ok: true, rows, changes };
}

/**
 * Executes several statements. Multi-statement SQL is sent in one call; if the
 * endpoint refuses it, every statement is retried individually so the feature
 * works with both behaviours. Exported for cloud-sync.ts.
 */
export async function runStatements(
  creds: D1Credentials,
  statements: string[]
): Promise<D1QueryResult> {
  if (statements.length === 0) return { ok: true, rows: [] };
  const joined = statements.join(';\n');
  const first = await d1Query(creds, joined);
  if (first.ok) return first;
  if (statements.length === 1) return first;
  // Fallback: one statement per request
  for (const stmt of statements) {
    const r = await d1Query(creds, stmt);
    if (!r.ok) return r;
  }
  return { ok: true, rows: [] };
}

// ============ SQL VALUE ESCAPING ============

/** Strips NUL bytes and unpaired UTF-16 surrogates (corrupt through JSON/UTF-8). */
export function sanitizeText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0) continue;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++;
      }
      // lone high surrogate → dropped
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      // lone low surrogate → dropped
    } else {
      out += s[i];
    }
  }
  return out;
}

/** Escapes a JS value as a SQLite literal (numbers/NULL unquoted, strings quoted). */
function sqlVal(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  const t = typeof v;
  if (t === 'number') {
    const n = v as number;
    return Number.isFinite(n) ? String(n) : 'NULL';
  }
  if (t === 'boolean') return v ? '1' : '0';
  const s = t === 'string' ? (v as string) : JSON.stringify(v);
  return `'${sanitizeText(s).replace(/'/g, "''")}'`;
}

// ============ SCHEMA ============

export const D1_SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS ps_categories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    image TEXT DEFAULT '',
    created_at TEXT DEFAULT '',
    updated_at TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS ps_products (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    category_id TEXT DEFAULT '',
    name TEXT NOT NULL,
    quantity INTEGER DEFAULT 0,
    box_number TEXT DEFAULT '',
    purchase_price REAL DEFAULT 0,
    selling_price REAL DEFAULT 0,
    low_stock_threshold INTEGER DEFAULT 0,
    created_at TEXT DEFAULT '',
    updated_at TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS ps_transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    product_id TEXT DEFAULT '',
    type TEXT DEFAULT 'STOCK_IN',
    quantity INTEGER DEFAULT 0,
    unit_price REAL DEFAULT 0,
    total_amount REAL DEFAULT 0,
    product TEXT DEFAULT '',
    date TEXT DEFAULT '',
    created_at TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS ps_expenses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT DEFAULT '',
    amount REAL DEFAULT 0,
    category TEXT DEFAULT '',
    description TEXT DEFAULT '',
    created_at TEXT DEFAULT '',
    updated_at TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS ps_cash_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT DEFAULT '',
    hand_cash REAL DEFAULT 0,
    liquid_cash REAL DEFAULT 0,
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT '',
    updated_at TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS ps_service_transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    category_type TEXT DEFAULT 'repairing',
    transaction_type TEXT DEFAULT 'income',
    amount REAL DEFAULT 0,
    purpose TEXT DEFAULT '',
    date TEXT DEFAULT '',
    created_at TEXT DEFAULT '',
    updated_at TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS ps_bills (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    bill_number TEXT DEFAULT '',
    customer_name TEXT DEFAULT '',
    customer_mobile TEXT DEFAULT '',
    items TEXT DEFAULT '[]',
    subtotal REAL DEFAULT 0,
    discount_value REAL DEFAULT 0,
    discount_type TEXT DEFAULT 'amount',
    discount_amount REAL DEFAULT 0,
    gst_enabled INTEGER DEFAULT 0,
    gst_rate REAL DEFAULT 0,
    gst_amount REAL DEFAULT 0,
    total REAL DEFAULT 0,
    payment_method TEXT DEFAULT 'cash',
    paid_amount REAL DEFAULT 0,
    due_amount REAL DEFAULT 0,
    note TEXT DEFAULT '',
    transaction_id TEXT DEFAULT '',
    shop_snapshot TEXT DEFAULT '{}',
    date TEXT DEFAULT '',
    created_at TEXT DEFAULT '',
    updated_at TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS ps_billing_settings (
    user_id TEXT PRIMARY KEY,
    shop_name TEXT DEFAULT '',
    proprietor_name TEXT DEFAULT '',
    shop_address TEXT DEFAULT '',
    shop_phone TEXT DEFAULT '',
    gst_number TEXT DEFAULT '',
    gst_enabled INTEGER DEFAULT 0,
    gst_rate REAL DEFAULT 0,
    default_discount_percent REAL DEFAULT 0,
    upi_id TEXT DEFAULT '',
    signature_data_url TEXT DEFAULT '',
    qr_code_data_url TEXT DEFAULT '',
    bill_prefix TEXT DEFAULT '',
    thank_you_note TEXT DEFAULT '',
    terms_text TEXT DEFAULT '',
    updated_at TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS ps_backup_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    user_id TEXT NOT NULL,
    user_email TEXT DEFAULT '',
    shop_name TEXT DEFAULT '',
    backed_up_at TEXT DEFAULT '',
    total_rows INTEGER DEFAULT 0,
    counts TEXT DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ps_categories_user ON ps_categories (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ps_products_user ON ps_products (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ps_transactions_user ON ps_transactions (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ps_expenses_user ON ps_expenses (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ps_cash_user ON ps_cash_entries (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ps_service_user ON ps_service_transactions (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ps_bills_user ON ps_bills (user_id)`,
];

export async function ensureD1Schema(creds: D1Credentials): Promise<D1QueryResult> {
  return runStatements(creds, D1_SCHEMA_STATEMENTS);
}

/**
 * Old cloud databases were created before the transactions table had the
 * `product` snapshot column. CREATE TABLE IF NOT EXISTS cannot add columns to
 * an existing table, so the ALTER is attempted separately and a "duplicate
 * column" failure is ignored — any other failure surfaces on the next INSERT.
 *
 * The outcome is remembered per session so a backup does not burn one doomed
 * query every single run (a duplicate-column failure also means the column
 * already exists — safe to cache).
 */
let productColumnVerified = false;
async function ensureProductColumn(creds: D1Credentials): Promise<void> {
  if (productColumnVerified) return;
  const res = await d1Query(creds, `ALTER TABLE ps_transactions ADD COLUMN product TEXT DEFAULT ''`);
  if (res.ok || /duplicate column/i.test(res.error || '')) {
    productColumnVerified = true;
  }
}

// ============ TABLE MAPPINGS (camelCase local ↔ snake_case cloud) ============

// Exported for the incremental sync engine (src/lib/cloud-sync.ts) — the
// backup/sync layers must share the exact same column mappings.
export interface CloudTable {
  cloud: string; // D1 table name
  local: string; // key in exportBackupOffline/importBackupOffline payload
  /** [localCamelKey, cloudSnakeColumn] in column order */
  columns: [string, string][];
  /** local keys serialized with JSON.stringify on write / JSON.parse on read */
  jsonKeys?: string[];
}

/**
 * Default value used when a JSON-serialized column is missing/unparseable.
 * `product` falls back to null (no snapshot — restore falls back to the
 * product's CURRENT purchase price) instead of a fabricated object.
 */
function jsonDefault(key: string): unknown {
  if (key === 'items') return [];
  if (key === 'product') return null;
  return {};
}

export const CLOUD_TABLES: CloudTable[] = [
  {
    cloud: 'ps_categories',
    local: 'categories',
    columns: [
      ['id', 'id'],
      ['name', 'name'],
      ['image', 'image'],
      ['userId', 'user_id'],
      ['createdAt', 'created_at'],
      ['updatedAt', 'updated_at'],
    ],
  },
  {
    cloud: 'ps_products',
    local: 'products',
    columns: [
      ['id', 'id'],
      ['name', 'name'],
      ['categoryId', 'category_id'],
      ['quantity', 'quantity'],
      ['boxNumber', 'box_number'],
      ['purchasePrice', 'purchase_price'],
      ['sellingPrice', 'selling_price'],
      ['lowStockThreshold', 'low_stock_threshold'],
      ['userId', 'user_id'],
      ['createdAt', 'created_at'],
      ['updatedAt', 'updated_at'],
    ],
  },
  {
    cloud: 'ps_transactions',
    local: 'transactions',
    jsonKeys: ['product'],
    columns: [
      ['id', 'id'],
      ['productId', 'product_id'],
      ['type', 'type'],
      ['quantity', 'quantity'],
      ['unitPrice', 'unit_price'],
      ['totalAmount', 'total_amount'],
      ['product', 'product'],
      ['date', 'date'],
      ['userId', 'user_id'],
      ['createdAt', 'created_at'],
    ],
  },
  {
    cloud: 'ps_expenses',
    local: 'expenses',
    columns: [
      ['id', 'id'],
      ['date', 'date'],
      ['amount', 'amount'],
      ['category', 'category'],
      ['description', 'description'],
      ['userId', 'user_id'],
      ['createdAt', 'created_at'],
      ['updatedAt', 'updated_at'],
    ],
  },
  {
    cloud: 'ps_cash_entries',
    local: 'cashEntries',
    columns: [
      ['id', 'id'],
      ['date', 'date'],
      ['handCash', 'hand_cash'],
      ['liquidCash', 'liquid_cash'],
      ['note', 'note'],
      ['userId', 'user_id'],
      ['createdAt', 'created_at'],
      ['updatedAt', 'updated_at'],
    ],
  },
  {
    cloud: 'ps_service_transactions',
    local: 'serviceTransactions',
    columns: [
      ['id', 'id'],
      ['categoryType', 'category_type'],
      ['transactionType', 'transaction_type'],
      ['amount', 'amount'],
      ['purpose', 'purpose'],
      ['date', 'date'],
      ['userId', 'user_id'],
      ['createdAt', 'created_at'],
      ['updatedAt', 'updated_at'],
    ],
  },
  {
    cloud: 'ps_bills',
    local: 'bills',
    jsonKeys: ['items', 'shopSnapshot'],
    columns: [
      ['id', 'id'],
      ['billNumber', 'bill_number'],
      ['customerName', 'customer_name'],
      ['customerMobile', 'customer_mobile'],
      ['items', 'items'],
      ['subtotal', 'subtotal'],
      ['discountValue', 'discount_value'],
      ['discountType', 'discount_type'],
      ['discountAmount', 'discount_amount'],
      ['gstEnabled', 'gst_enabled'],
      ['gstRate', 'gst_rate'],
      ['gstAmount', 'gst_amount'],
      ['total', 'total'],
      ['paymentMethod', 'payment_method'],
      ['paidAmount', 'paid_amount'],
      ['dueAmount', 'due_amount'],
      ['note', 'note'],
      ['transactionId', 'transaction_id'],
      ['shopSnapshot', 'shop_snapshot'],
      ['date', 'date'],
      ['userId', 'user_id'],
      ['createdAt', 'created_at'],
      ['updatedAt', 'updated_at'],
    ],
  },
];

// Exported for cloud-sync.ts (same escaping/mapping on every write path).
export function toRow(table: CloudTable, record: Record<string, unknown>): unknown[] {
  return table.columns.map(([camel]) => {
    const v = record[camel];
    if (v === undefined) {
      if (table.jsonKeys?.includes(camel)) return jsonDefault(camel);
      if (camel === 'gstEnabled' || camel === 'gstRate') return 0;
      return '';
    }
    return v;
  });
}

function fromRow(table: CloudTable, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [camel, snake] of table.columns) {
    let v = row[snake];
    if (camel === 'gstEnabled') {
      out[camel] = Number(v) === 1;
      continue;
    }
    if (table.jsonKeys?.includes(camel)) {
      if (typeof v === 'string') {
        try {
          v = JSON.parse(v);
        } catch {
          v = jsonDefault(camel);
        }
      }
      out[camel] = v ?? jsonDefault(camel);
      continue;
    }
    out[camel] = v === null || v === undefined ? '' : v;
  }
  return out;
}

/** billing_settings mapping (keyed by user_id, includes large dataURLs). */
export const BILLING_SETTINGS_COLUMNS: [string, string][] = [
  ['shopName', 'shop_name'],
  ['proprietorName', 'proprietor_name'],
  ['shopAddress', 'shop_address'],
  ['shopPhone', 'shop_phone'],
  ['gstNumber', 'gst_number'],
  ['gstEnabled', 'gst_enabled'],
  ['gstRate', 'gst_rate'],
  ['defaultDiscountPercent', 'default_discount_percent'],
  ['upiId', 'upi_id'],
  ['signatureDataUrl', 'signature_data_url'],
  ['qrCodeDataUrl', 'qr_code_data_url'],
  ['billPrefix', 'bill_prefix'],
  ['thankYouNote', 'thank_you_note'],
  ['termsText', 'terms_text'],
  ['updatedAt', 'updated_at'],
];

// ============ BACKUP ============

export interface BackupProgress {
  table: string;
  done: number;
  total: number;
}

export interface CloudCounts {
  categories: number;
  products: number;
  transactions: number;
  expenses: number;
  cashEntries: number;
  serviceTransactions: number;
  bills: number;
}

const MAX_STATEMENT_LEN = 48_000; // stay far below D1's per-statement limit
const MAX_ROWS_PER_STATEMENT = 25;
const STATEMENTS_PER_CALL = 10;

// Exported for cloud-sync.ts.
export function buildInsertStatements(
  table: CloudTable,
  rows: Record<string, unknown>[]
): string[] {
  const cols = table.columns.map(([, snake]) => snake);
  const header = `INSERT OR REPLACE INTO ${table.cloud} (${cols.join(', ')}) VALUES `;
  const statements: string[] = [];
  let current = '';
  let rowCount = 0;

  const flush = () => {
    if (current) statements.push(current);
    current = '';
    rowCount = 0;
  };

  for (const row of rows) {
    const values = toRow(table, row).map(sqlVal).join(', ');
    const piece = header.length + values.length;
    if (current && (rowCount >= MAX_ROWS_PER_STATEMENT || current.length + piece > MAX_STATEMENT_LEN)) {
      flush();
    }
    current += (current ? ',\n' : header) + `(${values})`;
    rowCount++;
  }
  flush();
  return statements;
}

export async function backupToD1(
  userId: string,
  creds: D1Credentials,
  options?: {
    userEmail?: string;
    shopName?: string;
    onProgress?: (p: BackupProgress) => void;
  }
): Promise<{ ok: boolean; counts?: CloudCounts; error?: string }> {
  const onProgress = options?.onProgress;

  // 1. Gather everything from local IndexedDB
  let data: Record<string, unknown>;
  try {
    data = (await exportBackupOffline(userId)) as unknown as Record<string, unknown>;
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'Could not read local data' };
  }

  const counts: CloudCounts = {
    categories: (data.categories as unknown[] | undefined)?.length || 0,
    products: (data.products as unknown[] | undefined)?.length || 0,
    transactions: (data.transactions as unknown[] | undefined)?.length || 0,
    expenses: (data.expenses as unknown[] | undefined)?.length || 0,
    cashEntries: (data.cashEntries as unknown[] | undefined)?.length || 0,
    serviceTransactions: (data.serviceTransactions as unknown[] | undefined)?.length || 0,
    bills: (data.bills as unknown[] | undefined)?.length || 0,
  };
  const totalRows =
    counts.categories + counts.products + counts.transactions + counts.expenses +
    counts.cashEntries + counts.serviceTransactions + counts.bills;

  // 2. Make sure tables exist (idempotent, cheap) + legacy column migration
  const schema = await ensureD1Schema(creds);
  if (!schema.ok) return { ok: false, error: schema.error };
  await ensureProductColumn(creds);

  // 3. Flag the backup as IN PROGRESS *before* any destructive step. If this
  //    process dies mid-way, the meta row keeps "_incomplete": true and
  //    restoreFromD1 refuses to import the partial backup.
  const markIncomplete = await d1Query(
    creds,
    `INSERT OR REPLACE INTO ps_backup_meta (id, user_id, user_email, shop_name, backed_up_at, total_rows, counts)
     VALUES (1, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      options?.userEmail || '',
      options?.shopName || '',
      new Date().toISOString(),
      totalRows,
      JSON.stringify({ ...counts, _incomplete: true }),
    ]
  );
  if (!markIncomplete.ok) return { ok: false, error: markIncomplete.error };

  // 4. Remove previous backup rows for a clean full replace
  const del = await runStatements(
    creds,
    [...CLOUD_TABLES.map(t => t.cloud), 'ps_billing_settings'].map(t => `DELETE FROM ${t} WHERE user_id = '${sanitizeText(userId).replace(/'/g, "''")}'`)
  );
  if (!del.ok) return { ok: false, error: del.error };

  // 5. Upload row tables in chunks with progress
  let done = 0;
  for (const table of CLOUD_TABLES) {
    const rows = (data[table.local] as Record<string, unknown>[] | undefined) || [];
    if (rows.length === 0) continue;
    const statements = buildInsertStatements(table, rows);
    for (let i = 0; i < statements.length; i += STATEMENTS_PER_CALL) {
      const batch = statements.slice(i, i + STATEMENTS_PER_CALL);
      const r = await runStatements(creds, batch);
      if (!r.ok) return { ok: false, error: r.error };
    }
    done += rows.length;
    onProgress?.({ table: table.cloud, done, total: totalRows });
  }

  // 6. billingSettings — single statement with BOUND params (handles huge dataURLs)
  const bs = (data.billingSettings && typeof data.billingSettings === 'object'
    ? data.billingSettings
    : {}) as Record<string, unknown>;
  const bsRes = await upsertBillingSettingsRow(creds, userId, bs);
  if (!bsRes.ok) return { ok: false, error: bsRes.error };

  // 7. Write the REAL backup meta row (overwrites the _incomplete marker)
  const metaRes = await d1Query(
    creds,
    `INSERT OR REPLACE INTO ps_backup_meta (id, user_id, user_email, shop_name, backed_up_at, total_rows, counts)
     VALUES (1, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      options?.userEmail || '',
      options?.shopName || '',
      new Date().toISOString(),
      totalRows,
      JSON.stringify(counts),
    ]
  );
  if (!metaRes.ok) return { ok: false, error: metaRes.error };

  // 8. Remember locally for instant "last backup" display + the cloud now has
  //    EVERYTHING — pending auto-sync deltas are obsolete.
  setD1LastBackup(userId);
  clearDirty(userId);

  return { ok: true, counts };
}

/**
 * Writes one user's billing settings row. Bound params (huge dataURLs must not
 * be inlined). Shared by full backup and incremental sync.
 */
export async function upsertBillingSettingsRow(
  creds: D1Credentials,
  userId: string,
  bs: Record<string, unknown>
): Promise<D1QueryResult> {
  const bsCols = BILLING_SETTINGS_COLUMNS.map(([, snake]) => snake);
  const bsPlaceholders = BILLING_SETTINGS_COLUMNS.map(() => '?').join(', ');
  const bsParams: unknown[] = [
    userId,
    ...BILLING_SETTINGS_COLUMNS.map(([camel]) => {
      const v = bs[camel];
      if (camel === 'gstEnabled') return v ? 1 : 0;
      return v === undefined || v === null ? '' : v;
    }),
  ];
  return d1Query(
    creds,
    `INSERT OR REPLACE INTO ps_billing_settings (user_id, ${bsCols.join(', ')}) VALUES (?, ${bsPlaceholders})`,
    bsParams
  );
}

/** Reads the cloud meta row (id=1). Null when the cloud database has no backup yet. */
export async function readCloudMeta(
  creds: D1Credentials
): Promise<Record<string, unknown> | null> {
  const res = await d1Query(creds, 'SELECT * FROM ps_backup_meta WHERE id = 1');
  if (!res.ok) return null;
  return res.rows?.[0] || null;
}

/** Reads one user's billing settings row from the cloud (null when absent). */
export async function readCloudBillingSettings(
  creds: D1Credentials,
  userId: string
): Promise<Record<string, unknown> | null> {
  const res = await d1Query(creds, 'SELECT * FROM ps_billing_settings WHERE user_id = ?', [userId]);
  return res.ok ? res.rows?.[0] || null : null;
}

// ============ RESTORE ============

export interface RestoreOptions {
  /** Current account's email — enables the backup-owner mismatch check. */
  userEmail?: string;
  /** Set after the user explicitly confirmed restoring a foreign backup. */
  confirmDifferentEmail?: boolean;
}

export interface RestoreResult {
  ok: boolean;
  counts?: CloudCounts;
  error?: string;
  empty?: boolean;
  /** True when the cloud backup belongs to a different account (see backupEmail). */
  emailMismatch?: boolean;
  backupEmail?: string;
}

export async function restoreFromD1(
  userId: string,
  creds: D1Credentials,
  options?: RestoreOptions
): Promise<RestoreResult> {
  // 1. Read meta row — identifies the account the backup belongs to
  const metaRes = await d1Query(creds, 'SELECT * FROM ps_backup_meta WHERE id = 1');
  if (!metaRes.ok) return { ok: false, error: metaRes.error };
  const meta = metaRes.rows?.[0];
  if (!meta || !meta.user_id) {
    return { ok: false, empty: true, error: 'Cloud database is empty' };
  }
  const cloudUserId = String(meta.user_id);
  const backupEmail = String(meta.user_email || '');

  // 1a. Account-mismatch confirmation: a backup made by another email needs an
  //     explicit confirmation before it can overwrite this device's data.
  if (
    backupEmail &&
    options?.userEmail &&
    backupEmail.toLowerCase() !== String(options.userEmail).toLowerCase() &&
    !options.confirmDifferentEmail
  ) {
    return {
      ok: false,
      emailMismatch: true,
      backupEmail,
      error: `Cloud backup belongs to ${backupEmail}`,
    };
  }

  // 1b. Refuse interrupted backups — the meta counts were never finalized.
  let metaCounts: Record<string, unknown> | null = null;
  try {
    metaCounts = JSON.parse(String(meta.counts || '{}')) as Record<string, unknown>;
  } catch {
    metaCounts = null;
  }
  if (metaCounts && metaCounts._incomplete === true) {
    return {
      ok: false,
      backupEmail,
      error: 'Cloud backup is incomplete — run a fresh backup',
    };
  }

  // 2. Pull every table (rows written with the backup owner's userId)
  const payload: Record<string, Record<string, unknown>[]> = {};
  let anyRows = 0;
  for (const table of CLOUD_TABLES) {
    const res = await d1Query(
      creds,
      `SELECT * FROM ${table.cloud} WHERE user_id = ?`,
      [cloudUserId]
    );
    if (!res.ok) return { ok: false, backupEmail, error: res.error };
    const rows = (res.rows || []).map(r => fromRow(table, r));
    payload[table.local] = rows;
    anyRows += rows.length;
  }

  // billing settings
  const bsRes = await d1Query(
    creds,
    'SELECT * FROM ps_billing_settings WHERE user_id = ?',
    [cloudUserId]
  );
  if (!bsRes.ok) return { ok: false, backupEmail, error: bsRes.error };
  let billingSettings: Record<string, unknown> | null = null;
  const bsRow = bsRes.rows?.[0];
  if (bsRow) {
    billingSettings = {};
    for (const [camel, snake] of BILLING_SETTINGS_COLUMNS) {
      const v = bsRow[snake];
      billingSettings[camel] =
        camel === 'gstEnabled' ? Number(v) === 1 : v === null || v === undefined ? '' : v;
    }
  }

  if (anyRows === 0 && !billingSettings) {
    return { ok: false, empty: true, error: 'Cloud database is empty' };
  }

  // 2c. Integrity: per-table row counts must match the meta row written at the
  //     end of a successful backup (missing keys are skipped for old backups).
  const fetchedCounts: CloudCounts = {
    categories: payload.categories.length,
    products: payload.products.length,
    transactions: payload.transactions.length,
    expenses: payload.expenses.length,
    cashEntries: payload.cashEntries.length,
    serviceTransactions: payload.serviceTransactions.length,
    bills: payload.bills.length,
  };
  if (metaCounts) {
    for (const key of Object.keys(fetchedCounts) as (keyof CloudCounts)[]) {
      const expected = Number(metaCounts[key]);
      if (Number.isFinite(expected) && expected !== fetchedCounts[key]) {
        return {
          ok: false,
          backupEmail,
          error: 'Cloud backup is incomplete/corrupted (row counts mismatch)',
        };
      }
    }
  }

  // 3. Import locally — importBackupOffline() validates rows, REPLACES local data
  //    and remaps every row's userId to the CURRENT account (device migration safe).
  try {
    await importBackupOffline(userId, {
      categories: payload.categories,
      products: payload.products,
      transactions: payload.transactions,
      expenses: payload.expenses,
      cashEntries: payload.cashEntries,
      serviceTransactions: payload.serviceTransactions,
      bills: payload.bills,
      billingSettings,
    });
  } catch (e) {
    return { ok: false, backupEmail, error: (e as Error).message || 'Import failed' };
  }

  return { ok: true, backupEmail, counts: fetchedCounts };
}

// ============ TEST CONNECTION ============

export async function testD1Connection(
  creds: D1Credentials
): Promise<{ ok: boolean; error?: string; meta?: CloudMeta | null }> {
  const ping = await d1Query(creds, 'SELECT 1 AS ok');
  if (!ping.ok) return { ok: false, error: ping.error };

  const schema = await ensureD1Schema(creds);
  if (!schema.ok) return { ok: false, error: schema.error };

  const metaRes = await d1Query(creds, 'SELECT * FROM ps_backup_meta WHERE id = 1');
  const m = metaRes.ok ? metaRes.rows?.[0] : undefined;
  const meta: CloudMeta | null = m
    ? {
        backedUpAt: String(m.backed_up_at || ''),
        userEmail: String(m.user_email || ''),
        shopName: String(m.shop_name || ''),
        totalRows: Number(m.total_rows || 0),
      }
    : null;

  return { ok: true, meta };
}
