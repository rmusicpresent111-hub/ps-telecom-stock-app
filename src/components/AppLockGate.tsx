'use client';

/**
 * AppLockGate — full-screen overlay that holds the app behind the phone's own
 * screen lock (fingerprint / face / PIN / pattern) inside the Android APK.
 *
 * Rendered from the ROOT layout so it covers the main app AND /admin. On web
 * (browser / PWA / GitHub Pages / Vercel) the native plugin does not exist,
 * the store never locks and this component renders nothing.
 *
 * Hydration safety: the initial render (server AND client hydration) is
 * `null` — the store flips `locked` inside a pre-paint layout effect, so the
 * overlay appears in the very first painted frame on the device (no data
 * flash) without any server/client markup mismatch.
 */

import { useEffect, useLayoutEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Fingerprint, ShieldCheck } from 'lucide-react';
import { useAppLockStore } from '@/store/appLockStore';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';

// Layout effect runs BEFORE the browser paints (zero-flash lock on cold
// start). On the server it does not exist → fall back to useEffect.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export default function AppLockGate() {
  const locked = useAppLockStore((s) => s.locked);
  const prompting = useAppLockStore((s) => s.prompting);
  const lastResult = useAppLockStore((s) => s.lastResult);
  const lastError = useAppLockStore((s) => s.lastError);
  const bootstrap = useAppLockStore((s) => s.bootstrap);
  const requestUnlock = useAppLockStore((s) => s.requestUnlock);
  const handleVisibilityChange = useAppLockStore((s) => s.handleVisibilityChange);
  const language = useAppStore((s) => s.language);
  const theme = useAppStore((s) => s.theme);

  useIsoLayoutEffect(() => {
    void bootstrap();
    const onVisibility = () => handleVisibilityChange();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const texts = useMemo(
    () => ({
      title: t('lockTitle', language),
      subtitle: t('lockSubtitle', language),
      unlock: t('lockUnlock', language),
      secured: t('lockSecured', language),
      cancelled: t('lockCancelled', language),
      failed: t('lockFailed', language),
    }),
    [language]
  );

  if (!locked) return null;

  const hint =
    lastError
      ? lastError
      : lastResult === 'failed'
        ? texts.failed
        : lastResult === 'cancelled'
          ? texts.cancelled
          : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      role="dialog"
      aria-modal="true"
      aria-label={texts.title}
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center px-6 text-center ${
        theme === 'light' ? 'light-theme' : ''
      } bg-background text-foreground`}
    >
      {/* Gold-ringed fingerprint emblem */}
      <motion.div
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="w-24 h-24 rounded-full bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center mb-6"
      >
        <Fingerprint size={44} className="text-emerald-400" strokeWidth={1.6} />
      </motion.div>

      <h1 className="text-lg font-bold tracking-wide">{texts.title}</h1>
      <p className="text-sm text-white/55 mt-2 max-w-xs leading-relaxed">{texts.subtitle}</p>

      {hint && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className={`mt-4 text-xs max-w-xs ${lastError || lastResult === 'failed' ? 'text-red-300' : 'text-white/50'}`}
        >
          {hint}
        </motion.p>
      )}

      <button
        type="button"
        onClick={() => void requestUnlock()}
        disabled={prompting}
        className="mt-8 min-h-[44px] px-9 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-sm font-semibold shadow-lg shadow-emerald-900/40 disabled:opacity-60 active:scale-[0.98] transition-transform"
      >
        {prompting ? '…' : texts.unlock}
      </button>

      <div className="absolute bottom-8 flex items-center gap-1.5 text-[11px] text-white/35">
        <ShieldCheck size={13} className="text-emerald-400/60" />
        <span>{texts.secured}</span>
      </div>
    </motion.div>
  );
}
