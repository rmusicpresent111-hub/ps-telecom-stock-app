import { Language } from './types';

export type TranslationKeys = {
  // App
  appName: string;
  // Splash
  loading: string;
  // Tutorial
  next: string;
  skip: string;
  getStarted: string;
  // Language
  selectLanguage: string;
  selectLanguageDesc: string;
  bengali: string;
  english: string;
  hindi: string;
  continue: string;
  // Auth
  email: string;
  password: string;
  name: string;
  shopName: string;
  // Dashboard
  dashboard: string;
  totalItems: string;
  lowItems: string;
  todayTransaction: string;
  stockValue: string;
  categories: string;
  addCategory: string;
  searchProducts: string;
  addProduct: string;
  // Category Detail
  lowStock: string;
  stockIn: string;
  stockOut: string;
  instantSell: string;
  // Add Product
  productName: string;
  category: string;
  quantity: string;
  boxNumber: string;
  purchasePrice: string;
  sellingPrice: string;
  save: string;
  cancel: string;
  // Products
  products: string;
  search: string;
  // Profit
  profit: string;
  daily: string;
  monthly: string;
  revenue: string;
  // History
  history: string;
  stockInLabel: string;
  stockOutLabel: string;
  sellLabel: string;
  date: string;
  // Profile
  profile: string;
  changeName: string;
  darkMode: string;
  lightMode: string;
  languageChange: string;
  reportDownload: string;
  backupRestore: string;
  backup: string;
  restore: string;
  resetAllData: string;
  // Reports
  reports: string;
  categoryWise: string;
  dailyReport: string;
  monthlyReport: string;
  item: string;
  sale: string;
  purchase: string;
  // Stock Operations
  stockInTitle: string;
  stockOutTitle: string;
  instantSellTitle: string;
  enterQuantity: string;
  price: string;
  confirm: string;
  // Invoice
  invoice: string;
  customerName: string;
  customerPhone: string;
  // Alerts
  lowStockAlert: string;
  lowStockMsg: string;
  // Misc
  noData: string;
  delete: string;
  edit: string;
  areYouSure: string;
  thisActionCannot: string;
  added: string;
  csvDownloaded: string;
  jsonDownloaded: string;
  updated: string;
  deleted: string;
  success: string;
  error: string;
  // Daily Book
  rent: string;
  electricity: string;
  transport: string;
  food: string;
  other: string;
  duplicateProduct: string;
  // Billing (e-Bill)
  billingSettings: string;
  billingSettingsDesc: string;
  // Cloud Sync (D1)
  d1SyncTitle: string;
  d1SyncDesc: string;
  d1SyncNow: string;
  d1LastSync: string;
  d1Never: string;
  d1StateSynced: string;
  d1StateSyncing: string;
  d1StateError: string;
  d1StateOffline: string;
  d1SetupTitle: string;
  d1SetupShort: string;
  d1CreateTab: string;
  d1JoinTab: string;
  d1IdLabel: string;
  d1PinLabel: string;
  d1PinConfirm: string;
  d1Generate: string;
  d1CreateBtn: string;
  d1JoinBtn: string;
  d1PinHint: string;
  d1JoinHint: string;
  d1ErrTaken: string;
  d1ErrNotFound: string;
  d1ErrWrongPin: string;
  d1ErrBadId: string;
  d1ErrBadPin: string;
  d1ErrMismatch: string;
  d1ErrOffline: string;
  d1ErrFail: string;
  d1ConnectedToast: string;
  d1DisconnectedToast: string;
  d1NotConnected: string;
  d1Disconnect: string;
  d1DisconnectConfirm: string;
  d1EncNote: string;
  transactions: string;
  expenses: string;
  shopAddress: string;
  shopPhone: string;
  proprietorName: string;
  billSharedWithPdf: string;
  directChatOpened: string;
  gstNumberLabel: string;
  enableGst: string;
  gstRate: string;
  defaultDiscount: string;
  upiId: string;
  signature: string;
  paymentQr: string;
  uploadImage: string;
  removeImage: string;
  billPrefix: string;
  thankYouNote: string;
  termsText: string;
  eBill: string;
  createEBill: string;
  skipEBill: string;
  eBillPromptDesc: string;
  bills: string;
  transactionsLabel: string;
  today: string;
  yesterday: string;
  subtotal: string;
  discount: string;
  gst: string;
  grandTotal: string;
  paidAmount: string;
  dueAmount: string;
  paymentMethod: string;
  cash: string;
  upi: string;
  card: string;
  due: string;
  note: string;
  generateBill: string;
  billSaved: string;
  viewPdf: string;
  sharePdf: string;
  whatsappSend: string;
  downloadPdf: string;
  pdfAttachManually: string;
  shareOpenInNewTab: string;
  makeBill: string;
  deleteBill: string;
  billDeleted: string;
  viewBill: string;
  soldAmount: string;
  saved: string;
  // Password re-auth + backup-owner safety
  // Fresh-device login guidance (empty local database)
  // Setup Code — one-paste credential transfer across the owner's devices
};

const translations: Record<Language, TranslationKeys> = {
  bn: {
    appName: 'PS TELECOM',
    loading: 'লোড হচ্ছে...',
    next: 'পরবর্তী',
    skip: 'এড়িয়ে যান',
    getStarted: 'শুরু করুন',
    selectLanguage: 'ভাষা নির্বাচন করুন',
    selectLanguageDesc: 'আপনার পছন্দের ভাষা নির্বাচন করুন',
    bengali: 'বাংলা',
    english: 'English',
    hindi: 'हिन्दी',
    continue: 'চালিয়ে যান',
    email: 'ইমেইল',
    password: 'পাসওয়ার্ড',
    name: 'নাম',
    shopName: 'দোকানের নাম',
    dashboard: 'ড্যাশবোর্ড',
    totalItems: 'মোট আইটেম',
    lowItems: 'কম স্টক',
    todayTransaction: 'আজকের লেনদেন',
    stockValue: 'স্টক মূল্য',
    categories: 'ক্যাটেগরি',
    addCategory: 'ক্যাটেগরি যোগ',
    searchProducts: 'প্রোডাক্ট খুঁজুন...',
    addProduct: 'প্রোডাক্ট যোগ',
    lowStock: 'কম স্টক',
    stockIn: 'স্টক ইন',
    stockOut: 'স্টক আউট',
    instantSell: 'তাৎক্ষণিক বিক্রয়',
    productName: 'প্রোডাক্টের নাম',
    category: 'ক্যাটেগরি',
    quantity: 'পরিমাণ',
    boxNumber: 'বক্স নম্বর',
    purchasePrice: 'ক্রয় মূল্য',
    sellingPrice: 'বিক্রয় মূল্য',
    save: 'সংরক্ষণ',
    cancel: 'বাতিল',
    products: 'প্রোডাক্ট',
    search: 'খুঁজুন',
    profit: 'লাভ',
    daily: 'দৈনিক',
    monthly: 'মাসিক',
    revenue: 'আয়',
    history: 'ইতিহাস',
    stockInLabel: 'স্টক ইন',
    stockOutLabel: 'স্টক আউট',
    sellLabel: 'বিক্রয়',
    date: 'তারিখ',
    profile: 'প্রোফাইল',
    changeName: 'নাম পরিবর্তন',
    darkMode: 'ডার্ক মোড',
    lightMode: 'লাইট মোড',
    languageChange: 'ভাষা পরিবর্তন',
    reportDownload: 'রিপোর্ট ডাউনলোড',
    backupRestore: 'ব্যাকআপ ও রিস্টোর',
    backup: 'ব্যাকআপ',
    restore: 'রিস্টোর',
    resetAllData: 'সব ডেটা মুছুন',
    reports: 'রিপোর্ট',
    categoryWise: 'ক্যাটেগরি অনুযায়ী',
    dailyReport: 'দৈনিক রিপোর্ট',
    monthlyReport: 'মাসিক রিপোর্ট',
    item: 'আইটেম',
    sale: 'বিক্রয়',
    purchase: 'ক্রয়',
    stockInTitle: 'স্টক ইন',
    stockOutTitle: 'স্টক আউট',
    instantSellTitle: 'তাৎক্ষণিক বিক্রয়',
    enterQuantity: 'পরিমাণ লিখুন',
    price: 'মূল্য',
    confirm: 'নিশ্চিত করুন',
    invoice: 'ইনভয়েস',
    customerName: 'ক্রেতার নাম',
    customerPhone: 'ক্রেতার ফোন',
    lowStockAlert: 'কম স্টক সতর্কতা',
    lowStockMsg: 'কিছু প্রোডাক্টের স্টক কম আছে',
    noData: 'কোনো ডেটা নেই',
    delete: 'মুছুন',
    edit: 'সম্পাদনা',
    areYouSure: 'আপনি কি নিশ্চিত?',
    thisActionCannot: 'এই কাজটি আর পূর্বাবস্থায় ফেরানো যাবে না',
    added: 'যোগ হয়েছে',
    csvDownloaded: 'CSV ডাউনলোড হয়েছে',
    jsonDownloaded: 'JSON ডাউনলোড হয়েছে',
    updated: 'আপডেট হয়েছে',
    deleted: 'মুছে ফেলা হয়েছে',
    success: 'সফল',
    error: 'ত্রুটি',
    rent: 'ভাড়া',
    electricity: 'বিদ্যুৎ',
    transport: 'যাতায়াত',
    food: 'খাবার',
    other: 'অন্যান্য',
    duplicateProduct: 'এই নামের প্রোডাক্ট এই ক্যাটেগরিতে আগেই আছে!',
    billingSettings: 'বিলিং সেটিংস',
    billingSettingsDesc: 'দোকান, GST, সিগনেচার, QR',
    d1SyncTitle: 'ক্লাউড সিঙ্ক (D1)',
    d1SyncDesc: 'ডেটা সব ডিভাইসে অটো সিঙ্ক হয়',
    d1SyncNow: 'এখনই সিঙ্ক করুন',
    d1LastSync: 'সর্বশেষ সিঙ্ক',
    d1Never: 'এখনও হয়নি',
    d1StateSynced: 'আপ টু ডেট ✓',
    d1StateSyncing: 'সিঙ্ক হচ্ছে…',
    d1StateError: 'সিঙ্ক সমস্যা — আবার চাপুন',
    d1StateOffline: 'অফলাইন — নিজে থেকেই চেষ্টা হবে',
    d1SetupTitle: 'ক্লাউড সিঙ্ক সেটআপ',
    d1SetupShort: 'সেটআপ',
    d1CreateTab: 'নতুন সিঙ্ক',
    d1JoinTab: 'ডিভাইস জয়েন',
    d1IdLabel: 'সিঙ্ক আইডি',
    d1PinLabel: 'সিক্রেট পিন',
    d1PinConfirm: 'পিন আবার লিখুন',
    d1Generate: 'নতুন আইডি',
    d1CreateBtn: 'সিঙ্ক শুরু করুন',
    d1JoinBtn: 'যুক্ত হন',
    d1PinHint: 'কমপক্ষে ৬ অক্ষর — এই পিন দিয়েই ডেটা এনক্রিপ্ট হয় ও অন্য ডিভাইস যুক্ত হয়। ভুলে গেলে আর ডেটা মেলানো যাবে না।',
    d1JoinHint: 'প্রথম ডিভাইসে তৈরি করা সিঙ্ক আইডি ও পিন দিন — সব ডেটা এই ডিভাইসেও দেখা যাবে।',
    d1ErrTaken: 'এই সিঙ্ক আইডি আগে থেকেই আছে — অন্যটা দিন',
    d1ErrNotFound: 'এই সিঙ্ক আইডি পাওয়া যায়নি',
    d1ErrWrongPin: 'পিন ভুল',
    d1ErrBadId: 'আইডি কমপক্ষে ৪ অক্ষরের হতে হবে (a-z, 0-9, -)',
    d1ErrBadPin: 'পিন কমপক্ষে ৬ অক্ষরের হতে হবে',
    d1ErrMismatch: 'দুটো পিন মিলছে না',
    d1ErrOffline: 'ইন্টারনেট নেই — পরে আবার চাপুন',
    d1ErrFail: 'সংযোগ ব্যর্থ — আবার চাপুন',
    d1ConnectedToast: 'সিঙ্ক চালু হয়েছে ✓',
    d1DisconnectedToast: 'সিঙ্ক বন্ধ হয়েছে',
    d1NotConnected: 'সিঙ্ক চালু নেই — সেটআপ করতে চাপুন',
    d1Disconnect: 'বন্ধ করুন',
    d1DisconnectConfirm: 'নিশ্চিত?',
    d1EncNote: 'ডেটা পিন দিয়ে এনক্রিপ্টেড — কেউ পড়তে পারবে না',
    transactions: 'লেনদেন',
    expenses: 'খরচ',
    shopAddress: 'দোকানের ঠিকানা',
    shopPhone: 'দোকানের ফোন',
    proprietorName: 'প্রোপ্রাইটরের নাম',
    billSharedWithPdf: 'বিল শেয়ার হয়েছে — WhatsApp-এ PDF সহ যাবে ✓',
    directChatOpened: 'কাস্টমারের WhatsApp-এ PDF সহ চ্যাট খুলেছে — সেন্ড ✓ চাপুন',
    gstNumberLabel: 'GST নম্বর',
    enableGst: 'GST চালু করুন',
    gstRate: 'GST হার (%)',
    defaultDiscount: 'ডিফল্ট ডিস্কাউন্ট (%)',
    upiId: 'UPI আইডি',
    signature: 'সিগনেচার',
    paymentQr: 'পেমেন্ট QR কোড',
    uploadImage: 'ছবি আপলোড করুন',
    removeImage: 'সরান',
    billPrefix: 'বিল প্রিফিক্স',
    thankYouNote: 'ধন্যবাদ নোট',
    termsText: 'শর্তাবলী',
    eBill: 'ই-বিল',
    createEBill: 'ই-বিল তৈরি করুন',
    skipEBill: 'এড়িয়ে যান',
    eBillPromptDesc: 'এই বিক্রয়ের জন্য কি ই-বিল তৈরি করবেন?',
    bills: 'বিলসমূহ',
    transactionsLabel: 'লেনদেন',
    today: 'আজ',
    yesterday: 'গতকাল',
    subtotal: 'সাবটোটাল',
    discount: 'ডিস্কাউন্ট',
    gst: 'GST',
    grandTotal: 'সর্বমোট',
    paidAmount: 'প্রদত্ত',
    dueAmount: 'বাকি',
    paymentMethod: 'পেমেন্ট মাধ্যম',
    cash: 'ক্যাশ',
    upi: 'UPI',
    card: 'কার্ড',
    due: 'বাকি',
    note: 'নোট',
    generateBill: 'বিল তৈরি করুন',
    billSaved: 'বিল সংরক্ষিত হয়েছে',
    viewPdf: 'PDF দেখুন',
    sharePdf: 'PDF শেয়ার',
    whatsappSend: 'WhatsApp-এ পাঠান',
    downloadPdf: 'PDF ডাউনলোড',
    pdfAttachManually: 'PDF ডাউনলোড হয়েছে — WhatsApp চ্যাটে 📎 চেপে ফাইলটা সংযুক্ত করে পাঠান',
    shareOpenInNewTab: 'শেয়ার করতে হলে আগে উপরের ডান কোণের "Open in New Tab" চেপে অ্যাপটা নিজস্ব ট্যাবে খুলুন, তারপর আবার চেষ্টা করুন',
    makeBill: 'ই-বিল করুন',
    deleteBill: 'বিল মুছুন',
    billDeleted: 'বিল মুছে ফেলা হয়েছে',
    viewBill: 'বিল দেখুন',
    soldAmount: 'বিক্রয়',
    saved: 'সংরক্ষিত হয়েছে',
  },
  en: {
    appName: 'PS TELECOM',
    loading: 'Loading...',
    next: 'Next',
    skip: 'Skip',
    getStarted: 'Get Started',
    selectLanguage: 'Select Language',
    selectLanguageDesc: 'Choose your preferred language',
    bengali: 'বাংলা',
    english: 'English',
    hindi: 'हिन्दी',
    continue: 'Continue',
    email: 'Email',
    password: 'Password',
    name: 'Name',
    shopName: 'Shop Name',
    dashboard: 'Dashboard',
    totalItems: 'Total Items',
    lowItems: 'Low Stock',
    todayTransaction: "Today's Transactions",
    stockValue: 'Stock Value',
    categories: 'Categories',
    addCategory: 'Add Category',
    searchProducts: 'Search products...',
    addProduct: 'Add Product',
    lowStock: 'Low Stock',
    stockIn: 'Stock In',
    stockOut: 'Stock Out',
    instantSell: 'Instant Sell',
    productName: 'Product Name',
    category: 'Category',
    quantity: 'Quantity',
    boxNumber: 'Box Number',
    purchasePrice: 'Purchase Price',
    sellingPrice: 'Selling Price',
    save: 'Save',
    cancel: 'Cancel',
    products: 'Products',
    search: 'Search',
    profit: 'Profit',
    daily: 'Daily',
    monthly: 'Monthly',
    revenue: 'Revenue',
    history: 'History',
    stockInLabel: 'Stock In',
    stockOutLabel: 'Stock Out',
    sellLabel: 'Sale',
    date: 'Date',
    profile: 'Profile',
    changeName: 'Change Name',
    darkMode: 'Dark Mode',
    lightMode: 'Light Mode',
    languageChange: 'Change Language',
    reportDownload: 'Report Download',
    backupRestore: 'Backup & Restore',
    backup: 'Backup',
    restore: 'Restore',
    resetAllData: 'Reset All Data',
    reports: 'Reports',
    categoryWise: 'Category-wise',
    dailyReport: 'Daily Report',
    monthlyReport: 'Monthly Report',
    item: 'Item',
    sale: 'Sale',
    purchase: 'Purchase',
    stockInTitle: 'Stock In',
    stockOutTitle: 'Stock Out',
    instantSellTitle: 'Instant Sell',
    enterQuantity: 'Enter quantity',
    price: 'Price',
    confirm: 'Confirm',
    invoice: 'Invoice',
    customerName: 'Customer Name',
    customerPhone: 'Customer Phone',
    lowStockAlert: 'Low Stock Alert',
    lowStockMsg: 'Some products are running low on stock',
    noData: 'No data found',
    delete: 'Delete',
    edit: 'Edit',
    areYouSure: 'Are you sure?',
    thisActionCannot: 'This action cannot be undone',
    added: 'Added successfully',
    csvDownloaded: 'CSV downloaded successfully',
    jsonDownloaded: 'JSON downloaded successfully',
    updated: 'Updated successfully',
    deleted: 'Deleted successfully',
    success: 'Success',
    error: 'Error',
    rent: 'Rent',
    electricity: 'Electricity',
    transport: 'Transport',
    food: 'Food',
    other: 'Other',
    duplicateProduct: 'A product with this name already exists in this category!',
    billingSettings: 'Billing Settings',
    billingSettingsDesc: 'Shop, GST, signature, QR',
    d1SyncTitle: 'Cloud Sync (D1)',
    d1SyncDesc: 'Data syncs across all your devices',
    d1SyncNow: 'Sync now',
    d1LastSync: 'Last sync',
    d1Never: 'Never',
    d1StateSynced: 'Up to date ✓',
    d1StateSyncing: 'Syncing…',
    d1StateError: 'Sync error — tap to retry',
    d1StateOffline: 'Offline — will retry automatically',
    d1SetupTitle: 'Cloud Sync Setup',
    d1SetupShort: 'Set up',
    d1CreateTab: 'New sync',
    d1JoinTab: 'Join device',
    d1IdLabel: 'Sync ID',
    d1PinLabel: 'Secret PIN',
    d1PinConfirm: 'Confirm PIN',
    d1Generate: 'New ID',
    d1CreateBtn: 'Start sync',
    d1JoinBtn: 'Join',
    d1PinHint: 'At least 6 characters — this PIN encrypts your data and links other devices. If forgotten, data cannot be re-linked.',
    d1JoinHint: 'Enter the Sync ID & PIN created on the first device — all its data will appear here too.',
    d1ErrTaken: 'This Sync ID already exists — pick another',
    d1ErrNotFound: 'Sync ID not found',
    d1ErrWrongPin: 'Wrong PIN',
    d1ErrBadId: 'ID must be at least 4 characters (a-z, 0-9, -)',
    d1ErrBadPin: 'PIN must be at least 6 characters',
    d1ErrMismatch: 'PINs do not match',
    d1ErrOffline: 'No internet — try again later',
    d1ErrFail: 'Connection failed — try again',
    d1ConnectedToast: 'Sync connected ✓',
    d1DisconnectedToast: 'Sync disconnected',
    d1NotConnected: 'Sync off — tap to set up',
    d1Disconnect: 'Disconnect',
    d1DisconnectConfirm: 'Sure?',
    d1EncNote: 'Data is PIN-encrypted — nobody can read it',
    transactions: 'Transactions',
    expenses: 'Expenses',
    shopAddress: 'Shop Address',
    shopPhone: 'Shop Phone',
    proprietorName: 'Proprietor Name',
    billSharedWithPdf: 'Bill shared — PDF goes with it on WhatsApp ✓',
    directChatOpened: "Customer's WhatsApp chat opened with the PDF — tap Send ✓",
    gstNumberLabel: 'GST Number',
    enableGst: 'Enable GST',
    gstRate: 'GST Rate (%)',
    defaultDiscount: 'Default Discount (%)',
    upiId: 'UPI ID',
    signature: 'Signature',
    paymentQr: 'Payment QR Code',
    uploadImage: 'Upload image',
    removeImage: 'Remove',
    billPrefix: 'Bill Prefix',
    thankYouNote: 'Thank-you Note',
    termsText: 'Terms & Conditions',
    eBill: 'e-Bill',
    createEBill: 'Create e-Bill',
    skipEBill: 'Skip',
    eBillPromptDesc: 'Do you want to create an e-Bill for this sale?',
    bills: 'Bills',
    transactionsLabel: 'Transactions',
    today: 'Today',
    yesterday: 'Yesterday',
    subtotal: 'Subtotal',
    discount: 'Discount',
    gst: 'GST',
    grandTotal: 'Grand Total',
    paidAmount: 'Paid',
    dueAmount: 'Due',
    paymentMethod: 'Payment Method',
    cash: 'Cash',
    upi: 'UPI',
    card: 'Card',
    due: 'Due',
    note: 'Note',
    generateBill: 'Generate Bill',
    billSaved: 'Bill saved successfully',
    viewPdf: 'View PDF',
    sharePdf: 'Share PDF',
    whatsappSend: 'Send on WhatsApp',
    downloadPdf: 'Download PDF',
    pdfAttachManually: 'PDF downloaded — open the WhatsApp chat and attach the file with 📎',
    shareOpenInNewTab: 'To share, first tap "Open in New Tab" (top-right) so the app opens in its own tab, then try again',
    makeBill: 'Make e-Bill',
    deleteBill: 'Delete Bill',
    billDeleted: 'Bill deleted',
    viewBill: 'View Bill',
    soldAmount: 'Sales',
    saved: 'Saved successfully',
  },
  hi: {
    appName: 'PS TELECOM',
    loading: 'लोड हो रहा है...',
    next: 'अगला',
    skip: 'छोड़ें',
    getStarted: 'शुरू करें',
    selectLanguage: 'भाषा चुनें',
    selectLanguageDesc: 'अपनी पसंदीदा भाषा चुनें',
    bengali: 'বাংলা',
    english: 'English',
    hindi: 'हिन्दी',
    continue: 'जारी रखें',
    email: 'ईमेल',
    password: 'पासवर्ड',
    name: 'नाम',
    shopName: 'दुकान का नाम',
    dashboard: 'डैशबोर्ड',
    totalItems: 'कुल आइटम',
    lowItems: 'कम स्टॉक',
    todayTransaction: 'आज का लेनदेन',
    stockValue: 'स्टॉक मूल्य',
    categories: 'कैटेगरी',
    addCategory: 'कैटेगरी जोड़ें',
    searchProducts: 'प्रोडक्ट खोजें...',
    addProduct: 'प्रोडक्ट जोड़ें',
    lowStock: 'कम स्टॉक',
    stockIn: 'स्टॉक इन',
    stockOut: 'स्टॉक आउट',
    instantSell: 'तुरंत बिक्री',
    productName: 'प्रोडक्ट का नाम',
    category: 'कैटेगरी',
    quantity: 'मात्रा',
    boxNumber: 'बॉक्स नंबर',
    purchasePrice: 'खरीद मूल्य',
    sellingPrice: 'बिक्री मूल्य',
    save: 'संरक्षित करें',
    cancel: 'रद्द करें',
    products: 'प्रोडक्ट',
    search: 'खोजें',
    profit: 'लाभ',
    daily: 'दैनिक',
    monthly: 'मासिक',
    revenue: 'आय',
    history: 'इतिहास',
    stockInLabel: 'स्टॉक इन',
    stockOutLabel: 'स्टॉक आउट',
    sellLabel: 'बिक्री',
    date: 'तारीख',
    profile: 'प्रोफाइल',
    changeName: 'नाम बदलें',
    darkMode: 'डार्क मोड',
    lightMode: 'लाइट मोड',
    languageChange: 'भाषा बदलें',
    reportDownload: 'रिपोर्ट डाउनलोड',
    backupRestore: 'बैकअप और रिस्टोर',
    backup: 'बैकअप',
    restore: 'रिस्टोर',
    resetAllData: 'सारा डेटा मिटाएं',
    reports: 'रिपोर्ट',
    categoryWise: 'कैटेगरी अनुसार',
    dailyReport: 'दैनिक रिपोर्ट',
    monthlyReport: 'मासिक रिपोर्ट',
    item: 'आइटम',
    sale: 'बिक्री',
    purchase: 'खरीद',
    stockInTitle: 'स्टॉक इन',
    stockOutTitle: 'स्टॉक आउट',
    instantSellTitle: 'तुरंत बिक्री',
    enterQuantity: 'मात्रा दर्ज करें',
    price: 'मूल्य',
    confirm: 'पुष्टि करें',
    invoice: 'इनवॉइस',
    customerName: 'ग्राहक का नाम',
    customerPhone: 'ग्राहक का फोन',
    lowStockAlert: 'कम स्टॉक अलर्ट',
    lowStockMsg: 'कुछ प्रोडक्ट का स्टॉक कम है',
    noData: 'कोई डेटा नहीं',
    delete: 'मिटाएं',
    edit: 'संपादन',
    areYouSure: 'क्या आप सुनिश्चित हैं?',
    thisActionCannot: 'यह काम पूर्ववत नहीं किया जा सकता',
    added: 'सफलतापूर्वक जोड़ा गया',
    csvDownloaded: 'CSV डाउनलोड हो गया',
    jsonDownloaded: 'JSON डाउनलोड हो गया',
    updated: 'सफलतापूर्वक अपडेट किया',
    deleted: 'सफलतापूर्वक मिटाया गया',
    success: 'सफल',
    error: 'त्रुटि',
    rent: 'किराया',
    electricity: 'बिजली',
    transport: 'यातायात',
    food: 'खाना',
    other: 'अन्य',
    duplicateProduct: 'इस नाम का प्रोडक्ट इस कैटेगरी में पहले से मौजूद है!',
    billingSettings: 'बिलिंग सेटिंग्स',
    billingSettingsDesc: 'दुकान, GST, हस्ताक्षर, QR',
    d1SyncTitle: 'क्लाउड सिंक (D1)',
    d1SyncDesc: 'डेटा सभी डिवाइस पर ऑटो सिंक होता है',
    d1SyncNow: 'अभी सिंक करें',
    d1LastSync: 'अंतिम सिंक',
    d1Never: 'अभी तक नहीं',
    d1StateSynced: 'अप टु डेट ✓',
    d1StateSyncing: 'सिंक हो रहा है…',
    d1StateError: 'सिंक समस्या — दोबारा दबाएं',
    d1StateOffline: 'ऑफलाइन — खुद कोशिश करेगा',
    d1SetupTitle: 'क्लाउड सिंक सेटअप',
    d1SetupShort: 'सेटअप',
    d1CreateTab: 'नया सिंक',
    d1JoinTab: 'डिवाइस जोड़ें',
    d1IdLabel: 'सिंक आईडी',
    d1PinLabel: 'सीक्रेट पिन',
    d1PinConfirm: 'पिन फिर लिखें',
    d1Generate: 'नई आईडी',
    d1CreateBtn: 'सिंक शुरू करें',
    d1JoinBtn: 'जुड़ें',
    d1PinHint: 'कम से कम 6 अक्षर — इसी पिन से डेटा एन्क्रिप्ट होता है और दूसरे डिवाइस जुड़ते हैं। भूल गए तो डेटा दोबारा नहीं जुड़ेगा।',
    d1JoinHint: 'पहले डिवाइस पर बनाई सिंक आईडी और पिन दें — सारा डेटा यहाँ भी दिखेगा।',
    d1ErrTaken: 'यह सिंक आईडी पहले से मौजूद है — दूसरी चुनें',
    d1ErrNotFound: 'सिंक आईडी नहीं मिली',
    d1ErrWrongPin: 'पिन गलत है',
    d1ErrBadId: 'आईडी कम से कम 4 अक्षर की हो (a-z, 0-9, -)',
    d1ErrBadPin: 'पिन कम से कम 6 अक्षर का हो',
    d1ErrMismatch: 'दोनों पिन मेल नहीं खा रहे',
    d1ErrOffline: 'इंटरनेट नहीं — बाद में कोशिश करें',
    d1ErrFail: 'कनेक्शन विफल — फिर कोशिश करें',
    d1ConnectedToast: 'सिंक चालू हो गया ✓',
    d1DisconnectedToast: 'सिंक बंद हो गया',
    d1NotConnected: 'सिंक बंद — सेटअप के लिए दबाएं',
    d1Disconnect: 'बंद करें',
    d1DisconnectConfirm: 'पक्का?',
    d1EncNote: 'डेटा पिन-एन्क्रिप्टेड — कोई नहीं पढ़ सकता',
    transactions: 'लेनदेन',
    expenses: 'खर्च',
    shopAddress: 'दुकान का पता',
    shopPhone: 'दुकान का फोन',
    proprietorName: 'स्वामी का नाम',
    billSharedWithPdf: 'बिल शेयर हो गया — WhatsApp पर PDF के साथ जाएगा ✓',
    directChatOpened: 'ग्राहक के WhatsApp पर PDF के साथ चैट खुल गई — भेजें ✓ दबाएं',
    gstNumberLabel: 'GST नंबर',
    enableGst: 'GST सक्षम करें',
    gstRate: 'GST दर (%)',
    defaultDiscount: 'डिफ़ॉल्ट छूट (%)',
    upiId: 'UPI आईडी',
    signature: 'हस्ताक्षर',
    paymentQr: 'पेमेंट QR कोड',
    uploadImage: 'छवि अपलोड करें',
    removeImage: 'हटाएं',
    billPrefix: 'बिल प्रीफिक्स',
    thankYouNote: 'धन्यवाद नोट',
    termsText: 'नियम और शर्तें',
    eBill: 'ई-बिल',
    createEBill: 'ई-बिल बनाएं',
    skipEBill: 'छोड़ें',
    eBillPromptDesc: 'क्या आप इस बिक्री के लिए ई-बिल बनाना चाहते हैं?',
    bills: 'बिल',
    transactionsLabel: 'लेनदेन',
    today: 'आज',
    yesterday: 'कल',
    subtotal: 'सबटोटल',
    discount: 'छूट',
    gst: 'GST',
    grandTotal: 'कुल राशि',
    paidAmount: 'भुगतान',
    dueAmount: 'बकाया',
    paymentMethod: 'भुगतान माध्यम',
    cash: 'नकद',
    upi: 'UPI',
    card: 'कार्ड',
    due: 'बकाया',
    note: 'नोट',
    generateBill: 'बिल बनाएं',
    billSaved: 'बिल सहेजा गया',
    viewPdf: 'PDF देखें',
    sharePdf: 'PDF साझा करें',
    whatsappSend: 'WhatsApp पर भेजें',
    downloadPdf: 'PDF डाउनलोड',
    pdfAttachManually: 'PDF डाउनलोड हो गया — WhatsApp चैट में 📎 दबाकर फाइल जोड़कर भेजें',
    shareOpenInNewTab: 'शेयर करने के लिए पहले ऊपर दाईं ओर "Open in New Tab" दबाकर ऐप को अपने टैब में खोलें, फिर दोबारा कोशिश करें',
    makeBill: 'ई-बिल बनाएं',
    deleteBill: 'बिल मिटाएं',
    billDeleted: 'बिल मिटा दिया गया',
    viewBill: 'बिल देखें',
    soldAmount: 'बिक्री',
    saved: 'सहेजा गया',
  },
};

export function t(key: keyof TranslationKeys, lang: Language): string {
  return translations[lang]?.[key] || translations.en[key] || key;
}
