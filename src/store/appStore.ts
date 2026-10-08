import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Screen, Language, ThemeMode, User, Category, Product, Transaction, Bill } from '@/lib/types';

interface AppState {
  // Hydration
  _hasHydrated: boolean;
  setHasHydrated: (val: boolean) => void;

  // Navigation
  currentScreen: Screen;
  previousScreens: Screen[];
  navigateTo: (screen: Screen) => void;
  navigateToTab: (screen: Screen) => void;
  resetNavigation: (screen: Screen) => void;
  goBack: () => void;

  // User & Auth
  user: User | null;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  logout: () => void;

  // App State
  language: Language;
  setLanguage: (lang: Language) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  shopName: string;
  setShopName: (name: string) => void;

  // Tutorial (welcome + tutorial flow - first time only)
  hasSeenTutorial: boolean;
  setHasSeenTutorial: (val: boolean) => void;

  // Selected Category
  selectedCategoryId: string | null;
  setSelectedCategoryId: (id: string | null) => void;

  // Selected Product
  selectedProductId: string | null;
  setSelectedProductId: (id: string | null) => void;

  // Stock operation context
  stockOperationType: 'STOCK_IN' | 'STOCK_OUT' | 'SELL' | null;
  setStockOperationType: (type: 'STOCK_IN' | 'STOCK_OUT' | 'SELL' | null) => void;

  // Selected Service Category
  selectedServiceCategory: string | null;
  setSelectedServiceCategory: (cat: string | null) => void;

  // Data (cached from API)
  categories: Category[];
  setCategories: (cats: Category[]) => void;
  products: Product[];
  setProducts: (prods: Product[]) => void;
  transactions: Transaction[];
  setTransactions: (txns: Transaction[]) => void;

  // Search
  searchQuery: string;
  setSearchQuery: (q: string) => void;

  // Billing (e-Bill)
  pendingBillData: PendingBillData | null;
  setPendingBillData: (data: PendingBillData | null) => void;
  selectedBillId: string | null;
  setSelectedBillId: (id: string | null) => void;
  selectedBill: Bill | null;
  setSelectedBill: (bill: Bill | null) => void;

  // History view (transactions | bills)
  historyView: 'transactions' | 'bills';
  setHistoryView: (view: 'transactions' | 'bills') => void;
}

export interface PendingBillData {
  transactionId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  date?: string;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, _get) => ({
      // Hydration tracking
      _hasHydrated: false,
      setHasHydrated: (val) => set({ _hasHydrated: val }),

      // Navigation
      currentScreen: 'splash',
      previousScreens: [],
      navigateTo: (screen) =>
        set((state) => ({
          previousScreens: [...state.previousScreens, state.currentScreen],
          currentScreen: screen,
        })),
      // Navigate to a main tab screen (BottomNav) - clears history so back always goes to dashboard
      navigateToTab: (screen) =>
        set({
          previousScreens: [],
          currentScreen: screen,
        }),
      // Reset navigation without pushing to history (for splash/auth redirects)
      resetNavigation: (screen) =>
        set({
          previousScreens: [],
          currentScreen: screen,
        }),
      goBack: () =>
        set((state) => {
          const prev = [...state.previousScreens];
          const last = prev.pop();
          return {
            previousScreens: prev,
            currentScreen: last || 'dashboard',
          };
        }),

      // User & Auth
      user: null,
      isAuthenticated: false,
      setUser: (user) => set({ user, isAuthenticated: !!user }),
      logout: () =>
        set({
          user: null,
          isAuthenticated: false,
          currentScreen: 'login',
          // Clear ALL session state so nothing bleeds into the next account:
          previousScreens: [],
          selectedCategoryId: null,
          selectedProductId: null,
          stockOperationType: null,
          selectedServiceCategory: null,
          searchQuery: '',
          categories: [],
          products: [],
          transactions: [],
          pendingBillData: null,
          selectedBillId: null,
          selectedBill: null,
        }),

      // App State
      language: 'en',
      setLanguage: (lang) => set({ language: lang }),
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
      shopName: 'PS TELECOM',
      setShopName: (name) => set({ shopName: name }),

      // Tutorial - first time users see Welcome + Tutorial
      hasSeenTutorial: false,
      setHasSeenTutorial: (val) => set({ hasSeenTutorial: val }),

      // Selected items
      selectedCategoryId: null,
      setSelectedCategoryId: (id) => set({ selectedCategoryId: id }),
      selectedProductId: null,
      setSelectedProductId: (id) => set({ selectedProductId: id }),

      // Stock operation
      stockOperationType: null,
      setStockOperationType: (type) => set({ stockOperationType: type }),

      // Selected Service Category
      selectedServiceCategory: null,
      setSelectedServiceCategory: (cat) => set({ selectedServiceCategory: cat }),

      // Data
      categories: [],
      setCategories: (cats) => set({ categories: cats }),
      products: [],
      setProducts: (prods: Product[]) => set({ products: prods }),
      transactions: [],
      setTransactions: (txns: Transaction[]) => set({ transactions: txns }),

      // Search
      searchQuery: '',
      setSearchQuery: (q) => set({ searchQuery: q }),

      // Billing (e-Bill)
      pendingBillData: null,
      setPendingBillData: (data) => set({ pendingBillData: data }),
      selectedBillId: null,
      setSelectedBillId: (id) => set({ selectedBillId: id }),
      selectedBill: null,
      setSelectedBill: (bill) => set({ selectedBill: bill }),

      // History view
      historyView: 'transactions' as const,
      setHistoryView: (view) => set({ historyView: view }),
    }),
    {
      name: 'ps-telecom-store',
      partialize: (state) => ({
        language: state.language,
        theme: state.theme,
        hasSeenTutorial: state.hasSeenTutorial,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        shopName: state.shopName,
      }),
      onRehydrateStorage: () => {
        return (state) => {
          state?.setHasHydrated(true);
        };
      },
    }
  )
);
