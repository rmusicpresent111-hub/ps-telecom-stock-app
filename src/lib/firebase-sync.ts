/**
 * Firebase Cloud Sync — backup/sync engine for PS TELECOM.
 *
 * Mirrors the user's local IndexedDB data to Cloud Firestore (their own
 * Firebase project) and can restore it back. The app stays 100% offline-first:
 * IndexedDB is always the source of truth, Firestore is the cloud copy.
 *
 * Firestore layout:
 *   psStock/{userId}/meta/sync                  → lastSync, counts
 *   psStock/{userId}/{store}/{recordId}         → one doc per local record
 *     stores: categories, products, transactions, expenses, cashEntries,
 *             serviceTransactions, bills, billingSettings
 *
 * Push strategy: full mirror (upsert everything, delete cloud docs that no
 * longer exist locally). Stock-shop datasets are small; this is the most
 * robust option — no dirty-tracking to corrupt.
 */

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { getFirebaseApp, firebaseConfig } from './firebase';
import { onLocalDataChanged } from './sync-events';
import { getOfflineDB, type OfflineDBSchema } from './offline-db';
import { importBackupOffline } from './offline-service';

const ROOT = 'psStock';
const SYNC_DEBOUNCE_MS = 3000;
const BATCH_LIMIT = 400; // Firestore batch cap is 500 mutations
const COMMIT_TIMEOUT_MS = 60000; // generous headroom: first connect on slow 4G + big first backup
const RETRY_DELAY_MS = 2500;

/** Reject after `ms` so the UI never hangs on a dead connection. */
function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`Network timeout — ${label} (check internet / Firebase setup)`)), COMMIT_TIMEOUT_MS)
    ),
  ]);
}

function isNetworkError(msg?: string): boolean {
  if (!msg) return false;
  return /timeout|failed to fetch|network|offline|unavailable/i.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type SyncStore = keyof Omit<OfflineDBSchema, 'syncMeta' | 'pendingDeletes' | 'users'>;

const SYNC_STORES: SyncStore[] = [
  'categories',
  'products',
  'transactions',
  'expenses',
  'cashEntries',
  'serviceTransactions',
  'bills',
  'billingSettings',
];

// ============ SETTINGS (localStorage) ============

const autoSyncKey = (uid: string) => `ps-fb-autosync:${uid}`;

export function isAutoSyncEnabled(uid: string): boolean {
  try {
    return localStorage.getItem(autoSyncKey(uid)) !== 'off';
  } catch {
    return true; // default ON
  }
}

export function setAutoSyncEnabled(uid: string, on: boolean): void {
  try {
    localStorage.setItem(autoSyncKey(uid), on ? 'on' : 'off');
  } catch {
    // storage unavailable — toggle stays in-memory only
  }
}

// ============ HELPERS ============

/** Strip undefined (Firestore rejects them) + local sync bookkeeping fields. */
function clean<T extends Record<string, unknown>>(rec: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k === '_dirty' || k === '_synced') continue;
    if (v === undefined) continue;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = clean(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function readStoreAll(store: SyncStore, uid: string): Promise<Record<string, unknown>[]> {
  const db = await getOfflineDB();
  // billingSettings is keyed by userId directly (no by-userId index)
  if (store === 'billingSettings') {
    const row = await db.get('billingSettings', uid);
    return row ? [row as unknown as Record<string, unknown>] : [];
  }
  const rows = (await db.getAllFromIndex(store, 'by-userId', uid)) as Record<string, unknown>[];
  return rows;
}

export interface SyncResult {
  ok: boolean;
  pushed: number;
  deleted: number;
  error?: string;
}

// ============ PUSH (local → cloud) ============

let busy: string | null = null; // userId currently syncing
let rerun: string | null = null; // userId that needs a re-run after current finishes

function emit(userId: string, status: 'busy' | 'ok' | 'error', message?: string): void {
  try {
    window.dispatchEvent(new CustomEvent('ps-fb-sync', { detail: { userId, status, message } }));
  } catch {
    // non-browser env
  }
}

/** Mirror ALL local stores of this user to Firestore. Auto-retries once on network failures. */
export async function pushAllToFirebase(userId: string): Promise<SyncResult> {
  const first = await pushAllOnce(userId);
  if (first.ok) return first;
  if (first.error !== 'busy' && isNetworkError(first.error)) {
    await sleep(RETRY_DELAY_MS);
    return pushAllOnce(userId); // one silent retry — fixes transient 4G blips
  }
  return first;
}

async function pushAllOnce(userId: string): Promise<SyncResult> {
  if (busy) {
    rerun = userId; // coalesce concurrent requests
    return { ok: false, pushed: 0, deleted: 0, error: 'busy' };
  }
  busy = userId;
  emit(userId, 'busy');

  let pushed = 0;
  let deleted = 0;
  try {
    const firestore = getFirestore(getFirebaseApp());
    const now = Date.now();
    const counts: Record<string, number> = {};

    for (const store of SYNC_STORES) {
      const rows = await readStoreAll(store, userId);
      counts[store] = rows.length;

      // local ids present (billingSettings is keyed by userId, stored as one doc)
      const localIds = new Set<string>();
      if (store === 'billingSettings') {
        if (rows.length > 0) localIds.add('settings');
      } else {
        for (const r of rows) if (typeof r.id === 'string') localIds.add(r.id as string);
      }

      // 1) Upsert every local record
      const entries: Array<{ id: string; data: Record<string, unknown> }> = [];
      if (store === 'billingSettings') {
        if (rows.length > 0) entries.push({ id: 'settings', data: clean(rows[0]) });
      } else {
        for (const r of rows) {
          if (typeof r.id === 'string') entries.push({ id: r.id as string, data: clean(r) });
        }
      }

      for (let i = 0; i < entries.length; i += BATCH_LIMIT) {
        const chunk = entries.slice(i, i + BATCH_LIMIT);
        const batch = writeBatch(firestore);
        for (const e of chunk) {
          batch.set(doc(firestore, ROOT, userId, store, e.id), e.data, { merge: true });
        }
        await withTimeout(batch.commit(), 'upload failed');
        pushed += chunk.length;
      }

      // 2) Delete cloud docs that no longer exist locally (removed records)
      const cloudSnap = await withTimeout(getDocs(collection(firestore, ROOT, userId, store)), 'download failed');
      const toDelete: string[] = [];
      cloudSnap.forEach((d) => {
        if (!localIds.has(d.id)) toDelete.push(d.id);
      });
      for (let i = 0; i < toDelete.length; i += BATCH_LIMIT) {
        const chunk = toDelete.slice(i, i + BATCH_LIMIT);
        const batch = writeBatch(firestore);
        for (const id of chunk) batch.delete(doc(firestore, ROOT, userId, store, id));
        await withTimeout(batch.commit(), 'upload failed');
        deleted += chunk.length;
      }
    }

    // meta doc — last sync marker (also lets the user inspect state in console)
    await withTimeout(
      setDoc(
        doc(firestore, ROOT, userId, 'meta', 'sync'),
        { lastSync: now, counts, app: 'ps-telecom' },
        { merge: true }
      ),
      'upload failed'
    );

    // local syncMeta marker (drives "last synced" in the UI)
    const db = await getOfflineDB();
    await db.put('syncMeta', {
      key: `firebase-last-sync:${userId}`,
      userId,
      lastSync: now,
      data: counts,
    });

    emit(userId, 'ok');
    return { ok: true, pushed, deleted };
  } catch (err) {
    const error = (err as Error)?.message || 'sync failed';
    console.warn('[firebase-sync] push failed:', error);
    emit(userId, 'error', error);
    return { ok: false, pushed, deleted, error };
  } finally {
    busy = null;
    if (rerun === userId) {
      rerun = null;
      scheduleCloudSync(userId, 500);
    }
  }
}

// ============ RESTORE (cloud → local) ============

export interface RestoreResult {
  ok: boolean;
  stores: Record<string, number>;
  error?: string;
}

/** Pull the user's cloud copy and import it into IndexedDB (replaces local data). */
export async function restoreFromFirebase(userId: string): Promise<RestoreResult> {
  try {
    const firestore = getFirestore(getFirebaseApp());
    const stores: Record<string, number> = {};
    const backup: Record<string, unknown> = {};

    for (const store of SYNC_STORES) {
      const snap = await withTimeout(getDocs(collection(firestore, ROOT, userId, store)), 'download failed');
      const rows: Record<string, unknown>[] = [];
      snap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        if (store === 'billingSettings') {
          backup[store] = { ...data, userId };
        } else {
          rows.push({ ...data, id: d.id, userId });
        }
      });
      if (store !== 'billingSettings') backup[store] = rows;
      stores[store] = store === 'billingSettings' ? (backup[store] ? 1 : 0) : rows.length;
    }

    await importBackupOffline(userId, backup as Parameters<typeof importBackupOffline>[1]);
    // restore succeeded → reflect the restored data back to the cloud mirror
    notifyRestoreDone(userId);
    return { ok: true, stores };
  } catch (err) {
    const error = (err as Error)?.message || 'restore failed';
    console.warn('[firebase-sync] restore failed:', error);
    return { ok: false, stores: {}, error };
  }
}

// ============ AUTO SYNC ============

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced push — called after any local write while auto-sync is ON. */
export function scheduleCloudSync(userId: string, delayMs = SYNC_DEBOUNCE_MS): void {
  if (!isAutoSyncEnabled(userId)) return;
  const prev = timers.get(userId);
  if (prev) clearTimeout(prev);
  timers.set(
    userId,
    setTimeout(() => {
      timers.delete(userId);
      void pushAllToFirebase(userId);
    }, delayMs)
  );
}

/** Check whether the cloud copy exists (used by the UI). */
export async function hasCloudBackup(userId: string): Promise<boolean> {
  try {
    const firestore = getFirestore(getFirebaseApp());
    const snap = await withTimeout(getDoc(doc(firestore, ROOT, userId, 'meta', 'sync')), 'download failed');
    return snap.exists();
  } catch {
    return false;
  }
}

export interface FirebaseSyncInfo {
  project: string;
  autoSync: boolean;
  lastSync: number | null;
  lastError: string | null;
  busy: boolean;
  counts: Record<string, number>;
}

/** Everything the Cloud Backup screen needs in one call. */
export async function getFirebaseSyncInfo(userId: string): Promise<FirebaseSyncInfo> {
  let lastSync: number | null = null;
  let counts: Record<string, number> = {};
  try {
    const db = await getOfflineDB();
    const meta = await db.get('syncMeta', `firebase-last-sync:${userId}`);
    if (meta) {
      lastSync = meta.lastSync;
      counts = (meta.data as Record<string, number>) || {};
    }
  } catch {
    // IndexedDB unavailable — leave defaults
  }
  return {
    project: firebaseConfig.projectId,
    autoSync: isAutoSyncEnabled(userId),
    lastSync,
    lastError: lastErrorByUser.get(userId) || null,
    busy: busy === userId,
    counts,
  };
}

// ============ BOOT ============

const lastErrorByUser = new Map<string, string>();

if (typeof window !== 'undefined') {
  window.addEventListener('ps-fb-sync', (e: Event) => {
    const detail = (e as CustomEvent).detail as { userId: string; status: string; message?: string };
    if (!detail?.userId) return;
    if (detail.status === 'error') lastErrorByUser.set(detail.userId, detail.message || 'sync failed');
    else if (detail.status === 'ok') lastErrorByUser.delete(detail.userId);
  });
}

let booted = false;

/** Idempotent — wires the data-layer change listener once. */
export function initFirebaseSync(): void {
  if (booted || typeof window === 'undefined') return;
  booted = true;
  onLocalDataChanged((userId) => scheduleCloudSync(userId));
}

/** Internal: after a restore, push the restored data up (without auto-sync gate). */
function notifyRestoreDone(userId: string): void {
  setTimeout(() => void pushAllToFirebase(userId), 400);
}
