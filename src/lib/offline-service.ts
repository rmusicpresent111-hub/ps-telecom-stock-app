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
  offlineMeta,
  clearOfflineData,
  getOfflineDB,
  type OfflineDBSchema,
} from './offline-db';
import { getLocalUser, updateLocalUser } from './local-auth';
import { generateRecordId } from './id';
import { Category, Product, Transaction, Expense, CashEntry, ServiceTransaction, ServiceCategoryType, Bill, BillingSettings, PaymentMethod } from './types';

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
export function resolvePeriodRange(options?: { period?: string; date?: string; from?: string; to?: string }): { from: string; to: string } {
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

function sortTxnsDesc(rows: OfflineDBSchema['transactions']['value'][]): OfflineDBSchema['transactions']['value'][] {
  return [...rows].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function localTxnsToTransactions(localTxns: OfflineDBSchema['transactions']['value'][]): Transaction[] {
  return sortTxnsDesc(localTxns).map(t => stripSync<Transaction>(t));
}

/** Cost basis for a transaction: the SNAPSHOT taken at sale time, falling back to the current product. */
function txnCostBasis(t: Transaction, products: Product[]): number {
  return t.product?.purchasePrice ?? products.find(p => p.id === t.productId)?.purchasePrice ?? 0;
}

// ============ CATEGORIES (Local) ============

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

  return { category };
}

export async function updateCategoryOffline(id: string, updates: { name?: string; image?: string }, userId: string): Promise<{ category: Category }> {
  const allCats = await offlineCategories.getAll(userId);
  const existing = allCats.find(c => c.id === id);
  if (!existing) throw new Error('Category not found');

  const updated = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await offlineCategories.put({
    ...updated,
    _synced: Date.now(),
    _dirty: 0,
  } as OfflineDBSchema['categories']['value']);

  const { _synced, _dirty, ...categoryData } = updated;
  return { category: categoryData as Category };
}

export async function deleteCategoryOffline(id: string, userId: string): Promise<{ message: string }> {
  // Cascade: delete all products in this category (which cascades their transactions too)
  const allProducts = await offlineProducts.getAll(userId);
  const catProducts = allProducts.filter(p => p.categoryId === id);
  for (const prod of catProducts) {
    await deleteProductOffline(prod.id, userId);
  }

  await offlineCategories.delete(id);
  return { message: 'Category deleted successfully' };
}

// ============ PRODUCTS (Local) ============

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

export async function createProductOffline(productData: {
  name: string;
  categoryId: string;
  quantity?: number;
  boxNumber?: string;
  purchasePrice?: number;
  sellingPrice?: number;
  lowStockThreshold?: number;
  userId: string;
}): Promise<{ product: Product }> {
  if (!productData.name.trim()) throw new Error('Product name is required');

  const quantity = Math.max(0, Math.floor(Number(productData.quantity ?? 0)) || 0);
  const purchasePrice = Math.max(0, Number(productData.purchasePrice ?? 0)) || 0;
  const sellingPrice = Math.max(0, Number(productData.sellingPrice ?? 0)) || 0;
  const lowStockThreshold = Math.max(0, Math.floor(Number(productData.lowStockThreshold ?? 5)) || 0);

  const now = new Date().toISOString();
  const product = {
    id: generateRecordId(),
    name: productData.name.trim(),
    categoryId: productData.categoryId,
    quantity,
    boxNumber: productData.boxNumber ?? '',
    purchasePrice,
    sellingPrice,
    lowStockThreshold,
    userId: productData.userId,
    createdAt: now,
    updatedAt: now,
  };

  await offlineProducts.put({
    ...product,
    _synced: Date.now(),
    _dirty: 0,
  } as OfflineDBSchema['products']['value']);

  return { product };
}

export async function updateProductOffline(id: string, updates: Partial<Product> & { userId: string }): Promise<{ product: Product }> {
  const existing = await offlineProducts.getAll(updates.userId);
  const product = existing.find(p => p.id === id);
  if (!product) throw new Error('Product not found');

  const updatedProduct = {
    ...product,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await offlineProducts.put({
    ...updatedProduct,
    _synced: Date.now(),
    _dirty: 0,
  } as OfflineDBSchema['products']['value']);

  const { _synced, _dirty, ...prodData } = updatedProduct;
  return { product: prodData as Product };
}

export async function deleteProductOffline(id: string, userId: string): Promise<{ message: string }> {
  // Delete related transactions first (cascade)
  const localTxns = await offlineTransactions.getAll(userId);
  const relatedTxns = localTxns.filter(t => t.productId === id);
  for (const txn of relatedTxns) {
    await offlineTransactions.delete(txn.id);
  }

  await offlineProducts.delete(id);
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

  const isOut = transactionData.type === 'STOCK_OUT' || transactionData.type === 'SELL';
  if (isOut && product.quantity < quantity) {
    throw new Error(`Insufficient stock — only ${product.quantity} left`);
  }

  const quantityChange = transactionData.type === 'STOCK_IN' ? quantity : -quantity;

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
    // Snapshot the product prices at transaction time — historical profit must
    // never change when the user later edits the product's prices.
    product: {
      id: product.id,
      name: product.name,
      purchasePrice: product.purchasePrice,
      sellingPrice: product.sellingPrice,
    },
    _synced: Date.now(),
    _dirty: 0,
  };

  await transactionsStore.put(row);
  await productsStore.put({
    ...product,
    quantity: product.quantity + quantityChange,
    updatedAt: now,
  });

  // Commit — rejects (and rolls back both stores) if anything failed.
  await tx.done;

  return { transaction: stripSync<Transaction>(row) };
}

export async function deleteTransactionOffline(id: string, userId: string): Promise<{ success: boolean }> {
  const db = await getOfflineDB();
  const now = new Date().toISOString();

  const tx = db.transaction(['products', 'transactions'], 'readwrite');
  const productsStore = tx.objectStore('products');
  const transactionsStore = tx.objectStore('transactions');

  const txn = await transactionsStore.get(id);
  if (!txn || txn.userId !== userId) {
    // Nothing to delete — no writes were queued, committing empty is harmless.
    await tx.done;
    return { success: true };
  }

  // Reverse the stock change caused by this transaction (same atomic tx)
  const product = await productsStore.get(txn.productId);
  if (product) {
    const quantityChange = txn.type === 'STOCK_IN' ? -txn.quantity : txn.quantity;
    await productsStore.put({
      ...product,
      quantity: Math.max(0, product.quantity + quantityChange),
      updatedAt: now,
    });
  }

  await transactionsStore.delete(id);
  await tx.done;

  return { success: true };
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
  const [localProducts, localCategories, localTransactions] = await Promise.all([
    offlineProducts.getAll(userId),
    offlineCategories.getAll(userId),
    offlineTransactions.getAll(userId),
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

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const sevenDaysAgoStr = localDateStr(sevenDaysAgo);

  const saleTxns = transactions.filter(t => t.type === 'SELL' && t.date >= sevenDaysAgoStr);
  const saleMap = new Map<string, { sales: number; quantity: number }>();
  for (const t of saleTxns) {
    const existing = saleMap.get(t.date) || { sales: 0, quantity: 0 };
    existing.sales += t.totalAmount;
    existing.quantity += t.quantity;
    saleMap.set(t.date, existing);
  }

  const saleOverview: { date: string; label: string; sales: number; quantity: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = localDateStr(d);
    const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' });
    const dayData = saleMap.get(dateStr) || { sales: 0, quantity: 0 };
    saleOverview.push({ date: dateStr, label: dayLabel, ...dayData });
  }

  const stockByCategory = new Map<string, { quantity: number; value: number }>();
  for (const p of products) {
    const cat = catsWithCount.find(c => c.id === p.categoryId);
    const catName = cat?.name || 'Unknown';
    const existing = stockByCategory.get(catName) || { quantity: 0, value: 0 };
    existing.quantity += p.quantity;
    existing.value += p.quantity * p.purchasePrice;
    stockByCategory.set(catName, existing);
  }

  const stockOverview = Array.from(stockByCategory.entries())
    .filter(([_, data]) => data.quantity > 0)
    .map(([category, data]) => ({ category, ...data }));

  return {
    stats: {
      totalItems: products.length,
      lowItems,
      todayTransactions: todayTxns.length,
      stockValue,
    },
    lowStockProducts,
    recentTransactions,
    categories: catsWithCount,
    saleOverview,
    stockOverview,
  };
}

// Alias for backward compatibility with existing imports
export { getDashboardOffline as getDashboard };

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

  return { expense: stripSync<Expense>(updatedExpense) };
}

export async function deleteExpenseOffline(id: string, _userId: string): Promise<{ success: boolean }> {
  await offlineExpenses.delete(id);
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

  // One balance entry per date — upsert by date
  const allEntries = await offlineCashEntries.getAll(entryData.userId);
  const existing = allEntries.find(e => e.date === entryData.date);

  if (existing) {
    const updated = {
      ...existing,
      handCash: entryData.handCash !== undefined ? Number(entryData.handCash) : existing.handCash,
      liquidCash: entryData.liquidCash !== undefined ? Number(entryData.liquidCash) : existing.liquidCash,
      note: entryData.note !== undefined ? entryData.note : existing.note,
      updatedAt: now,
    };

    await offlineCashEntries.put({
      ...updated,
      _synced: Date.now(),
      _dirty: 0,
    });

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

  await offlineCashEntries.put({
    ...newEntry,
    _synced: Date.now(),
    _dirty: 0,
  });

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

  return { entry: stripSync<CashEntry>(updatedEntry) };
}

export async function deleteCashEntryOffline(id: string, _userId: string): Promise<{ success: boolean }> {
  await offlineCashEntries.delete(id);
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

      if (t.type === 'SELL') {
        entry.revenue += t.totalAmount || 0;
        entry.cost += (t.quantity || 0) * costBasis;
        entry.profit += (t.totalAmount || 0) - (t.quantity || 0) * costBasis;
        entry.sell += t.quantity || 0;
      } else if (t.type === 'STOCK_IN') {
        entry.cost += (t.quantity || 0) * (t.unitPrice || 0);
        entry.stockIn += t.quantity || 0;
      } else if (t.type === 'STOCK_OUT') {
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

      if (t.type === 'SELL') {
        entry.revenue += t.totalAmount || 0;
        entry.cost += (t.quantity || 0) * costBasis;
        entry.profit += (t.totalAmount || 0) - (t.quantity || 0) * costBasis;
        entry.sell += t.quantity || 0;
      } else if (t.type === 'STOCK_IN') {
        entry.cost += (t.quantity || 0) * (t.unitPrice || 0);
        entry.stockIn += t.quantity || 0;
      } else if (t.type === 'STOCK_OUT') {
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

      if (t.type === 'SELL') {
        entry.revenue += t.totalAmount || 0;
        entry.cost += (t.quantity || 0) * costBasis;
        entry.profit += (t.totalAmount || 0) - (t.quantity || 0) * costBasis;
        entry.sell += t.quantity || 0;
        entry.quantity += t.quantity || 0;
      } else if (t.type === 'STOCK_IN') {
        entry.cost += (t.quantity || 0) * (t.unitPrice || 0);
        entry.stockIn += t.quantity || 0;
        entry.quantity += t.quantity || 0;
      } else if (t.type === 'STOCK_OUT') {
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

  return { serviceTransaction };
}

export async function deleteServiceTransactionOffline(id: string, _userId: string): Promise<{ success: boolean }> {
  await offlineServiceTransactions.delete(id);
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
  defaultDiscountPercent: 0,
  upiId: '',
  signatureDataUrl: '',
  qrCodeDataUrl: '',
  billPrefix: 'PS',
  thankYouNote: 'Thank you for your business!',
  termsText: '',
};

export async function getBillingSettingsOffline(userId: string): Promise<BillingSettings> {
  const db = await getOfflineDB();
  const existing = await db.get('billingSettings', userId);
  if (existing) return existing;
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
    defaultDiscountPercent: clampNumber(updates.defaultDiscountPercent ?? current.defaultDiscountPercent, 0, 100),
    userId,
    updatedAt: new Date().toISOString(),
  };
  const db = await getOfflineDB();
  await db.put('billingSettings', next);
  return next;
}

function clampNumber(value: number, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

/** Generates the next sequential bill number: PREFIX-YYMM-0001 */
async function nextBillNumber(userId: string, prefix: string): Promise<string> {
  const bills = await offlineBills.getAll(userId);
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const monthPrefix = `${prefix}-${yy}${mm}-`;
  let maxSeq = 0;
  for (const b of bills) {
    if (typeof b.billNumber === 'string' && b.billNumber.startsWith(monthPrefix)) {
      const seq = parseInt(b.billNumber.slice(monthPrefix.length), 10);
      if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
    }
  }
  return `${monthPrefix}${String(maxSeq + 1).padStart(4, '0')}`;
}

export async function createBillOffline(data: {
  userId: string;
  transactionId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  customerName?: string;
  customerMobile?: string;
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
  const gstAmount = gstEnabled ? round2(((subtotal - discountAmount) * settings.gstRate) / 100) : 0;
  const total = round2(subtotal - discountAmount + gstAmount);

  const paymentMethod: PaymentMethod = data.paymentMethod ?? 'cash';
  let paidAmount = data.paidAmount === undefined ? total : Math.max(0, Number(data.paidAmount) || 0);
  if (paymentMethod === 'due') paidAmount = 0;
  paidAmount = round2(Math.min(paidAmount, total));
  const dueAmount = round2(total - paidAmount);

  // Guard: one bill per stock-out/sell transaction — prevents accidental duplicates
  const existingBills = await offlineBills.getAll(data.userId);
  const dupe = existingBills.find(b => b.transactionId === data.transactionId);
  if (dupe) throw new Error('A bill already exists for this transaction');

  const now = new Date().toISOString();
  const billNumber = await nextBillNumber(data.userId, settings.billPrefix.trim() || 'PS');

  const bill: OfflineDBSchema['bills']['value'] = {
    id: generateRecordId(),
    userId: data.userId,
    billNumber,
    customerName: (data.customerName ?? '').trim() || 'Walk-in Customer',
    customerMobile: (data.customerMobile ?? '').replace(/[^\d+]/g, ''),
    items: [
      {
        productId: data.productId,
        name: data.productName,
        quantity: qty,
        unitPrice,
        total: subtotal,
      },
    ],
    subtotal,
    discountValue,
    discountType,
    discountAmount,
    gstEnabled,
    gstRate: gstEnabled ? settings.gstRate : 0,
    gstAmount,
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

  await offlineBills.put(bill);
  return { bill: bill as unknown as Bill };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
  if (row && row.userId === userId) {
    await db.delete('bills', id);
  }
  return { success: true };
}

// ============ BACKUP (Local) ============

export async function exportBackupOffline(userId: string) {
  const [localCategories, localProducts, localTransactions, localExpenses, localCashEntries, localServiceTxns, localBills, billingSettings] = await Promise.all([
    offlineCategories.getAll(userId),
    offlineProducts.getAll(userId),
    offlineTransactions.getAll(userId),
    offlineExpenses.getAll(userId),
    offlineCashEntries.getAll(userId),
    offlineServiceTransactions.getAll(userId),
    offlineBills.getAll(userId),
    getBillingSettingsOffline(userId),
  ]);

  return {
    categories: localCategories.map(c => stripSync(c)),
    products: localProducts.map(p => { const { category: _c, ...rest } = stripSync<Record<string, unknown>>(p); return rest; }),
    transactions: localTransactions.map(t => { const { product: _p, ...rest } = stripSync<Record<string, unknown>>(t); return rest; }),
    expenses: localExpenses.map(e => stripSync(e)),
    cashEntries: localCashEntries.map(e => stripSync(e)),
    serviceTransactions: localServiceTxns.map(s => stripSync(s)),
    bills: localBills.map(b => b),
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
  billingSettings?: unknown;
}) {
  const now = Date.now();

  // Validate rows: every row MUST have an id — malformed backups must never
  // be written into IndexedDB.
  const asRows = (rows: unknown[]): Record<string, unknown>[] => {
    if (!Array.isArray(rows)) return [];
    return rows.filter((r): r is Record<string, unknown> =>
      !!r && typeof r === 'object' && typeof (r as Record<string, unknown>).id === 'string' && (r as Record<string, unknown>).id !== ''
    );
  };

  const categories = asRows(backupData.categories || []);
  const products = asRows(backupData.products || []);
  const transactions = asRows(backupData.transactions || []);
  const expenses = asRows(backupData.expenses || []);
  const cashEntries = asRows(backupData.cashEntries || []);
  const serviceTransactions = asRows(backupData.serviceTransactions || []);
  const bills = asRows(backupData.bills || []);
  const billingSettings = (backupData.billingSettings && typeof backupData.billingSettings === 'object')
    ? backupData.billingSettings as Record<string, unknown>
    : null;

  if (categories.length === 0 && products.length === 0 && transactions.length === 0 && expenses.length === 0 && cashEntries.length === 0 && serviceTransactions.length === 0 && bills.length === 0) {
    throw new Error('Backup file contains no valid data');
  }

  // REPLACE semantics: clear existing stores first so stale rows can't survive a restore.
  const [allLocalCats, allLocalProducts, allLocalTxns, allLocalExpenses, allLocalCash, allLocalSvc, allLocalBills] = await Promise.all([
    offlineCategories.getAll(userId),
    offlineProducts.getAll(userId),
    offlineTransactions.getAll(userId),
    offlineExpenses.getAll(userId),
    offlineCashEntries.getAll(userId),
    offlineServiceTransactions.getAll(userId),
    offlineBills.getAll(userId),
  ]);
  await Promise.all([
    ...allLocalCats.map(c => offlineCategories.delete(c.id)),
    ...allLocalProducts.map(p => offlineProducts.delete(p.id)),
    ...allLocalTxns.map(t => offlineTransactions.delete(t.id)),
    ...allLocalExpenses.map(e => offlineExpenses.delete(e.id)),
    ...allLocalCash.map(e => offlineCashEntries.delete(e.id)),
    ...allLocalSvc.map(s => offlineServiceTransactions.delete(s.id)),
    ...allLocalBills.map(b => offlineBills.delete(b.id)),
  ]);

  if (categories.length) {
    await offlineCategories.putBulk(
      categories.map((cat) => ({ ...cat, userId, _synced: now, _dirty: 0 })) as OfflineDBSchema['categories']['value'][]
    );
  }
  if (products.length) {
    await offlineProducts.putBulk(
      products.map((prod) => ({ ...prod, userId, _synced: now, _dirty: 0 })) as OfflineDBSchema['products']['value'][]
    );
  }
  if (transactions.length) {
    await offlineTransactions.putBulk(
      transactions.map((txn) => ({ ...txn, userId, _synced: now, _dirty: 0 })) as OfflineDBSchema['transactions']['value'][]
    );
  }
  if (expenses.length) {
    await offlineExpenses.putBulk(
      expenses.map((exp) => ({ ...exp, userId, _synced: now, _dirty: 0 })) as OfflineDBSchema['expenses']['value'][]
    );
  }
  if (cashEntries.length) {
    await offlineCashEntries.putBulk(
      cashEntries.map((entry) => ({ ...entry, userId, _synced: now, _dirty: 0 })) as OfflineDBSchema['cashEntries']['value'][]
    );
  }
  if (serviceTransactions.length) {
    await offlineServiceTransactions.putBulk(
      serviceTransactions.map((svc) => ({ ...svc, userId, _synced: now, _dirty: 0 })) as OfflineDBSchema['serviceTransactions']['value'][]
    );
  }
  if (bills.length) {
    await offlineBills.putBulk(
      bills.map((bill) => ({ ...bill, userId, createdAt: bill.createdAt || new Date().toISOString(), updatedAt: bill.updatedAt || new Date().toISOString() })) as OfflineDBSchema['bills']['value'][]
    );
  }
  if (billingSettings) {
    const db = await getOfflineDB();
    await db.put('billingSettings', {
      ...DEFAULT_BILLING_SETTINGS,
      ...billingSettings,
      userId,
      updatedAt: new Date().toISOString(),
    } as OfflineDBSchema['billingSettings']['value']);
  }

  return { message: 'Backup imported successfully' };
}

// ============ RESET DATA (Local) ============

export async function resetDataOffline(userId: string) {
  await clearOfflineData(userId);
  return { message: 'All data reset successfully' };
}

// Keep the syncMeta export used by potential future features (last backup time etc.)
export { offlineMeta };
