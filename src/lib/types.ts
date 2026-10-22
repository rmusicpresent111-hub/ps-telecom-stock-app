export type Screen =
  | 'splash'
  | 'welcome'
  | 'tutorial'
  | 'language'
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
  | 'due-book'
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
  /** LEGACY single serial (v2.11.5) — kept as a mirror of serialNumbers[0]
   *  so older builds/search keep working. New code reads serialNumbers. */
  serialNumber?: string;
  /** Phone serials/IMEIs — ONE PER UNIT, only for mobile-category products.
   *  Selling a unit removes its serial from this array (per-unit tracking). */
  serialNumbers?: string[];
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
  /** Sum of all bills' dueAmount — powers the dashboard Due Book banner. */
  totalDue: number;
  /** How many bills still carry a due. */
  dueBills: number;
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

// ============ STAFF PAYMENTS (admin panel) ============

export type StaffPaymentKind = 'salary' | 'advance' | 'bonus' | 'other';

export interface StaffPayment {
  id: string;
  userId: string;
  date: string;           // YYYY-MM-DD (local)
  staffName: string;
  staffPhone: string;     // optional, for call/WhatsApp
  kind: StaffPaymentKind; // salary | advance | bonus | other
  amount: number;
  note: string;
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

export type ServiceCategoryType = 'repairing' | 'withdraw-deposit';

// ============ BILLING (e-Bill / Invoice) ============

export type PaymentMethod = 'cash' | 'upi' | 'card' | 'due';

export interface BillItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  /** The serial(s) the customer bought — shown on the receipt. */
  serialNumbers?: string[];
}

/** How GST relates to the entered price — set once in Bill Settings.
 *  inclusive: the entered amount IS the final amount (tax carved out of it)
 *  exclusive: tax is added on top of the entered amount (legacy). */
export type GstMode = 'inclusive' | 'exclusive';

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
  /** GST mode this bill was computed with — undefined on pre-2.13 bills (legacy exclusive). */
  gstMode?: GstMode;
  /** Inclusive-mode breakdown (taxable + CGST + SGST == total exactly).
   *  Undefined on legacy exclusive bills — they print the old "+ GST" row. */
  taxableValue?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  total: number;
  paymentMethod: PaymentMethod;
  paidAmount: number;
  dueAmount: number;
  note: string;
  transactionId: string;   // the STOCK_OUT/SELL transaction this bill documents
  shopSnapshot: { name: string; address: string; phone: string; gstNumber: string; proprietorName?: string };
  date: string;            // YYYY-MM-DD (local)
  createdAt: string;
  updatedAt: string;
}

export interface BillingSettings {
  userId: string;
  shopName: string;
  proprietorName: string;  // e.g. 'Avijit Maity & Brother'
  shopAddress: string;
  shopPhone: string;
  gstNumber: string;
  gstEnabled: boolean;
  gstRate: number;         // percent, e.g. 18 → 9% CGST + 9% SGST
  gstMode: GstMode;        // inclusive (default v2.13): entered amount is final
  defaultDiscountPercent: number;
  upiId: string;
  signatureDataUrl: string; // dataURL image, '' when unset
  qrCodeDataUrl: string;    // payment QR image dataURL, '' when unset
  billPrefix: string;       // e.g. 'PS'
  thankYouNote: string;
  termsText: string;
  adminPin: string;         // admin panel security PIN ('' → DEFAULT_ADMIN_PIN)
  updatedAt: string;
}
