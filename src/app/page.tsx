'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { AnimatePresence, motion } from 'framer-motion';
import { Screen } from '@/lib/types';
import { LogOut, X } from 'lucide-react';

// Screens
import SplashScreen from '@/components/screens/SplashScreen';
import OnboardingScreen from '@/components/screens/OnboardingScreen';
import LanguageScreen from '@/components/screens/LanguageScreen';
import LoginScreen from '@/components/screens/LoginScreen';
import SignupScreen from '@/components/screens/SignupScreen';
import ForgotPasswordScreen from '@/components/screens/ForgotPasswordScreen';
import DashboardScreen from '@/components/screens/DashboardScreen';
import CategoryDetailScreen from '@/components/screens/CategoryDetailScreen';
import AddProductScreen from '@/components/screens/AddProductScreen';
import ProductListScreen from '@/components/screens/ProductListScreen';
import ProductDetailScreen from '@/components/screens/ProductDetailScreen';
import StockOperationScreen from '@/components/screens/StockOperationScreen';
import AddCategoryScreen from '@/components/screens/AddCategoryScreen';
import ProfitScreen from '@/components/screens/ProfitScreen';
import HistoryScreen from '@/components/screens/HistoryScreen';
import ProfileScreen from '@/components/screens/ProfileScreen';
import ReportsScreen from '@/components/screens/ReportsScreen';
import DailyBookScreen from '@/components/screens/DailyBookScreen';
import WelcomeScreen from '@/components/screens/WelcomeScreen';
import TutorialScreen from '@/components/screens/TutorialScreen';
import SetupScreen from '@/components/screens/SetupScreen';
import BottomNav from '@/components/BottomNav';

const screenComponents: Record<Screen, React.ComponentType> = {
  splash: SplashScreen,
  onboarding: OnboardingScreen,
  language: LanguageScreen,
  login: LoginScreen,
  signup: SignupScreen,
  'forgot-password': ForgotPasswordScreen,
  dashboard: DashboardScreen,
  'category-detail': CategoryDetailScreen,
  'add-product': AddProductScreen,
  'product-list': ProductListScreen,
  'product-detail': ProductDetailScreen,
  'stock-in': StockOperationScreen,
  'stock-out': StockOperationScreen,
  'instant-sell': StockOperationScreen,
  profit: ProfitScreen,
  history: HistoryScreen,
  profile: ProfileScreen,
  reports: ReportsScreen,
  'add-category': AddCategoryScreen,
  'daily-book': DailyBookScreen,
  invoice: DashboardScreen, // placeholder
  welcome: WelcomeScreen,
  tutorial: TutorialScreen,
  setup: SetupScreen,
};

const showBottomNavScreens: Screen[] = [
  'dashboard',
  'product-list',
  'profit',
  'history',
  'profile',
];

export default function Home() {
  const { currentScreen, theme, isAuthenticated, goBack, previousScreens } = useAppStore();
  const [showExitDialog, setShowExitDialog] = useState(false);

  // Apply theme class to document
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light-theme');
      root.classList.remove('dark');
    } else {
      root.classList.remove('light-theme');
      root.classList.add('dark');
    }
  }, [theme]);

  // Auto-redirect if authenticated but on auth screens
  useEffect(() => {
    const authScreens: Screen[] = ['login', 'signup', 'forgot-password'];
    if (isAuthenticated && authScreens.includes(currentScreen)) {
      useAppStore.getState().navigateTo('dashboard');
    }
  }, [isAuthenticated, currentScreen]);

  // Handle browser back button / popstate
  useEffect(() => {
    // Push initial state so we can intercept back navigation
    window.history.pushState({ appState: true }, '');

    const handlePopState = () => {
      const state = useAppStore.getState();
      // If on dashboard, show exit confirmation instead of navigating away
      if (state.currentScreen === 'dashboard') {
        // Push state back so we stay on the page
        window.history.pushState({ appState: true }, '');
        setShowExitDialog(true);
      } else if (state.previousScreens.length > 0) {
        // Go back to previous screen in our app
        state.goBack();
        // Push state back so we can intercept again
        window.history.pushState({ appState: true }, '');
      } else {
        // No previous screen, go to dashboard
        state.navigateTo('dashboard');
        window.history.pushState({ appState: true }, '');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Also handle beforeunload for tab close
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Custom back handler that shows exit dialog on dashboard
  const handleAppBack = useCallback(() => {
    const state = useAppStore.getState();
    if (state.currentScreen === 'dashboard') {
      setShowExitDialog(true);
    } else {
      state.goBack();
    }
  }, []);

  // Expose the custom back handler globally so screens can use it
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__appGoBack = handleAppBack;
  }, [handleAppBack]);

  const handleExitConfirm = () => {
    setShowExitDialog(false);
    // Try to close the window/tab
    window.close();
    // If window.close() doesn't work (most browsers block it), navigate to about:blank
    window.location.href = 'about:blank';
  };

  const handleExitCancel = () => {
    setShowExitDialog(false);
  };

  const CurrentScreenComponent = screenComponents[currentScreen] || SplashScreen;
  const showBottomNav = showBottomNavScreens.includes(currentScreen);

  return (
    <div className={`min-h-screen ${theme === 'light' ? 'light-theme' : ''}`}>
      <AnimatePresence mode="wait">
        <motion.div
          key={currentScreen}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="min-h-screen"
        >
          <CurrentScreenComponent />
        </motion.div>
      </AnimatePresence>

      {/* Bottom Navigation */}
      {showBottomNav && (
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.3 }}
        >
          <BottomNav />
        </motion.div>
      )}

      {/* Exit Confirmation Dialog */}
      <AnimatePresence>
        {showExitDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6"
            onClick={handleExitCancel}
          >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            {/* Dialog */}
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-card-strong p-6 w-full max-w-sm relative z-10"
            >
              {/* Close button */}
              <button
                onClick={handleExitCancel}
                className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-white/10 transition-colors"
              >
                <X size={16} className="text-white/40" />
              </button>

              {/* Icon */}
              <div className="w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center mx-auto mb-4">
                <LogOut size={24} className="text-red-400" />
              </div>

              {/* Title */}
              <h3 className="text-lg font-bold text-center mb-2">Exit App?</h3>

              {/* Description */}
              <p className="text-sm text-white/50 text-center mb-6">
                Are you sure you want to exit PS TELECOM?
              </p>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleExitCancel}
                  className="flex-1 glass-card py-3 text-sm font-semibold text-white/70 rounded-xl hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExitConfirm}
                  className="flex-1 py-3 text-sm font-semibold rounded-xl text-white transition-all"
                  style={{
                    background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
                    border: '1px solid rgba(220,38,38,0.5)',
                  }}
                >
                  Exit
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
