/**
 * Local-First Service Layer — 100% offline, NO cloud database.
 *
 * READ STRATEGY:  Always served from local IndexedDB (instant, works with zero internet).
 * WRITE STRATEGY: Written to local IndexedDB immediately (atomic where it matters).
 * DELETE STRATEGY: Deleted from local IndexedDB (with cascades where required).
 *
 * Stock transactions are applied atomically (products + transactions stores in a
 * single IndexedDB transaction) so rapid taps can never create negative stock.
 * Profit/report math uses the purchase-price SNAPSHOT captured on each transaction,
 * so later price edits never rewrite historical profit.
 */

import {
  offlineCategories,
  offlineProducts,
  offlineTransactions,
  offlineExpenses,
  offlineCashEntries,
  offlineServiceTransactions,
  offlineBills,
  offlineStaffPayments,
  offlineInvestments,
  offlineDueEntries,
  clearOfflineData,
  getOfflineDB,
  type OfflineDBSchema,
} from './offline-db';
import { getLocalUser, updateLocalUser } from './local-auth';
import { generateRecordId } from './id';
import { notifyLocalDataChanged, notifyLocalWipe } from './sync-events';
import { computeGst, normalizeGstMode, round2 } from './gst';
import { Category, Product, Transaction, Expense, CashEntry, ServiceTransaction, ServiceCategoryType, Bill, BillItem, BillingSettings, PaymentMethod, StaffPayment, StaffPaymentKind, Investment, DueEntry, DueScheduleItem } from './types';

// ============ DATE HELPERS (local timezone — never use UTC for business days) ============

/**
 * Returns YYYY-MM-DD for a Date in LOCAL time.
 * toISOString() uses UTC — for IST (UTC+5:30) sales between 00:00–05:30 local
 * would land on the previous day. This helper fixes that class of bugs.
 */
export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Resolves a reporting period to a [from, to] date range (local time).
 */
function resolvePeriodRange(options?: { period?: string; date?: string; from?: string; to?: string }): { from: string; to: string } {
  const now = new Date();
  if (options?.from && options?.to) {
    // Guard against inverted custom ranges (from > to) — silently swap.
    return options.from <= options.to
      ? { from: options.from, to: options.to }
      : { from: options.to, to: options.from };
  }
  if (options?.date) return { from: options.date, to: options.date };

  const todayStr = localDateStr(now);
  const period = options?.period || 'today';
  if (period === 'week') {
    const weekStart = new Date(now);
    const day = weekStart.getDay();
    const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1); // Monday start
    weekStart.setDate(diff);
    return { from: localDateStr(weekStart), to: todayStr };
  }
  if (period === 'month') {
    return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to: todayStr };
  }
  // today (default) or any unknown period
  return { from: todayStr, to: todayStr };
}

// ============ SHARED STRIP HELPERS ============

function stripSync<T>(row: Record<string, unknown>): T {
  const { _synced: _s, _dirty: _d, ...rest } = row;
  return rest as T;
}

/**
 * Record an explicit local delete so the cloud sync engine can propagate it
 * to Firestore (tombstone + cloud doc delete) and thereby to every other
 * device. Without this, a delete on device A would silently reappear from
 * the cloud on device B.
 */
async function recordPendingDelete(
  storeName: 'products' | 'expenses' | 'cashEntries' | 'serviceTransactions' | 'bills' | 'staffPayments' | 'investments' | 'dueEntries',
  itemId: string,
  userId: string
): Promise<void> {
  try {
    const db = await getOfflineDB();
    await db.put('pendingDeletes', {
      id: `${storeName}:${itemId}`,
      storeName,
      itemId,
      userId,
      deletedAt: Date.now(),
    });
  } catch {
    // non-fatal — worst case the record resurfaces from the cloud mirror
  }
}

function sortTxnsDesc(rows: OfflineDBSchema['transactions']['value'][]): OfflineDBSchema['transactions']['value'][] {
  return [...rows].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function localTxnsToTransactions(localTxns: OfflineDBSchema['transactions']['value'][]): Transaction[] {
  return sortTxnsDesc(localTxns).map(t => {
    const row = stripSync<Transaction>(t);
    // Legacy rows stored a full ISO timestamp in `date` — normalize to
    // YYYY-MM-DD so "today" filters, 7-day charts and daily grouping
    // can never silently drop them.
    if (row.date && row.date.length > 10) row.date = row.date.slice(0, 10);
    return row;
  });
}

/** Cost basis for a transaction: the SNAPSHOT taken at sale time, falling back to the current product. */
function txnCostBasis(t: Transaction, products: Product[]): number {
  return t.product?.purchasePrice ?? products.find(p => p.id === t.productId)?.purchasePrice ?? 0;
}

/** A "sale" = SELL *or* STOCK_OUT — both consume stock and earn revenue.
 *  Shopkeepers record everyday sales through Stock Out, so every profit
 *  surface must count BOTH types or the Profit tab looks "broken". */
export function isSaleType(type: string): boolean {
  return type === 'SELL' || type === 'STOCK_OUT';
}

/**
 * FIFO cost engine — "purches price ager gulo theke suruhobe, tarpor last
 * purches price asbe".
 *
 * Replays the product's full transaction history in chronological order and
 * maintains a queue of purchase lots (every STOCK_IN row = one lot at its
 * recorded price). Each earlier sale/stock-out consumes the OLDEST lots
 * first. The NEW sale's cost = whatever the oldest remaining lots supply,
 * and when every lot is dry the balance is priced at the product's LAST
 * known purchase price. Returns the blended PER-UNIT cost of this sale —
 * the caller snapshots it into the transaction, so every profit surface
 * (Profit tab, dashboard, reports) uses FIFO automatically.
 */
function computeFifoUnitCost(
  product: OfflineDBSchema['products']['value'],
  history: OfflineDBSchema['transactions']['value'][],
  sellQty: number
): number {
  if (sellQty <= 0) return 0;

  type Lot = { qty: number; price: number };
  const lots: Lot[] = [];

  const chron = history
    .filter(t => t.productId === product.id)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

  for (const t of chron) {
    const qty = Math.max(0, Math.floor(Number(t.quantity)) || 0);
    if (qty <= 0) continue;
    if (t.type === 'STOCK_IN') {
      // The price typed at stock-in time; fall back to the row total, then
      // to the product's current purchase price.
      const price = t.unitPrice > 0
        ? t.unitPrice
        : (t.totalAmount > 0 ? t.totalAmount / qty : 0) || product.purchasePrice;
      lots.push({ qty, price: price || product.purchasePrice });
    } else if (t.type === 'STOCK_OUT' || t.type === 'SELL') {
      // Replay earlier consumption — oldest lots leave the queue first.
      let need = qty;
      while (need > 0 && lots.length > 0) {
        const lot = lots[0];
        const take = Math.min(lot.qty, need);
        lot.qty -= take;
        need -= take;
        if (lot.qty <= 0) lots.shift();
      }
    }
  }

  // THIS sale: blended cost across the oldest remaining lots…
  let cost = 0;
  let need = sellQty;
  while (need > 0 && lots.length > 0) {
    const lot = lots[0];
    const take = Math.min(lot.qty, need);
    cost += take * lot.price;
    lot.qty -= take;
    need -= take;
    if (lot.qty <= 0) lots.shift();
  }
  // …and when lots run dry, the LAST known purchase price applies.
  if (need > 0) cost += need * (product.purchasePrice || 0);

  return cost / sellQty;
}

// ============ CATEGORIES (Local) ============

/** The 20 shop-ready starter categories, seeded into a FRESH device once.
 *  Without this the Add Product form's category dropdown is empty on a new
 *  install and the owner cannot add a single product. */
const DEFAULT_CATEGORY_SEED: { name: string; image: string }[] = [
  { name: 'Mobile', image: '/categories/mobile.png' },
  { name: 'Display/Combo', image: '/categories/display.png' },
  { name: 'Tempered Glass', image: '/categories/tempered-glass.png' },
  { name: 'Flip Cover', image: '/categories/flip-cover.png' },
  { name: 'Back Cover', image: '/categories/back-cover.png' },
  { name: 'UV Glass', image: '/categories/uv-glass.png' },
  { name: 'Smart Watch', image: '/categories/smart-watch.png' },
  { name: 'Battery', image: '/categories/battery.png' },
  { name: 'Charger', image: '/categories/charger.png' },
  { name: 'Neck Band', image: '/categories/neckband.png' },
  { name: 'Ear Pods', image: '/categories/earpods.png' },
  { name: 'Selfie Stick', image: '/categories/selfie-stick.png' },
  { name: 'Ring Light', image: '/categories/ring-light.png' },
  { name: 'Mobile Stand', image: '/categories/mobile-stand.png' },
  { name: 'Watch Strap', image: '/categories/watch-strap.png' },
  { name: 'Earphone', image: '/categories/earphone.png' },
  { name: 'Memory Card', image: '/categories/memory-card.png' },
  { name: 'Data Cable', image: '/categories/data-cable.png' },
  { name: 'Home Theater', image: '/categories/home-theater.png' },
  { name: 'Refrigerator', image: '/categories/refrigerator.png' },
];

/**
 * Creates the starter categories ONCE per device (no-op when the owner
 * already has any category — never overwrites their own setup).
 */
export async function seedDefaultCategoriesOffline(userId: string): Promise<void> {
  if (!userId) return;
  try {
    const existing = await offlineCategories.getAll(userId);
    if (existing.length > 0) return;
    const now = new Date().toISOString();
    const ids: string[] = [];
    for (const seed of DEFAULT_CATEGORY_SEED) {
      const id = generateRecordId();
      ids.push(id);
      const category = {
        id,
        name: seed.name,
        image: seed.image,
        userId,
        createdAt: now,
        updatedAt: now,
        _count: { products: 0 },
      };
      await offlineCategories.put({
        ...category,
        _synced: Date.now(),
        _dirty: 0,
      } as OfflineDBSchema['categories']['value']);
    }
  } catch {
    // Seeding is best-effort; the + Add Category button still works.
  }
}

export async function getCategoriesOffline(userId: string): Promise<Category[]> {
  const localCats = await offlineCategories.getAll(userId);
  return localCats.map(c => stripSync<Category>(c));
}

export async function createCategoryOffline(name: string, image: string, userId: string): Promise<{ category: Category }> {
  if (!name.trim()) throw new Error('Category name is required');

  const now = new Date().toISOString();
  const category = {
    id: generateRecordId(),
    name: name.trim(),
    image: image || '',
    userId,
    createdAt: now,
    updatedAt: now,
    _count: { products: 0 },
  };

  await offlineCategories.put({
    ...category,
    _synced: Date.now(),
    _dirty: 0,
  } as OfflineDBSchema['categories']['value']);

  notifyLocalDataChanged(userId);
  return { category };
}

/**
 * Find-or-create a category by (trimmed, case-insensitive) name — powers the
 * product form's type-to-create field: a category typed onto a product is
 * guaranteed to exist before the product row lands, on this device AND on
 * every other device via cloud sync (app + web). New categories get the 📦
 * default tile and can be restyled later from Add Category presets.
 * Idempotent: concurrent callers converge on the same row.
 */
export async function ensureCategoryOffline(
  rawName: string,
  userId: string
): Promise<{ category: Category; created: boolean }> {
  const name = rawName.trim();
  if (!name) throw new Error('Category name is required');
  const existing = await offlineCategories.getAll(userId);
  const match = existing.find((c) => c.name.trim().toLowerCase() === name.toLowerCase());
  if (match) return { category: stripSync<Category>(match), created: false };
  const { category } = await createCategoryOffline(name, '📦', userId);
  return { category, created: true };
}

// ============ PRODUCTS (Local) ============

/**
 * ⚡ Single product by id — direct IndexedDB key get (O(1)).
 * Used where only ONE product is needed (edit prefill); the old path loaded
 * the user's entire product list just to find one row.
 */
export async function getProductByIdOffline(id: string): Promise<Product | null> {
  const row = await offlineProducts.getById(id);
  return row ? stripSync<Product>(row) : null;
}

export async function getProductsOffline(userId: string, options?: { categoryId?: string; search?: string }): Promise<Product[]> {
  let localProducts: OfflineDBSchema['products']['value'][];

  if (options?.categoryId) {
    localProducts = await offlineProducts.getByCategory(userId, options.categoryId);
  } else if (options?.search) {
    localProducts = await offlineProducts.search(userId, options.search);
  } else {
    localProducts = await offlineProducts.getAll(userId);
  }

  return localProducts.map(p => stripSync<Product>(p));
}

/**
 * Thrown when a product with the same (trimmed, case-insensitive) name
 * already exists in the same category. UI layers map `code` to a localized
 * message; the raw message is a readable English fallback.
 */
export class DuplicateProductError extends Error {
  code = 'DUPLICATE_PRODUCT';
  constructor(name: string) {
    super(`A product named "${name}" already exists in this category`);
    this.name = 'DuplicateProductError';
  }
}

/**
 * Duplicate guard — one name per category (trimmed + case-insensitive).
 * `excludeId` lets edits keep their own row. Returns the conflicting row.
 */
async function findDuplicateProduct(
  userId: string,
  categoryId: string,
  name: string,
  excludeId?: string
): Promise<OfflineDBSchema['products']['value'] | null> {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const rows = await offlineProducts.getByCategory(userId, categoryId);
  return rows.find((r) => r.id !== excludeId && r.name.trim().toLowerCase() === needle) || null;
}

async function assertNoDuplicateProduct(
  userId: string,
  categoryId: string,
  name: string,
  excludeId?: string
): Promise<void> {
  const dup = await findDuplicateProduct(userId, categoryId, name, excludeId);
  if (dup) throw new DuplicateProductError(dup.name);
}

/**
 * Per-unit serial list cleaner — trims, drops empties and de-duplicates
 * (case-insensitive: an IMEI typed twice with different casing is still one
 * phone). Order is preserved — array position = stock entry order.
 */
export function normalizeSerialList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const s = String(raw ?? '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export async function createProductOffline(productData: {
  name: string;
  categoryId: string;
  quantity?: number;
  boxNumber?: string;
  serialNumber?: string;
  serialNumbers?: string[];
  purchasePrice?: number;
  sellingPrice?: number;
  lowStockThreshold?: number;
  userId: string;
}): Promise<{ product: Product }> {
  if (!productData.name.trim()) throw new Error('Product name is required');

  // Duplicate guard — the same name must never appear twice inside ONE
  // category. Enforced at the service level so every entry point (app,
  // admin panel, future importers) is protected, not just one UI form.
  await assertNoDuplicateProduct(productData.userId, productData.categoryId, productData.name);

  const quantity = Math.max(0, Math.floor(Number(productData.quantity ?? 0)) || 0);
  const purchasePrice = Math.max(0, Number(productData.purchasePrice ?? 0)) || 0;
  const sellingPrice = Math.max(0, Number(productData.sellingPrice ?? 0)) || 0;
  const lowStockThreshold = Math.max(0, Math.floor(Number(productData.lowStockThreshold ?? 5)) || 0);

  const now = new Date().toISOString();
  // Per-unit serials (mobile products): one S/N per physical unit. The legacy
  // single `serialNumber` stays in sync as the FIRST serial so v2.11.5 builds
  // and old search paths keep reading something meaningful.
  const serialNumbers = normalizeSerialList(productData.serialNumbers);
  const product = {
    id: generateRecordId(),
    name: productData.name.trim(),
    categoryId: productData.categoryId,
    quantity,
    boxNumber: productData.boxNumber ?? '',
    serialNumber: serialNumbers[0] ?? (productData.serialNumber ?? '').trim(),
    serialNumbers,
    purchasePrice,
    sellingPrice,
    lowStockThreshold,
    userId: productData.userId,
    createdAt: now,
    updatedAt: now,
  };

  // Opening stock becomes FIFO lot #1: an initial STOCK_IN row at the
  // creation-time purchase price. Without it the FIFO engine would have no
  // lot for the quantity entered on the Add Product form (it would fall
  // straight through to "last purchase price" for the very first sales).
  // Product + opening lot are written in ONE atomic IndexedDB transaction —
  // a crash can never leave a product whose quantity has no ledger lot.
  const productRow = {
    ...product,
    _synced: Date.now(),
    _dirty: 0,
  } as OfflineDBSchema['products']['value'];

  let openingTxn: OfflineDBSchema['transactions']['value'] | null = null;
  if (quantity > 0) {
    openingTxn = {
      id: generateRecordId(),
      productId: product.id,
      type: 'STOCK_IN',
      quantity,
      unitPrice: purchasePrice,
      totalAmount: purchasePrice * quantity,
      date: localDateStr(new Date(now)),
      userId: productData.userId,
      createdAt: now,
      product: {
        id: product.id,
        name: product.name,
        purchasePrice,
        sellingPrice,
      },
      _synced: Date.now(),
      _dirty: 0,
    };
  }

  const db = await getOfflineDB();
  const tx = db.transaction(['products', 'transactions'], 'readwrite');
  tx.objectStore('products').put(productRow);
  if (openingTxn) tx.objectStore('transactions').put(openingTxn);
  await tx.done;

  notifyLocalDataChanged(productData.userId);
  return { product };
}

/** Only these keys may be changed by an update — never trust raw spreads. */
function applyProductUpdates(
  product: OfflineDBSchema['products']['value'],
  updates: Partial<Product>
): OfflineDBSchema['products']['value'] {
  const next = { ...product };
  if (updates.name !== undefined) {
    const name = String(updates.name).trim();
    if (name) next.name = name;
  }
  if (updates.categoryId !== undefined) next.categoryId = updates.categoryId;
  if (updates.boxNumber !== undefined) next.boxNumber = updates.boxNumber;
  if (updates.serialNumber !== undefined) next.serialNumber = String(updates.serialNumber).trim();
  if (updates.serialNumbers !== undefined) {
    next.serialNumbers = normalizeSerialList(updates.serialNumbers);
    // legacy mirror: first serial keeps older builds/search functional
    next.serialNumber = next.serialNumbers[0] ?? '';
  }
  if (updates.quantity !== undefined) {
    next.quantity = Math.max(0, Math.floor(Number(updates.quantity)) || 0);
  }
  if (updates.purchasePrice !== undefined) {
    next.purchasePrice = Math.max(0, Number(updates.purchasePrice)) || 0;
  }
  if (updates.sellingPrice !== undefined) {
    next.sellingPrice = Math.max(0, Number(updates.sellingPrice)) || 0;
  }
  if (updates.lowStockThreshold !== undefined) {
    next.lowStockThreshold = Math.max(0, Math.floor(Number(updates.lowStockThreshold)) || 0);
  }
  return next;
}

export async function updateProductOffline(id: string, updates: Partial<Product> & { userId: string }): Promise<{ product: Product }> {
  const db = await getOfflineDB();

  // Phase 1 — duplicate guard BEFORE the readwrite transaction opens: an
  // IndexedDB tx auto-commits the moment it idles, so it must never sit
  // waiting on another store query. (Read current row first to know the
  // effective next name/category.)
  {
    const current = await db.transaction('products').objectStore('products').get(id);
    if (!current || current.userId !== updates.userId) throw new Error('Product not found');
    const nextName = updates.name !== undefined ? String(updates.name).trim() || current.name : current.name;
    const nextCategoryId = updates.categoryId !== undefined ? updates.categoryId : current.categoryId;
    const changing = nextName.trim().toLowerCase() !== String(current.name).trim().toLowerCase() || nextCategoryId !== current.categoryId;
    if (changing) {
      await assertNoDuplicateProduct(updates.userId, nextCategoryId, nextName, id);
    }
  }

  const tx = db.transaction(['products', 'transactions'], 'readwrite');
  const product = await tx.objectStore('products').get(id);
  if (!product || product.userId !== updates.userId) throw new Error('Product not found');

  const prevQuantity = product.quantity || 0;
  const updatedProduct = {
    ...applyProductUpdates(product, updates),
    updatedAt: new Date().toISOString(),
  };

  // A quantity edit is a stock correction: mirror it in the FIFO ledger so
  // the lot replay stays truthful (a direct quantity write used to leave lots
  // that no longer matched reality — later sales costed from stale lots).
  //   increase -> STOCK_IN lot at the effective purchase price
  //   decrease -> STOCK_OUT consumption of the oldest lots (revenue ₹0 —
  //               a correction is not a sale, but the lots must leave).
  const delta = (updatedProduct.quantity || 0) - prevQuantity;
  const now = new Date().toISOString();
  const effectivePurchasePrice = updatedProduct.purchasePrice || 0;
  let adjustment: OfflineDBSchema['transactions']['value'] | null = null;
  if (delta !== 0) {
    adjustment = {
      id: generateRecordId(),
      productId: id,
      type: delta > 0 ? 'STOCK_IN' : 'STOCK_OUT',
      quantity: Math.abs(delta),
      unitPrice: delta > 0 ? effectivePurchasePrice : 0,
      totalAmount: delta > 0 ? effectivePurchasePrice * delta : 0,
      date: localDateStr(new Date(now)),
      userId: updates.userId,
      createdAt: now,
      product: {
        id,
        name: updatedProduct.name,
        purchasePrice: effectivePurchasePrice,
        sellingPrice: updatedProduct.sellingPrice || 0,
      },
      _synced: Date.now(),
      _dirty: 0,
    };
  }

  tx.objectStore('products').put({
    ...updatedProduct,
    _synced: Date.now(),
    _dirty: 0,
  } as OfflineDBSchema['products']['value']);
  if (adjustment) tx.objectStore('transactions').put(adjustment);
  await tx.done;

  const { _synced, _dirty, ...prodData } = updatedProduct;
  notifyLocalDataChanged(updates.userId);
  return { product: prodData as Product };
}

export async function deleteProductOffline(id: string, userId: string): Promise<{ message: string }> {
  // Ownership check — a product must never be deleted by a different account
  // on a shared device. The delete itself runs in a single atomic
  // IndexedDB transaction.
  const db = await getOfflineDB();
  const tx = db.transaction('products', 'readwrite');
  const product = await tx.objectStore('products').get(id);
  if (!product || (userId && product.userId !== userId)) throw new Error('Not found');

  // Historical transactions are deliberately KEPT: every row carries a
  // purchase-price snapshot, so past profit/reports must still count sales
  // of a product that was later deleted ("deleted products still count").
  // History renders those rows via the snapshot (txn.product?.name).
  void tx.objectStore('products').delete(id);
  await tx.done;

  await recordPendingDelete('products', id, userId);
  notifyLocalDataChanged(userId);
  return { message: 'Product deleted successfully' };
}

// ============ TRANSACTIONS (Local, ATOMIC stock updates) ============

/**
 * Creates a transaction AND applies the stock change in ONE atomic IndexedDB
 * transaction. Two rapid sells can never both pass the same stock check.
 *
 * NOTE: idb v8's db.transaction() has NO callback parameter — the correct
 * atomic pattern is: open tx → await requests → `await tx.done`.
 */
export async function createTransactionOffline(transactionData: {
  type: 'STOCK_IN' | 'STOCK_OUT' | 'SELL';
  productId: string;
  quantity: number;
  unitPrice?: number;
  totalAmount?: number;
  date?: string;
  /** For serialized (mobile) stock going OUT: exactly these per-unit serials
   *  leave the inventory — each is removed from the product's serial list.
   *  Validated against the product INSIDE the atomic transaction. */
  soldSerials?: string[];
  userId: string;
}): Promise<{ transaction: Transaction }> {
  const quantity = Math.floor(Number(transactionData.quantity));
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantity must be a positive whole number');

  const unitPrice = Number(transactionData.unitPrice ?? 0);
  const totalAmount = Number(transactionData.totalAmount ?? 0);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('Price cannot be negative');
  if (!Number.isFinite(totalAmount) || totalAmount < 0) throw new Error('Total amount cannot be negative');

  const db = await getOfflineDB();
  const now = new Date().toISOString();
  const id = generateRecordId();

  const tx = db.transaction(['products', 'transactions'], 'readwrite');
  const productsStore = tx.objectStore('products');
  const transactionsStore = tx.objectStore('transactions');

  // Validate BEFORE writing anything — a readwrite tx with no writes commits empty.
  const product = await productsStore.get(transactionData.productId);
  if (!product) {
    throw new Error('Product not found');
  }
  // Ownership check — a second account on a shared device must never be able
  // to move stock on (or write transactions against) someone else's product.
  // Generic message, same as the not-found case (no enumeration).
  if (product.userId !== transactionData.userId) {
    throw new Error('Product not found');
  }

  const isOut = transactionData.type === 'STOCK_OUT' || transactionData.type === 'SELL';
  if (isOut && product.quantity < quantity) {
    throw new Error(`Insufficient stock — only ${product.quantity} left`);
  }

  // ---- per-unit serial bookkeeping (mobile products) ----
  // Every requested serial must physically exist in the product's stock list —
  // a sell can never remove a serial that isn't there (data integrity).
  let soldSerials: string[] = [];
  if (isOut && transactionData.soldSerials?.length) {
    const inStock = normalizeSerialList(product.serialNumbers);
    const requested = normalizeSerialList(transactionData.soldSerials);
    const stockSet = new Set(inStock.map((s) => s.toLowerCase()));
    for (const s of requested) {
      if (!stockSet.has(s.toLowerCase())) {
        throw new Error(`Serial "${s}" is not in stock for this product`);
      }
    }
    if (requested.length > quantity) {
      throw new Error('More serials selected than units sold');
    }
    soldSerials = requested;
  }

  // ---- FIFO cost basis (oldest purchase lots first, then last price) ----
  // Read the product's transaction history INSIDE the same atomic tx so the
  // replay can never race a concurrent sell. Only prior rows exist here —
  // the new row is put() below.
  let fifoUnitCost = product.purchasePrice || 0;
  if (isOut) {
    const history = await transactionsStore
      .index('by-userId')
      .getAll(transactionData.userId);
    fifoUnitCost = computeFifoUnitCost(product, history, quantity);
  }

  const quantityChange = transactionData.type === 'STOCK_IN' ? quantity : -quantity;

  // Stocking in at a new price moves the product's "last purchase price"
  // forward — once older lots are consumed, sales cost THIS price.
  const lastPurchasePrice = transactionData.type === 'STOCK_IN' && unitPrice > 0
    ? unitPrice
    : product.purchasePrice;

  const row: OfflineDBSchema['transactions']['value'] = {
    id,
    productId: transactionData.productId,
    type: transactionData.type,
    quantity,
    unitPrice,
    totalAmount,
    date: transactionData.date || localDateStr(),
    userId: transactionData.userId,
    createdAt: now,
    // Snapshot the prices at transaction time — historical profit must
    // never change when the user later edits the product's prices.
    // For sales the snapshot IS the FIFO per-unit cost, so every profit
    // surface (Profit tab / dashboard / reports) computes FIFO profit
    // without any extra plumbing.
    product: {
      id: product.id,
      name: product.name,
      purchasePrice: isOut ? fifoUnitCost : lastPurchasePrice,
      sellingPrice: product.sellingPrice,
    },
    _synced: Date.now(),
    _dirty: 0,
  };

  await transactionsStore.put(row);
  // a sold unit's serial leaves the stock list — that phone is gone.
  // Legacy single-serial mirror stays = first remaining serial (or '').
  const remainingSerials = soldSerials.length
    ? normalizeSerialList(product.serialNumbers).filter(
        (s) => !soldSerials.some((x) => x.toLowerCase() === s.toLowerCase())
      )
    : normalizeSerialList(product.serialNumbers);
  await productsStore.put({
    ...product,
    quantity: product.quantity + quantityChange,
    purchasePrice: lastPurchasePrice,
    ...(soldSerials.length ? { serialNumbers: remainingSerials, serialNumber: remainingSerials[0] ?? '' } : {}),
    updatedAt: now,
  });

  // Commit — rejects (and rolls back both stores) if anything failed.
  await tx.done;

  notifyLocalDataChanged(transactionData.userId);
  return { transaction: stripSync<Transaction>(row) };
}

export async function getTransactionsOffline(userId: string, options?: { type?: string; productId?: string; from?: string; to?: string }): Promise<Transaction[]> {
  let localTxns = await offlineTransactions.getAll(userId);

  if (options?.type) localTxns = localTxns.filter(t => t.type === options.type);
  if (options?.productId) localTxns = localTxns.filter(t => t.productId === options.productId);
  if (options?.from) localTxns = localTxns.filter(t => t.date >= options.from!);
  if (options?.to) localTxns = localTxns.filter(t => t.date <= options.to!);

  return localTxnsToTransactions(localTxns);
}

// ============ DASHBOARD (Local) ============

export async function getDashboardOffline(userId: string) {
  const [localProducts, localCategories, localTransactions, localBills] = await Promise.all([
    offlineProducts.getAll(userId),
    offlineCategories.getAll(userId),
    offlineTransactions.getAll(userId),
    offlineBills.getAll(userId),
  ]);

  const products = localProducts.map(p => stripSync<Product>(p));
  const categories = localCategories.map(c => stripSync<Category>(c));
  const transactions = localTxnsToTransactions(localTransactions);

  const today = localDateStr();
  const todayTxns = transactions.filter(t => t.date === today);

  const lowItems = products.filter(p => p.quantity <= p.lowStockThreshold).length;
  const stockValue = products.reduce((sum, p) => sum + p.quantity * p.purchasePrice, 0);
  const lowStockProducts = products.filter(p => p.quantity <= p.lowStockThreshold).slice(0, 10);
  const recentTransactions = transactions.slice(0, 5);

  const productCountMap: Record<string, number> = {};
  for (const p of products) {
    productCountMap[p.categoryId] = (productCountMap[p.categoryId] || 0) + 1;
  }
  const catsWithCount = categories.map(c => ({
    ...c,
    _count: { products: productCountMap[c.id] || 0 },
  }));
  // ⚡ Map lookup instead of catsWithCount.find() inside the product loop
  // (was O(products × categories), now O(products))
  const catNameMap = new Map(catsWithCount.map(c => [c.id, c.name]));

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const sevenDaysAgoStr = localDateStr(sevenDaysAgo);

  const saleTxns = transactions.filter(t => isSaleType(t.type) && t.date >= sevenDaysAgoStr);
  const saleMap = new Map<string, { sales: number; quantity: number; profit: number }>();
  for (const t of saleTxns) {
    const existing = saleMap.get(t.date) || { sales: 0, quantity: 0, profit: 0 };
    existing.sales += t.totalAmount;
    existing.quantity += t.quantity;
    // Daily profit line for the dashboard chart — same FIFO snapshot math as
    // todayProfit below, so bar + line can never disagree.
    existing.profit += (t.totalAmount || 0)
      - (t.quantity || 0) * (t.product?.purchasePrice ?? products.find(p => p.id === t.productId)?.purchasePrice ?? 0);
    saleMap.set(t.date, existing);
  }

  const saleOverview: { date: string; label: string; sales: number; quantity: number; profit: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = localDateStr(d);
    const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' });
    const dayData = saleMap.get(dateStr) || { sales: 0, quantity: 0, profit: 0 };
    saleOverview.push({ date: dateStr, label: dayLabel, ...dayData });
  }

  const stockByCategory = new Map<string, { quantity: number; value: number }>();
  for (const p of products) {
    const catName = catNameMap.get(p.categoryId) || 'Unknown';
    const existing = stockByCategory.get(catName) || { quantity: 0, value: 0 };
    existing.quantity += p.quantity;
    existing.value += p.quantity * p.purchasePrice;
    stockByCategory.set(catName, existing);
  }

  const stockOverview = Array.from(stockByCategory.entries())
    .filter(([_, data]) => data.quantity > 0)
    .map(([category, data]) => ({ category, ...data }));

  // ⚡ Today's profit computed from the ALREADY-LOADED transactions — the
  // dashboard used to re-scan the whole transactions store a second time.
  // Profit = totalAmount − (quantity × FIFO cost snapshot at sale time).
  // Both SELL and STOCK_OUT count — everyday sales are recorded via Stock Out.
  const todayProfit = todayTxns.reduce((sum, tx) => {
    if (!isSaleType(tx.type)) return sum;
    // Same fallback as txnCostBasis(): legacy/imported rows without a price
    // snapshot cost the product's CURRENT purchase price — never ₹0-cost.
    const cost = (tx.quantity || 0)
      * (tx.product?.purchasePrice ?? products.find(p => p.id === tx.productId)?.purchasePrice ?? 0);
    return sum + ((tx.totalAmount || 0) - cost);
  }, 0);

  // ---- Due Book aggregates (customer credit) — same pass, no extra store scan
  const totalDue = round2(localBills.reduce((sum, b) => sum + (b.dueAmount || 0), 0));
  const dueBills = localBills.filter(b => (b.dueAmount || 0) > 0.009).length;

  return {
    stats: {
      totalItems: products.length,
      lowItems,
      todayTransactions: todayTxns.length,
      stockValue,
      totalDue,
      dueBills,
    },
    lowStockProducts,
    recentTransactions,
    categories: catsWithCount,
    saleOverview,
    stockOverview,
    todayProfit,
  };
}

// Alias for backward compatibility with existing imports
export { getDashboardOffline as getDashboard };

// ============ INVESTMENTS (Others Invest — Local) ============

export async function getInvestmentsOffline(userId: string): Promise<Investment[]> {
  const rows = await offlineInvestments.getAll(userId);
  return rows
    .map(r => stripSync<Investment>(r))
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
}

export async function createInvestmentOffline(data: {
  userId: string;
  date?: string;
  amount: number;
  purpose?: string;
  note?: string;
}): Promise<{ investment: Investment }> {
  const amount = round2(Number(data.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Investment amount must be greater than 0');

  const now = new Date().toISOString();
  const row: OfflineDBSchema['investments']['value'] = {
    id: generateRecordId(),
    userId: data.userId,
    date: data.date || localDateStr(),
    amount,
    purpose: (data.purpose || '').trim(),
    note: (data.note || '').trim(),
    createdAt: now,
    updatedAt: now,
    _synced: Date.now(),
    _dirty: 0,
  };

  await offlineInvestments.put(row);
  notifyLocalDataChanged(data.userId);
  return { investment: stripSync<Investment>(row) };
}

export async function deleteInvestmentOffline(id: string, userId: string): Promise<{ success: boolean }> {
  const db = await getOfflineDB();
  const row = await db.get('investments', id);
  if (!row || row.userId !== userId) throw new Error('Investment not found');
  await db.delete('investments', id);
  await recordPendingDelete('investments', id, userId);
  notifyLocalDataChanged(userId);
  return { success: true };
}

// ============ DUE ENTRIES (বাকি এন্ট্রি — custom credit ledger, Local) ============

/** Rupee rounding tolerance for "fully collected" checks. */
const DUE_EPS = 0.009;

/** Coerce/repair a raw schedule array (create/update/import all funnel here):
 *  clamps amounts, generates missing ids, drops empty rows, sorts by date. */
function normalizeSchedule(raw: unknown): DueScheduleItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((it, ix): DueScheduleItem => {
      const r = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
      const amount = round2(Math.max(0, Number(r.amount) || 0));
      const paidAmount = round2(Math.min(amount, Math.max(0, Number(r.paidAmount) || 0)));
      const item: DueScheduleItem = {
        id: typeof r.id === 'string' && r.id ? r.id : `k${ix}-${Date.now().toString(36)}-${ix}`,
        dueDate: typeof r.dueDate === 'string' ? r.dueDate.slice(0, 10) : '',
        amount,
        paidAmount,
      };
      if (amount > 0 && paidAmount >= amount - DUE_EPS) {
        item.paidAt = typeof r.paidAt === 'string' && r.paidAt ? r.paidAt : new Date().toISOString();
      }
      return item;
    })
    .filter(it => it.amount > DUE_EPS || it.paidAmount > DUE_EPS)
    .sort((a, b) => (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99'));
}

/** Remaining un-collected amount of a due entry. */
export function dueEntryOutstanding(e: Pick<DueEntry, 'amount' | 'paidAmount'>): number {
  return round2(Math.max(0, (Number(e.amount) || 0) - (Number(e.paidAmount) || 0)));
}

export async function getDueEntriesOffline(userId: string): Promise<DueEntry[]> {
  const rows = await offlineDueEntries.getAll(userId);
  return rows
    .map(r => stripSync<DueEntry>(r))
    .map(e => ({ ...e, schedule: normalizeSchedule(e.schedule) }))
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
}

export async function createDueEntryOffline(data: {
  userId: string;
  customerName: string;
  customerMobile?: string;
  customerPhotoDataUrl?: string;
  productName: string;
  productPhotoDataUrl?: string;
  amount: number;
  /** Installment plan — {dueDate, amount} rows; ids/progress are assigned here. */
  schedule?: { dueDate: string; amount: number }[];
  note?: string;
  date?: string;
}): Promise<{ dueEntry: DueEntry }> {
  const amount = round2(Number(data.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Due amount must be greater than 0');
  const customerName = (data.customerName || '').trim();
  const productName = (data.productName || '').trim();
  if (!customerName) throw new Error('Customer name is required');
  if (!productName) throw new Error('Product name is required');

  const now = new Date().toISOString();
  const row: OfflineDBSchema['dueEntries']['value'] = {
    id: generateRecordId(),
    userId: data.userId,
    customerName,
    customerMobile: (data.customerMobile || '').trim(),
    customerPhotoDataUrl: data.customerPhotoDataUrl || '',
    productName,
    productPhotoDataUrl: data.productPhotoDataUrl || '',
    amount,
    paidAmount: 0,
    schedule: normalizeSchedule(data.schedule),
    note: (data.note || '').trim(),
    date: data.date || localDateStr(),
    createdAt: now,
    updatedAt: now,
    _synced: Date.now(),
    _dirty: 0,
  };

  await offlineDueEntries.put(row);
  notifyLocalDataChanged(data.userId);
  return { dueEntry: stripSync<DueEntry>(row) };
}

export async function updateDueEntryOffline(
  id: string,
  updates: {
    customerName?: string;
    customerMobile?: string;
    customerPhotoDataUrl?: string;
    productName?: string;
    productPhotoDataUrl?: string;
    amount?: number;
    /** Full replacement plan; per-item collection progress is carried over by id. */
    schedule?: { id?: string; dueDate: string; amount: number }[];
    note?: string;
    date?: string;
  },
  userId: string
): Promise<{ dueEntry: DueEntry }> {
  const row = await offlineDueEntries.getById(id);
  if (!row || row.userId !== userId) throw new Error('Due entry not found');

  if (updates.customerName !== undefined && !updates.customerName.trim()) throw new Error('Customer name is required');
  if (updates.productName !== undefined && !updates.productName.trim()) throw new Error('Product name is required');

  let amount = row.amount;
  if (updates.amount !== undefined) {
    amount = round2(Number(updates.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Due amount must be greater than 0');
  }

  // Collection progress lives on the entry (payments only ever go through
  // recordDueEntryPaymentOffline) — an edit can lower the total, never the
  // already-collected amount.
  const paidAmount = round2(Math.min(amount, Number(row.paidAmount) || 0));

  let schedule = row.schedule;
  if (updates.schedule !== undefined) {
    const prevById = new Map(row.schedule.map(it => [it.id, it]));
    schedule = normalizeSchedule(
      updates.schedule.map(it => ({
        id: typeof it.id === 'string' && it.id ? it.id : undefined,
        dueDate: it.dueDate,
        amount: it.amount,
        paidAmount: 0,
      }))
    );
    // Carry each previously-collected installment's progress over by id.
    schedule = schedule.map(it => {
      const prev = prevById.get(it.id);
      const carried = prev ? Math.min(it.amount, prev.paidAmount) : 0;
      const out: DueScheduleItem = { ...it, paidAmount: round2(carried) };
      if (carried >= it.amount - DUE_EPS) out.paidAt = prev?.paidAt || new Date().toISOString();
      return out;
    });
    // If the trimmed plan now accounts for MORE progress than the entry has
    // collected, shed the difference from the LAST items (predictable, rare).
    let excess = round2(schedule.reduce((s, it) => s + it.paidAmount, 0) - paidAmount);
    if (excess > 0) {
      schedule = [...schedule].reverse().map(it => {
        if (excess <= 0 || it.paidAmount <= 0) return it;
        const take = Math.min(it.paidAmount, excess);
        excess = round2(excess - take);
        const left = round2(it.paidAmount - take);
        const out: DueScheduleItem = { ...it, paidAmount: left };
        if (left < it.amount - DUE_EPS) delete out.paidAt;
        return out;
      }).reverse();
    }
  }

  const next: OfflineDBSchema['dueEntries']['value'] = {
    ...row,
    ...(updates.customerName !== undefined ? { customerName: updates.customerName.trim() } : {}),
    ...(updates.customerMobile !== undefined ? { customerMobile: updates.customerMobile.trim() } : {}),
    ...(updates.customerPhotoDataUrl !== undefined ? { customerPhotoDataUrl: updates.customerPhotoDataUrl } : {}),
    ...(updates.productName !== undefined ? { productName: updates.productName.trim() } : {}),
    ...(updates.productPhotoDataUrl !== undefined ? { productPhotoDataUrl: updates.productPhotoDataUrl } : {}),
    amount,
    paidAmount,
    schedule,
    ...(updates.note !== undefined ? { note: updates.note.trim() } : {}),
    ...(updates.date ? { date: updates.date } : {}),
    updatedAt: new Date().toISOString(),
  };

  await offlineDueEntries.put(next);
  notifyLocalDataChanged(userId);
  return { dueEntry: stripSync<DueEntry>(next) };
}

export async function deleteDueEntryOffline(id: string, userId: string): Promise<{ success: boolean }> {
  const row = await offlineDueEntries.getById(id);
  if (!row || row.userId !== userId) throw new Error('Due entry not found');
  await offlineDueEntries.delete(id);
  await recordPendingDelete('dueEntries', id, userId);
  notifyLocalDataChanged(userId);
  return { success: true };
}

/**
 * Record a collection against a due entry.
 *  - `opts.scheduleItemId` → pay THAT installment's remaining balance first.
 *  - otherwise            → fill unpaid installments chronologically.
 * Any leftover (advance payment / no fixed schedule) lands on the entry itself.
 */
export async function recordDueEntryPaymentOffline(
  id: string,
  userId: string,
  amount?: number,
  opts?: { scheduleItemId?: string }
): Promise<{ dueEntry: DueEntry }> {
  const row = await offlineDueEntries.getById(id);
  if (!row || row.userId !== userId) throw new Error('Due entry not found');

  const total = round2(Number(row.amount) || 0);
  const paid = round2(Number(row.paidAmount) || 0);
  const outstanding = round2(total - paid);
  if (outstanding <= DUE_EPS) throw new Error('This due is already fully settled');

  let schedule = (row.schedule || []).map(it => ({ ...it }));

  // Resolve the pay amount FIRST: a per-installment tap with no explicit
  // amount collects exactly THAT kisti's balance (never the whole due —
  // the old behaviour swept the remaining outstanding in as "advance").
  let pay: number;
  if (opts?.scheduleItemId) {
    const target = schedule.find(it => it.id === opts.scheduleItemId);
    if (!target) throw new Error('Installment not found');
    const itemRemaining = round2(target.amount - (Number(target.paidAmount) || 0));
    if (itemRemaining <= DUE_EPS) throw new Error('This installment is already settled');
    pay = amount === undefined ? itemRemaining : round2(Math.max(0, Number(amount) || 0));
  } else {
    pay = amount === undefined ? outstanding : round2(Math.max(0, Number(amount) || 0));
  }
  pay = Math.min(pay, outstanding);
  if (pay <= DUE_EPS) throw new Error('Payment amount must be greater than 0');

  let left = pay;

  if (opts?.scheduleItemId) {
    const item = schedule.find(it => it.id === opts.scheduleItemId);
    if (!item) throw new Error('Installment not found');
    const itemRemaining = round2(item.amount - (Number(item.paidAmount) || 0));
    if (itemRemaining <= DUE_EPS) throw new Error('This installment is already settled');
    const take = Math.min(left, itemRemaining);
    item.paidAmount = round2((Number(item.paidAmount) || 0) + take);
    if (item.paidAmount >= item.amount - DUE_EPS) item.paidAt = new Date().toISOString();
    left = round2(left - take);
  } else {
    const sorted = [...schedule].sort((a, b) => (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99'));
    for (const item of sorted) {
      if (left <= DUE_EPS) break;
      const remaining = round2(item.amount - (Number(item.paidAmount) || 0));
      if (remaining <= DUE_EPS) continue;
      const take = Math.min(left, remaining);
      item.paidAmount = round2((Number(item.paidAmount) || 0) + take);
      if (item.paidAmount >= item.amount - DUE_EPS) item.paidAt = new Date().toISOString();
      left = round2(left - take);
    }
  }

  const next: OfflineDBSchema['dueEntries']['value'] = {
    ...row,
    paidAmount: round2(paid + pay),
    schedule,
    updatedAt: new Date().toISOString(),
  };

  await offlineDueEntries.put(next);
  notifyLocalDataChanged(userId);
  return { dueEntry: stripSync<DueEntry>(next) };
}

// ============ CASH BOOK (Local — admin Cash section) ============

export interface CashLedgerEntry {
  id: string;
  kind: 'sale' | 'invest' | 'expense';
  date: string;      // YYYY-MM-DD
  at: number;        // createdAt epoch ms (tie-breaker within a day)
  title: string;     // bill no · customer / product name / purpose / category
  sub: string;       // optional extra info (raw, UI localizes the prefix)
  cashIn: number;
  cashOut: number;
  profit: number;    // sales only (FIFO snapshot)
  due: number;       // bills only — unpaid portion (NOT in cash yet)
}

export interface CashBook {
  balance: number;    // cash in hand = salesIn + investIn − expenseOut
  salesIn: number;    // collected sale money (sell amount, profit included)
  investIn: number;   // Others Invest total
  expenseOut: number; // Expenses total
  todayIn: number;
  todayOut: number;
  entries: CashLedgerEntry[];
}

/**
 * The admin Cash Book — ONE merged ledger of every rupee that moves cash:
 *  - Sales: each bill contributes what was actually COLLECTED (paidAmount);
 *    due collections later raise paidAmount, so collecting a due adds cash
 *    automatically. Sale transactions WITHOUT a bill (Stock-Out / quick SELL)
 *    contribute their full amount. Profit (FIFO snapshot) rides along for display.
 *  - Others Invest: cash added into the business for any other purpose (+).
 *  - Expenses: every expense takes cash out (−).
 */
export async function getCashBookOffline(userId: string, options?: { limit?: number }): Promise<CashBook> {
  const [localBills, localTxns, localExpenses, localInvestments, localProducts] = await Promise.all([
    offlineBills.getAll(userId),
    offlineTransactions.getAll(userId),
    offlineExpenses.getAll(userId),
    offlineInvestments.getAll(userId),
    offlineProducts.getAll(userId),
  ]);

  const products = localProducts.map(p => stripSync<Product>(p));
  const txns = localTxnsToTransactions(localTxns);
  const txnById = new Map(txns.map(t => [t.id, t]));
  const billTxnIds = new Set(
    localBills.map(b => b.transactionId).filter((x): x is string => typeof x === 'string' && x !== '')
  );

  const fifoProfit = (t: Transaction): number =>
    round2((t.totalAmount || 0) - (t.quantity || 0) * txnCostBasis(t, products));

  const entries: CashLedgerEntry[] = [];

  // 1) Bills — collected money (paidAmount). Dues are NOT cash yet; when the
  //    due is collected (markBillPaidOffline) paidAmount rises and this entry
  //    grows — cash follows reality with zero extra bookkeeping.
  for (const b of localBills) {
    const paid = round2(Number(b.paidAmount) || 0);
    if (paid <= 0) continue; // pure-due bill — nothing in cash yet
    const tx = b.transactionId ? txnById.get(b.transactionId) : undefined;
    const due = round2(Number(b.dueAmount) || 0);
    entries.push({
      id: `b:${b.id}`,
      kind: 'sale',
      date: b.date,
      at: Date.parse(b.createdAt) || 0,
      title: `${b.billNumber || '—'} · ${b.customerName || 'Walk-in'}`,
      sub: due > 0 ? String(due) : '',
      cashIn: paid,
      cashOut: 0,
      profit: tx ? fifoProfit(tx) : 0,
      due,
    });
  }

  // 2) Sale transactions not documented by any bill (Stock-Out / instant SELL)
  //    — the full sell amount (profit included) lands in cash.
  for (const t of txns) {
    if (!isSaleType(t.type)) continue;
    if (billTxnIds.has(t.id)) continue; // the bill entry above already counts it
    entries.push({
      id: `t:${t.id}`,
      kind: 'sale',
      date: t.date,
      at: Date.parse(t.createdAt) || 0,
      title: t.product?.name || 'Sale',
      sub: String(t.quantity || 0),
      cashIn: round2(t.totalAmount || 0),
      cashOut: 0,
      profit: fifoProfit(t),
      due: 0,
    });
  }

  // 3) Others Invest — extra cash brought into the business (+)
  for (const inv of localInvestments) {
    entries.push({
      id: `i:${inv.id}`,
      kind: 'invest',
      date: inv.date,
      at: Date.parse(inv.createdAt) || 0,
      title: inv.purpose || 'Others Invest',
      sub: inv.note || '',
      cashIn: round2(Number(inv.amount) || 0),
      cashOut: 0,
      profit: 0,
      due: 0,
    });
  }

  // 4) Expenses — cash leaves the box (−)
  for (const e of localExpenses) {
    entries.push({
      id: `e:${e.id}`,
      kind: 'expense',
      date: e.date,
      at: Date.parse(e.createdAt) || 0,
      title: e.category || 'Expense',
      sub: e.description || '',
      cashIn: 0,
      cashOut: round2(Number(e.amount) || 0),
      profit: 0,
      due: 0,
    });
  }

  entries.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return b.at - a.at;
  });

  const today = localDateStr();
  let salesIn = 0, investIn = 0, expenseOut = 0, todayIn = 0, todayOut = 0;
  for (const e of entries) {
    if (e.kind === 'sale') salesIn += e.cashIn;
    else if (e.kind === 'invest') investIn += e.cashIn;
    else expenseOut += e.cashOut;
    if (e.date === today) {
      todayIn += e.cashIn;
      todayOut += e.cashOut;
    }
  }

  return {
    balance: round2(salesIn + investIn - expenseOut),
    salesIn: round2(salesIn),
    investIn: round2(investIn),
    expenseOut: round2(expenseOut),
    todayIn: round2(todayIn),
    todayOut: round2(todayOut),
    entries: entries.slice(0, options?.limit ?? 400),
  };
}

// ============ EXPENSES (Local) ============

export async function getExpensesOffline(userId: string, options?: { period?: string; date?: string; from?: string; to?: string; category?: string }) {
  let localExpenses = await offlineExpenses.getAll(userId);

  // Honor the reporting period exactly — otherwise "Today" would show all-time totals.
  const { from, to } = resolvePeriodRange(options);
  localExpenses = localExpenses.filter(e => e.date >= from && e.date <= to);
  if (options?.category) localExpenses = localExpenses.filter(e => e.category === options.category);

  const expenses = localExpenses
    .map(e => stripSync<Expense>(e))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const totalExpense = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const byCategory = expenses.reduce((acc, e) => {
    const cat = e.category || 'other';
    acc[cat] = (acc[cat] || 0) + (e.amount || 0);
    return acc;
  }, {} as Record<string, number>);

  return {
    expenses,
    summary: { totalExpense, byCategory, count: expenses.length },
  };
}

export async function createExpenseOffline(expenseData: {
  userId: string;
  date: string;
  amount: number;
  category?: string;
  description?: string;
}): Promise<{ expense: Expense }> {
  const amount = Number(expenseData.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Expense amount must be greater than 0');

  const now = new Date().toISOString();
  const expense = {
    id: generateRecordId(),
    userId: expenseData.userId,
    date: expenseData.date || localDateStr(),
    amount,
    category: expenseData.category || 'other',
    description: expenseData.description || '',
    createdAt: now,
    updatedAt: now,
  };

  await offlineExpenses.put({
    ...expense,
    _synced: Date.now(),
    _dirty: 0,
  });

  notifyLocalDataChanged(expenseData.userId);
  return { expense };
}

export async function updateExpenseOffline(id: string, updates: { amount?: number; category?: string; description?: string }, userId: string): Promise<{ expense: Expense }> {
  const allExpenses = await offlineExpenses.getAll(userId);
  const existing = allExpenses.find(e => e.id === id);
  if (!existing) throw new Error('Expense not found');

  if (updates.amount !== undefined) {
    const amount = Number(updates.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Expense amount must be greater than 0');
  }

  const updatedExpense = {
    ...existing,
    ...(updates.amount !== undefined ? { amount: Number(updates.amount) } : {}),
    ...(updates.category !== undefined ? { category: updates.category } : {}),
    ...(updates.description !== undefined ? { description: updates.description } : {}),
    updatedAt: new Date().toISOString(),
  };

  await offlineExpenses.put({
    ...updatedExpense,
    _synced: Date.now(),
    _dirty: 0,
  });

  notifyLocalDataChanged(userId);
  return { expense: stripSync<Expense>(updatedExpense) };
}

export async function deleteExpenseOffline(id: string, userId: string): Promise<{ success: boolean }> {
  // Ownership check — ignore requests for rows belonging to another account.
  const db = await getOfflineDB();
  const row = await db.get('expenses', id);
  if (!row || (userId && row.userId !== userId)) throw new Error('Not found');
  await offlineExpenses.delete(id);
  await recordPendingDelete('expenses', id, userId);
  notifyLocalDataChanged(userId);
  return { success: true };
}

// ============ STAFF PAYMENTS (Local, synced via D1) ============

const STAFF_KINDS: StaffPaymentKind[] = ['salary', 'advance', 'bonus', 'other'];

function normalizeStaffKind(k: unknown): StaffPaymentKind {
  return STAFF_KINDS.includes(k as StaffPaymentKind) ? (k as StaffPaymentKind) : 'other';
}

export async function getStaffPaymentsOffline(
  userId: string,
  options?: { from?: string; to?: string; staff?: string }
): Promise<{
  staffPayments: StaffPayment[];
  summary: { total: number; count: number; byStaff: { name: string; total: number; count: number }[] };
}> {
  let rows = await offlineStaffPayments.getAll(userId);
  if (options?.from) rows = rows.filter(p => p.date >= options.from!);
  if (options?.to) rows = rows.filter(p => p.date <= options.to!);
  if (options?.staff) {
    const q = options.staff.trim().toLowerCase();
    if (q) rows = rows.filter(p => (p.staffName || '').toLowerCase().includes(q));
  }
  const staffPayments = rows
    .map(p => stripSync<StaffPayment>(p))
    .sort((a, b) => (a.date === b.date ? String(b.createdAt).localeCompare(String(a.createdAt)) : b.date.localeCompare(a.date)));
  const total = staffPayments.reduce((s, p) => s + (p.amount || 0), 0);
  const staffMap = new Map<string, { name: string; total: number; count: number }>();
  for (const p of staffPayments) {
    const key = (p.staffName || '—').trim();
    const e = staffMap.get(key) || { name: key, total: 0, count: 0 };
    e.total += p.amount || 0;
    e.count += 1;
    staffMap.set(key, e);
  }
  const byStaff = [...staffMap.values()].sort((a, b) => b.total - a.total);
  return { staffPayments, summary: { total, count: staffPayments.length, byStaff } };
}

export async function createStaffPaymentOffline(data: {
  userId: string;
  date?: string;
  staffName: string;
  staffPhone?: string;
  kind?: StaffPaymentKind;
  amount: number;
  note?: string;
}): Promise<{ staffPayment: StaffPayment }> {
  const staffName = (data.staffName || '').trim();
  if (!staffName) throw new Error('Staff name is required');
  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment amount must be greater than 0');

  const now = new Date().toISOString();
  const row = {
    id: generateRecordId(),
    userId: data.userId,
    date: data.date || localDateStr(),
    staffName,
    staffPhone: (data.staffPhone || '').trim(),
    kind: normalizeStaffKind(data.kind),
    amount,
    note: (data.note || '').trim(),
    createdAt: now,
    updatedAt: now,
  };

  await offlineStaffPayments.put({ ...row, _synced: Date.now(), _dirty: 0 });
  notifyLocalDataChanged(data.userId);
  return { staffPayment: row };
}

export async function updateStaffPaymentOffline(
  id: string,
  updates: { date?: string; staffName?: string; staffPhone?: string; kind?: StaffPaymentKind; amount?: number; note?: string },
  userId: string
): Promise<{ staffPayment: StaffPayment }> {
  const all = await offlineStaffPayments.getAll(userId);
  const existing = all.find(p => p.id === id);
  if (!existing) throw new Error('Staff payment not found');

  let amount = existing.amount;
  if (updates.amount !== undefined) {
    amount = Number(updates.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment amount must be greater than 0');
  }
  const staffName = updates.staffName !== undefined ? updates.staffName.trim() : existing.staffName;
  if (!staffName) throw new Error('Staff name is required');

  const updated = {
    ...existing,
    ...(updates.date !== undefined ? { date: updates.date || existing.date } : {}),
    staffName,
    ...(updates.staffPhone !== undefined ? { staffPhone: updates.staffPhone.trim() } : {}),
    ...(updates.kind !== undefined ? { kind: normalizeStaffKind(updates.kind) } : {}),
    amount,
    ...(updates.note !== undefined ? { note: updates.note.trim() } : {}),
    updatedAt: new Date().toISOString(),
  };

  await offlineStaffPayments.put({ ...updated, _synced: Date.now(), _dirty: 0 });
  notifyLocalDataChanged(userId);
  return { staffPayment: stripSync<StaffPayment>(updated) };
}

export async function deleteStaffPaymentOffline(id: string, userId: string): Promise<{ success: boolean }> {
  const db = await getOfflineDB();
  const row = await db.get('staffPayments', id);
  if (!row || (userId && row.userId !== userId)) throw new Error('Not found');
  await offlineStaffPayments.delete(id);
  await recordPendingDelete('staffPayments', id, userId);
  notifyLocalDataChanged(userId);
  return { success: true };
}

// ============ CASH ENTRIES (Local) ============

export async function getCashEntriesOffline(userId: string, options?: { period?: string; date?: string; from?: string; to?: string }) {
  let localEntries = await offlineCashEntries.getAll(userId);

  // Honor the reporting period.
  const { from, to } = resolvePeriodRange(options);
  localEntries = localEntries.filter(e => e.date >= from && e.date <= to);

  const entries = localEntries
    .map(e => stripSync<CashEntry>(e))
    .sort((a, b) => b.date.localeCompare(a.date));
  // Balance semantics: the LATEST entry in the filtered period holds the running balance.
  const latest = entries[0];
  const totalHandCash = latest?.handCash || 0;
  const totalLiquidCash = latest?.liquidCash || 0;

  return {
    entries,
    summary: { totalHandCash, totalLiquidCash, totalCash: totalHandCash + totalLiquidCash },
  };
}

export async function upsertCashEntryOffline(entryData: {
  userId: string;
  date: string;
  handCash?: number;
  liquidCash?: number;
  note?: string;
}): Promise<{ entry: CashEntry }> {
  for (const value of [entryData.handCash, entryData.liquidCash]) {
    if (value !== undefined) {
      const num = Number(value);
      if (!Number.isFinite(num) || num < 0) throw new Error('Cash amounts cannot be negative');
    }
  }

  const now = new Date().toISOString();

  // One balance entry per date — upsert by date.
  // Read + write happen in ONE readwrite transaction so two rapid saves for
  // the same date can never both miss `existing` and insert duplicates.
  const db = await getOfflineDB();
  const tx = db.transaction('cashEntries', 'readwrite');
  const allEntries = await tx.objectStore('cashEntries').index('by-userId').getAll(entryData.userId);
  const existing = allEntries.find(e => e.date === entryData.date);

  if (existing) {
    const updated = {
      ...existing,
      handCash: entryData.handCash !== undefined ? Number(entryData.handCash) : existing.handCash,
      liquidCash: entryData.liquidCash !== undefined ? Number(entryData.liquidCash) : existing.liquidCash,
      note: entryData.note !== undefined ? entryData.note : existing.note,
      updatedAt: now,
    };

    await tx.objectStore('cashEntries').put({
      ...updated,
      _synced: Date.now(),
      _dirty: 0,
    });

    notifyLocalDataChanged(entryData.userId);
    return { entry: stripSync<CashEntry>(updated) };
  }

  const newEntry = {
    id: generateRecordId(),
    userId: entryData.userId,
    date: entryData.date,
    handCash: Number(entryData.handCash ?? 0),
    liquidCash: Number(entryData.liquidCash ?? 0),
    note: entryData.note || '',
    createdAt: now,
    updatedAt: now,
  };

  await tx.objectStore('cashEntries').put({
    ...newEntry,
    _synced: Date.now(),
    _dirty: 0,
  });

  notifyLocalDataChanged(entryData.userId);
  return { entry: newEntry };
}

export async function updateCashEntryOffline(id: string, updates: { handCash?: number; liquidCash?: number; note?: string }, userId: string): Promise<{ entry: CashEntry }> {
  const allEntries = await offlineCashEntries.getAll(userId);
  const existing = allEntries.find(e => e.id === id);
  if (!existing) throw new Error('Cash entry not found');

  for (const value of [updates.handCash, updates.liquidCash]) {
    if (value !== undefined) {
      const num = Number(value);
      if (!Number.isFinite(num) || num < 0) throw new Error('Cash amounts cannot be negative');
    }
  }

  const updatedEntry = {
    ...existing,
    ...(updates.handCash !== undefined ? { handCash: Number(updates.handCash) } : {}),
    ...(updates.liquidCash !== undefined ? { liquidCash: Number(updates.liquidCash) } : {}),
    ...(updates.note !== undefined ? { note: updates.note } : {}),
    updatedAt: new Date().toISOString(),
  };

  await offlineCashEntries.put({
    ...updatedEntry,
    _synced: Date.now(),
    _dirty: 0,
  });

  notifyLocalDataChanged(userId);
  return { entry: stripSync<CashEntry>(updatedEntry) };
}

export async function deleteCashEntryOffline(id: string, userId: string): Promise<{ success: boolean }> {
  // Ownership check — ignore requests for rows belonging to another account.
  const db = await getOfflineDB();
  const row = await db.get('cashEntries', id);
  if (!row || (userId && row.userId !== userId)) throw new Error('Not found');
  await offlineCashEntries.delete(id);
  await recordPendingDelete('cashEntries', id, userId);
  notifyLocalDataChanged(userId);
  return { success: true };
}

// ============ REPORTS (Local) ============

export async function getReportsOffline(userId: string, type: string, options?: { from?: string; to?: string }) {
  const [localProducts, localCategories, localTransactions] = await Promise.all([
    offlineProducts.getAll(userId),
    offlineCategories.getAll(userId),
    offlineTransactions.getAll(userId),
  ]);

  const products = localProducts.map(p => stripSync<Product>(p));
  const categories = localCategories.map(c => stripSync<Category>(c));
  const transactions = localTxnsToTransactions(localTransactions);

  // Apply date filters
  let filteredTxns = transactions;
  if (options?.from) filteredTxns = filteredTxns.filter(t => t.date >= options.from!);
  if (options?.to) filteredTxns = filteredTxns.filter(t => t.date <= options.to!);

  if (type === 'stock-value') {
    const stockValueData = categories.map(cat => {
      const catProducts = products.filter(p => p.categoryId === cat.id);
      const totalQty = catProducts.reduce((sum, p) => sum + p.quantity, 0);
      const totalPurchaseValue = catProducts.reduce((sum, p) => sum + p.quantity * p.purchasePrice, 0);
      const totalSellingValue = catProducts.reduce((sum, p) => sum + p.quantity * p.sellingPrice, 0);
      const totalProfit = totalSellingValue - totalPurchaseValue;
      const lowStockCount = catProducts.filter(p => p.quantity <= p.lowStockThreshold).length;

      return {
        categoryId: cat.id,
        categoryName: cat.name,
        categoryImage: cat.image,
        productCount: catProducts.length,
        totalQty,
        totalPurchaseValue,
        totalSellingValue,
        totalProfit,
        lowStockCount,
        products: catProducts.map(p => ({
          id: p.id,
          name: p.name,
          quantity: p.quantity,
          purchasePrice: p.purchasePrice,
          sellingPrice: p.sellingPrice,
          stockValue: p.quantity * p.purchasePrice,
          purchaseValue: p.quantity * p.purchasePrice,
          lowStock: p.quantity <= p.lowStockThreshold,
        })),
      };
    }).filter(item => item.productCount > 0);

    const grandTotal = {
      totalProducts: stockValueData.reduce((s, d) => s + d.productCount, 0),
      totalQty: stockValueData.reduce((s, d) => s + d.totalQty, 0),
      totalPurchaseValue: stockValueData.reduce((s, d) => s + d.totalPurchaseValue, 0),
      totalSellingValue: stockValueData.reduce((s, d) => s + d.totalSellingValue, 0),
      totalProfit: stockValueData.reduce((s, d) => s + d.totalProfit, 0),
      totalLowStock: stockValueData.reduce((s, d) => s + d.lowStockCount, 0),
    };

    return { type: 'stock-value', data: stockValueData, grandTotal };
  }

  // Daily report
  if (type === 'daily') {
    const dailyMap = new Map<string, {
      date: string; revenue: number; cost: number; profit: number;
      stockIn: number; stockOut: number; sell: number;
    }>();

    for (const t of filteredTxns) {
      if (!dailyMap.has(t.date)) {
        dailyMap.set(t.date, { date: t.date, revenue: 0, cost: 0, profit: 0, stockIn: 0, stockOut: 0, sell: 0 });
      }
      const entry = dailyMap.get(t.date)!;
      const costBasis = txnCostBasis(t, products);

      // SELL *and* STOCK_OUT earn revenue — everyday sales are recorded via
      // Stock Out, so reports must match the Dashboard/Profit surfaces.
      if (isSaleType(t.type)) {
        entry.revenue += t.totalAmount || 0;
        entry.cost += (t.quantity || 0) * costBasis;
        entry.profit += (t.totalAmount || 0) - (t.quantity || 0) * costBasis;
        entry.sell += t.quantity || 0;
      }
      if (t.type === 'STOCK_IN') {
        entry.cost += (t.quantity || 0) * (t.unitPrice || 0);
        entry.stockIn += t.quantity || 0;
      }
      if (t.type === 'STOCK_OUT') {
        entry.stockOut += t.quantity || 0;
      }
    }

    const values = Array.from(dailyMap.values());
    return {
      type: 'daily',
      data: values.sort((a, b) => b.date.localeCompare(a.date)),
      grandTotal: {
        totalRevenue: values.reduce((s, d) => s + d.revenue, 0),
        totalCost: values.reduce((s, d) => s + d.cost, 0),
        totalProfit: values.reduce((s, d) => s + d.profit, 0),
        totalStockIn: values.reduce((s, d) => s + d.stockIn, 0),
        totalStockOut: values.reduce((s, d) => s + d.stockOut, 0),
        totalSell: values.reduce((s, d) => s + d.sell, 0),
      },
    };
  }

  // Monthly report
  if (type === 'monthly') {
    const monthlyMap = new Map<string, {
      month: string; revenue: number; cost: number; profit: number;
      stockIn: number; stockOut: number; sell: number;
    }>();

    for (const t of filteredTxns) {
      const month = t.date.substring(0, 7); // YYYY-MM
      if (!monthlyMap.has(month)) {
        monthlyMap.set(month, { month, revenue: 0, cost: 0, profit: 0, stockIn: 0, stockOut: 0, sell: 0 });
      }
      const entry = monthlyMap.get(month)!;
      const costBasis = txnCostBasis(t, products);

      if (isSaleType(t.type)) {
        entry.revenue += t.totalAmount || 0;
        entry.cost += (t.quantity || 0) * costBasis;
        entry.profit += (t.totalAmount || 0) - (t.quantity || 0) * costBasis;
        entry.sell += t.quantity || 0;
      }
      if (t.type === 'STOCK_IN') {
        entry.cost += (t.quantity || 0) * (t.unitPrice || 0);
        entry.stockIn += t.quantity || 0;
      }
      if (t.type === 'STOCK_OUT') {
        entry.stockOut += t.quantity || 0;
      }
    }

    const values = Array.from(monthlyMap.values());
    return {
      type: 'monthly',
      data: values.sort((a, b) => b.month.localeCompare(a.month)),
      grandTotal: {
        totalRevenue: values.reduce((s, d) => s + d.revenue, 0),
        totalCost: values.reduce((s, d) => s + d.cost, 0),
        totalProfit: values.reduce((s, d) => s + d.profit, 0),
        totalStockIn: values.reduce((s, d) => s + d.stockIn, 0),
        totalStockOut: values.reduce((s, d) => s + d.stockOut, 0),
        totalSell: values.reduce((s, d) => s + d.sell, 0),
      },
    };
  }

  // Category report
  if (type === 'category') {
    const categoryMap = new Map<string, {
      categoryId: string; categoryName: string;
      revenue: number; cost: number; profit: number;
      stockIn: number; stockOut: number; sell: number; quantity: number;
    }>();

    for (const t of filteredTxns) {
      const product = products.find(p => p.id === t.productId) ?? (t.product ? ({ ...t.product, categoryId: '', createdAt: '', updatedAt: '', boxNumber: '', lowStockThreshold: 0, quantity: 0, userId: '' } as Product) : undefined);
      const cat = categories.find(c => c.id === product?.categoryId);
      const catId = cat?.id || 'unknown';
      const catName = cat?.name || 'Unknown';

      if (!categoryMap.has(catId)) {
        categoryMap.set(catId, { categoryId: catId, categoryName: catName, revenue: 0, cost: 0, profit: 0, stockIn: 0, stockOut: 0, sell: 0, quantity: 0 });
      }
      const entry = categoryMap.get(catId)!;
      const costBasis = txnCostBasis(t, products);

      if (isSaleType(t.type)) {
        entry.revenue += t.totalAmount || 0;
        entry.cost += (t.quantity || 0) * costBasis;
        entry.profit += (t.totalAmount || 0) - (t.quantity || 0) * costBasis;
        entry.sell += t.quantity || 0;
      }
      if (t.type === 'STOCK_IN') {
        entry.cost += (t.quantity || 0) * (t.unitPrice || 0);
        entry.stockIn += t.quantity || 0;
        entry.quantity += t.quantity || 0;
      }
      if (t.type === 'STOCK_OUT') {
        entry.stockOut += t.quantity || 0;
        entry.quantity += t.quantity || 0;
      }
    }

    const values = Array.from(categoryMap.values());
    return {
      type: 'category',
      data: values.sort((a, b) => b.revenue - a.revenue),
      grandTotal: {
        totalRevenue: values.reduce((s, d) => s + d.revenue, 0),
        totalCost: values.reduce((s, d) => s + d.cost, 0),
        totalProfit: values.reduce((s, d) => s + d.profit, 0),
        totalStockIn: values.reduce((s, d) => s + d.stockIn, 0),
        totalStockOut: values.reduce((s, d) => s + d.stockOut, 0),
        totalSell: values.reduce((s, d) => s + d.sell, 0),
        totalQuantity: values.reduce((s, d) => s + d.quantity, 0),
      },
    };
  }

  return { type, data: [], grandTotal: {} };
}

// ============ PROFILE (Local) ============

export async function getProfileOffline(userId: string) {
  const user = await getLocalUser(userId);
  return user ? { user } : null;
}

export async function updateProfileOffline(id: string, updates: { name?: string; shopName?: string; language?: string; theme?: string }) {
  const user = await updateLocalUser(id, updates);
  return { user };
}

// ============ SERVICE TRANSACTIONS (Local) ============

export async function getServiceTransactionsOffline(userId: string, options?: { categoryType?: ServiceCategoryType; from?: string; to?: string }): Promise<ServiceTransaction[]> {
  let localTxns = await offlineServiceTransactions.getAll(userId);

  if (options?.categoryType) localTxns = localTxns.filter(t => t.categoryType === options.categoryType);
  if (options?.from) localTxns = localTxns.filter(t => t.date >= options.from!);
  if (options?.to) localTxns = localTxns.filter(t => t.date <= options.to!);

  return localTxns
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(t => stripSync<ServiceTransaction>(t));
}

export async function createServiceTransactionOffline(data: {
  categoryType: ServiceCategoryType;
  transactionType: 'income' | 'expense';
  amount: number;
  purpose: string;
  userId: string;
}): Promise<{ serviceTransaction: ServiceTransaction }> {
  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be greater than 0');
  if (!data.purpose.trim()) throw new Error('Purpose is required');

  const now = new Date().toISOString();
  const serviceTransaction = {
    id: generateRecordId(),
    userId: data.userId,
    categoryType: data.categoryType,
    transactionType: data.transactionType,
    amount,
    purpose: data.purpose.trim(),
    date: localDateStr(),
    createdAt: now,
    updatedAt: now,
  };

  await offlineServiceTransactions.put({
    ...serviceTransaction,
    _synced: Date.now(),
    _dirty: 0,
  });

  notifyLocalDataChanged(data.userId);
  return { serviceTransaction };
}

export async function deleteServiceTransactionOffline(id: string, userId: string): Promise<{ success: boolean }> {
  // Ownership check — ignore requests for rows belonging to another account.
  const db = await getOfflineDB();
  const row = await db.get('serviceTransactions', id);
  if (!row || (userId && row.userId !== userId)) throw new Error('Not found');
  await offlineServiceTransactions.delete(id);
  await recordPendingDelete('serviceTransactions', id, userId);
  notifyLocalDataChanged(userId);
  return { success: true };
}

// ============ BILLS (e-Bill / Invoice) ============

export const DEFAULT_BILLING_SETTINGS: Omit<BillingSettings, 'userId' | 'updatedAt'> = {
  shopName: 'PS TELECOM',
  proprietorName: 'Avijit Maity & Brother',
  shopAddress: '',
  shopPhone: '',
  gstNumber: '',
  gstEnabled: false,
  gstRate: 18,
  gstMode: 'inclusive', // entered amount = final amount (shop owner's requested behaviour)
  defaultDiscountPercent: 0,
  upiId: '',
  signatureDataUrl: '',
  qrCodeDataUrl: '',
  billPrefix: 'PS',
  thankYouNote: 'Thank you for your business!',
  termsText: '',
  adminPin: '9732881732', // admin panel security PIN (change in Bill Settings)
};

export async function getBillingSettingsOffline(userId: string): Promise<BillingSettings> {
  const db = await getOfflineDB();
  const existing = await db.get('billingSettings', userId);
  if (existing) return { ...existing, gstMode: normalizeGstMode(existing.gstMode) };
  return {
    ...DEFAULT_BILLING_SETTINGS,
    userId,
    updatedAt: new Date().toISOString(),
  };
}

export async function saveBillingSettingsOffline(userId: string, updates: Partial<Omit<BillingSettings, 'userId' | 'updatedAt'>>): Promise<BillingSettings> {
  const current = await getBillingSettingsOffline(userId);
  const next: BillingSettings = {
    ...current,
    ...updates,
    // Never allow blank shop name — bill header must always render
    shopName: (updates.shopName ?? current.shopName).trim() || DEFAULT_BILLING_SETTINGS.shopName,
    gstRate: clampNumber(updates.gstRate ?? current.gstRate, 0, 100),
    gstMode: normalizeGstMode(updates.gstMode ?? current.gstMode),
    defaultDiscountPercent: clampNumber(updates.defaultDiscountPercent ?? current.defaultDiscountPercent, 0, 100),
    adminPin: (updates.adminPin ?? current.adminPin ?? '').replace(/\D/g, '').slice(0, 12) || '9732881732',
    userId,
    updatedAt: new Date().toISOString(),
  };
  const db = await getOfflineDB();
  await db.put('billingSettings', next);
  notifyLocalDataChanged(userId);
  return next;
}

function clampNumber(value: number, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

/**
 * Generates the next sequential bill number: PREFIX-YYMM-0001.
 * Runs against rows already fetched inside the SAME transaction that will save
 * the new bill (no read-then-write race), and skips any number that is already
 * taken (e.g. numbers that arrived via a restore/import) so duplicates are
 * impossible.
 */
function nextBillNumberFromRows(
  bills: OfflineDBSchema['bills']['value'][],
  prefix: string
): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const monthPrefix = `${prefix}-${yy}${mm}-`;
  let maxSeq = 0;
  const taken = new Set<string>();
  for (const b of bills) {
    if (typeof b.billNumber === 'string' && b.billNumber.startsWith(monthPrefix)) {
      taken.add(b.billNumber);
      const seq = parseInt(b.billNumber.slice(monthPrefix.length), 10);
      if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
    }
  }
  let seq = maxSeq + 1;
  let candidate = `${monthPrefix}${String(seq).padStart(4, '0')}`;
  while (taken.has(candidate)) {
    seq += 1;
    candidate = `${monthPrefix}${String(seq).padStart(4, '0')}`;
  }
  return candidate;
}

export async function createBillOffline(data: {
  userId: string;
  transactionId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  /** Serial(s) the customer bought — printed on the receipt under the item. */
  soldSerials?: string[];
  customerName?: string;
  customerMobile?: string;
  /** Optional address line — printed in the Bill-To box (v2.25). */
  customerAddress?: string;
  discountType?: 'amount' | 'percent';
  discountValue?: number;
  paymentMethod?: PaymentMethod;
  paidAmount?: number;
  note?: string;
  date?: string;
}): Promise<{ bill: Bill }> {
  const qty = Math.floor(Number(data.quantity));
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Quantity must be a positive whole number');
  const unitPrice = Number(data.unitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('Price cannot be negative');

  const settings = await getBillingSettingsOffline(data.userId);

  // Resolve the product's CATEGORY so the invoice can print it under the
  // item name ("bill e category ashe"). A missing product/category (e.g.
  // a transaction pointing at data deleted long ago) simply skips the line.
  let categoryName = '';
  try {
    const db = await getOfflineDB();
    const prod = await db.get('products', data.productId);
    if (prod && prod.userId === data.userId && prod.categoryId) {
      const cat = await db.get('categories', prod.categoryId);
      if (cat && cat.userId === data.userId) categoryName = String(cat.name || '').trim();
    }
  } catch { /* category is cosmetic — never block the bill */ }

  const discountType = data.discountType === 'percent' ? 'percent' : 'amount';
  let discountValue = Math.max(0, Number(data.discountValue ?? 0) || 0);
  const subtotal = round2(qty * unitPrice);

  let discountAmount = 0;
  if (discountType === 'percent') {
    discountValue = clampNumber(discountValue, 0, 100);
    discountAmount = round2((subtotal * discountValue) / 100);
  } else {
    discountAmount = round2(Math.min(discountValue, subtotal));
  }

  const gstEnabled = !!settings.gstEnabled && !!settings.gstNumber.trim() && settings.gstRate > 0;
  const gstMode = normalizeGstMode(settings.gstMode);
  const afterDiscount = round2(subtotal - discountAmount);
  const breakup = gstEnabled
    ? computeGst(afterDiscount, settings.gstRate, gstMode)
    : { taxable: afterDiscount, gstAmount: 0, cgst: 0, sgst: 0, total: afterDiscount };
  const total = breakup.total;

  const paymentMethod: PaymentMethod = data.paymentMethod ?? 'cash';
  let paidAmount = data.paidAmount === undefined ? total : Math.max(0, Number(data.paidAmount) || 0);
  if (paymentMethod === 'due') paidAmount = 0;
  paidAmount = round2(Math.min(paidAmount, total));
  const dueAmount = round2(total - paidAmount);

  const now = new Date().toISOString();

  // Atomic bill creation: the duplicate-transaction guard, the bill-number
  // allocation and the save run inside ONE IndexedDB transaction, so a
  // double-tap or racing call can never mint two bills for one stock-out
  // transaction or allocate the same number twice.
  const db = await getOfflineDB();
  const tx = db.transaction('bills', 'readwrite');
  const billsOs = tx.objectStore('bills');
  const existingBills = await billsOs.index('by-userId').getAll(data.userId);

  const dupe = existingBills.find(b => b.transactionId === data.transactionId);
  if (dupe) throw new Error('A bill already exists for this transaction');

  const billNumber = nextBillNumberFromRows(existingBills, settings.billPrefix.trim() || 'PS');

  const bill: OfflineDBSchema['bills']['value'] = {
    id: generateRecordId(),
    userId: data.userId,
    billNumber,
    customerName: (data.customerName ?? '').trim() || 'Walk-in Customer',
    customerMobile: (data.customerMobile ?? '').replace(/[^\d+]/g, ''),
    ...((data.customerAddress ?? '').trim() ? { customerAddress: (data.customerAddress ?? '').trim() } : {}),
    items: [
      {
        productId: data.productId,
        name: data.productName,
        ...(categoryName ? { categoryName } : {}),
        quantity: qty,
        unitPrice,
        total: subtotal,
        ...(data.soldSerials?.length ? { serialNumbers: normalizeSerialList(data.soldSerials) } : {}),
      },
    ],
    subtotal,
    discountValue,
    discountType,
    discountAmount,
    gstEnabled,
    gstRate: gstEnabled ? settings.gstRate : 0,
    gstAmount: breakup.gstAmount,
    ...(gstEnabled
      ? { gstMode, taxableValue: breakup.taxable, cgstAmount: breakup.cgst, sgstAmount: breakup.sgst }
      : {}),
    total,
    paymentMethod,
    paidAmount,
    dueAmount,
    note: (data.note ?? '').trim(),
    transactionId: data.transactionId,
    shopSnapshot: {
      name: settings.shopName,
      proprietorName: settings.proprietorName,
      address: settings.shopAddress,
      phone: settings.shopPhone,
      gstNumber: settings.gstNumber,
    },
    date: data.date || localDateStr(),
    createdAt: now,
    updatedAt: now,
  };

  void billsOs.put(bill);
  await tx.done;

  notifyLocalDataChanged(data.userId);
  return { bill: bill as unknown as Bill };
}

/**
 * CART CHECKOUT (v2.25) — sells EVERY cart line in ONE atomic IndexedDB
 * transaction: all products are validated first (existence, ownership,
 * stock, serials — including duplicate-serial checks ACROSS lines), then
 * one SELL transaction is written per product and a single multi-item bill
 * is minted. Either the whole cart lands or nothing does — a mid-cart
 * failure can never leave half the stock sold with no bill.
 */
export async function createCartBillOffline(data: {
  userId: string;
  entries: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
    /** Serial(s) of THIS line — required when the product tracks serials. */
    soldSerials?: string[];
  }>;
  customerName?: string;
  customerMobile?: string;
  customerAddress?: string;
  paymentMethod?: PaymentMethod;
  note?: string;
  date?: string;
}): Promise<{ bill: Bill }> {
  if (!data.entries.length) throw new Error('Cart is empty');

  const entries = data.entries.map((e) => ({
    productId: String(e.productId),
    quantity: Math.floor(Number(e.quantity)),
    unitPrice: Number(e.unitPrice) || 0,
    soldSerials: normalizeSerialList(e.soldSerials),
  }));
  for (const e of entries) {
    if (!Number.isFinite(e.quantity) || e.quantity <= 0) throw new Error('Quantity must be a positive whole number');
    if (!Number.isFinite(e.unitPrice) || e.unitPrice < 0) throw new Error('Price cannot be negative');
  }
  // The same physical unit can never appear on two cart lines.
  const seenSerial = new Set<string>();
  for (const e of entries) {
    for (const s of e.soldSerials) {
      const k = s.toLowerCase();
      if (seenSerial.has(k)) throw new Error(`Serial "${s}" is selected more than once`);
      seenSerial.add(k);
    }
  }

  const settings = await getBillingSettingsOffline(data.userId);

  // ---- validate EVERYTHING before a single byte is written ----
  const db = await getOfflineDB();
  const now = new Date().toISOString();

  const prods = new Map<string, OfflineDBSchema['products']['value']>();
  const catNames = new Map<string, string>();
  const byProduct = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = byProduct.get(e.productId) || [];
    list.push(e);
    byProduct.set(e.productId, list);
  }

  for (const [productId, lines] of byProduct) {
    const product = await db.get('products', productId);
    if (!product) throw new Error('Product not found');
    if (product.userId !== data.userId) throw new Error('Product not found');
    const totalQty = lines.reduce((s, e) => s + e.quantity, 0);
    if (product.quantity < totalQty) {
      throw new Error(`Insufficient stock — ${product.name}: only ${product.quantity} left`);
    }
    const inStock = normalizeSerialList(product.serialNumbers);
    const stockSet = new Set(inStock.map((s) => s.toLowerCase()));
    const requested = lines.flatMap((e) => e.soldSerials);
    for (const s of requested) {
      if (!stockSet.has(s.toLowerCase())) {
        throw new Error(`Serial "${s}" is not in stock for this product`);
      }
    }
    if (inStock.length > 0 && requested.length !== Math.min(totalQty, inStock.length)) {
      throw new Error(`Select serial numbers for ${product.name}`);
    }
    if (product.categoryId) {
      const cat = await db.get('categories', product.categoryId);
      if (cat && cat.userId === data.userId && String(cat.name || '').trim()) {
        catNames.set(productId, String(cat.name).trim());
      }
    }
    prods.set(productId, product);
  }

  const gstEnabled = !!settings.gstEnabled && !!settings.gstNumber.trim() && settings.gstRate > 0;
  const gstMode = normalizeGstMode(settings.gstMode);

  // ---- ONE atomic transaction: transactions + products + bills together ----
  const tx = db.transaction(['transactions', 'products', 'bills'], 'readwrite');
  const transactionsStore = tx.objectStore('transactions');
  const productsStore = tx.objectStore('products');
  const billsOs = tx.objectStore('bills');

  const items: BillItem[] = [];
  const createdTxnIds: string[] = [];
  const date = data.date || localDateStr();
  const touched = new Map<string, OfflineDBSchema['products']['value']>();

  for (const [productId, lines] of byProduct) {
    const product = prods.get(productId)!;
    let remaining = normalizeSerialList(product.serialNumbers);
    for (const e of lines) {
      // FIFO cost basis needs the history INSIDE the same atomic tx.
      const history = await transactionsStore.index('by-userId').getAll(data.userId);
      const fifoUnitCost = computeFifoUnitCost(product, history, e.quantity);
      const lineTotal = round2(e.quantity * e.unitPrice);

      const row: OfflineDBSchema['transactions']['value'] = {
        id: generateRecordId(),
        productId,
        type: 'SELL',
        quantity: e.quantity,
        unitPrice: e.unitPrice,
        totalAmount: lineTotal,
        date,
        userId: data.userId,
        createdAt: now,
        product: {
          id: product.id,
          name: product.name,
          purchasePrice: fifoUnitCost,
          sellingPrice: product.sellingPrice,
        },
        _synced: Date.now(),
        _dirty: 0,
      };
      void transactionsStore.put(row);
      createdTxnIds.push(row.id);

      items.push({
        productId,
        name: product.name,
        ...(catNames.get(productId) ? { categoryName: catNames.get(productId) } : {}),
        quantity: e.quantity,
        unitPrice: e.unitPrice,
        total: lineTotal,
        ...(e.soldSerials.length ? { serialNumbers: e.soldSerials } : {}),
      });
    }

    // stock + serial bookkeeping for this product (all its lines at once)
    const totalQty = lines.reduce((s, e) => s + e.quantity, 0);
    const soldSerials = lines.flatMap((e) => e.soldSerials);
    if (soldSerials.length) {
      remaining = remaining.filter((s) => !soldSerials.some((x) => x.toLowerCase() === s.toLowerCase()));
    }
    touched.set(productId, {
      ...product,
      quantity: product.quantity - totalQty,
      ...(soldSerials.length ? { serialNumbers: remaining, serialNumber: remaining[0] ?? '' } : {}),
      updatedAt: now,
    });
  }
  for (const p of touched.values()) void productsStore.put(p);

  const subtotal = round2(items.reduce((s, it) => s + it.total, 0));
  const breakup = gstEnabled
    ? computeGst(subtotal, settings.gstRate, gstMode)
    : { taxable: subtotal, gstAmount: 0, cgst: 0, sgst: 0, total: subtotal };
  const total = breakup.total;

  const paymentMethod: PaymentMethod = data.paymentMethod ?? 'cash';
  const paidAmount = paymentMethod === 'due' ? 0 : total;
  const dueAmount = round2(total - paidAmount);

  const existingBills = await billsOs.index('by-userId').getAll(data.userId);
  const billNumber = nextBillNumberFromRows(existingBills, settings.billPrefix.trim() || 'PS');

  const bill: OfflineDBSchema['bills']['value'] = {
    id: generateRecordId(),
    userId: data.userId,
    billNumber,
    customerName: (data.customerName ?? '').trim() || 'Walk-in Customer',
    customerMobile: (data.customerMobile ?? '').replace(/[^\d+]/g, ''),
    ...((data.customerAddress ?? '').trim() ? { customerAddress: (data.customerAddress ?? '').trim() } : {}),
    items,
    subtotal,
    discountValue: 0,
    discountType: 'amount',
    discountAmount: 0,
    gstEnabled,
    gstRate: gstEnabled ? settings.gstRate : 0,
    gstAmount: breakup.gstAmount,
    ...(gstEnabled
      ? { gstMode, taxableValue: breakup.taxable, cgstAmount: breakup.cgst, sgstAmount: breakup.sgst }
      : {}),
    total,
    paymentMethod,
    paidAmount,
    dueAmount,
    note: (data.note ?? '').trim(),
    transactionId: createdTxnIds[0],
    shopSnapshot: {
      name: settings.shopName,
      proprietorName: settings.proprietorName,
      address: settings.shopAddress,
      phone: settings.shopPhone,
      gstNumber: settings.gstNumber,
    },
    date,
    createdAt: now,
    updatedAt: now,
  };
  void billsOs.put(bill);

  // Commit — ANY failure above rolls back stock, serials, transactions and bill.
  await tx.done;

  notifyLocalDataChanged(data.userId);
  return { bill: bill as unknown as Bill };
}

export async function getBillsOffline(userId: string, options?: { from?: string; to?: string; search?: string }): Promise<Bill[]> {
  let rows = await offlineBills.getAll(userId);
  if (options?.from) rows = rows.filter(b => b.date >= options.from!);
  if (options?.to) rows = rows.filter(b => b.date <= options.to!);
  if (options?.search) {
    const q = options.search.toLowerCase();
    rows = rows.filter(b =>
      b.customerName.toLowerCase().includes(q) ||
      b.customerMobile.includes(q) ||
      b.billNumber.toLowerCase().includes(q) ||
      b.items.some(i => i.name.toLowerCase().includes(q))
    );
  }
  return rows
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .map(b => b as unknown as Bill);
}

export async function getBillByIdOffline(id: string, userId: string): Promise<Bill | null> {
  const db = await getOfflineDB();
  const row = await db.get('bills', id);
  if (!row || row.userId !== userId) return null;
  return row as unknown as Bill;
}

export async function deleteBillOffline(id: string, userId: string): Promise<{ success: boolean }> {
  const db = await getOfflineDB();
  const row = await db.get('bills', id);
  // Fail loudly — a missing/foreign bill must never report success
  // (the caller toasts "Bill deleted" only when the row really went).
  if (!row || row.userId !== userId) throw new Error('Bill not found');
  await db.delete('bills', id);
  await recordPendingDelete('bills', id, userId);
  notifyLocalDataChanged(userId);
  return { success: true };
}

/**
 * Record a payment against a bill's due (Due Book). Passing no amount clears
 * the ENTIRE due (full settlement); a partial amount reduces the due by that
 * much. The updated `updatedAt` makes the D1 push pick the bill up on the
 * next sync — the customer's state reaches every device on the same account.
 */
export async function markBillPaidOffline(
  id: string,
  userId: string,
  amount?: number,
): Promise<{ bill: Bill }> {
  const db = await getOfflineDB();
  const row = await db.get('bills', id);
  if (!row || row.userId !== userId) throw new Error('Bill not found');

  const total = Number(row.total) || 0;
  const due = Number(row.dueAmount) || 0;
  if (due <= 0) throw new Error('This bill has no due left');

  let pay = amount === undefined ? due : round2(Math.max(0, Number(amount) || 0));
  pay = Math.min(pay, due);

  const paidAmount = round2(Math.min(total, (Number(row.paidAmount) || 0) + pay));
  const dueAmount = round2(total - paidAmount);

  const next = {
    ...row,
    paidAmount,
    dueAmount,
    // A full settlement makes the payment obvious in every list/report.
    paymentMethod: dueAmount === 0 && row.paymentMethod === 'due' ? 'cash' : row.paymentMethod,
    updatedAt: new Date().toISOString(),
  } as OfflineDBSchema['bills']['value'];

  await db.put('bills', next);
  notifyLocalDataChanged(userId);
  return { bill: next as unknown as Bill };
}

// ============ BACKUP (Local) ============

export async function exportBackupOffline(userId: string) {
  const [localCategories, localProducts, localTransactions, localExpenses, localCashEntries, localServiceTxns, localBills, localStaffPayments, localInvestments, localDueEntries, billingSettings] = await Promise.all([
    offlineCategories.getAll(userId),
    offlineProducts.getAll(userId),
    offlineTransactions.getAll(userId),
    offlineExpenses.getAll(userId),
    offlineCashEntries.getAll(userId),
    offlineServiceTransactions.getAll(userId),
    offlineBills.getAll(userId),
    offlineStaffPayments.getAll(userId),
    offlineInvestments.getAll(userId),
    offlineDueEntries.getAll(userId),
    getBillingSettingsOffline(userId),
  ]);

  // NOTE: the purchase-price snapshot (`product`) on transactions is kept —
  // stripping it made historical profit silently change after a restore.
  return {
    categories: localCategories.map(c => stripSync(c)),
    products: localProducts.map(p => stripSync(p)),
    transactions: localTransactions.map(t => stripSync(t)),
    expenses: localExpenses.map(e => stripSync(e)),
    cashEntries: localCashEntries.map(e => stripSync(e)),
    serviceTransactions: localServiceTxns.map(s => stripSync(s)),
    bills: localBills.map(b => b),
    staffPayments: localStaffPayments.map(p => stripSync(p)),
    investments: localInvestments.map(i => stripSync(i)),
    dueEntries: localDueEntries.map(d => stripSync(d)),
    billingSettings,
    exportedAt: new Date().toISOString(),
  };
}

export async function importBackupOffline(userId: string, backupData: {
  categories: unknown[];
  products: unknown[];
  transactions: unknown[];
  expenses?: unknown[];
  cashEntries?: unknown[];
  serviceTransactions?: unknown[];
  bills?: unknown[];
  staffPayments?: unknown[];
  investments?: unknown[];
  dueEntries?: unknown[];
  billingSettings?: unknown;
}) {
  const now = Date.now();
  const nowIso = new Date().toISOString();

  // ---- Numeric coercion helpers (same clamps the create* functions use) ----
  const toNum = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  /** Non-negative number — mirrors Math.max(0, Number(x)) || 0 in create*. */
  const numPos = (v: unknown): number => Math.max(0, toNum(v));
  /** Non-negative whole number — mirrors Math.max(0, Math.floor(Number(x))) || 0. */
  const intPos = (v: unknown): number => Math.max(0, Math.floor(toNum(v)) || 0);
  /** Coerces the listed numeric fields (only when present) on a raw backup row. */
  const coerce = (row: Record<string, unknown>, fields: Record<string, 'int' | 'num'>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...row };
    for (const [key, kind] of Object.entries(fields)) {
      if (key in out) out[key] = kind === 'int' ? intPos(out[key]) : numPos(out[key]);
    }
    return out;
  };
  const hasName = (row: Record<string, unknown>): boolean =>
    typeof row.name === 'string' && row.name.trim() !== '';
  /** A hand-edited backup with date: 20251012 (number) would crash every
   *  localeCompare()/date filter later — force date-ish fields to strings. */
  const isoStr = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
  /** Normalizes any date-ish field that is PRESENT in the row to a string. */
  const fixDates = (row: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...row };
    if (out.date !== undefined) out.date = isoStr(out.date);
    if (out.createdAt !== undefined) out.createdAt = isoStr(out.createdAt);
    if (out.updatedAt !== undefined) out.updatedAt = isoStr(out.updatedAt);
    return out;
  };

  // Validate rows: every row MUST have an id — malformed backups must never
  // be written into IndexedDB.
  const asRows = (rows: unknown[]): Record<string, unknown>[] => {
    if (!Array.isArray(rows)) return [];
    return rows.filter((r): r is Record<string, unknown> =>
      !!r && typeof r === 'object' && typeof (r as Record<string, unknown>).id === 'string' && (r as Record<string, unknown>).id !== ''
    );
  };

  const categories = asRows(backupData.categories || []).filter(hasName);
  const products = asRows(backupData.products || []).filter(hasName);
  const transactions = asRows(backupData.transactions || []);
  const expenses = asRows(backupData.expenses || []);
  const cashEntries = asRows(backupData.cashEntries || []);
  const serviceTransactions = asRows(backupData.serviceTransactions || []);
  const bills = asRows(backupData.bills || []);
  const staffPayments = asRows(backupData.staffPayments || []);
  const investments = asRows(backupData.investments || []);
  const dueEntries = asRows(backupData.dueEntries || []);
  const billingSettings = (backupData.billingSettings && typeof backupData.billingSettings === 'object')
    ? backupData.billingSettings as Record<string, unknown>
    : null;

  if (categories.length === 0 && products.length === 0 && transactions.length === 0 && expenses.length === 0 && cashEntries.length === 0 && serviceTransactions.length === 0 && bills.length === 0 && staffPayments.length === 0 && investments.length === 0 && dueEntries.length === 0 && !billingSettings) {
    // A settings-only backup (fresh shop, no rows yet) is legitimate — only
    // reject a file that has literally nothing usable.
    throw new Error('Backup file contains no valid data');
  }

  // ---- REPLACE semantics, ATOMICALLY ----
  // The old rows and the imported rows swap inside ONE IndexedDB transaction
  // spanning every store: a crash or quota error mid-restore can never leave
  // the device half-wiped or half-imported. (Previously the wipe and the write
  // ran in separate transactions — a failure in between destroyed local data.)

  // 1. Prepare all validated + coerced rows first (pure data, no I/O) so the
  //    transaction itself stays short.
  const catRows: OfflineDBSchema['categories']['value'][] = categories.map(
    (cat) => ({ ...fixDates(cat), userId, _synced: now, _dirty: 0 }) as OfflineDBSchema['categories']['value']
  );
  const prodRows: OfflineDBSchema['products']['value'][] = products.map(
    (prod) => coerce({ ...fixDates(prod), userId, _synced: now, _dirty: 0 }, {
      quantity: 'int',
      purchasePrice: 'num',
      sellingPrice: 'num',
      lowStockThreshold: 'int',
    }) as OfflineDBSchema['products']['value']
  );
  const txnRows: OfflineDBSchema['transactions']['value'][] = transactions.map(
    (txn) => coerce({ ...fixDates(txn), date: isoStr(txn.date), userId, _synced: now, _dirty: 0 }, {
      quantity: 'int',
      unitPrice: 'num',
      totalAmount: 'num',
    }) as OfflineDBSchema['transactions']['value']
  );
  const expRows: OfflineDBSchema['expenses']['value'][] = expenses.map(
    (exp) => coerce({ ...fixDates(exp), date: isoStr(exp.date), userId, _synced: now, _dirty: 0 }, { amount: 'num' }) as OfflineDBSchema['expenses']['value']
  );
  const cashRows: OfflineDBSchema['cashEntries']['value'][] = cashEntries.map(
    (entry) => coerce({ ...fixDates(entry), date: isoStr(entry.date), userId, _synced: now, _dirty: 0 }, {
      handCash: 'num',
      liquidCash: 'num',
    }) as OfflineDBSchema['cashEntries']['value']
  );
  const svcRows: OfflineDBSchema['serviceTransactions']['value'][] = serviceTransactions.map(
    (svc) => coerce({ ...fixDates(svc), date: isoStr(svc.date), userId, _synced: now, _dirty: 0 }, { amount: 'num' }) as OfflineDBSchema['serviceTransactions']['value']
  );
  const billRows: OfflineDBSchema['bills']['value'][] = bills.map(
    (bill) => coerce({
      ...fixDates(bill),
      date: isoStr(bill.date),
      userId,
      createdAt: isoStr(bill.createdAt) || nowIso,
      updatedAt: isoStr(bill.updatedAt) || nowIso,
      // Shape-defend the fields the bills list/search later calls string and
      // array methods on — a hand-edited backup must never crash that tab.
      items: Array.isArray(bill.items) ? bill.items : [],
      customerName: typeof bill.customerName === 'string' ? bill.customerName : '',
      customerMobile: typeof bill.customerMobile === 'string' ? bill.customerMobile : '',
      billNumber: typeof bill.billNumber === 'string' ? bill.billNumber : '',
      paymentMethod: typeof bill.paymentMethod === 'string' ? bill.paymentMethod : 'cash',
    }, {
      subtotal: 'num',
      discountValue: 'num',
      discountAmount: 'num',
      gstRate: 'num',
      gstAmount: 'num',
      taxableValue: 'num',
      cgstAmount: 'num',
      sgstAmount: 'num',
      total: 'num',
      paidAmount: 'num',
      dueAmount: 'num',
    }) as OfflineDBSchema['bills']['value']
  );
  const staffRows: OfflineDBSchema['staffPayments']['value'][] = staffPayments.map(
    (row) => coerce({
      ...fixDates(row),
      date: isoStr(row.date),
      userId,
      staffName: typeof row.staffName === 'string' ? row.staffName : '',
      staffPhone: typeof row.staffPhone === 'string' ? row.staffPhone : '',
      note: typeof row.note === 'string' ? row.note : '',
    }, { amount: 'num' }) as OfflineDBSchema['staffPayments']['value']
  );
  const invRows: OfflineDBSchema['investments']['value'][] = investments.map(
    (row) => coerce({
      ...fixDates(row),
      date: isoStr(row.date),
      userId,
      purpose: typeof row.purpose === 'string' ? row.purpose : '',
      note: typeof row.note === 'string' ? row.note : '',
    }, { amount: 'num' }) as OfflineDBSchema['investments']['value']
  );
  const dueRows: OfflineDBSchema['dueEntries']['value'][] = dueEntries.map(
    (row) => {
      const coerced = coerce({
        ...fixDates(row),
        date: isoStr(row.date) || localDateStr(),
        userId,
        customerName: typeof row.customerName === 'string' ? row.customerName : '',
        customerMobile: typeof row.customerMobile === 'string' ? row.customerMobile : '',
        customerPhotoDataUrl: typeof row.customerPhotoDataUrl === 'string' ? row.customerPhotoDataUrl : '',
        productName: typeof row.productName === 'string' ? row.productName : '',
        productPhotoDataUrl: typeof row.productPhotoDataUrl === 'string' ? row.productPhotoDataUrl : '',
        note: typeof row.note === 'string' ? row.note : '',
        schedule: normalizeSchedule(row.schedule),
        createdAt: isoStr(row.createdAt) || nowIso,
        updatedAt: isoStr(row.updatedAt) || nowIso,
        _synced: now,
        _dirty: 0,
      }, { amount: 'num', paidAmount: 'num' });
      // Collected can never exceed the total.
      coerced.paidAmount = Math.min(Number(coerced.paidAmount) || 0, Number(coerced.amount) || 0);
      return coerced as OfflineDBSchema['dueEntries']['value'];
    }
  );

  // 2. One readwrite transaction across ALL stores: wipe this user's rows,
  //    write the imported ones, swap billingSettings — all or nothing.
  const db = await getOfflineDB();
  const tx = db.transaction(
    ['categories', 'products', 'transactions', 'expenses', 'cashEntries', 'serviceTransactions', 'bills', 'staffPayments', 'investments', 'dueEntries', 'billingSettings'],
    'readwrite'
  );

  for (const store of ['categories', 'products', 'transactions', 'expenses', 'cashEntries', 'serviceTransactions', 'bills', 'staffPayments', 'investments', 'dueEntries'] as const) {
    const os = tx.objectStore(store);
    const keys = await os.index('by-userId').getAllKeys(userId);
    for (const key of keys) void os.delete(key);
  }

  for (const row of catRows) void tx.objectStore('categories').put(row);
  for (const row of prodRows) void tx.objectStore('products').put(row);
  for (const row of txnRows) void tx.objectStore('transactions').put(row);
  for (const row of expRows) void tx.objectStore('expenses').put(row);
  for (const row of cashRows) void tx.objectStore('cashEntries').put(row);
  for (const row of svcRows) void tx.objectStore('serviceTransactions').put(row);
  for (const row of billRows) void tx.objectStore('bills').put(row);
  for (const row of staffRows) void tx.objectStore('staffPayments').put(row);
  for (const row of invRows) void tx.objectStore('investments').put(row);
  for (const row of dueRows) void tx.objectStore('dueEntries').put(row);

  if (billingSettings) {
    void tx.objectStore('billingSettings').put({
      ...DEFAULT_BILLING_SETTINGS,
      ...billingSettings,
      userId,
      updatedAt: nowIso,
    } as OfflineDBSchema['billingSettings']['value']);
  }

  // Commits everything or nothing — any failed request rejects and rolls back.
  await tx.done;

  notifyLocalDataChanged(userId);
  return { message: 'Backup imported successfully' };
}

// ============ RESET DATA (Local) ============

export async function resetDataOffline(userId: string) {
  await clearOfflineData(userId);
  notifyLocalDataChanged(userId);
  // Wipe the cloud mirror too — otherwise the cloud copy flows straight back
  // in on the next sync and "Reset All Data" looks broken (and wipes the
  // user's data on their OTHER devices as soon as it re-arrives).
  notifyLocalWipe(userId);
  return { message: 'All data reset successfully' };
}
