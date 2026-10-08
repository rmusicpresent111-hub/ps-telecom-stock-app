'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { Screen } from '@/lib/types';

// Auth/onboarding screens — hardware back does nothing there
const AUTH_SCREENS: Screen[] = ['splash', 'welcome', 'tutorial', 'language', 'login', 'signup', 'forgot-password'];

/**
 * NATIVE BACK NAVIGATION
 *
 * Behaviour (hardware back button / browser back / Escape):
 *   1. Any page  → goes STRAIGHT to the home page (dashboard).
 *   2. Home page → shows the Exit / Continue confirmation dialog.
 *   3. Dialog open → back closes the dialog.
 *
 * The in-app ← header arrows still navigate step-by-step through the
 * navigation stack (store.goBack) — this handler only re-maps the SYSTEM
 * back button to the simple "home first, then exit" flow.
 *
 * Wiring:
 *   - Android APK: capacitor-init.ts listens to App 'backButton' and
 *     dispatches the 'app:back-button' DOM event; page.tsx forwards it here.
 *   - Web/PWA: browser popstate (re-pushed after each press so the page
 *     never actually navigates away) + Escape key for desktop testing.
 */
export function useBackHandler() {
  const [showExitDialog, setShowExitDialog] = useState(false);

  // ✅ Debounce guard - prevents double-firing from multiple listeners
  const lastBackTimeRef = useRef(0);
  const DEBOUNCE_MS = 300;

  // Mirror the dialog state in a ref so the stable handleBack callback can
  // read it without re-creating on every render.
  const exitDialogRef = useRef(false);
  const setDialog = useCallback((show: boolean) => {
    exitDialogRef.current = show;
    setShowExitDialog(show);
  }, []);

  // The core back-navigation logic
  const handleBack = useCallback(() => {
    const now = Date.now();
    if (now - lastBackTimeRef.current < DEBOUNCE_MS) {
      console.log('[BackHandler] Debounced - ignoring rapid back press');
      return;
    }
    lastBackTimeRef.current = now;

    const state = useAppStore.getState();
    const { currentScreen } = state;

    console.log('[BackHandler] Back pressed. Current:', currentScreen);

    // 3. Exit dialog open → back press closes it (standard Android behaviour)
    if (exitDialogRef.current) {
      console.log('[BackHandler] Exit dialog open → close it');
      setDialog(false);
      return;
    }

    // Don't handle back on auth/onboarding screens
    if (AUTH_SCREENS.includes(currentScreen)) {
      console.log('[BackHandler] Auth screen - ignoring back');
      return;
    }

    // 2. HOME page → exit confirmation dialog (Exit / Continue)
    if (currentScreen === 'dashboard') {
      console.log('[BackHandler] Home page → show exit dialog');
      setDialog(true);
      return;
    }

    // 1. ANY other page → go STRAIGHT to the home page
    console.log('[BackHandler]', currentScreen, '→ straight to home (dashboard)');
    state.resetNavigation('dashboard');
  }, [setDialog]);

  // ===== 1. Browser popstate handler (PWA / mobile browser back gesture) =====
  useEffect(() => {
    // Push initial state so back button doesn't exit immediately
    window.history.pushState({ appState: true, screenIndex: 0 }, '');

    const handlePopState = () => {
      console.log('[BackHandler] popstate event fired');
      handleBack();
      // Re-push state to prevent actual navigation away
      window.history.pushState({ appState: true }, '');
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [handleBack]);

  // ===== 2. Keyboard Escape key handler (testing in browser) =====
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        console.log('[BackHandler] Escape key pressed');
        handleBack();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleBack]);

  // ===== NOTE: Capacitor back button is handled by capacitor-init.ts =====
  // capacitor-init.ts registers the native back button listener and dispatches
  // 'app:back-button' custom event, which page.tsx listens for and calls handleBack().
  // This prevents double-firing from having two separate Capacitor listeners.

  // ===== Exit handlers =====
  const handleExitConfirm = useCallback(() => {
    console.log('[BackHandler] Exit confirmed');
    setDialog(false);

    // Try Capacitor App exit first (for native Android)
    import('@capacitor/app')
      .then(({ App }) => {
        App.exitApp();
      })
      .catch(() => {
        // Fallback for web/PWA
        window.close();
        window.location.href = 'about:blank';
      });
  }, [setDialog]);

  const handleExitCancel = useCallback(() => {
    console.log('[BackHandler] Exit cancelled');
    setDialog(false);
  }, [setDialog]);

  return {
    showExitDialog,
    setShowExitDialog: setDialog,
    handleBack,
    handleExitConfirm,
    handleExitCancel,
  };
}
