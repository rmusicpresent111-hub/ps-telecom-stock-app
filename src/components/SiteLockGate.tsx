'use client';

/**
 * CLIENT-SIDE SITE GATE — overlay for deployments that can't run
 * src/middleware.ts (GitHub Pages static export) and a safety net for
 * server deployments.
 *
 * Decision order:
 *   1. Capacitor native (APK) → skip: the APK already has its own native
 *      screen-lock (AppLockGate) and the data lives on the device.
 *   2. Valid "trusted device" flag in localStorage (30 days) → open.
 *   3. GET /api/site-auth → 200 means the server cookie is valid → open
 *      (this is the normal path on Vercel after the middleware unlock).
 *   4. Otherwise → full-screen lock overlay (same form as /site-lock).
 *
 * The overlay renders OPAQUE from the first paint (initial state = locked)
 * so the app content behind it never flashes on static hosts.
 */

import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import SiteLockForm, { markSiteTrusted } from '@/components/SiteLockForm';

type GateState = 'locked' | 'open';

const TRUST_KEY = 'ps-site-gate-ok-v1';

function trustedFlagValid(): boolean {
  try {
    const raw = localStorage.getItem(TRUST_KEY);
    if (!raw) return false;
    const { exp } = JSON.parse(raw) as { exp?: number };
    return typeof exp === 'number' && Date.now() < exp;
  } catch {
    return false;
  }
}

export default function SiteLockGate() {
  const [state, setState] = useState<GateState>('locked');

  useEffect(() => {
    let alive = true;

    (async () => {
      // 1) APK — native AppLock already guards the whole app
      try {
        if (Capacitor.isNativePlatform()) {
          if (alive) setState('open');
          return;
        }
      } catch {
        /* not a Capacitor environment — continue */
      }

      // 2) trusted-device flag (static hosts)
      if (trustedFlagValid()) {
        if (alive) setState('open');
        return;
      }

      // 3) server cookie check (server mode)
      try {
        const r = await fetch('/api/site-auth/', { cache: 'no-store' });
        if (r.ok) {
          markSiteTrusted();
          if (alive) setState('open');
          return;
        }
      } catch {
        /* static host without API routes → stay locked */
      }

      if (alive) setState('locked');
    })();

    return () => {
      alive = false;
    };
  }, []);

  const unlock = useCallback(() => setState('open'), []);

  if (state === 'open') return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Site locked"
      className="fixed inset-0 z-[2147483000] flex items-center justify-center overflow-y-auto bg-[radial-gradient(1200px_600px_at_50%_-10%,rgba(250,110,65,0.14),transparent),linear-gradient(180deg,#0a1210,#070d0c)] p-4"
    >
      <SiteLockForm onUnlock={unlock} />
    </div>
  );
}
