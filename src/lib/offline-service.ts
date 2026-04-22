/**
 * Offline-First Service Layer
 * 
 * READ STRATEGY: Local IndexedDB first → instant response. Then fetch from Supabase in background.
 * WRITE STRATEGY: Save to local IndexedDB immediately (mark dirty) → upload to Supabase in background.
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
} from './offline-db';
import { Category, Product, Transaction, Expense, CashEntry } from './types';

// ============ CATEGORIES (Offline-First) ============

export async function getCategoriesOffline(userId: string): Promise<Category[]> {
  try {
    // 1. Try local IndexedDB first (instant)
    const localCats = await offlineCategories.getAll(userId);
    
    if (localCats.length > 0) {
      // Return local data immediately
      const cats = localCats.map(({ _synced, _dirty, ...cat }) => cat as unknown as Category);
      
      // Background: fetch fresh data from Supabase if online
      if (isOnline()) {
        syncFromSupabase(userId).catch(() => {});
      }
      return cats;
    }
    
    // 2. No local data — must fetch from Supabase
    if (isOnline()) {
      const { getCategories } = await import('./supabase-service');
      const result = await getCategories(userId);
      return result.categories as Category[];
    }
    
    // 3. Offline with no local data
    return [];
  } catch {
    // Fallback to online method
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

  // Save to local IndexedDB immediately (mark as dirty for sync)
  await offlineCategories.put({
    ...category,
    _synced: 0,
    _dirty: Date.now(),
  });

  // Try to upload to Supabase if online
  if (isOnline()) {
    try {
      const { createCategory } = await import('./supabase-service');
      const result = await createCategory(name, image, userId);
      // Replace local entry with Supabase entry (has real ID)
      await offlineCategories.put({
        ...result.category,
        _synced: Date.now(),
        _dirty: 0,
      });
      // Delete the temporary local entry
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
      
      // Background sync if online
      if (isOnline()) {
        syncFromSupabase(userId).catch(() => {});
      }
      return prods;
    }

    // No local data — fetch from Supabase
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

  // Save locally immediately
  await offlineProducts.put({
    ...product,
    _synced: 0,
    _dirty: Date.now(),
  });

  // Upload to Supabase if online
  if (isOnline()) {
    try {
      const { createProduct } = await import('./supabase-service');
      const result = await createProduct(productData);
      // Replace local with server version
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
  // Get existing product from local
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

  // Save locally with dirty flag
  await offlineProducts.put({
    ...updatedProduct,
    _synced: product._synced,
    _dirty: Date.now(),
  });

  // Update on Supabase if online
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

  // Get the product to check stock and update quantity
  const products = await offlineProducts.getAll(transactionData.userId);
  const product = products.find(p => p.id === transactionData.productId);

  if (!product) {
    throw new Error('Product not found');
  }

  // Check stock for STOCK_OUT and SELL
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

  // Save transaction locally
  await offlineTransactions.put({
    ...transaction,
    _synced: 0,
    _dirty: Date.now(),
  });

  // Update product quantity locally
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

  // Upload to Supabase if online
  if (isOnline()) {
    try {
      const { createTransaction } = await import('./supabase-service');
      const result = await createTransaction(transactionData);
      // Replace local entries with server versions
      await offlineTransactions.put({
        ...result.transaction,
        _synced: Date.now(),
        _dirty: 0,
      });
      await offlineTransactions.delete(id);
      // Update product with server data
      const serverProducts = await offlineProducts.getAll(transactionData.userId);
      const serverProduct = serverProducts.find(p => p.id === transactionData.productId);
      if (serverProduct) {
        await offlineProducts.put({
          ...serverProduct,
          quantity: product.quantity + quantityChange, // Use computed quantity
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
    
    // Apply filters
    if (options?.type) {
      localTxns = localTxns.filter(t => t.type === options.type);
    }
    if (options?.from) {
      localTxns = localTxns.filter(t => t.date >= options.from!);
    }
    if (options?.to) {
      localTxns = localTxns.filter(t => t.date <= options.to!);
    }

    if (localTxns.length > 0) {
      const txns = localTxns.map(({ _synced, _dirty, ...txn }) => txn as unknown as Transaction);
      
      if (isOnline()) {
        syncFromSupabase(userId).catch(() => {});
      }
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
  // Dashboard is computed from local data - always works offline!
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
      // No local data at all — fetch from Supabase
      const { getDashboard } = await import('./supabase-service');
      const result = await getDashboard(userId);
      // Trigger background sync to save to local
      syncFromSupabase(userId).catch(() => {});
      return result;
    }

    // Compute dashboard from local data
    const today = new Date().toISOString().split('T')[0];
    const todayTxns = transactions.filter(t => t.date === today);
    
    const lowItems = products.filter(p => p.quantity <= p.lowStockThreshold).length;
    const stockValue = products.reduce((sum, p) => sum + p.quantity * p.sellingPrice, 0);
    const lowStockProducts = products.filter(p => p.quantity <= p.lowStockThreshold).slice(0, 10);
    const recentTransactions = transactions.slice(0, 5);

    // Product counts per category
    const productCountMap: Record<string, number> = {};
    for (const p of products) {
      productCountMap[p.categoryId] = (productCountMap[p.categoryId] || 0) + 1;
    }
    const catsWithCount = categories.map(c => ({
      ...c,
      _count: { products: productCountMap[c.id] || 0 },
    }));

    // 7-day sale overview
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

    // Stock overview by category
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

    // Background sync if online
    if (isOnline()) {
      syncFromSupabase(userId).catch(() => {});
    }

    return result;
  } catch {
    // Fallback to online
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

// ============ CASH ENTRIES (Offline-First) ============

export async function getCashEntriesOffline(userId: string, options?: { period?: string; date?: string; from?: string; to?: string }) {
  try {
    let localEntries = await offlineCashEntries.getAll(userId);
    
    if (options?.from) localEntries = localEntries.filter(e => e.date >= options.from!);
    if (options?.to) localEntries = localEntries.filter(e => e.date <= options.to!);

    if (localEntries.length > 0 || !isOnline()) {
      const entries = localEntries.map(({ _synced, _dirty, ...entry }) => entry as unknown as CashEntry);
      // Find latest entry for summary
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
