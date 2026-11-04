'use client';

/**
 * CLIENT-SIDE SITE GATE — overlay for deployments that can't run
 * src/proxy.ts (GitHub Pages static export) and a safety net for
 * server deployments.
 *
 * Decision order:
 *   1. Capacitor native (APK) → skip: the APK already has its own native
 *      screen-lock (AppLockGate) and the data lives on the device.
 *   2. Per-tab "unlocked" flag in sessionStorage → open.
 *   3. GET /api/site-auth → 200 means the server cookie is valid → open
 *      (this is the normal path on Vercel after the proxy unlock).
 *   4. Otherwise → full-screen lock overlay (same form as /site-lock).
 *
 * 5-MINUTE AUTO-LOCK (v2.24.1 — owner request: entry asks for the password,
 * the site re-locks itself after 5 minutes):
 *   • while the gate is OPEN an inactivity timer runs — any pointer/key/
 *     scroll activity restarts it, 5 quiet minutes raise the overlay again
 *     (and drop the per-tab flag);
 *   • returning to a tab that was hidden for ≥5 minutes locks immediately;
 *   • a fresh tab / fresh session never carries the flag, so every new
 *     entry asks for the password.
 *
 * The overlay renders OPAQUE from the first paint (initial state = locked)
 * so the app content behind it never flashes on static hosts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import SiteLockForm, {
  markSiteTrusted,
  clearSiteTrusted,
  SITE_TRUST_KEY,
} from '@/components/SiteLockForm';

type GateState = 'locked' | 'open';

/** Idle time before the site re-locks itself ("5 minite por auto lock"). */
const SITE_IDLE_MS = 5 * 60 * 1000;

function trustedFlagValid(): boolean {
  try {
    return sessionStorage.getItem(SITE_TRUST_KEY) === '1';
  } catch {
    return false;
  }
}

export default function SiteLockGate() {
  const [state, setState] = useState<GateState>('locked');
  const stateRef = useRef<GateState>('locked');

  const setGate = useCallback((s: GateState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      // 1) APK — native AppLock already guards the whole app
      try {
        if (Capacitor.isNativePlatform()) {
          if (alive) setGate('open');
          return;
        }
      } catch {
        /* not a Capacitor environment — continue */
      }

      // 2) per-tab unlocked flag (static hosts + reloaded tabs)
      if (trustedFlagValid()) {
        if (alive) setGate('open');
        return;
      }

      // 3) server cookie check (server mode) — also slides the 5-min session
      // NOTE: the endpoint answers HTTP 200 even when the cookie is invalid
      // (body {ok:false}) — decide on the BODY, never on r.ok alone.
      try {
        const r = await fetch('/api/site-auth/', { cache: 'no-store' });
        if (r.ok) {
          const j = (await r.json().catch(() => null)) as { ok?: boolean } | null;
          if (j?.ok === true) {
            markSiteTrusted();
            if (alive) setGate('open');
            return;
          }
        }
      } catch {
        /* static host without API routes → stay locked */
      }

      if (alive) setGate('locked');
    })();

    return () => {
      alive = false;
    };
  }, [setGate]);

  // 5-minute idle auto-lock + long-background re-lock (gate open only)
  useEffect(() => {
    if (state !== 'open') return;

    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let hiddenAt = 0;

    const relock = () => {
      clearTimeout(idleTimer);
      clearSiteTrusted();
      setGate('locked');
    };
    const arm = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(relock, SITE_IDLE_MS);
    };
    const onActivity = () => {
      if (stateRef.current === 'open') arm();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      // back from hidden: ≥5 min away → lock right away, else keep guarding
      if (hiddenAt && Date.now() - hiddenAt >= SITE_IDLE_MS) {
        relock();
        return;
      }
      onActivity();
    };

    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    arm();

    return () => {
      clearTimeout(idleTimer);
      events.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [state, setGate]);

  const unlock = useCallback(() => setGate('open'), []);

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
