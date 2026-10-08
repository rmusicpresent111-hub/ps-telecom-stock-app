/**
 * Capacitor Bridge Initialization
 *
 * This module ensures the Capacitor native bridge is properly initialized
 * before the React app mounts. It also pre-registers the back button handler
 * at the native level to prevent the app from exiting prematurely.
 *
 * MUST be imported early in the app lifecycle (before React renders).
 */

let _backButtonRegistered = false;

/**
 * Initialize Capacitor App plugin and register a global back button handler.
 * This runs BEFORE React mounts, ensuring the back button is always intercepted.
 */
export async function initCapacitorBridge(): Promise<void> {
  if (typeof window === 'undefined') return; // SSR guard

  try {
    const { App } = await import('@capacitor/app');

    // Pre-register back button handler at the native level
    // This prevents the app from closing before React even mounts
    // NOTE: flag is set SYNCHRONOUSLY before the async addListener call —
    // two rapid initCapacitorBridge() calls (e.g. HMR) could otherwise both
    // pass the guard and register duplicate native listeners.
    if (!_backButtonRegistered) {
      _backButtonRegistered = true;
      App.addListener('backButton', () => {
        // Dispatch a custom event that the React app will listen to
        window.dispatchEvent(new CustomEvent('app:back-button'));
      }).catch((err: unknown) => {
        _backButtonRegistered = false; // allow retry on next call
        console.warn('[CapacitorInit] Failed to register backButton listener:', err);
      });
    }
  } catch {
    // Not running inside Capacitor (plain browser) — expected, nothing to do.
  }
}

// Auto-initialize on import (runs when module is first loaded)
if (typeof window !== 'undefined') {
  // Use requestAnimationFrame to ensure DOM is ready but still runs early
  requestAnimationFrame(() => {
    initCapacitorBridge();
  });
}
