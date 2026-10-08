/**
 * Cloudflare D1 cloud-backup engine (client side).
 *
 * Stores a faithful copy of the local (IndexedDB) shop data in the user's OWN
 * Cloudflare D1 database, using the /api/cloud/d1 proxy route.
 *
 * Design:
 *  - Backup  = DELETE user rows on cloud + INSERT all local rows (full replace).
 *  - Restore = SELECT all cloud rows + importBackupOffline() (full local replace).
 *  - Every row keeps its original `userId` in the cloud, and a meta row records
 *    which account made the backup — so restore works even on a brand-new phone
 *    with a fresh account (rows are remapped to the current user on import).
 *  - Normal rows are sent as multi-row INSERT statements (literal values, safe
 *    escaping); billingSettings (which can contain huge signature/QR dataURLs)
 *    and all SELECTs use bound parameters instead.
 */

import { exportBackupOffline, importBackupOffline } from './offline-service';

// ============ CREDENTIALS (localStorage) ============

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

const CREDS_KEY = 'ps-d1-creds';
const LAST_BACKUP_KEY = 'ps-d1-last-backup';

export function getD1Credentials(): D1Credentials | null {
  try {
    const raw = localStorage.getItem(CREDS_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<D1Credentials>;
    if (c.accountId && c.databaseId && c.apiToken) {
      return { accountId: c.accountId, databaseId: c.databaseId, apiToken: c.apiToken };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveD1Credentials(creds: D1Credentials): void {
  localStorage.setItem(CREDS_KEY, JSON.stringify(creds));
}

export function clearD1Credentials(): void {
  localStorage.removeItem(CREDS_KEY);
  localStorage.removeItem(LAST_BACKUP_KEY);
}

/** Timestamp (ms) of the last successful cloud backup by this user (0 = never). */
export function getD1LastBackup(userId: string): number {
  try {
    const raw = localStorage.getItem(LAST_BACKUP_KEY);
    if (!raw) return 0;
    const v = JSON.parse(raw) as { userId: string; at: number };
    return v && v.userId === userId && typeof v.at === 'number' ? v.at : 0;
  } catch {
    return 0;
  }
}

function setD1LastBackup(userId: string): void {
  localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify({ userId, at: Date.now() }));
}

// ============ LOW-LEVEL QUERY (via /api/cloud/d1 proxy) ============

export interface D1QueryResult {
  ok: boolean;
  rows?: Record<string, unknown>[];
  changes?: number;
  error?: string;
}

async function d1Query(
  creds: D1Credentials,
  sql: string,
  params?: unknown[]
): Promise<D1QueryResult> {
  try {
    const res = await fetch('/api/cloud/d1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...creds, sql, params }),
    });
    let payload: D1QueryResult | null = null;
    try {
      payload = (await res.json()) as D1QueryResult;
    } catch {
      payload = null;
    }
    if (!res.ok || !payload) {
      return { ok: false, error: payload?.error || `Request failed (HTTP ${res.status})` };
    }
    return payload;
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'Network error' };
  }
}

/**
 * Executes several statements. Multi-statement SQL is sent in one call; if the
 * endpoint refuses it, every statement is retried individually so the feature
 * works with both behaviours.
 */
async function runStatements(
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
function sanitizeText(s: string): string {
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

// ============ TABLE MAPPINGS (camelCase local ↔ snake_case cloud) ============

interface CloudTable {
  cloud: string; // D1 table name
  local: string; // key in exportBackupOffline/importBackupOffline payload
  /** [localCamelKey, cloudSnakeColumn] in column order */
  columns: [string, string][];
  /** local keys serialized with JSON.stringify on write / JSON.parse on read */
  jsonKeys?: string[];
}

const CLOUD_TABLES: CloudTable[] = [
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
    columns: [
      ['id', 'id'],
      ['productId', 'product_id'],
      ['type', 'type'],
      ['quantity', 'quantity'],
      ['unitPrice', 'unit_price'],
      ['totalAmount', 'total_amount'],
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

function toRow(table: CloudTable, record: Record<string, unknown>): unknown[] {
  return table.columns.map(([camel]) => {
    const v = record[camel];
    if (v === undefined) {
      if (table.jsonKeys?.includes(camel)) return camel === 'items' ? [] : {};
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
          v = camel === 'items' ? [] : {};
        }
      }
      out[camel] = v ?? (camel === 'items' ? [] : {});
      continue;
    }
    out[camel] = v === null || v === undefined ? '' : v;
  }
  return out;
}

/** billing_settings mapping (keyed by user_id, includes large dataURLs). */
const BILLING_SETTINGS_COLUMNS: [string, string][] = [
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

function buildInsertStatements(
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

  // 2. Make sure tables exist (idempotent, cheap)
  const schema = await ensureD1Schema(creds);
  if (!schema.ok) return { ok: false, error: schema.error };

  // 3. Remove previous backup rows for a clean full replace
  const del = await runStatements(
    creds,
    [...CLOUD_TABLES.map(t => t.cloud), 'ps_billing_settings'].map(t => `DELETE FROM ${t} WHERE user_id = '${sanitizeText(userId).replace(/'/g, "''")}'`)
  );
  if (!del.ok) return { ok: false, error: del.error };

  // 4. Upload row tables in chunks with progress
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

  // 5. billingSettings — single statement with BOUND params (handles huge dataURLs)
  const bs = (data.billingSettings && typeof data.billingSettings === 'object'
    ? data.billingSettings
    : {}) as Record<string, unknown>;
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
  const bsRes = await d1Query(
    creds,
    `INSERT OR REPLACE INTO ps_billing_settings (user_id, ${bsCols.join(', ')}) VALUES (?, ${bsPlaceholders})`,
    bsParams
  );
  if (!bsRes.ok) return { ok: false, error: bsRes.error };

  // 6. Write backup meta row (identifies which account this backup belongs to)
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

  // 7. Remember locally for instant "last backup" display
  setD1LastBackup(userId);

  return { ok: true, counts };
}

// ============ RESTORE ============

export async function restoreFromD1(
  userId: string,
  creds: D1Credentials
): Promise<{ ok: boolean; counts?: CloudCounts; error?: string; empty?: boolean }> {
  // 1. Read meta row — identifies the account the backup belongs to
  const metaRes = await d1Query(creds, 'SELECT * FROM ps_backup_meta WHERE id = 1');
  if (!metaRes.ok) return { ok: false, error: metaRes.error };
  const meta = metaRes.rows?.[0];
  if (!meta || !meta.user_id) {
    return { ok: false, empty: true, error: 'Cloud database is empty' };
  }
  const cloudUserId = String(meta.user_id);

  // 2. Pull every table (rows written with the backup owner's userId)
  const payload: Record<string, Record<string, unknown>[]> = {};
  let anyRows = 0;
  for (const table of CLOUD_TABLES) {
    const res = await d1Query(
      creds,
      `SELECT * FROM ${table.cloud} WHERE user_id = ?`,
      [cloudUserId]
    );
    if (!res.ok) return { ok: false, error: res.error };
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
  if (!bsRes.ok) return { ok: false, error: bsRes.error };
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
    return { ok: false, error: (e as Error).message || 'Import failed' };
  }

  const counts: CloudCounts = {
    categories: payload.categories.length,
    products: payload.products.length,
    transactions: payload.transactions.length,
    expenses: payload.expenses.length,
    cashEntries: payload.cashEntries.length,
    serviceTransactions: payload.serviceTransactions.length,
    bills: payload.bills.length,
  };
  return { ok: true, counts };
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
