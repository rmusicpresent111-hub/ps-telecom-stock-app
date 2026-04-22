/**
 * Offline Database - IndexedDB layer for offline-first architecture
 * All Supabase data is automatically saved here for offline access
 */

import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'ps-telecom-offline';
const DB_VERSION = 3;

interface OfflineDBSchema {
  categories: {
    key: string;
    value: {
      id: string;
      name: string;
      image: string;
      userId: string;
      createdAt: string;
      updatedAt: string;
      _count?: { products: number };
      _synced: number; // timestamp of last sync
      _dirty: number; // 0 = synced, >0 = needs upload
    };
    indexes: { 'by-userId': string; 'by-dirty': number };
  };
  products: {
    key: string;
    value: {
      id: string;
      name: string;
      categoryId: string;
      quantity: number;
      boxNumber: string;
      purchasePrice: number;
      sellingPrice: number;
      lowStockThreshold: number;
      userId: string;
      createdAt: string;
      updatedAt: string;
      category?: { id: string; name: string; image: string };
      _synced: number;
      _dirty: number;
    };
    indexes: { 'by-userId': string; 'by-categoryId': string; 'by-dirty': number };
  };
  transactions: {
    key: string;
    value: {
      id: string;
      productId: string;
      type: 'STOCK_IN' | 'STOCK_OUT' | 'SELL';
      quantity: number;
      unitPrice: number;
      totalAmount: number;
      date: string;
      userId: string;
      createdAt: string;
      product?: { id: string; name: string; purchasePrice: number; sellingPrice: number };
      _synced: number;
      _dirty: number;
    };
    indexes: { 'by-userId': string; 'by-date': string; 'by-dirty': number };
  };
  expenses: {
    key: string;
    value: {
      id: string;
      userId: string;
      date: string;
      amount: number;
      category: string;
      description: string;
      createdAt: string;
      updatedAt: string;
      _synced: number;
      _dirty: number;
    };
    indexes: { 'by-userId': string; 'by-dirty': number };
  };
  cashEntries: {
    key: string;
    value: {
      id: string;
      userId: string;
      date: string;
      handCash: number;
      liquidCash: number;
      note: string;
      createdAt: string;
      updatedAt: string;
      _synced: number;
      _dirty: number;
    };
    indexes: { 'by-userId': string; 'by-dirty': number };
  };
  syncMeta: {
    key: string;
    value: {
      key: string;
      userId: string;
      lastSync: number;
      data: unknown;
    };
    indexes: { 'by-userId': string };
  };
}

let dbPromise: Promise<IDBPDatabase<OfflineDBSchema>> | null = null;

function getDB(): Promise<IDBPDatabase<OfflineDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // Create stores if they don't exist
        if (!db.objectStoreNames.contains('categories')) {
          const catStore = db.createObjectStore('categories', { keyPath: 'id' });
          catStore.createIndex('by-userId', 'userId');
          catStore.createIndex('by-dirty', '_dirty');
        }
        if (!db.objectStoreNames.contains('products')) {
          const prodStore = db.createObjectStore('products', { keyPath: 'id' });
          prodStore.createIndex('by-userId', 'userId');
          prodStore.createIndex('by-categoryId', 'categoryId');
          prodStore.createIndex('by-dirty', '_dirty');
        }
        if (!db.objectStoreNames.contains('transactions')) {
          const txnStore = db.createObjectStore('transactions', { keyPath: 'id' });
          txnStore.createIndex('by-userId', 'userId');
          txnStore.createIndex('by-date', 'date');
          txnStore.createIndex('by-dirty', '_dirty');
        }
        if (!db.objectStoreNames.contains('expenses')) {
          const expStore = db.createObjectStore('expenses', { keyPath: 'id' });
          expStore.createIndex('by-userId', 'userId');
          expStore.createIndex('by-dirty', '_dirty');
        }
        if (!db.objectStoreNames.contains('cashEntries')) {
          const cashStore = db.createObjectStore('cashEntries', { keyPath: 'id' });
          cashStore.createIndex('by-userId', 'userId');
          cashStore.createIndex('by-dirty', '_dirty');
        }
        if (!db.objectStoreNames.contains('syncMeta')) {
          const metaStore = db.createObjectStore('syncMeta', { keyPath: 'key' });
          metaStore.createIndex('by-userId', 'userId');
        }
      },
    });
  }
  return dbPromise;
}

// ============ GENERIC OPERATIONS ============

async function getAllByUser<K extends keyof OfflineDBSchema>(
  storeName: K,
  userId: string
): Promise<OfflineDBSchema[K]['value'][]> {
  const db = await getDB();
  const all = await db.getAllFromIndex(storeName, 'by-userId', userId);
  return all;
}

async function putItem<K extends keyof OfflineDBSchema>(
  storeName: K,
  item: OfflineDBSchema[K]['value']
): Promise<void> {
  const db = await getDB();
  await db.put(storeName, item);
}

async function putBulk<K extends keyof OfflineDBSchema>(
  storeName: K,
  items: OfflineDBSchema[K]['value'][]
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(storeName, 'readwrite');
  for (const item of items) {
    await tx.store.put(item);
  }
  await tx.done;
}

async function deleteItem<K extends keyof OfflineDBSchema>(
  storeName: K,
  id: string
): Promise<void> {
  const db = await getDB();
  await db.delete(storeName, id);
}

async function getDirtyItems<K extends keyof OfflineDBSchema>(
  storeName: K
): Promise<OfflineDBSchema[K]['value'][]> {
  const db = await getDB();
  // Get all items where _dirty > 0
  const range = IDBKeyRange.lowerBound(1);
  return db.getAllFromIndex(storeName, 'by-dirty', range);
}

// ============ CATEGORIES ============

export const offlineCategories = {
  getAll: (userId: string) => getAllByUser('categories', userId),
  put: (cat: OfflineDBSchema['categories']['value']) => putItem('categories', cat),
  putBulk: (cats: OfflineDBSchema['categories']['value'][]) => putBulk('categories', cats),
  delete: (id: string) => deleteItem('categories', id),
  getDirty: () => getDirtyItems('categories'),
};

// ============ PRODUCTS ============

export const offlineProducts = {
  getAll: (userId: string) => getAllByUser('products', userId),
  put: (prod: OfflineDBSchema['products']['value']) => putItem('products', prod),
  putBulk: (prods: OfflineDBSchema['products']['value'][]) => putBulk('products', prods),
  delete: (id: string) => deleteItem('products', id),
  getByCategory: async (userId: string, categoryId: string) => {
    const db = await getDB();
    const all = await db.getAllFromIndex('products', 'by-userId', userId);
    return all.filter(p => p.categoryId === categoryId);
  },
  search: async (userId: string, query: string) => {
    const db = await getDB();
    const all = await db.getAllFromIndex('products', 'by-userId', userId);
    const q = query.toLowerCase();
    return all.filter(p => p.name.toLowerCase().includes(q));
  },
  getDirty: () => getDirtyItems('products'),
};

// ============ TRANSACTIONS ============

export const offlineTransactions = {
  getAll: (userId: string) => getAllByUser('transactions', userId),
  put: (txn: OfflineDBSchema['transactions']['value']) => putItem('transactions', txn),
  putBulk: (txns: OfflineDBSchema['transactions']['value'][]) => putBulk('transactions', txns),
  delete: (id: string) => deleteItem('transactions', id),
  getByType: async (userId: string, type: string) => {
    const db = await getDB();
    const all = await db.getAllFromIndex('transactions', 'by-userId', userId);
    return all.filter(t => t.type === type);
  },
  getByDateRange: async (userId: string, from: string, to: string) => {
    const db = await getDB();
    const all = await db.getAllFromIndex('transactions', 'by-userId', userId);
    return all.filter(t => t.date >= from && t.date <= to);
  },
  getDirty: () => getDirtyItems('transactions'),
};

// ============ EXPENSES ============

export const offlineExpenses = {
  getAll: (userId: string) => getAllByUser('expenses', userId),
  put: (exp: OfflineDBSchema['expenses']['value']) => putItem('expenses', exp),
  putBulk: (exps: OfflineDBSchema['expenses']['value'][]) => putBulk('expenses', exps),
  delete: (id: string) => deleteItem('expenses', id),
  getDirty: () => getDirtyItems('expenses'),
};

// ============ CASH ENTRIES ============

export const offlineCashEntries = {
  getAll: (userId: string) => getAllByUser('cashEntries', userId),
  put: (entry: OfflineDBSchema['cashEntries']['value']) => putItem('cashEntries', entry),
  putBulk: (entries: OfflineDBSchema['cashEntries']['value'][]) => putBulk('cashEntries', entries),
  delete: (id: string) => deleteItem('cashEntries', id),
  getDirty: () => getDirtyItems('cashEntries'),
};

// ============ SYNC META ============

export const offlineMeta = {
  get: async (key: string): Promise<OfflineDBSchema['syncMeta']['value'] | undefined> => {
    const db = await getDB();
    return db.get('syncMeta', key);
  },
  put: async (meta: OfflineDBSchema['syncMeta']['value']) => {
    const db = await getDB();
    await db.put('syncMeta', meta);
  },
  getLastSync: async (userId: string, key: string): Promise<number> => {
    const meta = await offlineMeta.get(`${userId}:${key}`);
    return meta?.lastSync ?? 0;
  },
  setLastSync: async (userId: string, key: string, timestamp?: number) => {
    await offlineMeta.put({
      key: `${userId}:${key}`,
      userId,
      lastSync: timestamp ?? Date.now(),
      data: null,
    });
  },
};

// ============ CLEAR ALL ============

export async function clearOfflineData(userId: string): Promise<void> {
  const db = await getDB();
  const stores: (keyof OfflineDBSchema)[] = ['categories', 'products', 'transactions', 'expenses', 'cashEntries', 'syncMeta'];
  for (const store of stores) {
    const all = await db.getAllFromIndex(store, 'by-userId', userId);
    const tx = db.transaction(store, 'readwrite');
    for (const item of all) {
      await tx.store.delete((item as { id: string }).id);
    }
    await tx.done;
  }
}
