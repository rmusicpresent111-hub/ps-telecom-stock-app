'use client';

import { useEffect, useCallback, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { Screen } from '@/lib/types';

// Tab screens that show BottomNav - pressing back from these should go to dashboard
const TAB_SCREENS: Screen[] = ['dashboard', 'product-list', 'profit', 'history', 'profile'];

// Auth/onboarding screens - back behavior is different
const AUTH_SCREENS: Screen[] = ['splash', 'welcome', 'tutorial', 'onboarding', 'language', 'login', 'signup', 'forgot-password'];

interface BackHandlerResult {
  showExitDialog: boolean;
  setShowExitDialog: (show: boolean) => void;
  handleBack: () => void;
  handleExitConfirm: () => void;
  handleExitCancel: () => void;
}

export function useBackHandler(): BackHandlerResult {
  const [showExitDialog, setShowExitDialog] = useState(false);

  const handleBack = useCallback(() => {
    const state = useAppStore.getState();
    const { currentScreen, previousScreens } = state;

    // Don't handle back on auth/splash screens
    if (AUTH_SCREENS.includes(currentScreen)) {
      return;
    }

    // On dashboard or any tab screen with no history → show exit dialog
    if (currentScreen === 'dashboard' && previousScreens.length === 0) {
      setShowExitDialog(true);
      return;
    }

    // On a tab screen (not dashboard) with no history → go to dashboard
    if (TAB_SCREENS.includes(currentScreen) && previousScreens.length === 0) {
      state.resetNavigation('dashboard');
      return;
    }

    // Has previous screens → go back in stack
    if (previousScreens.length > 0) {
      state.goBack();
      return;
    }

    // Fallback: go to dashboard
    state.resetNavigation('dashboard');
  }, []);

  // Sync browser history with app navigation
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

  // Handle Capacitor/Android hardware back button
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    const setupCapacitorBackButton = async () => {
      try {
        // Try to use @capacitor/app plugin (proper way for Capacitor 3+)
        const { App } = await import('@capacitor/app');
        const handler = await App.addListener('backButton', () => {
          handleBack();
        });
        cleanup = () => handler.remove();
      } catch {
        // Fallback: use Cordova-style backbutton event (for older Capacitor or web)
        const handleBackButton = (e: Event) => {
          e.preventDefault();
          handleBack();
        };
        document.addEventListener('backbutton', handleBackButton);
        cleanup = () => document.removeEventListener('backbutton', handleBackButton);
      }
    };

    setupCapacitorBackButton();

    return () => {
      cleanup?.();
    };
  }, [handleBack]);

  const handleExitConfirm = useCallback(() => {
    setShowExitDialog(false);
    // Try Capacitor App exit first (for native Android)
    import('@capacitor/app')
      .then(({ App }) => App.exitApp())
      .catch(() => {
        // Fallback for web/PWA
        window.close();
        window.location.href = 'about:blank';
      });
  }, []);

  const handleExitCancel = useCallback(() => {
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
