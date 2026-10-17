'use client';

/**
 * Registers the PWA service worker — PRODUCTION, non-localhost origins only.
 *
 * Why the guard: the sandbox preview / development server runs `next dev`,
 * where a service worker would cache dev chunks and break HMR. The installed
 * APK (Capacitor) doesn't need a SW either — it already ships the shell
 * natively. So this only comes alive on the deployed web version (e.g.
 * Vercel), where it makes the app open offline from the home-screen icon.
 */

import { useEffect } from 'react';

export default function PwaRegister() {
  useEffect(() => {
    try {
      if (process.env.NODE_ENV !== 'production') return;
      if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
      const host = window.location.hostname;
      if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return;

      const register = () => {
        // NEXT_PUBLIC_BASE_PATH is stamped at build time (GitHub Pages mirror)
        const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
        navigator.serviceWorker.register(`${base}/sw.js`).catch(() => {
          /* PWA is a bonus — never let it break the app */
        });
      };
      if (document.readyState === 'complete') register();
      else window.addEventListener('load', register, { once: true });
    } catch {
      /* ignore — same reason as above */
    }
  }, []);

  return null;
}
