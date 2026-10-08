'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { Screen } from '@/lib/types';
import { closeTopBackModal } from '@/lib/modal-back';

// Auth/onboarding flow screens — hardware back does nothing there
const AUTH_FLOW_SCREENS: Screen[] = ['splash', 'welcome', 'tutorial', 'login', 'signup', 'forgot-password'];

/**
 * NATIVE BACK NAVIGATION (stack-based)
 *
 * Behaviour (hardware back button / browser back / Escape):
 *   1. In-screen dialog/modal open → closes the dialog (Android standard).
 *   2. Any page with navigation history → PREVIOUS page (store.goBack).
 *   3. Page with empty history (bottom-nav tab) → HOME page (dashboard).
 *   4. Home page → shows the Exit / Continue confirmation dialog.
 *   5. Exit dialog open → back closes it.
 *
 * This matches the in-app ← header arrows which also walk the navigation
 * stack step-by-step (store.goBack) — so hardware back and on-screen back
 * always behave identically.
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
    if (now - lastBackTimeRef.current < DEBOUNCE_MS) return;
    lastBackTimeRef.current = now;

    const state = useAppStore.getState();
    const { currentScreen } = state;

    // 5. Exit dialog open → back press closes it (standard Android behaviour)
    if (exitDialogRef.current) {
      setDialog(false);
      return;
    }

    // 1. An in-screen dialog/modal is open → close the topmost one,
    //    never navigate the screen beneath it.
    if (closeTopBackModal()) return;

    // Don't handle back on auth/onboarding flow screens
    if (AUTH_FLOW_SCREENS.includes(currentScreen)) return;

    // Language screen during first-run onboarding has no history → ignore
    if (currentScreen === 'language' && !state.isAuthenticated) return;

    // 4. HOME page → exit confirmation dialog (Exit / Continue)
    if (currentScreen === 'dashboard') {
      setDialog(true);
      return;
    }

    // 3. Navigation history exists → go to the PREVIOUS page
    if (state.previousScreens.length > 0) {
      state.goBack();
      return;
    }

    // 2. No history (bottom-nav tab with cleared stack) → HOME page first
    state.resetNavigation('dashboard');
  }, [setDialog]);

  // ===== 1. Browser popstate handler (PWA / mobile browser back gesture) =====
  useEffect(() => {
    // Push initial state so back button doesn't exit immediately
    window.history.pushState({ appState: true, screenIndex: 0 }, '');

    const handlePopState = () => {
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
      if (e.key === 'Escape') handleBack();
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
