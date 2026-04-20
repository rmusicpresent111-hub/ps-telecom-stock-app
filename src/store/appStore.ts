import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Screen, Language, ThemeMode, User, Category, Product, Transaction } from '@/lib/types';

interface AppState {
  // Navigation
  currentScreen: Screen;
  previousScreens: Screen[];
  navigateTo: (screen: Screen) => void;
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

  // Onboarding
  hasSeenOnboarding: boolean;
  setHasSeenOnboarding: (val: boolean) => void;

  // Selected Category
  selectedCategoryId: string | null;
  setSelectedCategoryId: (id: string | null) => void;

  // Selected Product
  selectedProductId: string | null;
  setSelectedProductId: (id: string | null) => void;

  // Stock operation context
  stockOperationType: 'STOCK_IN' | 'STOCK_OUT' | 'SELL' | null;
  setStockOperationType: (type: 'STOCK_IN' | 'STOCK_OUT' | 'SELL' | null) => void;

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
}

export const useAppStore = create<AppState>()(
  persist(
    (set, _get) => ({
      // Navigation
      currentScreen: 'splash',
      previousScreens: [],
      navigateTo: (screen) =>
        set((state) => ({
          previousScreens: [...state.previousScreens, state.currentScreen],
          currentScreen: screen,
        })),
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
      logout: () => set({ user: null, isAuthenticated: false, currentScreen: 'login' }),

      // App State
      language: 'en',
      setLanguage: (lang) => set({ language: lang }),
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
      shopName: 'PS TELECOM',
      setShopName: (name) => set({ shopName: name }),

      // Onboarding
      hasSeenOnboarding: false,
      setHasSeenOnboarding: (val) => set({ hasSeenOnboarding: val }),

      // Selected items
      selectedCategoryId: null,
      setSelectedCategoryId: (id) => set({ selectedCategoryId: id }),
      selectedProductId: null,
      setSelectedProductId: (id) => set({ selectedProductId: id }),

      // Stock operation
      stockOperationType: null,
      setStockOperationType: (type) => set({ stockOperationType: type }),

      // Data
      categories: [],
      setCategories: (cats) => set({ categories: cats }),
      products: [],
      setProducts: (prods) => set({ products: prods }),
      transactions: [],
      setTransactions: (txns) => set({ transactions: txns }),

      // Search
      searchQuery: '',
      setSearchQuery: (q) => set({ searchQuery: q }),
    }),
    {
      name: 'ps-telecom-store',
      partialize: (state) => ({
        language: state.language,
        theme: state.theme,
        hasSeenOnboarding: state.hasSeenOnboarding,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        shopName: state.shopName,
      }),
    }
  )
);
