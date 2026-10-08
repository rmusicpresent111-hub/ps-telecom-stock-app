export type Screen =
  | 'splash'
  | 'welcome'
  | 'tutorial'
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
  | 'billing-settings'
  | 'daily-book'
  | 'service-category';

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

export interface ServiceTransaction {
  id: string;
  userId: string;
  categoryType: 'repairing' | 'withdraw-deposit';
  transactionType: 'income' | 'expense';
  amount: number;
  purpose: string;
  date: string;
  createdAt: string;
  updatedAt: string;
}

export const SERVICE_CATEGORIES = ['Repairing', 'Withdraw/Deposit'] as const;
export type ServiceCategoryType = 'repairing' | 'withdraw-deposit';

// ============ BILLING (e-Bill / Invoice) ============

export type PaymentMethod = 'cash' | 'upi' | 'card' | 'due';

export interface BillItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Bill {
  id: string;
  userId: string;
  billNumber: string;
  customerName: string;
  customerMobile: string;
  items: BillItem[];
  subtotal: number;
  discountValue: number;   // amount or percent depending on discountType
  discountType: 'amount' | 'percent';
  discountAmount: number;  // resolved rupee value
  gstEnabled: boolean;
  gstRate: number;
  gstAmount: number;
  total: number;
  paymentMethod: PaymentMethod;
  paidAmount: number;
  dueAmount: number;
  note: string;
  transactionId: string;   // the STOCK_OUT/SELL transaction this bill documents
  shopSnapshot: { name: string; address: string; phone: string; gstNumber: string };
  date: string;            // YYYY-MM-DD (local)
  createdAt: string;
  updatedAt: string;
}

export interface BillingSettings {
  userId: string;
  shopName: string;
  shopAddress: string;
  shopPhone: string;
  gstNumber: string;
  gstEnabled: boolean;
  gstRate: number;         // percent, e.g. 18
  defaultDiscountPercent: number;
  upiId: string;
  signatureDataUrl: string; // dataURL image, '' when unset
  qrCodeDataUrl: string;    // payment QR image dataURL, '' when unset
  billPrefix: string;       // e.g. 'PS'
  thankYouNote: string;
  termsText: string;
  updatedAt: string;
}
