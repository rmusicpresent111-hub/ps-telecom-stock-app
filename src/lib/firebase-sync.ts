/**
 * Firebase Cloud Sync — real two-way sync engine for PS TELECOM.
 *
 * Every device shares ONE cloud pool:  psStock/{userId}/{store}/{recordId}
 * (userId is the fixed device-local profile 'local-owner' on every device, so
 * all devices automatically read/write the same shop data).
 *
 * HOW DATA FLOWS
 *   local write  → IndexedDB → debounced PUSH  → upsert into Firestore
 *                (+ explicit deletes via pendingDeletes → tombstones)
 *   cloud change → onSnapshot LISTENER      → apply-if-newer into IndexedDB
 *
 * This is what makes data added on device 1 appear on device 2 automatically.
 *
 * SAFETY RULES (the bugs this design deliberately avoids)
 *   • NEVER "delete cloud docs missing locally" — device B would erase device
 *     A's records before B even received them. Deletes travel explicitly:
 *     local delete → pendingDeletes row → tombstone + cloud delete →
 *     'removed' events delete the row on every other device.
 *   • Tombstones (psStock/{uid}/_tombstones) stop deleted records from
 *     resurrecting when an older offline copy pushes later.
 *   • Last-writer-wins via updatedAt/createdAt — newer edit always wins.
 *   • Echo guards: our own writes come back as hasPendingWrites=true and are
 *     skipped; listener-applied rows go straight into IndexedDB (no re-push).
 *
 * The app stays 100% offline-first: IndexedDB is always the source of truth
 * for the UI; Firestore is the live cloud mirror.
 *
 * Firestore layout:
 *   psStock/{userId}/meta/sync                  → lastSync, counts
 *   psStock/{userId}/{store}/{recordId}         → one doc per local record
 *     stores: categories, products, transactions, expenses, cashEntries,
 *             serviceTransactions, bills, billingSettings
 *   psStock/{userId}/_tombstones/{store}__{id}  → {storeName,itemId,deletedAt}
 */

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  writeBatch,
  onSnapshot,
} from 'firebase/firestore';
import { getFirebaseApp, firebaseConfig } from './firebase';
import { onLocalDataChanged, onLocalWipe } from './sync-events';
import { getOfflineDB, type OfflineDBSchema } from './offline-db';
import { importBackupOffline } from './offline-service';
import { DEFAULT_USER_ID } from './local-auth';

const ROOT = 'psStock';
const TOMB = '_tombstones';
const SYNC_DEBOUNCE_MS = 3000;
const BATCH_LIMIT = 400; // Firestore batch cap is 500 mutations
const COMMIT_TIMEOUT_MS = 60000; // generous headroom: first connect on slow 4G + big first backup
const RETRY_DELAY_MS = 2500;

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

/** Strip local sync bookkeeping (Firestore rejects undefined) — recurses into
 *  nested objects AND objects inside arrays (bills.items etc.). */
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => clean(v));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === '_dirty' || k === '_synced') continue;
      if (v === undefined) continue;
      out[k] = clean(v);
    }
    return out;
  }
  return value;
}

/** Best-effort record timestamp (ms) for last-writer-wins comparisons. */
function recordTs(row: Record<string, unknown> | undefined | null): number {
  if (!row) return 0;
  const raw = (row.updatedAt as string) || (row.createdAt as string) || '';
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
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

// ============ STATUS EVENTS ============

let busy: string | null = null; // userId currently syncing
let rerun: string | null = null; // userId that needs a re-run after current finishes

function emit(userId: string, status: 'busy' | 'ok' | 'error', message?: string): void {
  try {
    window.dispatchEvent(new CustomEvent('ps-fb-sync', { detail: { userId, status, message } }));
  } catch {
    // non-browser env
  }
}

// ============ TOMBSTONES (in-memory mirror of the cloud _tombstones tree) ============

const tombstones = new Map<string, number>(); // `${store}__${id}` → deletedAt(ms)

// ============ PUSH (local → cloud) ============

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

    // ---- 1) Upsert every local record (never deletes anything) ----
    for (const store of SYNC_STORES) {
      const rows = await readStoreAll(store, userId);
      counts[store] = rows.length;

      const entries: Array<{ id: string; data: Record<string, unknown> }> = [];
      if (store === 'billingSettings') {
        if (rows.length > 0) entries.push({ id: 'settings', data: clean(rows[0]) as Record<string, unknown> });
      } else {
        for (const r of rows) {
          if (typeof r.id === 'string') entries.push({ id: r.id, data: clean(r) as Record<string, unknown> });
        }
      }

      for (let i = 0; i < entries.length; i += BATCH_LIMIT) {
        const chunk = entries.slice(i, i + BATCH_LIMIT);
        const batch = writeBatch(firestore);
        let applied = 0;
        for (const e of chunk) {
          // Resurrection guard: another device deleted this record after this
          // row was last edited — keep it deleted.
          const tomb = tombstones.get(`${store}__${e.id}`);
          if (tomb !== undefined && tomb >= recordTs(e.data)) continue;
          batch.set(doc(firestore, ROOT, userId, store, e.id), e.data, { merge: true });
          applied++;
        }
        if (applied > 0) {
          await withTimeout(batch.commit(), 'upload failed');
          pushed += applied;
        }
      }
    }

    // ---- 2) Propagate explicit local deletes (pendingDeletes → tombstone + cloud delete) ----
    const db = await getOfflineDB();
    const pending = await db.getAll('pendingDeletes');
    const deletable = pending.filter((p) => (SYNC_STORES as string[]).includes(p.storeName));
    for (let i = 0; i < deletable.length; i += BATCH_LIMIT) {
      const chunk = deletable.slice(i, i + BATCH_LIMIT);
      const batch = writeBatch(firestore);
      for (const p of chunk) {
        batch.set(
          doc(firestore, ROOT, userId, TOMB, `${p.storeName}__${p.itemId}`),
          { storeName: p.storeName, itemId: p.itemId, deletedAt: p.deletedAt, userId },
          { merge: true }
        );
        batch.delete(doc(firestore, ROOT, userId, p.storeName as SyncStore, p.itemId));
        tombstones.set(`${p.storeName}__${p.itemId}`, p.deletedAt);
      }
      await withTimeout(batch.commit(), 'upload failed');
      deleted += chunk.length;
      // Clear the processed markers (single tx)
      const tx = db.transaction('pendingDeletes', 'readwrite');
      for (const p of chunk) void tx.objectStore('pendingDeletes').delete(p.id);
      await tx.done;
    }

    // ---- 3) meta doc — last sync marker ----
    await withTimeout(
      setDoc(
        doc(firestore, ROOT, userId, 'meta', 'sync'),
        { lastSync: now, counts, app: 'ps-telecom' },
        { merge: true }
      ),
      'upload failed'
    );

    // local syncMeta marker (drives "last synced" in the UI)
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

// ============ LISTENERS (cloud → local, the missing half of sync) ============

const attachedFor = new Map<string, (() => void)[]>();
const liveByUser = new Map<string, boolean>();

/**
 * Real-time listeners: every cloud change (including the INITIAL snapshot of
 * everything already in the cloud) is applied into local IndexedDB. This is
 * how data added on one device shows up on every other device automatically.
 */
async function ensureAttached(userId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  if (attachedFor.has(userId)) return;
  attachedFor.set(userId, []); // reserve — prevents concurrent double-attach

  const unsubs: (() => void)[] = [];
  try {
    const firestore = getFirestore(getFirebaseApp());

    // Tombstone tree (deletes made on other devices) — keep the in-memory
    // mirror fresh; also delete tombstoned rows locally.
    void (async () => {
      try {
        const snap = await withTimeout(getDocs(collection(firestore, ROOT, userId, TOMB)), 'download failed');
        snap.forEach((d) => {
          const delAt = Number((d.data() as { deletedAt?: number }).deletedAt) || 0;
          tombstones.set(d.id, delAt);
        });
      } catch {
        // offline — the onSnapshot below keeps filling the map anyway
      }
    })();

    unsubs.push(
      onSnapshot(collection(firestore, ROOT, userId, TOMB), (snap) => {
        snap.docChanges().forEach((ch) => {
          if (ch.type === 'removed') {
            tombstones.delete(ch.doc.id);
            return;
          }
          const data = ch.doc.data() as { deletedAt?: number };
          const delAt = Number(data.deletedAt) || 0;
          tombstones.set(ch.doc.id, delAt);
          void deleteLocalIfTombstoned(userId, ch.doc.id, delAt);
        });
      })
    );

    // Data stores
    for (const store of SYNC_STORES) {
      const unsub = onSnapshot(
        collection(firestore, ROOT, userId, store),
        (snap) => {
          snap.docChanges().forEach((ch) => {
            // Our own writes echo back with hasPendingWrites=true — skip them.
            if (ch.doc.metadata.hasPendingWrites) return;

            if (ch.type === 'removed') {
              // Deleted on another device → delete locally too.
              if (!tombstones.has(`${store}__${ch.doc.id}`)) {
                tombstones.set(`${store}__${ch.doc.id}`, Date.now());
              }
              void dbDeleteLocal(store, ch.doc.id);
              return;
            }

            void applyCloudDoc(store, userId, ch.doc.id, ch.doc.data() as Record<string, unknown>).catch((err) =>
              console.warn('[firebase-sync] apply failed:', (err as Error)?.message)
            );
          });
        },
        (err) => console.warn(`[firebase-sync] listener error (${store}):`, (err as Error)?.message)
      );
      unsubs.push(unsub);
    }

    attachedFor.set(userId, unsubs);
    liveByUser.set(userId, true);
    emit(userId, 'ok');
  } catch (err) {
    attachedFor.delete(userId); // allow a later retry
    liveByUser.set(userId, false);
    console.warn('[firebase-sync] attach failed:', (err as Error)?.message);
  }
}

async function dbDeleteLocal(store: SyncStore, id: string): Promise<void> {
  try {
    const db = await getOfflineDB();
    await db.delete(store, id);
  } catch (err) {
    console.warn('[firebase-sync] local delete failed:', (err as Error)?.message);
  }
}

/** Tombstone arrived from another device → remove the local row it covers. */
async function deleteLocalIfTombstoned(userId: string, key: string, deletedAt: number): Promise<void> {
  const sep = key.indexOf('__');
  if (sep <= 0) return;
  const storeName = key.slice(0, sep);
  const itemId = key.slice(sep + 2);
  if (!(SYNC_STORES as string[]).includes(storeName) || !itemId) return;
  try {
    const db = await getOfflineDB();
    const store = storeName as SyncStore;
    if (store === 'billingSettings') return; // single settings doc — LWW handles it
    const local = (await db.get(store, itemId)) as unknown as Record<string, unknown> | undefined;
    if (local && recordTs(local) > deletedAt) return; // locally edited after the delete → keep
    await db.delete(store, itemId);
  } catch {
    // best-effort
  }
}

/** Apply one cloud doc into local IndexedDB — last-writer-wins. */
async function applyCloudDoc(store: SyncStore, uid: string, id: string, data: Record<string, unknown>): Promise<void> {
  const db = await getOfflineDB();

  // Deleted (on another device) after this doc was last written → stays deleted.
  const tomb = tombstones.get(`${store}__${id}`);
  if (tomb !== undefined && tomb >= recordTs(data)) return;

  const local = (await db.get(store, id)) as unknown as Record<string, unknown> | undefined;
  if (local && recordTs(local) >= recordTs(data)) return; // local is same/newer

  if (store === 'categories') {
    await applyCloudCategory(uid, id, data);
    return;
  }
  if (store === 'billingSettings') {
    // Single settings doc keyed by the local userId.
    const cloudTs = recordTs(data);
    const localSettings = (await db.get('billingSettings', uid)) as unknown as Record<string, unknown> | undefined;
    if (localSettings && recordTs(localSettings) >= cloudTs) return;
    const fixed = { ...(clean(data) as Record<string, unknown>), userId: uid };
    await db.put('billingSettings', fixed as OfflineDBSchema['billingSettings']['value']);
    return;
  }

  const stamp = Date.now();
  const row = { ...data, id, userId: uid } as Record<string, unknown>;
  if (store !== 'bills') {
    row._synced = stamp; // bills/billingSettings rows carry no bookkeeping fields
    row._dirty = 0;
  }
  await db.put(store, row as never);
}

/**
 * Two devices both seed the 20 starter categories with DIFFERENT random ids —
 * without this the shop ends up with duplicate "Mobile"/"Charger" categories.
 * Rule: when a cloud category collides with a same-name local one, the OLDER
 * createdAt wins deterministically on every device. If the cloud row wins,
 * the local duplicate's id is retired and every product referencing it is
 * remapped to the cloud id (one atomic transaction) so nothing dangles.
 */
async function applyCloudCategory(uid: string, cloudId: string, cloudData: Record<string, unknown>): Promise<void> {
  const db = await getOfflineDB();
  const cloudName = String(cloudData.name || '').trim().toLowerCase();
  const cloudRow = { ...cloudData, id: cloudId, userId: uid, _synced: Date.now(), _dirty: 0 } as OfflineDBSchema['categories']['value'];

  const localRows = (await db.getAllFromIndex('categories', 'by-userId', uid)) as OfflineDBSchema['categories']['value'][];
  const dup = cloudName
    ? localRows.find((c) => c.id !== cloudId && String(c.name || '').trim().toLowerCase() === cloudName)
    : undefined;

  if (!dup) {
    await db.put('categories', cloudRow);
    return;
  }

  // Deterministic winner: older createdAt wins; tie → smaller id.
  const cloudCreated = Date.parse(String(cloudData.createdAt || '')) || 0;
  const dupCreated = Date.parse(String(dup.createdAt || '')) || 0;
  const cloudWins = cloudCreated < dupCreated || (cloudCreated === dupCreated && cloudId <= dup.id);
  if (!cloudWins) return; // local copy is the winner — leave it alone

  const tx = db.transaction(['categories', 'products'], 'readwrite');
  const products = await tx.objectStore('products').index('by-categoryId').getAll(dup.id);
  for (const p of products) {
    const prod = p as OfflineDBSchema['products']['value'];
    if (prod.userId !== uid) continue;
    const remapped: OfflineDBSchema['products']['value'] = { ...prod, categoryId: cloudId };
    if (remapped.category && remapped.category.id === dup.id) {
      remapped.category = { ...remapped.category, id: cloudId };
    }
    void tx.objectStore('products').put(remapped);
  }
  void tx.objectStore('categories').delete(dup.id);
  void tx.objectStore('categories').put(cloudRow);
  await tx.done;
}

// ============ RESTORE (cloud → local, full replace) ============

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
    // restore succeeded → push the restored data back up (keeps the mirror true)
    notifyRestoreDone(userId);
    return { ok: true, stores };
  } catch (err) {
    const error = (err as Error)?.message || 'restore failed';
    console.warn('[firebase-sync] restore failed:', error);
    return { ok: false, stores: {}, error };
  }
}

// ============ WIPE (Reset All Data → clear the cloud mirror too) ============

/** Deletes every cloud doc of this user (all stores + tombstones + meta). */
export async function wipeCloudData(userId: string): Promise<void> {
  try {
    const firestore = getFirestore(getFirebaseApp());
    const trees = [...SYNC_STORES, TOMB, 'meta'];
    for (const colName of trees) {
      const snap = await withTimeout(getDocs(collection(firestore, ROOT, userId, colName)), 'download failed');
      const ids: string[] = [];
      snap.forEach((d) => ids.push(d.id));
      for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
        const batch = writeBatch(firestore);
        for (const id of ids.slice(i, i + BATCH_LIMIT)) batch.delete(doc(firestore, ROOT, userId, colName, id));
        await withTimeout(batch.commit(), 'upload failed');
      }
    }
    tombstones.clear();
    console.info('[firebase-sync] cloud mirror wiped for', userId);
  } catch (err) {
    console.warn('[firebase-sync] cloud wipe failed:', (err as Error)?.message);
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
  live: boolean;
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
    live: liveByUser.get(userId) ?? false,
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

/** Idempotent — wires the data-layer change listener + real-time cloud listeners once. */
export function initFirebaseSync(): void {
  if (booted || typeof window === 'undefined') return;
  booted = true;
  onLocalDataChanged((userId) => {
    void ensureAttached(userId);
    scheduleCloudSync(userId);
  });
  onLocalWipe((userId) => {
    void wipeCloudData(userId);
  });
  // Attach immediately at boot so the initial cloud snapshot (data added on
  // the user's other device) flows in without waiting for a local write.
  void ensureAttached(DEFAULT_USER_ID);
}

/** Internal: after a restore, push the restored data up (without auto-sync gate). */
function notifyRestoreDone(userId: string): void {
  setTimeout(() => void pushAllToFirebase(userId), 400);
}
