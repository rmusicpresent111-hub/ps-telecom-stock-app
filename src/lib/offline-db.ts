/**
 * Offline Database - IndexedDB layer for 100% local (offline-first) architecture
 * All app data (users, categories, products, transactions, ...) lives here —
 * there is NO cloud/server database.
 */

import { openDB, type IDBPDatabase } from 'idb';
import { Bill, BillingSettings } from './types';

const DB_NAME = 'ps-telecom-offline';
// v10 (v2.23.0): + 'dueEntries' — custom due ledger (customer/product photos,
// amount, payment schedule/kisti) managed from the Admin Panel + Due Book.
const DB_VERSION = 10;

// ============ LOCAL USERS (authentication) ============

export interface LocalUserRecord {
  id: string;
  name: string;
  email: string; // always stored lowercase
  // "pbkdf2$310000$<saltB64>$<hashB64>" (current) or legacy "salt:sha256" hex
  // (still verified; transparently upgraded to PBKDF2 on next successful login)
  password: string;
  shopName: string;
  role: string;
  language: string;
  theme: string;
  createdAt: string;
  updatedAt: string;
}

export interface OfflineDBSchema {
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
      serialNumber?: string;
      serialNumbers?: string[];
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
  pendingDeletes: {
    key: string;
    value: {
      id: string; // composite: storeName:itemId
      storeName: string;
      itemId: string;
      userId: string;
      deletedAt: number;
    };
    indexes: { 'by-userId': string; 'by-storeName': string };
  };
  serviceTransactions: {
    key: string;
    value: {
      id: string;
      userId: string;
      categoryType: 'repairing' | 'withdraw-deposit';
      transactionType: 'income' | 'expense';
      amount: number;
      purpose: string;
      date: string;
      createdAt: string;
      updatedAt: string;
      _synced: number;
      _dirty: number;
    };
    indexes: { 'by-userId': string; 'by-categoryType': string; 'by-date': string; 'by-dirty': number };
  };
  users: {
    key: string;
    value: LocalUserRecord;
    indexes: { 'by-email': string };
  };
  bills: {
    key: string;
    // v2.31.0 — mirrors the real Bill type (was a stale partial copy that
    // drifted: customerAddress, gstMode, taxableValue, cgst/sgst, categoryName
    // and serialNumbers were missing). Runtime behaviour unchanged — IDB is
    // schemaless; this only makes the compiler see what we actually store.
    // _synced/_dirty are OPTIONAL because bill-create paths don't set them —
    // the sync layer stamps them on afterwards (same as the old inline type).
    value: Bill & {
      _synced?: number; // timestamp of last sync
      _dirty?: number; // 0 = synced, >0 = needs upload
    };
    indexes: { 'by-userId': string; 'by-date': string };
  };
  billingSettings: {
    key: string; // userId
    // v2.31.0 — mirrors the real BillingSettings type (gstMode, adminPin,
    // billTemplate, thermalWidthMm were missing from the old inline copy).
    value: BillingSettings & {
      _synced?: number; // timestamp of last sync
      _dirty?: number; // 0 = synced, >0 = needs upload
    };
    indexes: Record<never, never>;
  };
  staffPayments: {
    key: string;
    value: {
      id: string;
      userId: string;
      date: string;
      staffName: string;
      staffPhone: string;
      kind: 'salary' | 'advance' | 'bonus' | 'other';
      amount: number;
      note: string;
      createdAt: string;
      updatedAt: string;
      _synced: number;
      _dirty: number;
    };
    indexes: { 'by-userId': string; 'by-dirty': number };
  };
  investments: {
    key: string;
    value: {
      id: string;
      userId: string;
      date: string;      // YYYY-MM-DD (local)
      amount: number;
      purpose: string;   // what the cash is invested for
      note: string;
      createdAt: string;
      updatedAt: string;
      _synced: number;
      _dirty: number;
    };
    indexes: { 'by-userId': string; 'by-dirty': number };
  };
  dueEntries: {
    key: string;
    value: {
      id: string;
      userId: string;
      customerName: string;
      customerMobile: string;
      /** Compressed JPEG data URLs — kept small so the encrypted sync
       *  payload (MAX_PAYLOAD_JSON 200 KB) always fits. */
      customerPhotoDataUrl?: string;
      productName: string;
      productPhotoDataUrl?: string;
      amount: number;      // total due (₹)
      paidAmount: number;  // collected so far (₹)
      schedule: {
        id: string;
        dueDate: string;   // YYYY-MM-DD
        amount: number;
        paidAmount: number;
        paidAt?: string;
      }[];                 // payment schedule (kisti) — may be empty
      note: string;
      date: string;        // YYYY-MM-DD (local) — credit given on
      createdAt: string;
      updatedAt: string;
      _synced: number;
      _dirty: number;
    };
    indexes: { 'by-userId': string; 'by-dirty': number };
  };
}

let dbPromise: Promise<IDBPDatabase<OfflineDBSchema>> | null = null;

/**
 * Direct DB handle — used for multi-store atomic transactions
 * (e.g. stock updates that must touch products + transactions together).
 */
export function getOfflineDB(): Promise<IDBPDatabase<OfflineDBSchema>> {
  return getDB();
}

function getDB(): Promise<IDBPDatabase<OfflineDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
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
        if (!db.objectStoreNames.contains('pendingDeletes')) {
          const delStore = db.createObjectStore('pendingDeletes', { keyPath: 'id' });
          delStore.createIndex('by-userId', 'userId');
          delStore.createIndex('by-storeName', 'storeName');
        }
        if (!db.objectStoreNames.contains('serviceTransactions')) {
          const svcStore = db.createObjectStore('serviceTransactions', { keyPath: 'id' });
          svcStore.createIndex('by-userId', 'userId');
          svcStore.createIndex('by-categoryType', 'categoryType');
          svcStore.createIndex('by-date', 'date');
          svcStore.createIndex('by-dirty', '_dirty');
        }
        if (!db.objectStoreNames.contains('users')) {
          const userStore = db.createObjectStore('users', { keyPath: 'id' });
          userStore.createIndex('by-email', 'email');
        }
        if (!db.objectStoreNames.contains('bills')) {
          const billStore = db.createObjectStore('bills', { keyPath: 'id' });
          billStore.createIndex('by-userId', 'userId');
          billStore.createIndex('by-date', 'date');
        }
        if (!db.objectStoreNames.contains('billingSettings')) {
          db.createObjectStore('billingSettings', { keyPath: 'userId' });
        }
        if (!db.objectStoreNames.contains('staffPayments')) {
          const staffStore = db.createObjectStore('staffPayments', { keyPath: 'id' });
          staffStore.createIndex('by-userId', 'userId');
          staffStore.createIndex('by-dirty', '_dirty');
        }
        // v9: Others Invest — additive, safe on every existing device.
        if (!db.objectStoreNames.contains('investments')) {
          const invStore = db.createObjectStore('investments', { keyPath: 'id' });
          invStore.createIndex('by-userId', 'userId');
          invStore.createIndex('by-dirty', '_dirty');
        }
        // v10 (v2.23.0): Due Entry — custom customer credit ledger with photos
        // and a payment schedule. Additive, safe on every existing device.
        if (!db.objectStoreNames.contains('dueEntries')) {
          const dueStore = db.createObjectStore('dueEntries', { keyPath: 'id' });
          dueStore.createIndex('by-userId', 'userId');
          dueStore.createIndex('by-dirty', '_dirty');
        }
      },
    }).catch((err) => {
      // Don't cache a rejected promise forever (private mode, quota, corruption) —
      // allow the next call to retry opening the database.
      dbPromise = null;
      throw err;
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

// ============ CATEGORIES ============

export const offlineCategories = {
  getAll: (userId: string) => getAllByUser('categories', userId),
  put: (cat: OfflineDBSchema['categories']['value']) => putItem('categories', cat),
  putBulk: (cats: OfflineDBSchema['categories']['value'][]) => putBulk('categories', cats),
  delete: (id: string) => deleteItem('categories', id),
};

// ============ PRODUCTS ============

export const offlineProducts = {
  getAll: (userId: string) => getAllByUser('products', userId),
  // ⚡ Direct key get — O(1) instead of loading the user's whole product list
  getById: async (id: string) => {
    const db = await getDB();
    return db.get('products', id);
  },
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
};

// ============ TRANSACTIONS ============

export const offlineTransactions = {
  getAll: (userId: string) => getAllByUser('transactions', userId),
  put: (txn: OfflineDBSchema['transactions']['value']) => putItem('transactions', txn),
  putBulk: (txns: OfflineDBSchema['transactions']['value'][]) => putBulk('transactions', txns),
  delete: (id: string) => deleteItem('transactions', id),
};

// ============ EXPENSES ============

export const offlineExpenses = {
  getAll: (userId: string) => getAllByUser('expenses', userId),
  put: (exp: OfflineDBSchema['expenses']['value']) => putItem('expenses', exp),
  putBulk: (exps: OfflineDBSchema['expenses']['value'][]) => putBulk('expenses', exps),
  delete: (id: string) => deleteItem('expenses', id),
};

// ============ CASH ENTRIES ============

export const offlineCashEntries = {
  getAll: (userId: string) => getAllByUser('cashEntries', userId),
  put: (entry: OfflineDBSchema['cashEntries']['value']) => putItem('cashEntries', entry),
  putBulk: (entries: OfflineDBSchema['cashEntries']['value'][]) => putBulk('cashEntries', entries),
  delete: (id: string) => deleteItem('cashEntries', id),
};

// ============ SERVICE TRANSACTIONS ============

export const offlineServiceTransactions = {
  getAll: (userId: string) => getAllByUser('serviceTransactions', userId),
  put: (svc: OfflineDBSchema['serviceTransactions']['value']) => putItem('serviceTransactions', svc),
  putBulk: (svcs: OfflineDBSchema['serviceTransactions']['value'][]) => putBulk('serviceTransactions', svcs),
  delete: (id: string) => deleteItem('serviceTransactions', id),
};

// ============ BILLS (e-Bill / Invoice) ============

export const offlineBills = {
  getAll: (userId: string) => getAllByUser('bills', userId),
  put: (bill: OfflineDBSchema['bills']['value']) => putItem('bills', bill),
  putBulk: (bills: OfflineDBSchema['bills']['value'][]) => putBulk('bills', bills),
  delete: (id: string) => deleteItem('bills', id),
};

// ============ STAFF PAYMENTS ============

export const offlineStaffPayments = {
  getAll: (userId: string) => getAllByUser('staffPayments', userId),
  put: (row: OfflineDBSchema['staffPayments']['value']) => putItem('staffPayments', row),
  putBulk: (rows: OfflineDBSchema['staffPayments']['value'][]) => putBulk('staffPayments', rows),
  delete: (id: string) => deleteItem('staffPayments', id),
};

// ============ INVESTMENTS (Others Invest — cash into the business) ============

export const offlineInvestments = {
  getAll: (userId: string) => getAllByUser('investments', userId),
  put: (row: OfflineDBSchema['investments']['value']) => putItem('investments', row),
  putBulk: (rows: OfflineDBSchema['investments']['value'][]) => putBulk('investments', rows),
  delete: (id: string) => deleteItem('investments', id),
};

// ============ DUE ENTRIES (বাকি এন্ট্রি — custom credit ledger) ============

export const offlineDueEntries = {
  getAll: (userId: string) => getAllByUser('dueEntries', userId),
  // ⚡ Direct key get — O(1) for payment recording on one entry
  getById: async (id: string) => {
    const db = await getDB();
    return db.get('dueEntries', id);
  },
  put: (row: OfflineDBSchema['dueEntries']['value']) => putItem('dueEntries', row),
  putBulk: (rows: OfflineDBSchema['dueEntries']['value'][]) => putBulk('dueEntries', rows),
  delete: (id: string) => deleteItem('dueEntries', id),
};

// ============ CLEAR ALL ============

// NOTE: the legacy `syncMeta` / `pendingDeletes` object stores are kept in the
// schema (removing them would need a DB version bump); clearOfflineData still
// wipes them, and the old sync-era helper APIs around them are gone.

export async function clearOfflineData(userId: string): Promise<void> {
  const db = await getDB();
  const userStores = (
    ['categories', 'products', 'transactions', 'expenses', 'cashEntries', 'syncMeta', 'pendingDeletes', 'serviceTransactions', 'bills', 'staffPayments', 'investments', 'dueEntries'] as const
  ).filter(s => db.objectStoreNames.contains(s));
  const txStores: (keyof OfflineDBSchema)[] = [...userStores];
  if (db.objectStoreNames.contains('billingSettings')) txStores.push('billingSettings');
  if (txStores.length === 0) return; // nothing to wipe (fresh/unknown DB)

  // ONE transaction across every store: Reset All Data either wipes ALL of the
  // user's rows or NONE of them (previously each store was a separate tx and
  // errors were silently swallowed, so a partial reset could go unnoticed).
  const tx = db.transaction(txStores, 'readwrite');

  for (const store of userStores) {
    const os = tx.objectStore(store);
    if (os.indexNames.contains('by-userId')) {
      const keys = await os.index('by-userId').getAllKeys(userId);
      for (const key of keys) void os.delete(key);
    } else {
      // Defensive fallback for a hypothetical legacy store without the index.
      const rows = await os.getAll();
      for (const row of rows) {
        if ((row as { userId?: string }).userId === userId) {
          void os.delete((row as { id: string }).id);
        }
      }
    }
  }

  // billingSettings is keyed by userId directly (no index)
  void tx.objectStore('billingSettings').delete(userId);

  // Rejects (and rolls back everything) on any failure — the caller surfaces it.
  await tx.done;
}
