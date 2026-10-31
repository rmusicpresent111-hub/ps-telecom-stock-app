/**
 * App Lock state — the store behind the AppLockGate overlay.
 *
 * Behaviour (APK only; web is a no-op because the native plugin is absent):
 *  - COLD START: bootstrap() runs in a pre-paint layout effect. If the lock is
 *    enabled the gate is raised SYNCHRONOUSLY (before the first paint — no
 *    data ever flashes) and the system screen-lock prompt is auto-triggered.
 *  - NO LOCKOUT GUARANTEE: if the device has no screen lock (or the plugin is
 *    missing) the gate never engages — availability is checked before/while
 *    locking and a negative answer immediately lowers the gate.
 *  - BACKGROUND RE-LOCK: returning from ≥30s in the background raises the
 *    gate again. Two race guards keep it well-behaved:
 *      · while a prompt is in flight the visibility handler does nothing
 *      · a successful unlock suppresses the resume re-lock for 5s (kills the
 *        "system credential activity paused us for 40s on old Android" loop)
 *  - SETTING: `enabled` is persisted per device ('ps-applock-v1', default ON
 *    per the owner's request); the Profile screen toggles it.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { appLockAuthenticate, appLockAvailable, appLockSupported } from '@/lib/app-lock';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';

/** Backgrounded longer than this → the gate re-locks on return. */
export const APP_LOCK_RELOCK_AFTER_MS = 30_000;
/** A fresh successful unlock suppresses the resume re-lock for this long. */
const APP_LOCK_UNLOCK_GRACE_MS = 5_000;

interface AppLockState {
  /** User setting (persisted, default ON). */
  enabled: boolean;
  /** Gate overlay visible? */
  locked: boolean;
  /** Native prompt in flight — blocks duplicate prompts. */
  prompting: boolean;
  /** Device can verify with a screen lock (null = not probed yet). */
  available: boolean | null;
  /** Real failure message from the native side (null on user-cancel). */
  lastError: string | null;
  /** 'cancelled' shows the soft hint line; 'failed' shows the error line. */
  lastResult: 'cancelled' | 'failed' | null;
  _bgSince: number | null;
  _lastUnlockAt: number;

  /** Called once from the gate's pre-paint layout effect. */
  bootstrap: () => Promise<void>;
  /** Probe device availability (Profile screen / bootstrap helper). */
  probe: () => Promise<boolean>;
  /** Show the system prompt; on success lower the gate. */
  requestUnlock: () => Promise<void>;
  /** visibilitychange listener body (background re-lock). */
  handleVisibilityChange: () => void;
  setEnabled: (on: boolean) => void;
}

export const useAppLockStore = create<AppLockState>()(
  persist(
    (set, get) => ({
      enabled: true,
      locked: false,
      prompting: false,
      available: null,
      lastError: null,
      lastResult: null,
      _bgSince: null,
      _lastUnlockAt: 0,

      bootstrap: async () => {
        if (!appLockSupported()) {
          // Plain browser / web build — the gate never exists here.
          set({ available: false, locked: false, prompting: false });
          return;
        }
        if (!get().enabled) {
          // Keep the Profile toggle informed even when the lock is off.
          void get().probe();
          set({ locked: false });
          return;
        }
        // Lock SYNCHRONOUSLY before the first await → the overlay paints with
        // the very first frame, before any app data can flash.
        set({ locked: true, lastError: null, lastResult: null });
        const ok = await get().probe();
        if (!ok) {
          // Device has no screen lock → never lock (no-lockout guarantee).
          set({ locked: false });
          return;
        }
        await get().requestUnlock();
      },

      probe: async () => {
        const ok = await appLockAvailable();
        set({ available: ok });
        if (!ok) set({ prompting: false });
        return ok;
      },

      requestUnlock: async () => {
        if (get().prompting) return;
        if (!appLockSupported()) return;
        set({ prompting: true, lastResult: null });
        const lang = useAppStore.getState().language;
        const res = await appLockAuthenticate({
          title: t('lockPromptTitle', lang),
          subtitle: t('lockPromptSubtitle', lang),
        });
        if (res.ok) {
          set({
            prompting: false,
            locked: false,
            lastError: null,
            lastResult: null,
            _lastUnlockAt: Date.now(),
            _bgSince: null,
          });
          return;
        }
        set({
          prompting: false,
          // Gate stays up — the user simply taps Unlock again.
          lastResult: res.cancelled ? 'cancelled' : 'failed',
          lastError: res.cancelled ? null : res.message,
        });
      },

      handleVisibilityChange: () => {
        if (typeof document === 'undefined') return;
        const state = get();
        if (document.visibilityState === 'hidden') {
          // Already gated / prompting → nothing to remember.
          if (state.locked || state.prompting) return;
          set({ _bgSince: Date.now() });
          return;
        }
        // Visible again.
        const bg = state._bgSince;
        set({ _bgSince: null });
        if (!bg || !state.enabled || !state.available || state.locked || state.prompting) return;
        if (Date.now() - state._lastUnlockAt < APP_LOCK_UNLOCK_GRACE_MS) return;
        if (Date.now() - bg >= APP_LOCK_RELOCK_AFTER_MS) {
          set({ locked: true, lastError: null, lastResult: null });
          void get().requestUnlock();
        }
      },

      setEnabled: (on) => {
        set({ enabled: on });
        if (!on) set({ locked: false, lastError: null, lastResult: null });
      },
    }),
    {
      name: 'ps-applock-v1',
      version: 1,
      // Only the user setting is persisted — lock/transient state never is.
      partialize: (state) => ({ enabled: state.enabled }) as AppLockState,
    }
  )
);
