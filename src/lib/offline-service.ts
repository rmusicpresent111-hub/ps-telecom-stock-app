/**
 * Offline-First Service Layer
 * 
 * READ STRATEGY: Local IndexedDB first → instant response. Then fetch from Supabase in background.
 * WRITE STRATEGY: Save to local IndexedDB immediately (mark dirty) → upload to Supabase in background.
 * DELETE STRATEGY: Delete from local IndexedDB + add to pendingDeletes queue → delete from Supabase when online.
 * 
 * This wraps the existing supabase-service functions with offline support.
 * The app always works - even with zero internet.
 */

import { isOnline, syncFromSupabase } from './sync-engine';
import {
  offlineCategories,
  offlineProducts,
  offlineTransactions,
  offlineExpenses,
  offlineCashEntries,
  offlinePendingDeletes,
} from './offline-db';
import { Category, Product, Transaction, Expense, CashEntry } from './types';

// ============ CATEGORIES (Offline-First) ============

export async function getCategoriesOffline(userId: string): Promise<Category[]> {
  try {
    const localCats = await offlineCategories.getAll(userId);
    
    if (localCats.length > 0) {
      const cats = localCats.map(({ _synced, _dirty, ...cat }) => cat as unknown as Category);
      if (isOnline()) syncFromSupabase(userId).catch(() => {});
      return cats;
    }
    
    if (isOnline()) {
      const { getCategories } = await import('./supabase-service');
      const result = await getCategories(userId);
      return result.categories as Category[];
    }
    
    return [];
  } catch {
    if (isOnline()) {
      const { getCategories } = await import('./supabase-service');
      const result = await getCategories(userId);
      return result.categories as Category[];
    }
    return [];
  }
}

export async function createCategoryOffline(name: string, image: string, userId: string): Promise<{ category: Category }> {
  const id = `local_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const now = new Date().toISOString();
  
  const category = {
    id,
    name,
    image: image || '',
    userId,
    createdAt: now,
    updatedAt: now,
    _count: { products: 0 },
  };

  await offlineCategories.put({
    ...category,
    _synced: 0,
    _dirty: Date.now(),
  });

  if (isOnline()) {
    try {
      const { createCategory } = await import('./supabase-service');
      const result = await createCategory(name, image, userId);
      await offlineCategories.put({
        ...result.category,
        _synced: Date.now(),
        _dirty: 0,
      });
      await offlineCategories.delete(id);
      return result;
    } catch {
      // Keep local entry - will sync later
    }
  }

  return { category: category as Category };
}

// ============ PRODUCTS (Offline-First) ============

export async function getProductsOffline(userId: string, options?: { categoryId?: string; search?: string }): Promise<Product[]> {
  try {
    let localProducts;
    
    if (options?.categoryId) {
      localProducts = await offlineProducts.getByCategory(userId, options.categoryId);
    } else if (options?.search) {
      localProducts = await offlineProducts.search(userId, options.search);
    } else {
      localProducts = await offlineProducts.getAll(userId);
    }

    if (localProducts.length > 0) {
      const prods = localProducts.map(({ _synced, _dirty, ...prod }) => prod as unknown as Product);
      if (isOnline()) syncFromSupabase(userId).catch(() => {});
      return prods;
    }

    if (isOnline()) {
      const { getProducts } = await import('./supabase-service');
      const result = await getProducts(userId, options);
      return result.products as Product[];
    }

    return [];
  } catch {
    if (isOnline()) {
      const { getProducts } = await import('./supabase-service');
      const result = await getProducts(userId, options);
      return result.products as Product[];
    }
    return [];
  }
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
  const id = `local_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const now = new Date().toISOString();

  const product = {
    id,
    name: productData.name,
    categoryId: productData.categoryId,
    quantity: productData.quantity ?? 0,
    boxNumber: productData.boxNumber ?? '',
    purchasePrice: productData.purchasePrice ?? 0,
    sellingPrice: productData.sellingPrice ?? 0,
    lowStockThreshold: productData.lowStockThreshold ?? 5,
    userId: productData.userId,
    createdAt: now,
    updatedAt: now,
  };

  await offlineProducts.put({
    ...product,
    _synced: 0,
    _dirty: Date.now(),
  });

  if (isOnline()) {
    try {
      const { createProduct } = await import('./supabase-service');
      const result = await createProduct(productData);
      await offlineProducts.put({
        ...result.product,
        _synced: Date.now(),
        _dirty: 0,
      });
      await offlineProducts.delete(id);
      return result;
    } catch {
      // Keep local - will sync later
    }
  }

  return { product: product as Product };
}

export async function updateProductOffline(id: string, updates: Partial<Product> & { userId: string }): Promise<{ product: Product }> {
  const existing = await offlineProducts.getAll(updates.userId);
  const product = existing.find(p => p.id === id);
  
  if (!product) {
    throw new Error('Product not found');
  }

  const updatedProduct = {
    ...product,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await offlineProducts.put({
    ...updatedProduct,
    _synced: product._synced,
    _dirty: Date.now(),
  });

  if (isOnline()) {
    try {
      const { updateProduct } = await import('./supabase-service');
      const { userId: _, ...updateFields } = updates;
      const result = await updateProduct(id, updateFields);
      await offlineProducts.put({
        ...result.product,
        _synced: Date.now(),
        _dirty: 0,
      });
      return result;
    } catch {
      // Keep local changes - will sync later
    }
  }

  const { _synced, _dirty, category, ...prodData } = updatedProduct;
  return { product: prodData as unknown as Product };
}

export async function deleteProductOffline(id: string, userId: string): Promise<{ message: string }> {
  // Delete from local IndexedDB
  await offlineProducts.delete(id);
  
  // Also delete related transactions locally
  const localTxns = await offlineTransactions.getAll(userId);
  const relatedTxns = localTxns.filter(t => t.productId === id);
  for (const txn of relatedTxns) {
    await offlineTransactions.delete(txn.id);
    await offlinePendingDeletes.removeByItemId('transactions', txn.id);
  }
  
  // Add to pending deletes for Supabase sync
  await offlinePendingDeletes.add('products', id, userId);

  // Try to delete from Supabase immediately if online
  if (isOnline()) {
    try {
      const { deleteProduct } = await import('./supabase-service');
      await deleteProduct(id);
      await offlinePendingDeletes.removeByItemId('products', id);
    } catch {
      // Will retry on next sync
    }
  }

  return { message: 'Product deleted successfully' };
}

// ============ TRANSACTIONS (Offline-First) ============

export async function createTransactionOffline(transactionData: {
  type: 'STOCK_IN' | 'STOCK_OUT' | 'SELL';
  productId: string;
  quantity: number;
  unitPrice?: number;
  totalAmount?: number;
  date?: string;
  userId: string;
}): Promise<{ transaction: Transaction }> {
  const id = `local_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const now = new Date().toISOString();

  const products = await offlineProducts.getAll(transactionData.userId);
  const product = products.find(p => p.id === transactionData.productId);

  if (!product) {
    throw new Error('Product not found');
  }

  if ((transactionData.type === 'STOCK_OUT' || transactionData.type === 'SELL') && product.quantity < transactionData.quantity) {
    throw new Error('Insufficient stock');
  }

  const quantityChange = transactionData.type === 'STOCK_IN' ? transactionData.quantity : -transactionData.quantity;

  const transaction = {
    id,
    productId: transactionData.productId,
    type: transactionData.type,
    quantity: transactionData.quantity,
    unitPrice: transactionData.unitPrice ?? 0,
    totalAmount: transactionData.totalAmount ?? 0,
    date: transactionData.date || now.split('T')[0],
    userId: transactionData.userId,
    createdAt: now,
    product: {
      id: product.id,
      name: product.name,
      purchasePrice: product.purchasePrice,
      sellingPrice: product.sellingPrice,
    },
  };

  await offlineTransactions.put({
    ...transaction,
    _synced: 0,
    _dirty: Date.now(),
  });

  const updatedProduct = {
    ...product,
    quantity: product.quantity + quantityChange,
    updatedAt: now,
  };
  await offlineProducts.put({
    ...updatedProduct,
    _synced: product._synced,
    _dirty: Date.now(),
  });

  if (isOnline()) {
    try {
      const { createTransaction } = await import('./supabase-service');
      const result = await createTransaction(transactionData);
      await offlineTransactions.put({
        ...result.transaction,
        _synced: Date.now(),
        _dirty: 0,
      });
      await offlineTransactions.delete(id);
      const serverProducts = await offlineProducts.getAll(transactionData.userId);
      const serverProduct = serverProducts.find(p => p.id === transactionData.productId);
      if (serverProduct) {
        await offlineProducts.put({
          ...serverProduct,
          quantity: product.quantity + quantityChange,
          _synced: Date.now(),
          _dirty: 0,
        });
      }
      return result;
    } catch {
      // Keep local - will sync later
    }
  }

  const { _synced, _dirty, ...txnData } = transaction;
  return { transaction: txnData as unknown as Transaction };
}

export async function getTransactionsOffline(userId: string, options?: { type?: string; from?: string; to?: string }): Promise<Transaction[]> {
  try {
    let localTxns = await offlineTransactions.getAll(userId);
    
    if (options?.type) localTxns = localTxns.filter(t => t.type === options.type);
    if (options?.from) localTxns = localTxns.filter(t => t.date >= options.from!);
    if (options?.to) localTxns = localTxns.filter(t => t.date <= options.to!);

    if (localTxns.length > 0) {
      const txns = localTxns.map(({ _synced, _dirty, ...txn }) => txn as unknown as Transaction);
      if (isOnline()) syncFromSupabase(userId).catch(() => {});
      return txns;
    }

    if (isOnline()) {
      const { getTransactions } = await import('./supabase-service');
      const result = await getTransactions(userId, options);
      return result.transactions as Transaction[];
    }

    return [];
  } catch {
    if (isOnline()) {
      const { getTransactions } = await import('./supabase-service');
      const result = await getTransactions(userId, options);
      return result.transactions as Transaction[];
    }
    return [];
  }
}

// ============ DASHBOARD (Offline-First) ============

export async function getDashboardOffline(userId: string) {
  try {
    const [localProducts, localCategories, localTransactions] = await Promise.all([
      offlineProducts.getAll(userId),
      offlineCategories.getAll(userId),
      offlineTransactions.getAll(userId),
    ]);

    const products = localProducts.map(({ _synced, _dirty, ...p }) => p as unknown as Product);
    const categories = localCategories.map(({ _synced, _dirty, ...c }) => c as unknown as Category);
    const transactions = localTxnsToTransactions(localTransactions);

    if (products.length === 0 && categories.length === 0 && isOnline()) {
      const { getDashboard } = await import('./supabase-service');
      const result = await getDashboard(userId);
      syncFromSupabase(userId).catch(() => {});
      return result;
    }

    const today = new Date().toISOString().split('T')[0];
    const todayTxns = transactions.filter(t => t.date === today);
    
    const lowItems = products.filter(p => p.quantity <= p.lowStockThreshold).length;
    const stockValue = products.reduce((sum, p) => sum + p.quantity * p.sellingPrice, 0);
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
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];
    
    const saleTxns = transactions.filter(t => t.type === 'SELL' && t.date >= sevenDaysAgoStr);
    const saleMap = new Map<string, { sales: number; quantity: number }>();
    for (const t of saleTxns) {
      const existing = saleMap.get(t.date) || { sales: 0, quantity: 0 };
      existing.sales += t.totalAmount;
      existing.quantity += t.quantity;
      saleMap.set(t.date, existing);
    }

    const saleOverview = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
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
      existing.value += p.quantity * p.sellingPrice;
      stockByCategory.set(catName, existing);
    }

    const stockOverview = Array.from(stockByCategory.entries())
      .filter(([_, data]) => data.quantity > 0)
      .map(([category, data]) => ({ category, ...data }));

    const result = {
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

    if (isOnline()) syncFromSupabase(userId).catch(() => {});

    return result;
  } catch {
    if (isOnline()) {
      const { getDashboard } = await import('./supabase-service');
      return getDashboard(userId);
    }
    return {
      stats: { totalItems: 0, lowItems: 0, todayTransactions: 0, stockValue: 0 },
      lowStockProducts: [],
      recentTransactions: [],
      categories: [],
      saleOverview: [],
      stockOverview: [],
    };
  }
}

// Alias for backward compatibility with existing imports
export { getDashboardOffline as getDashboard };

function localTxnsToTransactions(localTxns: { _synced: number; _dirty: number; [key: string]: unknown }[]): Transaction[] {
  return localTxns
    .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime())
    .map(({ _synced, _dirty, ...txn }) => txn as unknown as Transaction);
}

// ============ EXPENSES (Offline-First) ============

export async function getExpensesOffline(userId: string, options?: { period?: string; date?: string; from?: string; to?: string; category?: string }) {
  try {
    let localExpenses = await offlineExpenses.getAll(userId);
    
    if (options?.from) localExpenses = localExpenses.filter(e => e.date >= options.from!);
    if (options?.to) localExpenses = localExpenses.filter(e => e.date <= options.to!);
    if (options?.category) localExpenses = localExpenses.filter(e => e.category === options.category);

    if (localExpenses.length > 0 || !isOnline()) {
      const expenses = localExpenses.map(({ _synced, _dirty, ...exp }) => exp as unknown as Expense);
      const totalExpense = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
      const byCategory = expenses.reduce((acc, e) => {
        const cat = e.category || 'other';
        acc[cat] = (acc[cat] || 0) + (e.amount || 0);
        return acc;
      }, {} as Record<string, number>);

      if (isOnline()) syncFromSupabase(userId).catch(() => {});
      
      return {
        expenses,
        summary: { totalExpense, byCategory, count: expenses.length },
      };
    }

    if (isOnline()) {
      const { getExpenses } = await import('./supabase-service');
      return getExpenses(userId, options);
    }

    return { expenses: [], summary: { totalExpense: 0, byCategory: {}, count: 0 } };
  } catch {
    if (isOnline()) {
      const { getExpenses } = await import('./supabase-service');
      return getExpenses(userId, options);
    }
    return { expenses: [], summary: { totalExpense: 0, byCategory: {}, count: 0 } };
  }
}

export async function createExpenseOffline(expenseData: {
  userId: string;
  date: string;
  amount: number;
  category?: string;
  description?: string;
}): Promise<{ expense: Expense }> {
  const id = `local_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const now = new Date().toISOString();

  const expense = {
    id,
    userId: expenseData.userId,
    date: expenseData.date,
    amount: parseFloat(String(expenseData.amount)) || 0,
    category: expenseData.category || 'other',
    description: expenseData.description || '',
    createdAt: now,
    updatedAt: now,
  };

  await offlineExpenses.put({
    ...expense,
    _synced: 0,
    _dirty: Date.now(),
  });

  if (isOnline()) {
    try {
      const { createExpense } = await import('./supabase-service');
      const result = await createExpense(expenseData);
      await offlineExpenses.put({
        ...result.expense,
        _synced: Date.now(),
        _dirty: 0,
      });
      await offlineExpenses.delete(id);
      return result;
    } catch {
      // Keep local - will sync later
    }
  }

  return { expense: expense as Expense };
}

export async function updateExpenseOffline(id: string, updates: { amount?: number; category?: string; description?: string }, userId: string): Promise<{ expense: Expense }> {
  const allExpenses = await offlineExpenses.getAll(userId);
  const existing = allExpenses.find(e => e.id === id);
  
  if (!existing) {
    throw new Error('Expense not found');
  }

  const updatedExpense = {
    ...existing,
    ...(updates.amount !== undefined ? { amount: parseFloat(String(updates.amount)) } : {}),
    ...(updates.category !== undefined ? { category: updates.category } : {}),
    ...(updates.description !== undefined ? { description: updates.description } : {}),
    updatedAt: new Date().toISOString(),
  };

  await offlineExpenses.put({
    ...updatedExpense,
    _synced: existing._synced,
    _dirty: Date.now(),
  });

  if (isOnline()) {
    try {
      const { updateExpense } = await import('./supabase-service');
      const result = await updateExpense(id, updates);
      await offlineExpenses.put({
        ...result.expense,
        _synced: Date.now(),
        _dirty: 0,
      });
      return result;
    } catch {
      // Keep local changes
    }
  }

  const { _synced, _dirty, ...expData } = updatedExpense;
  return { expense: expData as unknown as Expense };
}

export async function deleteExpenseOffline(id: string, userId: string): Promise<{ success: boolean }> {
  await offlineExpenses.delete(id);
  await offlinePendingDeletes.add('expenses', id, userId);

  if (isOnline()) {
    try {
      const { deleteExpense } = await import('./supabase-service');
      await deleteExpense(id);
      await offlinePendingDeletes.removeByItemId('expenses', id);
    } catch {
      // Will retry on next sync
    }
  }

  return { success: true };
}

// ============ CASH ENTRIES (Offline-First) ============

export async function getCashEntriesOffline(userId: string, options?: { period?: string; date?: string; from?: string; to?: string }) {
  try {
    let localEntries = await offlineCashEntries.getAll(userId);
    
    if (options?.from) localEntries = localEntries.filter(e => e.date >= options.from!);
    if (options?.to) localEntries = localEntries.filter(e => e.date <= options.to!);

    if (localEntries.length > 0 || !isOnline()) {
      const entries = localEntries.map(({ _synced, _dirty, ...entry }) => entry as unknown as CashEntry);
      const sortedByDate = [...localEntries].sort((a, b) => b.date.localeCompare(a.date));
      const latest = sortedByDate[0];
      const totalHandCash = latest?.handCash || 0;
      const totalLiquidCash = latest?.liquidCash || 0;

      if (isOnline()) syncFromSupabase(userId).catch(() => {});

      return {
        entries,
        summary: { totalHandCash, totalLiquidCash, totalCash: totalHandCash + totalLiquidCash },
      };
    }

    if (isOnline()) {
      const { getCashEntries } = await import('./supabase-service');
      return getCashEntries(userId, options);
    }

    return { entries: [], summary: { totalHandCash: 0, totalLiquidCash: 0, totalCash: 0 } };
  } catch {
    if (isOnline()) {
      const { getCashEntries } = await import('./supabase-service');
      return getCashEntries(userId, options);
    }
    return { entries: [], summary: { totalHandCash: 0, totalLiquidCash: 0, totalCash: 0 } };
  }
}

export async function upsertCashEntryOffline(entryData: {
  userId: string;
  date: string;
  handCash?: number;
  liquidCash?: number;
  note?: string;
}): Promise<{ entry: CashEntry }> {
  const now = new Date().toISOString();
  
  // Check if entry exists for this date
  const allEntries = await offlineCashEntries.getAll(entryData.userId);
  const existing = allEntries.find(e => e.date === entryData.date);
  
  let entry: CashEntry;
  
  if (existing) {
    // Update existing
    const updated = {
      ...existing,
      handCash: entryData.handCash !== undefined ? entryData.handCash : existing.handCash,
      liquidCash: entryData.liquidCash !== undefined ? entryData.liquidCash : existing.liquidCash,
      note: entryData.note !== undefined ? entryData.note : existing.note,
      updatedAt: now,
    };
    
    await offlineCashEntries.put({
      ...updated,
      _synced: existing._synced,
      _dirty: Date.now(),
    });
    
    const { _synced, _dirty, ...entryData2 } = updated;
    entry = entryData2 as unknown as CashEntry;
  } else {
    // Create new
    const id = `local_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const newEntry = {
      id,
      userId: entryData.userId,
      date: entryData.date,
      handCash: entryData.handCash || 0,
      liquidCash: entryData.liquidCash || 0,
      note: entryData.note || '',
      createdAt: now,
      updatedAt: now,
    };
    
    await offlineCashEntries.put({
      ...newEntry,
      _synced: 0,
      _dirty: Date.now(),
    });
    
    entry = newEntry as CashEntry;
  }

  // Try to sync to Supabase if online
  if (isOnline()) {
    try {
      const { upsertCashEntry } = await import('./supabase-service');
      const result = await upsertCashEntry(entryData);
      // Update local with server version
      if (existing) {
        await offlineCashEntries.put({
          ...result.entry,
          _synced: Date.now(),
          _dirty: 0,
        });
      } else {
        await offlineCashEntries.put({
          ...result.entry,
          _synced: Date.now(),
          _dirty: 0,
        });
        await offlineCashEntries.delete((entry as { id: string }).id);
      }
      return result;
    } catch {
      // Keep local
    }
  }

  return { entry };
}

export async function updateCashEntryOffline(id: string, updates: { handCash?: number; liquidCash?: number; note?: string }, userId: string): Promise<{ entry: CashEntry }> {
  const allEntries = await offlineCashEntries.getAll(userId);
  const existing = allEntries.find(e => e.id === id);
  
  if (!existing) {
    throw new Error('Cash entry not found');
  }

  const updatedEntry = {
    ...existing,
    ...(updates.handCash !== undefined ? { handCash: updates.handCash } : {}),
    ...(updates.liquidCash !== undefined ? { liquidCash: updates.liquidCash } : {}),
    ...(updates.note !== undefined ? { note: updates.note } : {}),
    updatedAt: new Date().toISOString(),
  };

  await offlineCashEntries.put({
    ...updatedEntry,
    _synced: existing._synced,
    _dirty: Date.now(),
  });

  if (isOnline()) {
    try {
      const { updateCashEntry } = await import('./supabase-service');
      const result = await updateCashEntry(id, updates);
      await offlineCashEntries.put({
        ...result.entry,
        _synced: Date.now(),
        _dirty: 0,
      });
      return result;
    } catch {
      // Keep local
    }
  }

  const { _synced, _dirty, ...entryData } = updatedEntry;
  return { entry: entryData as unknown as CashEntry };
}

export async function deleteCashEntryOffline(id: string, userId: string): Promise<{ success: boolean }> {
  await offlineCashEntries.delete(id);
  await offlinePendingDeletes.add('cashEntries', id, userId);

  if (isOnline()) {
    try {
      const { deleteCashEntry } = await import('./supabase-service');
      await deleteCashEntry(id);
      await offlinePendingDeletes.removeByItemId('cashEntries', id);
    } catch {
      // Will retry on next sync
    }
  }

  return { success: true };
}

// ============ REPORTS (Offline-First) ============

export async function getReportsOffline(userId: string, type: string, options?: { from?: string; to?: string }) {
  try {
    // Reports are computed from local data - always works offline!
    const [localProducts, localCategories, localTransactions] = await Promise.all([
      offlineProducts.getAll(userId),
      offlineCategories.getAll(userId),
      offlineTransactions.getAll(userId),
    ]);

    const products = localProducts.map(({ _synced, _dirty, ...p }) => p as unknown as Product);
    const categories = localCategories.map(({ _synced, _dirty, ...c }) => c as unknown as Category);
    const transactions = localTxnsToTransactions(localTransactions);

    // Apply date filters
    let filteredTxns = transactions;
    if (options?.from) filteredTxns = filteredTxns.filter(t => t.date >= options.from!);
    if (options?.to) filteredTxns = filteredTxns.filter(t => t.date <= options.to!);

    // If no local data and online, fall back to Supabase
    if (products.length === 0 && transactions.length === 0 && isOnline()) {
      const { getReports } = await import('./supabase-service');
      return getReports(userId, type, options);
    }

    if (type === 'stock-value') {
      // Stock value report from local data
      const productCountMap: Record<string, number> = {};
      for (const p of products) {
        productCountMap[p.categoryId] = (productCountMap[p.categoryId] || 0) + 1;
      }

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
            stockValue: p.quantity * p.sellingPrice,
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

      // Background sync
      if (isOnline()) syncFromSupabase(userId).catch(() => {});

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
        const product = products.find(p => p.id === t.productId);

        if (t.type === 'SELL') {
          entry.revenue += t.totalAmount || 0;
          entry.cost += (t.quantity || 0) * (product?.purchasePrice ?? 0);
          entry.profit += (t.totalAmount || 0) - (t.quantity || 0) * (product?.purchasePrice ?? 0);
          entry.sell += t.quantity || 0;
        } else if (t.type === 'STOCK_IN') {
          entry.cost += (t.quantity || 0) * (t.unitPrice || 0);
          entry.stockIn += t.quantity || 0;
        } else if (t.type === 'STOCK_OUT') {
          entry.stockOut += t.quantity || 0;
        }
      }

      const result = {
        type: 'daily',
        data: Array.from(dailyMap.values()).sort((a, b) => b.date.localeCompare(a.date)),
        grandTotal: {
          totalRevenue: Array.from(dailyMap.values()).reduce((s, d) => s + d.revenue, 0),
          totalCost: Array.from(dailyMap.values()).reduce((s, d) => s + d.cost, 0),
          totalProfit: Array.from(dailyMap.values()).reduce((s, d) => s + d.profit, 0),
          totalStockIn: Array.from(dailyMap.values()).reduce((s, d) => s + d.stockIn, 0),
          totalStockOut: Array.from(dailyMap.values()).reduce((s, d) => s + d.stockOut, 0),
          totalSell: Array.from(dailyMap.values()).reduce((s, d) => s + d.sell, 0),
        },
      };

      if (isOnline()) syncFromSupabase(userId).catch(() => {});
      return result;
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
        const product = products.find(p => p.id === t.productId);

        if (t.type === 'SELL') {
          entry.revenue += t.totalAmount || 0;
          entry.cost += (t.quantity || 0) * (product?.purchasePrice ?? 0);
          entry.profit += (t.totalAmount || 0) - (t.quantity || 0) * (product?.purchasePrice ?? 0);
          entry.sell += t.quantity || 0;
        } else if (t.type === 'STOCK_IN') {
          entry.cost += (t.quantity || 0) * (t.unitPrice || 0);
          entry.stockIn += t.quantity || 0;
        } else if (t.type === 'STOCK_OUT') {
          entry.stockOut += t.quantity || 0;
        }
      }

      const result = {
        type: 'monthly',
        data: Array.from(monthlyMap.values()).sort((a, b) => b.month.localeCompare(a.month)),
        grandTotal: {
          totalRevenue: Array.from(monthlyMap.values()).reduce((s, d) => s + d.revenue, 0),
          totalCost: Array.from(monthlyMap.values()).reduce((s, d) => s + d.cost, 0),
          totalProfit: Array.from(monthlyMap.values()).reduce((s, d) => s + d.profit, 0),
          totalStockIn: Array.from(monthlyMap.values()).reduce((s, d) => s + d.stockIn, 0),
          totalStockOut: Array.from(monthlyMap.values()).reduce((s, d) => s + d.stockOut, 0),
          totalSell: Array.from(monthlyMap.values()).reduce((s, d) => s + d.sell, 0),
        },
      };

      if (isOnline()) syncFromSupabase(userId).catch(() => {});
      return result;
    }

    // Category report
    if (type === 'category') {
      const categoryMap = new Map<string, {
        categoryId: string; categoryName: string;
        revenue: number; cost: number; profit: number;
        stockIn: number; stockOut: number; sell: number; quantity: number;
      }>();

      for (const t of filteredTxns) {
        const product = products.find(p => p.id === t.productId);
        const cat = categories.find(c => c.id === product?.categoryId);
        const catId = cat?.id || 'unknown';
        const catName = cat?.name || 'Unknown';

        if (!categoryMap.has(catId)) {
          categoryMap.set(catId, { categoryId: catId, categoryName: catName, revenue: 0, cost: 0, profit: 0, stockIn: 0, stockOut: 0, sell: 0, quantity: 0 });
        }
        const entry = categoryMap.get(catId)!;

        if (t.type === 'SELL') {
          entry.revenue += t.totalAmount || 0;
          entry.cost += (t.quantity || 0) * (product?.purchasePrice ?? 0);
          entry.profit += (t.totalAmount || 0) - (t.quantity || 0) * (product?.purchasePrice ?? 0);
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

      const result = {
        type: 'category',
        data: Array.from(categoryMap.values()).sort((a, b) => b.revenue - a.revenue),
        grandTotal: {
          totalRevenue: Array.from(categoryMap.values()).reduce((s, d) => s + d.revenue, 0),
          totalCost: Array.from(categoryMap.values()).reduce((s, d) => s + d.cost, 0),
          totalProfit: Array.from(categoryMap.values()).reduce((s, d) => s + d.profit, 0),
          totalStockIn: Array.from(categoryMap.values()).reduce((s, d) => s + d.stockIn, 0),
          totalStockOut: Array.from(categoryMap.values()).reduce((s, d) => s + d.stockOut, 0),
          totalSell: Array.from(categoryMap.values()).reduce((s, d) => s + d.sell, 0),
          totalQuantity: Array.from(categoryMap.values()).reduce((s, d) => s + d.quantity, 0),
        },
      };

      if (isOnline()) syncFromSupabase(userId).catch(() => {});
      return result;
    }

    // Fallback to online for unknown report types
    if (isOnline()) {
      const { getReports } = await import('./supabase-service');
      return getReports(userId, type, options);
    }

    return { type, data: [], grandTotal: {} };
  } catch {
    if (isOnline()) {
      const { getReports } = await import('./supabase-service');
      return getReports(userId, type, options);
    }
    return { type, data: [], grandTotal: {} };
  }
}

// ============ PROFILE (Offline-aware) ============

export async function getProfileOffline(userId: string) {
  // Profile data is kept in zustand store (persisted to localStorage)
  // If online, try to fetch fresh data
  if (isOnline()) {
    try {
      const { getProfile } = await import('./supabase-service');
      return getProfile(userId);
    } catch {
      // Return cached user from store
    }
  }
  
  // Return null - the calling code should use the cached user from store
  return null;
}

export async function updateProfileOffline(id: string, updates: { name?: string; shopName?: string; language?: string; theme?: string }) {
  // Profile updates go directly to Supabase if online
  // If offline, we save locally and retry when online
  if (isOnline()) {
    try {
      const { updateProfile } = await import('./supabase-service');
      return updateProfile(id, updates);
    } catch {
      // Fall through to offline handling
    }
  }
  
  // Store the update for later sync
  // The zustand store already has the updated values, so they persist
  // We'll sync when coming back online
  return { user: { id, ...updates } };
}

// ============ BACKUP (Offline-aware) ============

export async function exportBackupOffline(userId: string) {
  // Export from local data - always works offline!
  const [localCategories, localProducts, localTransactions, localExpenses, localCashEntries] = await Promise.all([
    offlineCategories.getAll(userId),
    offlineProducts.getAll(userId),
    offlineTransactions.getAll(userId),
    offlineExpenses.getAll(userId),
    offlineCashEntries.getAll(userId),
  ]);

  const categories = localCategories.map(({ _synced, _dirty, ...c }) => c);
  const products = localProducts.map(({ _synced, _dirty, category, ...p }) => p);
  const transactions = localTransactions.map(({ _synced, _dirty, product, ...t }) => t);
  const expenses = localExpenses.map(({ _synced, _dirty, ...e }) => e);
  const cashEntries = localCashEntries.map(({ _synced, _dirty, ...e }) => e);

  return {
    categories,
    products,
    transactions,
    expenses,
    cashEntries,
    exportedAt: new Date().toISOString(),
  };
}

export async function importBackupOffline(userId: string, backupData: {
  categories: unknown[];
  products: unknown[];
  transactions: unknown[];
  expenses?: unknown[];
  cashEntries?: unknown[];
}) {
  // Import to local IndexedDB first
  const now = Date.now();

  // Import categories
  if (backupData.categories?.length) {
    await offlineCategories.putBulk(
      backupData.categories.map((cat: Record<string, unknown>) => ({
        ...cat,
        userId,
        _synced: 0,
        _dirty: now,
      }))
    );
  }

  // Import products
  if (backupData.products?.length) {
    await offlineProducts.putBulk(
      backupData.products.map((prod: Record<string, unknown>) => ({
        ...prod,
        userId,
        _synced: 0,
        _dirty: now,
      }))
    );
  }

  // Import transactions
  if (backupData.transactions?.length) {
    await offlineTransactions.putBulk(
      backupData.transactions.map((txn: Record<string, unknown>) => ({
        ...txn,
        userId,
        _synced: 0,
        _dirty: now,
      }))
    );
  }

  // Import expenses
  if (backupData.expenses?.length) {
    await offlineExpenses.putBulk(
      backupData.expenses.map((exp: Record<string, unknown>) => ({
        ...exp,
        userId,
        _synced: 0,
        _dirty: now,
      }))
    );
  }

  // Import cash entries
  if (backupData.cashEntries?.length) {
    await offlineCashEntries.putBulk(
      backupData.cashEntries.map((entry: Record<string, unknown>) => ({
        ...entry,
        userId,
        _synced: 0,
        _dirty: now,
      }))
    );
  }

  // Try to sync to Supabase if online
  if (isOnline()) {
    try {
      const { importBackup } = await import('./supabase-service');
      await importBackup(userId, backupData);
      // Mark all as synced
      await syncFromSupabase(userId);
    } catch {
      // Will sync later
    }
  }

  return { message: 'Backup imported successfully' };
}

// ============ RESET DATA (Offline) ============

export async function resetDataOffline(userId: string) {
  const { clearOfflineData } = await import('./offline-db');
  await clearOfflineData(userId);
  
  if (isOnline()) {
    const { resetData } = await import('./supabase-service');
    await resetData(userId);
  }
  
  return { message: 'All data reset successfully' };
}
