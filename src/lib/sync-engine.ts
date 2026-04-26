/**
 * Sync Engine - Automatic two-way sync between Supabase and local IndexedDB
 * 
 * Strategy:
 * 1. READ: Always read from local IndexedDB first (instant). Then fetch from Supabase in background and update local.
 * 2. WRITE: Save to local IndexedDB immediately (instant). Mark as "dirty". Upload to Supabase in background.
 * 3. AUTO-SYNC: Periodic sync every 30s when online, plus sync on online event.
 */

import { supabase, generateId, toCamelCase, toSnakeCase } from './supabase';
import {
  offlineCategories,
  offlineProducts,
  offlineTransactions,
  offlineExpenses,
  offlineCashEntries,
  offlineServiceTransactions,
  offlineMeta,
  offlinePendingDeletes,
  clearOfflineData,
  type OfflineDBSchema,
} from './offline-db';
import { invalidateCache } from './cache';

// ============ ONLINE STATUS TRACKING ============

let _isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

export function isOnline(): boolean {
  return _isOnline;
}

// Listen for online/offline events
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    _isOnline = true;
    // Auto-sync when coming back online
    syncAll().catch(console.error);
    // Notify UI
    window.dispatchEvent(new CustomEvent('app:online-status', { detail: true }));
  });
  
  window.addEventListener('offline', () => {
    _isOnline = false;
    window.dispatchEvent(new CustomEvent('app:online-status', { detail: false }));
  });
}

// ============ FULL SYNC (Download all from Supabase → Local) ============

export async function syncFromSupabase(userId: string): Promise<void> {
  if (!userId || !isOnline()) return;

  try {
    // Fetch all data from Supabase in parallel
    const [
      categoriesResult,
      productsResult,
      transactionsResult,
      expensesResult,
      cashEntriesResult,
      serviceTransactionsResult,
    ] = await Promise.all([
      supabase.from('categories').select('*').eq('user_id', userId),
      supabase.from('products').select('*, category:categories(*)').eq('user_id', userId),
      supabase.from('transactions').select('*, product:products(*)').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('expenses').select('*').eq('user_id', userId),
      supabase.from('cash_entries').select('*').eq('user_id', userId).order('date', { ascending: false }),
      supabase.from('service_transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    ]);

    // Save categories to local
    if (categoriesResult.data) {
      const now = Date.now();
      // Get product counts
      const productCountMap: Record<string, number> = {};
      if (productsResult.data) {
        for (const p of productsResult.data) {
          const catId = p.category_id as string;
          if (catId) productCountMap[catId] = (productCountMap[catId] || 0) + 1;
        }
      }
      
      await offlineCategories.putBulk(
        categoriesResult.data.map((cat: Record<string, unknown>) => ({
          ...toCamelCase(cat),
          _count: { products: productCountMap[(cat as Record<string, unknown>).id as string] || 0 },
          _synced: now,
          _dirty: 0,
        })) as OfflineDBSchema['categories']['value'][]
      );
    }

    // Save products to local
    if (productsResult.data) {
      const now = Date.now();
      await offlineProducts.putBulk(
        productsResult.data.map((prod: Record<string, unknown>) => {
          const { category, ...productFields } = prod as Record<string, unknown>;
          const camelProduct = toCamelCase(productFields as Record<string, unknown>);
          if (category && typeof category === 'object') {
            const camelCat = toCamelCase(category as Record<string, unknown>);
            camelProduct.category = { id: camelCat.id as string, name: camelCat.name as string, image: camelCat.image as string };
          }
          return {
            ...camelProduct,
            _synced: now,
            _dirty: 0,
          };
        }) as OfflineDBSchema['products']['value'][]
      );
    }

    // Save transactions to local
    if (transactionsResult.data) {
      const now = Date.now();
      await offlineTransactions.putBulk(
        transactionsResult.data.map((txn: Record<string, unknown>) => {
          const { product, ...txnFields } = txn as Record<string, unknown>;
          const camelTxn = toCamelCase(txnFields);
          if (product && typeof product === 'object') {
            const camelProd = toCamelCase(product as Record<string, unknown>);
            camelTxn.product = {
              id: camelProd.id as string,
              name: camelProd.name as string,
              purchasePrice: camelProd.purchasePrice as number,
              sellingPrice: camelProd.sellingPrice as number,
            };
          }
          return {
            ...camelTxn,
            _synced: now,
            _dirty: 0,
          };
        }) as OfflineDBSchema['transactions']['value'][]
      );
    }

    // Save expenses to local
    if (expensesResult.data) {
      const now = Date.now();
      await offlineExpenses.putBulk(
        expensesResult.data.map((exp: Record<string, unknown>) => ({
          ...toCamelCase(exp),
          _synced: now,
          _dirty: 0,
        })) as OfflineDBSchema['expenses']['value'][]
      );
    }

    // Save cash entries to local
    if (cashEntriesResult.data) {
      const now = Date.now();
      await offlineCashEntries.putBulk(
        cashEntriesResult.data.map((entry: Record<string, unknown>) => ({
          ...toCamelCase(entry),
          _synced: now,
          _dirty: 0,
        })) as OfflineDBSchema['cashEntries']['value'][]
      );
    }

    // Save service transactions to local
    if (serviceTransactionsResult.data) {
      const now = Date.now();
      await offlineServiceTransactions.putBulk(
        serviceTransactionsResult.data.map((svc: Record<string, unknown>) => ({
          ...toCamelCase(svc),
          _synced: now,
          _dirty: 0,
        })) as OfflineDBSchema['serviceTransactions']['value'][]
      );
    }

    // Update sync timestamp
    await offlineMeta.setLastSync(userId, 'full-sync');
    
    // Invalidate memory cache so UI picks up fresh data
    invalidateCache();
  } catch (error) {
    console.error('Sync from Supabase failed:', error);
  }
}

// ============ PROCESS PENDING DELETES (Local Deletes → Supabase) ============

const STORE_TO_TABLE: Record<string, string> = {
  categories: 'categories',
  products: 'products',
  transactions: 'transactions',
  expenses: 'expenses',
  cashEntries: 'cash_entries',
  serviceTransactions: 'service_transactions',
};

async function processPendingDeletes(userId: string): Promise<void> {
  if (!userId || !isOnline()) return;

  const pendingDeletes = await offlinePendingDeletes.getAll(userId);
  
  for (const item of pendingDeletes) {
    try {
      const tableName = STORE_TO_TABLE[item.storeName];
      if (!tableName) {
        await offlinePendingDeletes.remove(item.id);
        continue;
      }
      
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('id', item.itemId);
      
      if (!error) {
        await offlinePendingDeletes.remove(item.id);
      }
      // If error, keep in queue for next sync attempt
    } catch (e) {
      console.error('Failed to process pending delete:', item.id, e);
    }
  }
}

// ============ UPLOAD DIRTY ITEMS (Local → Supabase) ============

export async function syncToSupabase(userId: string): Promise<void> {
  if (!userId || !isOnline()) return;

  try {
    // Upload dirty categories
    const dirtyCategories = await offlineCategories.getDirty();
    for (const cat of dirtyCategories) {
      try {
        const { _synced, _dirty, _count, ...catData } = cat;
        const snakeData = toSnakeCase(catData);
        
        // Check if exists on Supabase
        const { data: existing } = await supabase
          .from('categories')
          .select('id')
          .eq('id', cat.id)
          .single();
        
        if (existing) {
          await supabase.from('categories').update(snakeData).eq('id', cat.id);
        } else {
          await supabase.from('categories').insert(snakeData);
        }
        
        // Mark as synced
        await offlineCategories.put({ ...cat, _synced: Date.now(), _dirty: 0 });
      } catch (e) {
        console.error('Failed to sync category:', cat.id, e);
      }
    }

    // Upload dirty products
    const dirtyProducts = await offlineProducts.getDirty();
    for (const prod of dirtyProducts) {
      try {
        const { _synced, _dirty, category, ...prodData } = prod;
        const snakeData = toSnakeCase(prodData);
        
        const { data: existing } = await supabase
          .from('products')
          .select('id')
          .eq('id', prod.id)
          .single();
        
        if (existing) {
          await supabase.from('products').update(snakeData).eq('id', prod.id);
        } else {
          await supabase.from('products').insert(snakeData);
        }
        
        await offlineProducts.put({ ...prod, _synced: Date.now(), _dirty: 0 });
      } catch (e) {
        console.error('Failed to sync product:', prod.id, e);
      }
    }

    // Upload dirty transactions (these are the most critical!)
    const dirtyTransactions = await offlineTransactions.getDirty();
    for (const txn of dirtyTransactions) {
      try {
        const { _synced, _dirty, product, ...txnData } = txn;
        const snakeData = toSnakeCase(txnData);
        
        // For transactions, we need to handle the stock update too
        const { data: existing } = await supabase
          .from('transactions')
          .select('id')
          .eq('id', txn.id)
          .single();
        
        if (!existing) {
          // New transaction - need to update product stock on Supabase
          const { data: productData } = await supabase
            .from('products')
            .select('quantity')
            .eq('id', txn.productId)
            .single();
          
          if (productData) {
            const quantityChange = txn.type === 'STOCK_IN' ? txn.quantity : -txn.quantity;
            
            // Insert transaction
            const { error: insertError } = await supabase
              .from('transactions')
              .insert(snakeData);
            
            if (!insertError) {
              // Update product quantity
              await supabase
                .from('products')
                .update({ quantity: productData.quantity + quantityChange })
                .eq('id', txn.productId);
            }
          }
        }
        
        await offlineTransactions.put({ ...txn, _synced: Date.now(), _dirty: 0 });
      } catch (e) {
        console.error('Failed to sync transaction:', txn.id, e);
      }
    }

    // Upload dirty expenses
    const dirtyExpenses = await offlineExpenses.getDirty();
    for (const exp of dirtyExpenses) {
      try {
        const { _synced, _dirty, ...expData } = exp;
        const snakeData = toSnakeCase(expData);
        
        const { data: existing } = await supabase
          .from('expenses')
          .select('id')
          .eq('id', exp.id)
          .single();
        
        if (existing) {
          await supabase.from('expenses').update(snakeData).eq('id', exp.id);
        } else {
          await supabase.from('expenses').insert(snakeData);
        }
        
        await offlineExpenses.put({ ...exp, _synced: Date.now(), _dirty: 0 });
      } catch (e) {
        console.error('Failed to sync expense:', exp.id, e);
      }
    }

    // Upload dirty cash entries
    const dirtyCashEntries = await offlineCashEntries.getDirty();
    for (const entry of dirtyCashEntries) {
      try {
        const { _synced, _dirty, ...entryData } = entry;
        const snakeData = toSnakeCase(entryData);
        
        const { data: existing } = await supabase
          .from('cash_entries')
          .select('id')
          .eq('id', entry.id)
          .single();
        
        if (existing) {
          await supabase.from('cash_entries').update(snakeData).eq('id', entry.id);
        } else {
          await supabase.from('cash_entries').insert(snakeData);
        }
        
        await offlineCashEntries.put({ ...entry, _synced: Date.now(), _dirty: 0 });
      } catch (e) {
        console.error('Failed to sync cash entry:', entry.id, e);
      }
    }

    // Upload dirty service transactions
    const dirtyServiceTransactions = await offlineServiceTransactions.getDirty();
    for (const svc of dirtyServiceTransactions) {
      try {
        const { _synced, _dirty, ...svcData } = svc;
        const snakeData = toSnakeCase(svcData);
        
        const { data: existing } = await supabase
          .from('service_transactions')
          .select('id')
          .eq('id', svc.id)
          .single();
        
        if (existing) {
          await supabase.from('service_transactions').update(snakeData).eq('id', svc.id);
        } else {
          await supabase.from('service_transactions').insert(snakeData);
        }
        
        await offlineServiceTransactions.put({ ...svc, _synced: Date.now(), _dirty: 0 });
      } catch (e) {
        console.error('Failed to sync service transaction:', svc.id, e);
      }
    }
  } catch (error) {
    console.error('Sync to Supabase failed:', error);
  }
}

// ============ SYNC ALL ============

export async function syncAll(): Promise<void> {
  // Get current user from store
  const { useAppStore } = await import('@/store/appStore');
  const userId = useAppStore.getState().user?.id;
  if (!userId || !isOnline()) return;

  // First process pending deletes, then upload local changes, then sync profile, then download fresh data
  await processPendingDeletes(userId);
  await syncToSupabase(userId);
  await syncPendingProfile(userId);
  await syncFromSupabase(userId);
}

// ============ SYNC PENDING PROFILE UPDATES ============

async function syncPendingProfile(userId: string): Promise<void> {
  if (!userId || !isOnline()) return;

  const { getPendingProfileUpdates, clearPendingProfileUpdates } = await import('./offline-service');
  const pendingUpdates = getPendingProfileUpdates(userId);
  if (pendingUpdates) {
    try {
      const { updateProfile } = await import('./supabase-service');
      await updateProfile(userId, pendingUpdates);
      clearPendingProfileUpdates(userId);
    } catch (e) {
      console.error('Failed to sync pending profile updates:', e);
    }
  }
}

// ============ AUTO-SYNC TIMER ============

let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoSync(intervalMs = 30000): void {
  if (syncInterval) return; // Already running
  
  // Initial sync
  syncAll().catch(console.error);
  
  // Periodic sync
  syncInterval = setInterval(() => {
    if (isOnline()) {
      syncAll().catch(console.error);
    }
  }, intervalMs);
}

export function stopAutoSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

// ============ INITIAL SYNC FOR USER ============

export async function initialSyncForUser(userId: string): Promise<void> {
  if (!userId) return;

  // Check when we last synced
  const lastSync = await offlineMeta.getLastSync(userId, 'full-sync');
  const timeSinceSync = Date.now() - lastSync;

  // If never synced or >5 min ago, do a full sync
  if (lastSync === 0 || timeSinceSync > 5 * 60 * 1000) {
    await syncFromSupabase(userId);
  }

  // Start auto-sync
  startAutoSync();
}

// ============ RESET ALL DATA ============

export async function resetAllOfflineData(userId: string): Promise<void> {
  await clearOfflineData(userId);
}
