'use client';

/**
 * Admin data cache — makes the console feel instant ("database connection
 * smooth faster load"):
 *
 *  - loadCached(key, loader): dedupes concurrent identical loads and serves
 *    an in-flight/recent result instead of re-scanning IndexedDB on every
 *    section switch. A SHORT ttl keeps it safe — it only absorbs rapid
 *    remounts and parallel calls, never stale data.
 *  - The cache is INVALIDATED the moment the underlying data can change:
 *    any local write (onLocalDataChanged) or a finished D1 sync cycle
 *    (idle after syncing) clears it, so a refetch always sees fresh rows.
 *  - prefetchAdminData(): warms the heaviest queries (dashboard + cash book)
 *    while the shell boot is still on screen, so the first
 *    dashboard paint hits the cache instead of waiting on IndexedDB.
 */

import { onLocalDataChanged } from '@/lib/sync-events';
import { subscribeD1Status } from '@/lib/d1-sync';
import { DEFAULT_USER_ID } from '@/lib/local-auth';

type Entry = { at: number; p: Promise<unknown> };

const cache = new Map<string, Entry>();
const TTL_MS = 4_000; // only absorbs rapid remounts — writes/sync clear it anyway

let wired = false;

function wire(): void {
  if (wired || typeof window === 'undefined') return;
  wired = true;

  // any local write anywhere invalidates everything
  onLocalDataChanged(() => cache.clear());

  // a finished D1 sync cycle may have written new rows
  let prev = '';
  subscribeD1Status((s) => {
    if (s.state === 'idle' && prev === 'syncing') cache.clear();
    prev = s.state;
  });
}

export function loadCached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  wire();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p as Promise<T>;
  const p = loader().catch((err) => {
    // a failed load must not be cached — the next call retries for real
    cache.delete(key);
    throw err;
  });
  cache.set(key, { at: Date.now(), p });
  return p;
}


/** Warm the heavy admin queries in the background (shell boot / unlock). */
export function prefetchAdminData(): void {
  void import('@/lib/offline-service').then((m) => {
    void loadCached('admin:dashboard', () => m.getDashboardOffline(DEFAULT_USER_ID)).catch(() => undefined);
    void loadCached('admin:cashbook', () => m.getCashBookOffline(DEFAULT_USER_ID)).catch(() => undefined);
  });
}
