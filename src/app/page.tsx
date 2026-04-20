'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { AnimatePresence, motion } from 'framer-motion';
import { Screen } from '@/lib/types';

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
  invoice: DashboardScreen, // placeholder
};

const showBottomNavScreens: Screen[] = [
  'dashboard',
  'product-list',
  'profit',
  'history',
  'profile',
];

export default function Home() {
  const { currentScreen, theme, isAuthenticated } = useAppStore();

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
    </div>
  );
}
