export type Screen =
  | 'splash'
  | 'welcome'
  | 'tutorial'
  | 'onboarding'
  | 'language'
  | 'login'
  | 'signup'
  | 'forgot-password'
  | 'dashboard'
  | 'category-detail'
  | 'add-product'
  | 'product-list'
  | 'product-detail'
  | 'profit'
  | 'history'
  | 'profile'
  | 'reports'
  | 'stock-in'
  | 'stock-out'
  | 'instant-sell'
  | 'add-category'
  | 'invoice'
  | 'daily-book'
  | 'setup';

export type Language = 'bn' | 'en' | 'hi';

export type ThemeMode = 'light' | 'dark';

export interface Category {
  id: string;
  name: string;
  image: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  _count?: { products: number };
}

export interface Product {
  id: string;
  name: string;
  categoryId: string;
  category?: Category;
  quantity: number;
  boxNumber: string;
  purchasePrice: number;
  sellingPrice: number;
  lowStockThreshold: number;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  productId: string;
  product?: Product;
  type: 'STOCK_IN' | 'STOCK_OUT' | 'SELL';
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  date: string;
  userId: string;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  shopName: string;
  role: string;
  language: string;
  theme: string;
}

export interface DashboardStats {
  totalItems: number;
  lowItems: number;
  todayTransactions: number;
  stockValue: number;
}

export interface ProfitData {
  daily: { date: string; profit: number; revenue: number; cost: number }[];
  monthly: { month: string; profit: number; revenue: number; cost: number }[];
}

export interface CashEntry {
  id: string;
  userId: string;
  date: string;
  handCash: number;
  liquidCash: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface Expense {
  id: string;
  userId: string;
  date: string;
  amount: number;
  category: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}
