/**
 * Auto-sync dirty tracking — pure localStorage, ZERO imports.
 *
 * Lives in its own tiny module so the offline data layer (offline-service.ts)
 * can mark changed rows without importing the cloud engine (cloud-d1.ts) —
 * that would create an import cycle: cloud-sync → cloud-d1 → offline-service
 * → cloud-sync. This module depends on nothing, so the cycle is impossible.
 *
 * Shape (per user): ps-d1-dirty:<userId> =
 *   { changed: { [cloudTable]: string[] }, deleted: { [cloudTable]: string[] },
 *     fullResync: string[] }  // tables whose change list overflowed → full backup
 */

const DIRTY_PREFIX = 'ps-d1-dirty:';
const AUTOSYNC_PREFIX = 'ps-d1-autosync:';
const LAST_SYNC_PREFIX = 'ps-d1-last-autosync:';

/** Per-table dirty list overflow threshold — beyond this a full backup is cheaper. */
const MAX_IDS_PER_TABLE = 5000;

export interface DirtyState {
  changed: Record<string, string[]>;
  deleted: Record<string, string[]>;
  /** Table names that overflowed their list — engine must run a full backup. */
  fullResync: string[];
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage full/blocked — auto-sync degrades to manual backup; nothing
    // sensible to do here and never crash a data write for this.
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore.
  }
}

export function getDirty(userId: string): DirtyState {
  try {
    const raw = safeGet(DIRTY_PREFIX + userId);
    if (!raw) return { changed: {}, deleted: {}, fullResync: [] };
    const parsed = JSON.parse(raw) as Partial<DirtyState>;
    return {
      changed: parsed.changed && typeof parsed.changed === 'object' ? parsed.changed : {},
      deleted: parsed.deleted && typeof parsed.deleted === 'object' ? parsed.deleted : {},
      fullResync: Array.isArray(parsed.fullResync) ? parsed.fullResync : [],
    };
  } catch {
    return { changed: {}, deleted: {}, fullResync: [] };
  }
}

export function hasDirty(userId: string): boolean {
  const d = getDirty(userId);
  const anyChanged = Object.values(d.changed).some(a => a.length > 0);
  const anyDeleted = Object.values(d.deleted).some(a => a.length > 0);
  return anyChanged || anyDeleted || d.fullResync.length > 0;
}

/**
 * Records row changes/deletions for a cloud table. Pure localStorage — safe to
 * call from any write path, never throws.
 */
export function markDirty(
  userId: string,
  opts: { table: string; changed?: string[]; deleted?: string[] }
): void {
  if (!userId || !opts?.table) return;
  const changed = (opts.changed || []).filter(Boolean);
  const deleted = (opts.deleted || []).filter(Boolean);
  if (changed.length === 0 && deleted.length === 0) return;

  const state = getDirty(userId);
  if (state.fullResync.includes(opts.table)) return; // already flagged for full backup

  const merge = (list: string[] | undefined, ids: string[]): string[] | null => {
    const set = new Set(list || []);
    for (const id of ids) set.add(id);
    return set.size > MAX_IDS_PER_TABLE ? null : Array.from(set);
  };

  const nextChanged: Record<string, string[]> = { ...state.changed };
  const nextDeleted: Record<string, string[]> = { ...state.deleted };
  const fullResync = [...state.fullResync];

  if (changed.length > 0) {
    const merged = merge(nextChanged[opts.table], changed);
    if (!merged) {
      fullResync.push(opts.table);
      delete nextChanged[opts.table];
    } else {
      nextChanged[opts.table] = merged;
    }
  }
  if (deleted.length > 0) {
    const merged = merge(nextDeleted[opts.table], deleted);
    if (!merged) {
      fullResync.push(opts.table);
      delete nextDeleted[opts.table];
    } else {
      nextDeleted[opts.table] = merged;
    }
  }
  // An id both deleted and changed → deletion wins (it no longer exists).
  for (const table of Object.keys(nextDeleted)) {
    if (nextChanged[table]) {
      const del = new Set(nextDeleted[table]);
      nextChanged[table] = nextChanged[table].filter(id => !del.has(id));
      if (nextChanged[table].length === 0) delete nextChanged[table];
    }
  }

  safeSet(DIRTY_PREFIX + userId, JSON.stringify({ changed: nextChanged, deleted: nextDeleted, fullResync }));

  // Wake the sync engine (cloud-sync.ts listens; sync-dirty itself stays
  // import-free so the offline data layer can never create an import cycle).
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('ps-d1-dirty', { detail: userId }));
    } catch {
      // Never let a notification failure break a data write.
    }
  }
}

/** Removes successfully synced ids (keeps anything newly dirty since the run started). */
export function clearSynced(
  userId: string,
  synced: { changed: Record<string, string[]>; deleted: Record<string, string[]>; fullResync?: string[] }
): void {
  const state = getDirty(userId);
  const subtract = (current: Record<string, string[]>, done: Record<string, string[]>) => {
    const out: Record<string, string[]> = {};
    for (const [table, ids] of Object.entries(current)) {
      const doneSet = new Set(done[table] || []);
      const rest = ids.filter(id => !doneSet.has(id));
      if (rest.length > 0) out[table] = rest;
    }
    return out;
  };
  const nextChanged = subtract(state.changed, synced.changed);
  const nextDeleted = subtract(state.deleted, synced.deleted);
  const nextFull = state.fullResync.filter(t => !(synced.fullResync || []).includes(t));
  const empty =
    Object.keys(nextChanged).length === 0 &&
    Object.keys(nextDeleted).length === 0 &&
    nextFull.length === 0;
  if (empty) safeRemove(DIRTY_PREFIX + userId);
  else safeSet(DIRTY_PREFIX + userId, JSON.stringify({ changed: nextChanged, deleted: nextDeleted, fullResync: nextFull }));
}

export function clearDirty(userId: string): void {
  safeRemove(DIRTY_PREFIX + userId);
}

// ---- Auto Sync settings ----

export function isAutoSyncEnabled(userId: string): boolean {
  return safeGet(AUTOSYNC_PREFIX + userId) === '1';
}

export function setAutoSyncEnabled(userId: string, enabled: boolean): void {
  if (enabled) safeSet(AUTOSYNC_PREFIX + userId, '1');
  else safeRemove(AUTOSYNC_PREFIX + userId);
}

/** Timestamp (ms) of the last successful auto sync (0 = never). */
export function getLastAutoSync(userId: string): number {
  const raw = safeGet(LAST_SYNC_PREFIX + userId);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

export function setLastAutoSync(userId: string, at: number): void {
  safeSet(LAST_SYNC_PREFIX + userId, String(at));
}
