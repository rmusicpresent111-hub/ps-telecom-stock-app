'use client';

import { useEffect, lazy, Suspense, useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { AnimatePresence, motion } from 'framer-motion';
import { Screen } from '@/lib/types';
import { LogOut, X } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import { useBackHandler } from '@/hooks/useBackHandler';

// Initialize Capacitor bridge early (registers native back button at system level)
import '@/lib/capacitor-init';

// Lazy load ALL screen components - only loads what's needed
const SplashScreen = lazy(() => import('@/components/screens/SplashScreen'));
const LanguageScreen = lazy(() => import('@/components/screens/LanguageScreen'));
const LoginScreen = lazy(() => import('@/components/screens/LoginScreen'));
const SignupScreen = lazy(() => import('@/components/screens/SignupScreen'));
const ForgotPasswordScreen = lazy(() => import('@/components/screens/ForgotPasswordScreen'));
const DashboardScreen = lazy(() => import('@/components/screens/DashboardScreen'));
const CategoryDetailScreen = lazy(() => import('@/components/screens/CategoryDetailScreen'));
const AddProductScreen = lazy(() => import('@/components/screens/AddProductScreen'));
const ProductListScreen = lazy(() => import('@/components/screens/ProductListScreen'));
const ProductDetailScreen = lazy(() => import('@/components/screens/ProductDetailScreen'));
const StockOperationScreen = lazy(() => import('@/components/screens/StockOperationScreen'));
const AddCategoryScreen = lazy(() => import('@/components/screens/AddCategoryScreen'));
const ProfitScreen = lazy(() => import('@/components/screens/ProfitScreen'));
const HistoryScreen = lazy(() => import('@/components/screens/HistoryScreen'));
const ProfileScreen = lazy(() => import('@/components/screens/ProfileScreen'));
const ReportsScreen = lazy(() => import('@/components/screens/ReportsScreen'));
const DailyBookScreen = lazy(() => import('@/components/screens/DailyBookScreen'));
const InvoiceScreen = lazy(() => import('@/components/screens/InvoiceScreen'));
const BillingSettingsScreen = lazy(() => import('@/components/screens/BillingSettingsScreen'));
const CloudSyncScreen = lazy(() => import('@/components/screens/CloudSyncScreen'));
const WelcomeScreen = lazy(() => import('@/components/screens/WelcomeScreen'));
const TutorialScreen = lazy(() => import('@/components/screens/TutorialScreen'));
const ServiceCategoryScreen = lazy(() => import('@/components/screens/ServiceCategoryScreen'));

const screenComponents: Record<Screen, React.ComponentType> = {
  splash: SplashScreen,
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
  'service-category': ServiceCategoryScreen,
  invoice: InvoiceScreen,
  'billing-settings': BillingSettingsScreen,
  'cloud-sync': CloudSyncScreen,
  welcome: WelcomeScreen,
  tutorial: TutorialScreen,
};

// ✅ Use Set for O(1) lookup instead of Array.includes()
const showBottomNavSet = new Set<Screen>([
  'dashboard',
  'product-list',
  'profit',
  'history',
  'profile',
]);

// Minimal loading fallback - ultra lightweight
function ScreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B0E18]">
      <div className="w-8 h-8 border-2 border-[#D4A853]/30 border-t-[#D4A853] rounded-full animate-spin" />
    </div>
  );
}

// ✅ Ultra-fast transition config - minimal animation for speed
const fastTransition = { duration: 0.1 };

export default function Home() {
  const currentScreen = useAppStore(s => s.currentScreen);
  const theme = useAppStore(s => s.theme);
  const isAuthenticated = useAppStore(s => s.isAuthenticated);
  const language = useAppStore(s => s.language);

  // ✅ Navigation Stack + Back Handler (browser, Capacitor, in-app)
  const { showExitDialog, handleExitConfirm, handleExitCancel, handleBack } = useBackHandler();

  // ✅ Listen for native Capacitor back button (dispatched by capacitor-init.ts)
  // This is the ONLY path for native Android back button → handleBack()
  // useBackHandler.ts does NOT register its own Capacitor listener to avoid double-firing
  useEffect(() => {
    const handleNativeBack = () => {
      console.log('[Page] Received app:back-button event from Capacitor bridge');
      handleBack();
    };
    window.addEventListener('app:back-button', handleNativeBack);
    return () => window.removeEventListener('app:back-button', handleNativeBack);
  }, [handleBack]);

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
      useAppStore.getState().resetNavigation('dashboard');
    }
  }, [isAuthenticated, currentScreen]);

  const CurrentScreenComponent = screenComponents[currentScreen] || SplashScreen;
  const showBottomNav = showBottomNavSet.has(currentScreen);

  // ✅ Memoize i18n strings
  const exitTexts = useMemo(() => ({
    title: language === 'bn' ? 'অ্যাপ থেকে বের হবেন?' : language === 'hi' ? 'ऐप से बाहर जाएं?' : 'Exit App?',
    desc: language === 'bn' ? 'আপনি কি নিশ্চিত PS TELECOM থেকে বের হতে চান?' : language === 'hi' ? 'क्या आप PS TELECOM से बाहर जाना चाहते हैं?' : 'Are you sure you want to exit PS TELECOM?',
    exitBtn: language === 'bn' ? 'বের হন' : language === 'hi' ? 'बाहर जाएं' : 'Exit',
    continueBtn: language === 'bn' ? 'চালিয়ে যান' : language === 'hi' ? 'जारी रखें' : 'Continue',
  }), [language]);

  return (
    <div className={`min-h-screen ${theme === 'light' ? 'light-theme' : ''}`}>
      <Suspense fallback={<ScreenLoader />}>
        <AnimatePresence mode="wait">
          <motion.div
            key={currentScreen}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fastTransition}
            className="min-h-screen"
          >
            <CurrentScreenComponent />
          </motion.div>
        </AnimatePresence>
      </Suspense>

      {/* Bottom Navigation */}
      {showBottomNav && <BottomNav />}

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
            <div className="absolute inset-0 bg-black/60" />

            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-card-strong p-6 w-full max-w-sm relative z-10"
            >
              <button
                onClick={handleExitCancel}
                className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-white/10 transition-colors"
              >
                <X size={16} className="text-white/40" />
              </button>

              <div className="w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center mx-auto mb-4">
                <LogOut size={24} className="text-red-400" />
              </div>

              <h3 className="text-lg font-bold text-center mb-2">{exitTexts.title}</h3>
              <p className="text-sm text-white/50 text-center mb-6">{exitTexts.desc}</p>

              <div className="flex gap-3">
                <button
                  onClick={handleExitCancel}
                  className="flex-1 glass-card py-3 text-sm font-semibold text-white/70 rounded-xl hover:bg-white/10 transition-colors"
                >
                  {exitTexts.continueBtn}
                </button>
                <button
                  onClick={handleExitConfirm}
                  className="flex-1 py-3 text-sm font-semibold rounded-xl text-white transition-all"
                  style={{
                    background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
                    border: '1px solid rgba(220,38,38,0.5)',
                  }}
                >
                  {exitTexts.exitBtn}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
