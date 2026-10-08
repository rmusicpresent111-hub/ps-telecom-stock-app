/**
 * Sync Engine - Automatic two-way sync between Supabase and local IndexedDB
 *
 * Strategy:
 * 1. READ: Always read from local IndexedDB first (instant). Then fetch from Supabase in background and update local.
 * 2. WRITE: Save to local IndexedDB immediately (instant). Mark as "dirty". Upload to Supabase in background.
 * 3. AUTO-SYNC: Periodic sync every 30s when online, plus sync on online event.
 *
 * Safety rules:
 * - All syncs are serialized through a mutex (no concurrent syncs clobbering each other).
 * - Every Supabase write checks { error } — items stay dirty until the server confirms.
 * - Downloads never overwrite locally-dirty (unsynced) rows.
 * - Transaction uploads apply stock deltas only when the server quantity doesn't already match local.
 */

import { supabase, toCamelCase, toSnakeCase } from './supabase';
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

// ============ SYNC MUTEX (prevents concurrent syncs) ============

let _syncChain: Promise<unknown> = Promise.resolve();

function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = _syncChain.then(fn, fn);
  // Keep the chain alive even if this run fails
  _syncChain = run.catch(() => undefined);
  return run;
}

// ============ FULL SYNC (Download all from Supabase → Local) ============

async function doSyncFromSupabase(userId: string): Promise<void> {
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

    // Locally-dirty rows must NEVER be overwritten by a download —
    // they still hold unsynced edits that syncToSupabase will upload later.
    const [
      dirtyCatIds,
      dirtyProdIds,
      dirtyTxnIds,
      dirtyExpIds,
      dirtyCashIds,
      dirtySvcIds,
    ] = await Promise.all([
      offlineCategories.getDirty().then(items => new Set(items.map(i => i.id))),
      offlineProducts.getDirty().then(items => new Set(items.map(i => i.id))),
      offlineTransactions.getDirty().then(items => new Set(items.map(i => i.id))),
      offlineExpenses.getDirty().then(items => new Set(items.map(i => i.id))),
      offlineCashEntries.getDirty().then(items => new Set(items.map(i => i.id))),
      offlineServiceTransactions.getDirty().then(items => new Set(items.map(i => i.id))),
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

      const rows = (categoriesResult.data as Record<string, unknown>[])
        .filter(cat => !dirtyCatIds.has(cat.id as string))
        .map((cat: Record<string, unknown>) => ({
          ...toCamelCase(cat),
          _count: { products: productCountMap[cat.id as string] || 0 },
          _synced: now,
          _dirty: 0,
        })) as OfflineDBSchema['categories']['value'][];
      if (rows.length > 0) await offlineCategories.putBulk(rows);
    }

    // Save products to local
    if (productsResult.data) {
      const now = Date.now();
      const rows = (productsResult.data as Record<string, unknown>[])
        .filter(prod => !dirtyProdIds.has(prod.id as string))
        .map((prod: Record<string, unknown>) => {
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
        }) as OfflineDBSchema['products']['value'][];
      if (rows.length > 0) await offlineProducts.putBulk(rows);
    }

    // Save transactions to local
    if (transactionsResult.data) {
      const now = Date.now();
      const rows = (transactionsResult.data as Record<string, unknown>[])
        .filter(txn => !dirtyTxnIds.has(txn.id as string))
        .map((txn: Record<string, unknown>) => {
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
        }) as OfflineDBSchema['transactions']['value'][];
      if (rows.length > 0) await offlineTransactions.putBulk(rows);
    }

    // Save expenses to local
    if (expensesResult.data) {
      const now = Date.now();
      const rows = (expensesResult.data as Record<string, unknown>[])
        .filter(exp => !dirtyExpIds.has(exp.id as string))
        .map((exp: Record<string, unknown>) => ({
          ...toCamelCase(exp),
          _synced: now,
          _dirty: 0,
        })) as OfflineDBSchema['expenses']['value'][];
      if (rows.length > 0) await offlineExpenses.putBulk(rows);
    }

    // Save cash entries to local
    if (cashEntriesResult.data) {
      const now = Date.now();
      const rows = (cashEntriesResult.data as Record<string, unknown>[])
        .filter(entry => !dirtyCashIds.has(entry.id as string))
        .map((entry: Record<string, unknown>) => ({
          ...toCamelCase(entry),
          _synced: now,
          _dirty: 0,
        })) as OfflineDBSchema['cashEntries']['value'][];
      if (rows.length > 0) await offlineCashEntries.putBulk(rows);
    }

    // Save service transactions to local
    if (serviceTransactionsResult.data) {
      const now = Date.now();
      const rows = (serviceTransactionsResult.data as Record<string, unknown>[])
        .filter(svc => !dirtySvcIds.has(svc.id as string))
        .map((svc: Record<string, unknown>) => ({
          ...toCamelCase(svc),
          _synced: now,
          _dirty: 0,
        })) as OfflineDBSchema['serviceTransactions']['value'][];
      if (rows.length > 0) await offlineServiceTransactions.putBulk(rows);
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

// ============ GENERIC DIRTY UPLOAD HELPERS ============

async function upsertDirtyItems<K extends 'categories' | 'products' | 'expenses' | 'cashEntries' | 'serviceTransactions'>(
  items: OfflineDBSchema[K]['value'][],
  tableName: string,
  put: (item: OfflineDBSchema[K]['value']) => Promise<void>
): Promise<void> {
  for (const item of items) {
    try {
      const { _synced: _s, _dirty: _d, ...itemData } = item as (OfflineDBSchema[K]['value'] & { _synced: number; _dirty: number });
      const snakeData = toSnakeCase(itemData as unknown as Record<string, unknown>);

      const { data: existing, error: existErr } = await supabase
        .from(tableName)
        .select('id')
        .eq('id', item.id)
        .maybeSingle();
      if (existErr) throw existErr;

      const { error } = existing
        ? await supabase.from(tableName).update(snakeData).eq('id', item.id)
        : await supabase.from(tableName).insert(snakeData);
      if (error) throw error;

      // Only mark synced after the server confirmed the write
      await put(item as OfflineDBSchema[K]['value']);
    } catch (e) {
      console.error(`Failed to sync ${tableName} item:`, item.id, e);
      // Item stays dirty — it will retry on the next sync
    }
  }
}

// ============ UPLOAD DIRTY ITEMS (Local → Supabase) ============

async function doSyncToSupabase(userId: string): Promise<void> {
  if (!userId || !isOnline()) return;

  try {
    // Upload dirty categories
    await upsertDirtyItems(
      await offlineCategories.getDirty(),
      'categories',
      async (cat) => { await offlineCategories.put({ ...(cat as OfflineDBSchema['categories']['value']), _synced: Date.now(), _dirty: 0 }); }
    );

    // Upload dirty products
    await upsertDirtyItems(
      await offlineProducts.getDirty(),
      'products',
      async (prod) => { await offlineProducts.put({ ...(prod as OfflineDBSchema['products']['value']), _synced: Date.now(), _dirty: 0 }); }
    );

    // Upload dirty transactions (these are the most critical!)
    const dirtyTransactions = await offlineTransactions.getDirty();
    for (const txn of dirtyTransactions) {
      try {
        const { _synced: _s, _dirty: _d, product: _p, ...txnData } = txn as OfflineDBSchema['transactions']['value'];
        const snakeData = toSnakeCase(txnData as unknown as Record<string, unknown>);

        const { data: existing, error: existErr } = await supabase
          .from('transactions')
          .select('id')
          .eq('id', txn.id)
          .maybeSingle();
        if (existErr) throw existErr;

        if (!existing) {
          // New transaction — make sure the parent product exists on the server first
          const { data: serverProd, error: prodErr } = await supabase
            .from('products')
            .select('quantity')
            .eq('id', txn.productId)
            .maybeSingle();
          if (prodErr) throw prodErr;

          if (!serverProd) {
            // Product was never uploaded (e.g. created fully offline) — upload it now
            const localProducts = await offlineProducts.getAll(txn.userId);
            const localProd = localProducts.find(p => p.id === txn.productId);
            if (localProd) {
              const { _synced: _ps, _dirty: _pd, category: _pc, ...prodData } = localProd;
              const { error: insProdErr } = await supabase
                .from('products')
                .insert(toSnakeCase(prodData as unknown as Record<string, unknown>));
              if (insProdErr) throw insProdErr;
            } else {
              // Orphan transaction: product doesn't exist locally or remotely.
              // Mark synced to avoid an infinite retry loop (data was already applied locally).
              console.warn('Orphan transaction skipped (product missing everywhere):', txn.id);
              await offlineTransactions.put({ ...txn, _synced: Date.now(), _dirty: 0 });
              continue;
            }
          }

          // Insert the transaction
          const { error: insertError } = await supabase
            .from('transactions')
            .insert(snakeData);
          if (insertError) throw insertError;

          // Apply the stock delta ONLY if the server quantity doesn't already reflect
          // the local quantity (products uploaded dirty carry their absolute quantity,
          // so the delta was already included — applying it again would double-count).
          const { data: prodAfter } = await supabase
            .from('products')
            .select('quantity')
            .eq('id', txn.productId)
            .maybeSingle();
          const localProductsAfter = await offlineProducts.getAll(txn.userId);
          const localProdAfter = localProductsAfter.find(p => p.id === txn.productId);
          if (prodAfter && localProdAfter && prodAfter.quantity !== localProdAfter.quantity) {
            const quantityChange = txn.type === 'STOCK_IN' ? txn.quantity : -txn.quantity;
            const { error: qtyErr } = await supabase
              .from('products')
              .update({ quantity: prodAfter.quantity + quantityChange })
              .eq('id', txn.productId);
            if (qtyErr) console.error('Failed to update product quantity on server:', txn.productId, qtyErr);
          }
        }

        // Mark synced only after confirmed success
        await offlineTransactions.put({ ...txn, _synced: Date.now(), _dirty: 0 });
      } catch (e) {
        console.error('Failed to sync transaction:', txn.id, e);
        // Transaction stays dirty — will retry on next sync
      }
    }

    // Upload dirty expenses
    await upsertDirtyItems(
      await offlineExpenses.getDirty(),
      'expenses',
      async (exp) => { await offlineExpenses.put({ ...(exp as OfflineDBSchema['expenses']['value']), _synced: Date.now(), _dirty: 0 }); }
    );

    // Upload dirty cash entries
    await upsertDirtyItems(
      await offlineCashEntries.getDirty(),
      'cash_entries',
      async (entry) => { await offlineCashEntries.put({ ...(entry as OfflineDBSchema['cashEntries']['value']), _synced: Date.now(), _dirty: 0 }); }
    );

    // Upload dirty service transactions
    await upsertDirtyItems(
      await offlineServiceTransactions.getDirty(),
      'service_transactions',
      async (svc) => { await offlineServiceTransactions.put({ ...(svc as OfflineDBSchema['serviceTransactions']['value']), _synced: Date.now(), _dirty: 0 }); }
    );
  } catch (error) {
    console.error('Sync to Supabase failed:', error);
  }
}

// ============ SYNC ALL ============

export async function syncAll(): Promise<void> {
  return withSyncLock(async () => {
    // Get current user from store
    const { useAppStore } = await import('@/store/appStore');
    const userId = useAppStore.getState().user?.id;
    if (!userId || !isOnline()) return;

    // First process pending deletes, then upload local changes, then sync profile, then download fresh data
    await processPendingDeletes(userId);
    await doSyncToSupabase(userId);
    await syncPendingProfile(userId);
    await doSyncFromSupabase(userId);
  });
}

// Public wrappers — serialized so concurrent callers (30s interval, online event,
// background syncs fired by offline-service getters) can never interleave.
export function syncFromSupabase(userId: string): Promise<void> {
  return withSyncLock(() => doSyncFromSupabase(userId));
}

export function syncToSupabase(userId: string): Promise<void> {
  return withSyncLock(() => doSyncToSupabase(userId));
}

// ============ SYNC PENDING PROFILE UPDATES ============

async function syncPendingProfile(userId: string): Promise<void> {
  if (!userId || !isOnline()) return;

  const { getPendingProfileUpdates, clearPendingProfileUpdates } = await import('./offline-service');
  const pendingUpdates = await getPendingProfileUpdates(userId);
  if (pendingUpdates) {
    try {
      const { updateProfile } = await import('./supabase-service');
      await updateProfile(userId, pendingUpdates);
      await clearPendingProfileUpdates(userId);
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
