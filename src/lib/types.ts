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
  | 'service-category'
  | 'extra-income';

/** Extra Income (v2.38.0) — one-off income entries (commission, scrap sale,
 *  old-device resale…) that are added DIRECTLY to the displayed profit. */
export interface ExtraIncome {
  id: string;
  userId: string;
  sourceName: string;
  amount: number;
  /** YYYY-MM-DD (local) — the day the income is counted into profit. */
  date: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

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
  /** All customer credit — bills' dueAmount + বাকি এন্ট্রি outstanding. Powers the dashboard Due Book banner. */
  totalDue: number;
  /** How many bills/বাকি এন্ট্রি still carry an outstanding amount. */
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

/** Others Invest — cash added INTO the business for any other purpose
 *  (new stock, shop work, extra capital…). Counts as cash-in in the Cash Book. */
export interface Investment {
  id: string;
  userId: string;
  date: string;      // YYYY-MM-DD (local)
  amount: number;
  purpose: string;
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

// ============ DUE ENTRY (বাকি এন্ট্রি — custom customer credit ledger) ============

/** One scheduled installment (কিস্তি) of a due entry. */
export interface DueScheduleItem {
  id: string;
  dueDate: string;        // YYYY-MM-DD
  amount: number;         // installment amount (₹)
  /** How much of THIS installment has been collected so far (₹). */
  paidAmount: number;
  /** ISO timestamp — set when the installment is fully collected. */
  paidAt?: string;
}

/**
 * A standalone due entry created from the Admin Panel / Due Book —
 * customer buys on credit with CUSTOMER + PRODUCT photos, an amount and
 * an optional payment schedule (kisti). Syncs via the generic D1 store
 * `dueEntries` (encrypted), independent from bill-based dues.
 */
export interface DueEntry {
  id: string;
  userId: string;
  customerName: string;
  customerMobile: string;
  /** Compressed JPEG data URL (≤ ~60 KB) — customer's face/KYC photo. */
  customerPhotoDataUrl?: string;
  productName: string;
  /** Compressed JPEG data URL (≤ ~80 KB) — photo of the product sold on credit. */
  productPhotoDataUrl?: string;
  /** Total due amount (₹). */
  amount: number;
  /** Collected so far (₹) — source of truth, mirrors Σ schedule.paidAmount. */
  paidAmount: number;
  /** Payment schedule (কিস্তি) — may be empty when there is no fixed plan. */
  schedule: DueScheduleItem[];
  note: string;
  /** YYYY-MM-DD (local) — the day the credit was given. */
  date: string;
  createdAt: string;
  updatedAt: string;
}

// ============ BILLING (e-Bill / Invoice) ============

export type PaymentMethod = 'cash' | 'upi' | 'card' | 'due';

/** Receipt styles shown on the bill screen (v2.31.0 — 5 templates).
 *  'royal-gold' is the original v2.25 receipt; the rest were added around it.
 *  Old synced settings rows simply lack the field → treated as 'royal-gold'. */
export type BillTemplateId =
  | 'royal-gold'
  | 'royal-blue'
  | 'classic-white'
  | 'modern-dark'
  | 'thermal-58';

export interface BillItem {
  productId: string;
  name: string;
  /** Resolved from the product at bill time — printed under the item on the
   *  invoice ("bill e category ashe"). Undefined on pre-2.25 legacy bills. */
  categoryName?: string;
  /** HSN classification code printed in the GST invoice items grid
   *  (v2.40.0 "PS TELECOM GST Invoice" template column). Optional additive
   *  field — old synced rows decode untouched; prints "—" when missing. */
  hsnCode?: string;
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
  /** Optional delivery/address line — printed in the Bill-To box (v2.25). */
  customerAddress?: string;
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
  /** v2.43.0 — per-bill GST invoice number in `PS-DDMMYYYY-N` format (user
   *  spec: every bill gets its own number, per-day sequence). Generated at
   *  bill creation; additive optional field — old synced rows decode untouched. */
  invoiceNumber?: string;
  /** v2.43.0 — unique 10-digit Order ID generated per bill (user spec).
   *  Additive optional field — pre-2.43 bills fall back to a stable id hash on print. */
  orderId?: string;
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
  /** Bank details printed in the invoice "Our Bank Details" box (v2.42.0).
   *  Additive optional fields — pre-2.42 synced rows decode untouched. */
  bankName?: string;
  bankBranch?: string;
  bankAccountNo?: string;
  bankIfsc?: string;
  adminPin: string;         // legacy field (lock system removed v2.29.0) — kept so old synced rows decode
  /** Bill receipt template — optional so pre-2.31 synced rows decode untouched
   *  (missing = 'royal-gold'). Additive field: sync-safe, DB schema untouched. */
  billTemplate?: BillTemplateId;
  /** Thermal printer paper width — 58 (default, 32 chars) or 80 (48 chars). */
  thermalWidthMm?: number;
  updatedAt: string;
}
