'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { Screen } from '@/lib/types';

// Tab screens that show BottomNav - pressing back from these should go to dashboard
const TAB_SCREENS: Screen[] = ['dashboard', 'product-list', 'profit', 'history', 'profile'];

// Auth/onboarding screens - back behavior is different
const AUTH_SCREENS: Screen[] = ['splash', 'welcome', 'tutorial', 'language', 'login', 'signup', 'forgot-password'];

interface BackHandlerResult {
  showExitDialog: boolean;
  setShowExitDialog: (show: boolean) => void;
  handleBack: () => void;
  handleExitConfirm: () => void;
  handleExitCancel: () => void;
}

export function useBackHandler(): BackHandlerResult {
  const [showExitDialog, setShowExitDialog] = useState(false);

  // ✅ Debounce guard - prevents double-firing from multiple listeners
  const lastBackTimeRef = useRef(0);
  const DEBOUNCE_MS = 300;

  // The core back-navigation logic
  const handleBack = useCallback(() => {
    // ✅ Debounce: ignore if called within DEBOUNCE_MS
    const now = Date.now();
    if (now - lastBackTimeRef.current < DEBOUNCE_MS) {
      console.log('[BackHandler] Debounced - ignoring rapid back press');
      return;
    }
    lastBackTimeRef.current = now;

    const state = useAppStore.getState();
    const { currentScreen, previousScreens } = state;

    console.log('[BackHandler] Back pressed. Current:', currentScreen, 'History:', previousScreens.length);

    // Don't handle back on auth/splash screens
    if (AUTH_SCREENS.includes(currentScreen)) {
      console.log('[BackHandler] Auth screen - ignoring back');
      return;
    }

    // On dashboard with no history → show exit dialog
    if (currentScreen === 'dashboard' && previousScreens.length === 0) {
      console.log('[BackHandler] Dashboard + no history → show exit dialog');
      setShowExitDialog(true);
      return;
    }

    // On a tab screen (not dashboard) with no history → go to dashboard
    if (TAB_SCREENS.includes(currentScreen) && previousScreens.length === 0) {
      console.log('[BackHandler] Tab screen + no history → go to dashboard');
      state.resetNavigation('dashboard');
      return;
    }

    // Has previous screens → go back in stack
    if (previousScreens.length > 0) {
      console.log('[BackHandler] Has history → goBack()');
      state.goBack();
      return;
    }

    // Fallback: go to dashboard
    console.log('[BackHandler] Fallback → go to dashboard');
    state.resetNavigation('dashboard');
  }, []);

  // ===== 1. Browser popstate handler (PWA / web) =====
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
    setShowExitDialog(false);

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
  }, []);

  const handleExitCancel = useCallback(() => {
    console.log('[BackHandler] Exit cancelled');
    setShowExitDialog(false);
  }, []);

  return {
    showExitDialog,
    setShowExitDialog,
    handleBack,
    handleExitConfirm,
    handleExitCancel,
  };
}
