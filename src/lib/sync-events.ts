/**
 * Tiny in-process event bus that decouples the data layer from any
 * future cloud/backup layer.
 *
 * offline-service.ts (IndexedDB writes) fires `notifyLocalDataChanged(userId)`
 * after every successful write. Any future database/sync module can subscribe
 * to these hooks without touching the data layer (no circular imports).
 *
 * Currently there are no subscribers — the app runs fully offline on IndexedDB.
 */

type Listener = (userId: string) => void;

const listeners = new Set<Listener>();
const wipeListeners = new Set<Listener>();

/** Subscribe to local data changes (returns an unsubscribe function). */
export function onLocalDataChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Fire after ANY successful local write (product, bill, txn, expense, ...). */
export function notifyLocalDataChanged(userId: string): void {
  if (!userId) return;
  listeners.forEach((fn) => {
    try {
      fn(userId);
    } catch (err) {
      console.warn('[sync-events] listener failed:', (err as Error)?.message);
    }
  });
}

/**
 * Subscribe to "Reset All Data" events — a future cloud layer must wipe the
 * cloud mirror too, otherwise the cloud copy would flow straight back into
 * the device on the next sync and the reset would look broken.
 */
export function onLocalWipe(fn: Listener): () => void {
  wipeListeners.add(fn);
  return () => {
    wipeListeners.delete(fn);
  };
}

/** Fire after the user's local data was completely reset. */
export function notifyLocalWipe(userId: string): void {
  if (!userId) return;
  wipeListeners.forEach((fn) => {
    try {
      fn(userId);
    } catch (err) {
      console.warn('[sync-events] wipe listener failed:', (err as Error)?.message);
    }
  });
}
