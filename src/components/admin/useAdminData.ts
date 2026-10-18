'use client';

/**
 * Admin data-refresh hook.
 *
 * Re-runs loaders whenever the underlying data can have changed:
 *  - any local write (offline-service fires onLocalDataChanged)
 *  - a completed cloud-sync cycle (D1 pull may have written new rows)
 *  - window focus / connectivity
 *  - a gentle 20s poll (other-device changes between pull ticks)
 */

import { useEffect, useState } from 'react';
import { onLocalDataChanged } from '@/lib/sync-events';
import { subscribeD1Status } from '@/lib/d1-sync';

export function useAdminDataTick(): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);

    const offLocal = onLocalDataChanged(() => bump());

    let prevSyncState = '';
    const offSync = subscribeD1Status((s) => {
      // bump once when a sync cycle finishes (idle after syncing)
      if (s.state === 'idle' && prevSyncState === 'syncing') bump();
      prevSyncState = s.state;
    });

    window.addEventListener('focus', bump);
    window.addEventListener('online', bump);
    const iv = setInterval(bump, 20_000);

    return () => {
      offLocal();
      offSync();
      window.removeEventListener('focus', bump);
      window.removeEventListener('online', bump);
      clearInterval(iv);
    };
  }, []);

  return tick;
}
