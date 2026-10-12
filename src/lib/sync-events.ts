/**
 * Tiny in-process event bus that decouples the data layer from the sync layer.
 *
 * offline-service.ts (IndexedDB writes) fires `notifyLocalDataChanged(userId)`
 * after every successful write; firebase-sync.ts subscribes and schedules a
 * debounced cloud push. Kept dependency-free to avoid circular imports.
 */

type Listener = (userId: string) => void;

const listeners = new Set<Listener>();

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
