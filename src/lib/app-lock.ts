/**
 * App Lock — device screen-lock (biometric / PIN / pattern) gate for the APK.
 *
 * The Android side is the LOCAL "AppLock" Capacitor plugin
 * (native/android/AppLockPlugin.java, auto-installed by scripts/build-apk.js):
 *   isAvailable()  → { available, code }   device has a screen lock / biometrics
 *   authenticate() → { ok, code, message } shows the SYSTEM lock prompt
 *
 * The phone's own lock credentials are used — no app PIN is stored anywhere.
 * On web (browser / PWA / GitHub Pages / Vercel) there is no native plugin,
 * so every helper degrades gracefully and the gate never appears.
 *
 * DEV/E2E HOOKS (inert in normal use): localStorage flags
 *   ps-applock-debug-native=1    → appLockSupported() returns true in a plain
 *                                  browser (no Capacitor plugin needed)
 *   ps-applock-debug-available=1 → appLockAvailable() returns true and
 *                                  authenticate() auto-succeeds after a short
 *                                  delay, so the gate UI can be exercised in
 *                                  a browser end-to-end.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

export interface AppLockPluginInterface {
  isAvailable(): Promise<{ available: boolean; code: number }>;
  authenticate(options: {
    title?: string;
    subtitle?: string;
  }): Promise<{ ok: boolean; code?: number; message?: string }>;
}

/**
 * The native plugin handle — registered LAZILY and ONLY inside the APK.
 * Registering on web would create a throw-away proxy (and Capacitor warns
 * "already registered" when a module re-evaluates, e.g. dev Fast Refresh);
 * native-only registration keeps the browser console clean.
 */
let cachedNativePlugin: AppLockPluginInterface | null | undefined;
function getNativePlugin(): AppLockPluginInterface | null {
  if (cachedNativePlugin !== undefined) return cachedNativePlugin;
  try {
    if (!Capacitor.isNativePlatform()) {
      cachedNativePlugin = null;
      return null;
    }
    cachedNativePlugin = registerPlugin<AppLockPluginInterface>('AppLock');
  } catch {
    cachedNativePlugin = null;
  }
  return cachedNativePlugin;
}

/** Dev/E2E hook — see module doc. Never true unless explicitly set. */
function debugNative(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem('ps-applock-debug-native') === '1';
  } catch {
    return false;
  }
}

/** Dev/E2E hook — see module doc. Never true unless explicitly set. */
function debugAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem('ps-applock-debug-available') === '1';
  } catch {
    return false;
  }
}

/** True only inside the Android APK (or with the dev/E2E flag set). */
export function appLockSupported(): boolean {
  try {
    return Capacitor.isNativePlatform() || debugNative();
  } catch {
    return false;
  }
}

/**
 * Can this device actually verify with a screen lock? False when no lock is
 * configured on the phone, when the hardware is unavailable, or when we are
 * not inside the APK — in every one of those cases the app must NOT lock.
 */
export async function appLockAvailable(): Promise<boolean> {
  if (!appLockSupported()) return false;
  if (debugAvailable()) return true;
  const plugin = getNativePlugin();
  if (!plugin) return false;
  try {
    const res = await plugin.isAvailable();
    return !!res?.available;
  } catch {
    return false;
  }
}

export interface AppLockAuthResult {
  ok: boolean;
  /** True when the user dismissed/cancelled the prompt (no scary error). */
  cancelled: boolean;
  message: string | null;
}

/** Shows the system screen-lock prompt and reports the outcome. */
export async function appLockAuthenticate(options: {
  title?: string;
  subtitle?: string;
}): Promise<AppLockAuthResult> {
  if (!appLockSupported()) {
    return { ok: false, cancelled: false, message: 'unsupported' };
  }
  if (debugAvailable()) {
    // Simulated prompt: 'ps-applock-debug-cancel=1' exercises the cancel path
    // (soft hint, gate stays up); otherwise auto-success after a short delay.
    await new Promise((resolve) => setTimeout(resolve, 600));
    try {
      if (window.localStorage.getItem('ps-applock-debug-cancel') === '1') {
        return { ok: false, cancelled: true, message: null };
      }
    } catch {
      /* ignore */
    }
    return { ok: true, cancelled: false, message: null };
  }
  try {
    const plugin = getNativePlugin();
    if (!plugin) return { ok: false, cancelled: false, message: 'unsupported' };
    const res = await plugin.authenticate(options);
    if (res?.ok) return { ok: true, cancelled: false, message: null };
    const code = typeof res?.code === 'number' ? res.code : -1;
    // androidx.biometric codes that mean "the user backed out", NOT a failure:
    //   5 ERROR_CANCELED · 10 ERROR_USER_CANCELED · 13 ERROR_NEGATIVE_BUTTON
    const cancelled = code === 5 || code === 10 || code === 13;
    const message = (res?.message ?? '').trim();
    return { ok: false, cancelled, message: message || null };
  } catch (err) {
    return { ok: false, cancelled: false, message: (err as Error)?.message || 'failed' };
  }
}
