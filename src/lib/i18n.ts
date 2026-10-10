import { Language } from './types';

type TranslationKeys = {
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
  login: string;
  signup: string;
  forgotPassword: string;
  email: string;
  password: string;
  newPassword: string;
  confirmPassword: string;
  name: string;
  shopName: string;
  loginBtn: string;
  signupBtn: string;
  resetPassword: string;
  noAccount: string;
  hasAccount: string;
  forgotLink: string;
  backToLogin: string;
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
  totalItem: string;
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
  addItem: string;
  productDetails: string;
  // Profit
  profit: string;
  daily: string;
  monthly: string;
  revenue: string;
  cost: string;
  totalProfit: string;
  // History
  history: string;
  stockInLabel: string;
  stockOutLabel: string;
  sellLabel: string;
  date: string;
  time: string;
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
  deleteCategory: string;
  logout: string;
  // Reports
  reports: string;
  categoryWise: string;
  dailyReport: string;
  monthlyReport: string;
  item: string;
  sale: string;
  purchase: string;
  exportPDF: string;
  exportExcel: string;
  // Stock Operations
  stockInTitle: string;
  stockOutTitle: string;
  instantSellTitle: string;
  enterQuantity: string;
  price: string;
  confirm: string;
  // Invoice
  invoice: string;
  invoiceNo: string;
  customerName: string;
  customerPhone: string;
  generateInvoice: string;
  thankYou: string;
  // Alerts
  lowStockAlert: string;
  lowStockMsg: string;
  // Misc
  noData: string;
  delete: string;
  edit: string;
  close: string;
  ok: string;
  areYouSure: string;
  thisActionCannot: string;
  added: string;
  csvDownloaded: string;
  jsonDownloaded: string;
  updated: string;
  deleted: string;
  success: string;
  error: string;
  allCategories: string;
  filterBy: string;
  sortBy: string;
  // Daily Book
  dailyBook: string;
  handCash: string;
  liquidCash: string;
  totalCash: string;
  addCashEntry: string;
  addExpense: string;
  expenseCategory: string;
  expenseAmount: string;
  expenseDesc: string;
  todayCash: string;
  weeklyCash: string;
  monthlyCash: string;
  cashHistory: string;
  expenseHistory: string;
  noEntries: string;
  noExpenses: string;
  rent: string;
  electricity: string;
  salary: string;
  transport: string;
  food: string;
  maintenance: string;
  other: string;
  dailyBookNote: string;
  deleteEntry: string;
  totalExpenses: string;
  netCash: string;
  cashIn: string;
  cashOut: string;
  duplicateProduct: string;
  // Billing (e-Bill)
  billingSettings: string;
  billingSettingsDesc: string;
  shopAddress: string;
  shopPhone: string;
  proprietorName: string;
  billSharedWithPdf: string;
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
  shareWhatsappHint: string;
  pdfAttachManually: string;
  shareOpenInNewTab: string;
  walkInCustomer: string;
  billed: string;
  makeBill: string;
  deleteBill: string;
  billDeleted: string;
  viewBill: string;
  soldAmount: string;
  saved: string;
  // Cloud backup (Cloudflare D1)
  cloudSync: string;
  cloudSyncDesc: string;
  accountId: string;
  databaseId: string;
  apiToken: string;
  saveTestConnection: string;
  connecting: string;
  connectionOk: string;
  connectionFailed: string;
  cloudStatusConnected: string;
  cloudStatusNotConnected: string;
  backupToCloud: string;
  restoreFromCloud: string;
  backingUp: string;
  restoring: string;
  cloudBackupDone: string;
  cloudRestoreDone: string;
  cloudRestoreTitle: string;
  cloudRestoreDesc: string;
  lastCloudBackup: string;
  never: string;
  setupGuide: string;
  setupStep1: string;
  setupStep2: string;
  setupStep3: string;
  setupStep4: string;
  setupStep5: string;
  clearCredentials: string;
  cloudDbEmpty: string;
  fillAllFields: string;
  cloudInfo: string;
  // Password re-auth + backup-owner safety
  reauthTitle: string;
  reauthDesc: string;
  wrongPassword: string;
  cloudBackupOwner: string;
  restoreDifferentAccountWarn: string;
  tokenSavedHint: string;
  // Fresh-device login guidance (empty local database)
  noAccountOnDevice: string;
  noAccountOnDeviceDesc: string;
  // Cloud credential field validation
  invalidAccountIdHint: string;
  // Auto Sync (incremental real-time cloud updates)
  autoSync: string;
  autoSyncDesc: string;
  autoSyncLast: string;
  autoSyncPending: string;
  autoSyncFirstNote: string;
  autoSyncRunNow: string;
  autoSyncRunning: string;
  autoSyncDone: string;
  autoSyncFailed: string;
  // Friendly, translated cloud error messages (matched by errorCode from the D1 layer)
  errTokenInvalid: string;
  errIdsWrong: string;
  errIdsMalformed: string;
  errRateLimit: string;
  errTimeout: string;
  invalidDatabaseIdHint: string;
  // Server-managed cloud (Vercel env credentials) + boot auto-restore
  cloudAutoRestore: string;
  cloudManagedTitle: string;
  cloudManagedDesc: string;
  cloudUseOwnCreds: string;
  errMissingCreds: string;
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
    login: 'লগইন',
    signup: 'সাইনআপ',
    forgotPassword: 'পাসওয়ার্ড ভুলে গেছেন',
    email: 'ইমেইল',
    password: 'পাসওয়ার্ড',
    newPassword: 'নতুন পাসওয়ার্ড',
    confirmPassword: 'পাসওয়ার্ড নিশ্চিত করুন',
    name: 'নাম',
    shopName: 'দোকানের নাম',
    loginBtn: 'লগইন করুন',
    signupBtn: 'সাইনআপ করুন',
    resetPassword: 'পাসওয়ার্ড রিসেট',
    noAccount: 'অ্যাকাউন্ট নেই?',
    hasAccount: 'অ্যাকাউন্ট আছে?',
    forgotLink: 'ভুলে গেছেন?',
    backToLogin: 'লগইনে ফিরুন',
    dashboard: 'ড্যাশবোর্ড',
    totalItems: 'মোট আইটেম',
    lowItems: 'কম স্টক',
    todayTransaction: 'আজকের লেনদেন',
    stockValue: 'স্টক মূল্য',
    categories: 'ক্যাটেগরি',
    addCategory: 'ক্যাটেগরি যোগ',
    searchProducts: 'প্রোডাক্ট খুঁজুন...',
    addProduct: 'প্রোডাক্ট যোগ',
    totalItem: 'মোট আইটেম',
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
    addItem: 'আইটেম যোগ',
    productDetails: 'প্রোডাক্ট বিবরণ',
    profit: 'লাভ',
    daily: 'দৈনিক',
    monthly: 'মাসিক',
    revenue: 'আয়',
    cost: 'খরচ',
    totalProfit: 'মোট লাভ',
    history: 'ইতিহাস',
    stockInLabel: 'স্টক ইন',
    stockOutLabel: 'স্টক আউট',
    sellLabel: 'বিক্রয়',
    date: 'তারিখ',
    time: 'সময়',
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
    deleteCategory: 'ক্যাটেগরি মুছুন',
    logout: 'লগআউট',
    reports: 'রিপোর্ট',
    categoryWise: 'ক্যাটেগরি অনুযায়ী',
    dailyReport: 'দৈনিক রিপোর্ট',
    monthlyReport: 'মাসিক রিপোর্ট',
    item: 'আইটেম',
    sale: 'বিক্রয়',
    purchase: 'ক্রয়',
    exportPDF: 'PDF এক্সপোর্ট',
    exportExcel: 'Excel এক্সপোর্ট',
    stockInTitle: 'স্টক ইন',
    stockOutTitle: 'স্টক আউট',
    instantSellTitle: 'তাৎক্ষণিক বিক্রয়',
    enterQuantity: 'পরিমাণ লিখুন',
    price: 'মূল্য',
    confirm: 'নিশ্চিত করুন',
    invoice: 'ইনভয়েস',
    invoiceNo: 'ইনভয়েস নং',
    customerName: 'ক্রেতার নাম',
    customerPhone: 'ক্রেতার ফোন',
    generateInvoice: 'ইনভয়েস তৈরি',
    thankYou: 'ধন্যবাদ',
    lowStockAlert: 'কম স্টক সতর্কতা',
    lowStockMsg: 'কিছু প্রোডাক্টের স্টক কম আছে',
    noData: 'কোনো ডেটা নেই',
    delete: 'মুছুন',
    edit: 'সম্পাদনা',
    close: 'বন্ধ',
    ok: 'ঠিক আছে',
    areYouSure: 'আপনি কি নিশ্চিত?',
    thisActionCannot: 'এই কাজটি আর পূর্বাবস্থায় ফেরানো যাবে না',
    added: 'যোগ হয়েছে',
    csvDownloaded: 'CSV ডাউনলোড হয়েছে',
    jsonDownloaded: 'JSON ডাউনলোড হয়েছে',
    updated: 'আপডেট হয়েছে',
    deleted: 'মুছে ফেলা হয়েছে',
    success: 'সফল',
    error: 'ত্রুটি',
    allCategories: 'সব ক্যাটেগরি',
    filterBy: 'ফিল্টার',
    sortBy: 'সাজান',
    dailyBook: 'ডেইলি বুক',
    handCash: 'হ্যান্ড ক্যাশ',
    liquidCash: 'লিকুইড ক্যাশ',
    totalCash: 'মোট ক্যাশ',
    addCashEntry: 'ক্যাশ এন্ট্রি যোগ',
    addExpense: 'খরচ যোগ',
    expenseCategory: 'খরচের ধরন',
    expenseAmount: 'খরচের পরিমাণ',
    expenseDesc: 'খরচের বিবরণ',
    todayCash: 'আজকের ক্যাশ',
    weeklyCash: 'সাপ্তাহিক ক্যাশ',
    monthlyCash: 'মাসিক ক্যাশ',
    cashHistory: 'ক্যাশ ইতিহাস',
    expenseHistory: 'খরচের ইতিহাস',
    noEntries: 'কোনো এন্ট্রি নেই',
    noExpenses: 'কোনো খরচ নেই',
    rent: 'ভাড়া',
    electricity: 'বিদ্যুৎ',
    salary: 'বেতন',
    transport: 'যাতায়াত',
    food: 'খাবার',
    maintenance: 'মেরামত',
    other: 'অন্যান্য',
    dailyBookNote: 'নোট',
    deleteEntry: 'এন্ট্রি মুছুন',
    totalExpenses: 'মোট খরচ',
    netCash: 'নেট ক্যাশ',
    cashIn: 'ক্যাশ ইন',
    cashOut: 'ক্যাশ আউট',
    duplicateProduct: 'এই নামের প্রোডাক্ট এই ক্যাটেগরিতে আগেই আছে!',
    billingSettings: 'বিলিং সেটিংস',
    billingSettingsDesc: 'দোকান, GST, সিগনেচার, QR',
    shopAddress: 'দোকানের ঠিকানা',
    shopPhone: 'দোকানের ফোন',
    proprietorName: 'প্রোপ্রাইটরের নাম',
    billSharedWithPdf: 'বিল শেয়ার হয়েছে — WhatsApp-এ PDF সহ যাবে ✓',
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
    shareWhatsappHint: 'PDF ডাউনলোড হয়েছে — WhatsApp চ্যাটে সংযুক্ত করুন',
    pdfAttachManually: 'PDF ডাউনলোড হয়েছে — WhatsApp চ্যাটে 📎 চেপে ফাইলটা সংযুক্ত করে পাঠান',
    shareOpenInNewTab: 'শেয়ার করতে হলে আগে উপরের ডান কোণের "Open in New Tab" চেপে অ্যাপটা নিজস্ব ট্যাবে খুলুন, তারপর আবার চেষ্টা করুন',
    walkInCustomer: 'সাধারণ ক্রেতা',
    billed: 'বিল হয়েছে',
    makeBill: 'ই-বিল করুন',
    deleteBill: 'বিল মুছুন',
    billDeleted: 'বিল মুছে ফেলা হয়েছে',
    viewBill: 'বিল দেখুন',
    soldAmount: 'বিক্রয়',
    saved: 'সংরক্ষিত হয়েছে',
    cloudSync: 'ক্লাউড ব্যাকআপ',
    cloudSyncDesc: 'Cloudflare D1 ডেটাবেসে ডেটা রাখুন',
    accountId: 'Account ID',
    databaseId: 'Database ID',
    apiToken: 'API Token',
    saveTestConnection: 'সংরক্ষণ ও সংযোগ পরীক্ষা',
    connecting: 'পরীক্ষা হচ্ছে...',
    connectionOk: 'সংযোগ সফল! টেবিল প্রস্তুত',
    connectionFailed: 'সংযোগ ব্যর্থ হয়েছে',
    cloudStatusConnected: 'সংযোগ হয়েছে',
    cloudStatusNotConnected: 'সংযোগ করা হয়নি',
    backupToCloud: 'ক্লাউডে ব্যাকআপ করুন',
    restoreFromCloud: 'ক্লাউড থেকে রিস্টোর করুন',
    backingUp: 'ব্যাকআপ হচ্ছে...',
    restoring: 'রিস্টোর হচ্ছে...',
    cloudBackupDone: 'ক্লাউড ব্যাকআপ সম্পন্ন!',
    cloudRestoreDone: 'ক্লাউড থেকে রিস্টোর সম্পন্ন!',
    cloudRestoreTitle: 'ক্লাউড থেকে রিস্টোর করবেন?',
    cloudRestoreDesc: 'এই ফোনের বর্তমান সব ডেটা মুছে গিয়ে ক্লাউডের ব্যাকআপ বসে যাবে।',
    lastCloudBackup: 'শেষ ক্লাউড ব্যাকআপ',
    never: 'এখনো হয়নি',
    setupGuide: 'Cloudflare সেটআপ গাইড',
    setupStep1: 'dash.cloudflare.com এ লগইন করুন',
    setupStep2: 'Workers & Pages → D1 → "Create database" (নাম দিন: ps-telecom)',
    setupStep3: 'ডেটাবেস খুলে "Database ID" কপি করুন; Account ID পাবেন Workers & Pages এর ডান দিকে',
    setupStep4: 'My Profile → API Tokens → Create Token → Custom Token: Account → D1 → Edit',
    setupStep5: 'তিনটি মান নিচে বসিয়ে "সংরক্ষণ ও সংযোগ পরীক্ষা" চাপুন',
    clearCredentials: 'সংযোগ মুছে ফেলুন',
    cloudDbEmpty: 'ক্লাউড ডেটাবেস খালি — আগে ব্যাকআপ করুন',
    cloudAutoRestore: 'ক্লাউড থেকে আপনার ডেটা আনা হচ্ছে…',
    cloudManagedTitle: 'অ্যাপ-ম্যানেজড ক্লাউড সংযোগ',
    cloudManagedDesc: 'ক্লাউড ব্যাকআপ এই অ্যাপের নিজস্ব সুরক্ষিত সংযোগ দিয়ে কাজ করছে — নতুন ডিভাইসে আলাদা কোনো কী (key) দেওয়ার দরকার নেই।',
    cloudUseOwnCreds: 'নিজের Cloudflare অ্যাকাউন্ট ব্যবহার করতে চান?',
    errMissingCreds: 'এই সাইটে ক্লাউড সংযোগ সেট করা নেই — নিজের Cloudflare কী দিন',
    fillAllFields: 'তিনটি তথ্যই পূরণ করুন',
    cloudInfo: 'আপনার ডেটা আপনার নিজের Cloudflare অ্যাকাউন্টে থাকে — ফোন হারালেও ডেটা নিরাপদ।',
    reauthTitle: 'পাসওয়ার্ড দিয়ে নিশ্চিত করুন',
    reauthDesc: 'এই সংবেদনশীল কাজটি করতে আপনার পাসওয়ার্ড লিখুন',
    wrongPassword: 'ভুল পাসওয়ার্ড — কাজটি বাতিল হয়েছে',
    cloudBackupOwner: 'ব্যাকআপের মালিক',
    restoreDifferentAccountWarn: 'এই ক্লাউড ব্যাকআপটি {email} অ্যাকাউন্টের — রিস্টোর করলে এই ফোনের সব ডেটা তা দিয়ে বদলে যাবে। চালিয়ে যাবেন?',
    tokenSavedHint: 'টোকেন সংরক্ষিত আছে — আগেরটি রাখতে খালি রাখুন',
    noAccountOnDevice: 'এই ডিভাইসে কোনো অ্যাকাউন্ট নেই',
    noAccountOnDeviceDesc: 'ডেটা প্রতিটি ডিভাইসে আলাদাভাবে সেভ থাকে। আগে সাইনআপ করুন — আগের ক্লাউড ব্যাকআপ থাকলে সাইনআপের পর Profile → Cloud Backup থেকে ফেরাতে পারবেন।',
    invalidAccountIdHint: 'Account ID ঠিক নেই — এটা ৩২টা অক্ষরের কোড। URL থেকে পুরোটা পেস্ট করলেও চলবে, বাকি অংশ আপনি আপ নিজেই মুছে যাবে।',
    errTokenInvalid: 'আপনার API Token কাজ করছে না — token হয় ভুল কপি হয়েছে, মুছে ফেলা হয়েছে, বা এতে "D1: Edit" permission নেই। Cloudflare-এ নতুন token বানিয়ে আবার চেষ্টা করুন।',
    errIdsWrong: 'Account ID বা Database ID ভুল — Cloudflare থেকে দুটোই আবার কপি করে বসান।',
    errIdsMalformed: 'Account ID বা Database ID-এর লেখা ঠিক নেই — শুধু কোডটাই পেস্ট করুন, বাড়তা কোনো লেখা ছাড়া।',
    errRateLimit: 'Cloudflare একটু বেশি request পেয়ে গেছে — এক মিনিট পর আবার চেষ্টা করুন।',
    errTimeout: 'Cloudflare-এর সাথে সংযোগে দেরি হচ্ছে — ইন্টারনেট ঠিক আছে কিনা দেখে আবার চেষ্টা করুন।',
    autoSync: 'অটো সিঙ্ক (সাথে সাথে ক্লাউড আপডেট)',
    autoSyncDesc: 'Stock in/out বা বিক্রি করলেই কয়েক সেকেন্ডের মধ্যে cloud database নিজে থেকেই আপডেট হয়ে যাবে — আর বাটন চাপতে হবে না।',
    autoSyncLast: 'সর্বশেষ অটো সিঙ্ক',
    autoSyncPending: 'কিছু পরিবর্তন এখনো সিঙ্ক হয়নি — অনলাইন হলেই নিজে থেকে হবে',
    autoSyncFirstNote: 'চালু করলে প্রথমে একবার পূর্ণ ব্যাকআপ হবে, তারপর থেকে শুধু পরিবর্তনগুলোই যাবে',
    autoSyncRunNow: 'এখনই সিঙ্ক করুন',
    autoSyncRunning: 'সিঙ্ক হচ্ছে…',
    autoSyncDone: 'অটো সিঙ্ক সফল — ক্লাউড আপডেট হয়ে গেছে',
    autoSyncFailed: 'অটো সিঙ্ক ব্যর্থ — পরে আবার চেষ্টা হবে',
    invalidDatabaseIdHint: 'Database ID ঠিক নেই — এটা xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx এই আকৃতির। পুরো URL পেস্ট করলেও সঠিক অংশটা নিজেই ধরা হবে।',
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
    login: 'Login',
    signup: 'Sign Up',
    forgotPassword: 'Forgot Password',
    email: 'Email',
    password: 'Password',
    newPassword: 'New Password',
    confirmPassword: 'Confirm Password',
    name: 'Name',
    shopName: 'Shop Name',
    loginBtn: 'Login',
    signupBtn: 'Sign Up',
    resetPassword: 'Reset Password',
    noAccount: "Don't have an account?",
    hasAccount: 'Already have an account?',
    forgotLink: 'Forgot?',
    backToLogin: 'Back to Login',
    dashboard: 'Dashboard',
    totalItems: 'Total Items',
    lowItems: 'Low Stock',
    todayTransaction: "Today's Transactions",
    stockValue: 'Stock Value',
    categories: 'Categories',
    addCategory: 'Add Category',
    searchProducts: 'Search products...',
    addProduct: 'Add Product',
    totalItem: 'Total Item',
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
    addItem: 'Add Item',
    productDetails: 'Product Details',
    profit: 'Profit',
    daily: 'Daily',
    monthly: 'Monthly',
    revenue: 'Revenue',
    cost: 'Cost',
    totalProfit: 'Total Profit',
    history: 'History',
    stockInLabel: 'Stock In',
    stockOutLabel: 'Stock Out',
    sellLabel: 'Sale',
    date: 'Date',
    time: 'Time',
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
    deleteCategory: 'Delete Category',
    logout: 'Logout',
    reports: 'Reports',
    categoryWise: 'Category-wise',
    dailyReport: 'Daily Report',
    monthlyReport: 'Monthly Report',
    item: 'Item',
    sale: 'Sale',
    purchase: 'Purchase',
    exportPDF: 'Export PDF',
    exportExcel: 'Export Excel',
    stockInTitle: 'Stock In',
    stockOutTitle: 'Stock Out',
    instantSellTitle: 'Instant Sell',
    enterQuantity: 'Enter quantity',
    price: 'Price',
    confirm: 'Confirm',
    invoice: 'Invoice',
    invoiceNo: 'Invoice No',
    customerName: 'Customer Name',
    customerPhone: 'Customer Phone',
    generateInvoice: 'Generate Invoice',
    thankYou: 'Thank You',
    lowStockAlert: 'Low Stock Alert',
    lowStockMsg: 'Some products are running low on stock',
    noData: 'No data found',
    delete: 'Delete',
    edit: 'Edit',
    close: 'Close',
    ok: 'OK',
    areYouSure: 'Are you sure?',
    thisActionCannot: 'This action cannot be undone',
    added: 'Added successfully',
    csvDownloaded: 'CSV downloaded successfully',
    jsonDownloaded: 'JSON downloaded successfully',
    updated: 'Updated successfully',
    deleted: 'Deleted successfully',
    success: 'Success',
    error: 'Error',
    allCategories: 'All Categories',
    filterBy: 'Filter By',
    sortBy: 'Sort By',
    dailyBook: 'Daily Book',
    handCash: 'Hand Cash',
    liquidCash: 'Liquid Cash',
    totalCash: 'Total Cash',
    addCashEntry: 'Add Cash Entry',
    addExpense: 'Add Expense',
    expenseCategory: 'Expense Category',
    expenseAmount: 'Expense Amount',
    expenseDesc: 'Expense Description',
    todayCash: "Today's Cash",
    weeklyCash: 'Weekly Cash',
    monthlyCash: 'Monthly Cash',
    cashHistory: 'Cash History',
    expenseHistory: 'Expense History',
    noEntries: 'No entries found',
    noExpenses: 'No expenses found',
    rent: 'Rent',
    electricity: 'Electricity',
    salary: 'Salary',
    transport: 'Transport',
    food: 'Food',
    maintenance: 'Maintenance',
    other: 'Other',
    dailyBookNote: 'Note',
    deleteEntry: 'Delete Entry',
    totalExpenses: 'Total Expenses',
    netCash: 'Net Cash',
    cashIn: 'Cash In',
    cashOut: 'Cash Out',
    duplicateProduct: 'A product with this name already exists in this category!',
    billingSettings: 'Billing Settings',
    billingSettingsDesc: 'Shop, GST, signature, QR',
    shopAddress: 'Shop Address',
    shopPhone: 'Shop Phone',
    proprietorName: 'Proprietor Name',
    billSharedWithPdf: 'Bill shared — PDF goes with it on WhatsApp ✓',
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
    shareWhatsappHint: 'PDF downloaded — attach it in the WhatsApp chat',
    pdfAttachManually: 'PDF downloaded — open the WhatsApp chat and attach the file with 📎',
    shareOpenInNewTab: 'To share, first tap "Open in New Tab" (top-right) so the app opens in its own tab, then try again',
    walkInCustomer: 'Walk-in Customer',
    billed: 'Billed',
    makeBill: 'Make e-Bill',
    deleteBill: 'Delete Bill',
    billDeleted: 'Bill deleted',
    viewBill: 'View Bill',
    soldAmount: 'Sales',
    saved: 'Saved successfully',
    cloudSync: 'Cloud Backup',
    cloudSyncDesc: 'Store data in Cloudflare D1 database',
    accountId: 'Account ID',
    databaseId: 'Database ID',
    apiToken: 'API Token',
    saveTestConnection: 'Save & Test Connection',
    connecting: 'Testing...',
    connectionOk: 'Connected! Tables ready',
    connectionFailed: 'Connection failed',
    cloudStatusConnected: 'Connected',
    cloudStatusNotConnected: 'Not connected',
    backupToCloud: 'Backup to Cloud',
    restoreFromCloud: 'Restore from Cloud',
    backingUp: 'Backing up...',
    restoring: 'Restoring...',
    cloudBackupDone: 'Cloud backup complete!',
    cloudRestoreDone: 'Restored from cloud!',
    cloudRestoreTitle: 'Restore from cloud?',
    cloudRestoreDesc: 'All current data on this phone will be REPLACED with the cloud backup.',
    lastCloudBackup: 'Last cloud backup',
    never: 'Never',
    setupGuide: 'Cloudflare setup guide',
    setupStep1: 'Log in at dash.cloudflare.com',
    setupStep2: 'Workers & Pages → D1 → "Create database" (name: ps-telecom)',
    setupStep3: 'Open the database and copy the "Database ID"; Account ID is on the right side of Workers & Pages',
    setupStep4: 'My Profile → API Tokens → Create Token → Custom Token: Account → D1 → Edit',
    setupStep5: 'Paste the three values below and tap "Save & Test Connection"',
    clearCredentials: 'Disconnect',
    cloudDbEmpty: 'Cloud database is empty — run a backup first',
    cloudAutoRestore: 'Fetching your data from the cloud…',
    cloudManagedTitle: 'App-managed cloud connection',
    cloudManagedDesc: 'Cloud backup works through the app\'s own secure connection — no keys needed on a new device.',
    cloudUseOwnCreds: 'Want to use your own Cloudflare account?',
    errMissingCreds: 'No cloud connection configured on this site — enter your own Cloudflare keys',
    fillAllFields: 'Please fill in all three fields',
    cloudInfo: 'Your data lives in your own Cloudflare account — safe even if the phone is lost.',
    reauthTitle: 'Confirm with password',
    reauthDesc: 'Enter your password to continue with this action',
    wrongPassword: 'Wrong password — action cancelled',
    cloudBackupOwner: 'Backup owner',
    restoreDifferentAccountWarn: 'This cloud backup was made by {email} — restoring will replace this device\'s data with it. Continue?',
    tokenSavedHint: 'Token saved — leave empty to keep the current one',
    noAccountOnDevice: 'No account exists on this device',
    noAccountOnDeviceDesc: 'Data is stored separately on each device. Please Sign Up first — if you had a cloud backup, restore it via Profile → Cloud Backup after signing up.',
    invalidAccountIdHint: 'Account ID does not look right — it is a 32-character code. Pasting the whole URL is fine; the extra parts are removed automatically.',
    errTokenInvalid: 'Your API token is invalid, expired, or missing the "D1 Edit" permission — create a new token in Cloudflare and try again.',
    errIdsWrong: 'Account ID or Database ID is wrong — please re-copy both from Cloudflare.',
    errIdsMalformed: 'Account ID or Database ID looks malformed — paste the ID only, without any extra text.',
    errRateLimit: 'Cloudflare rate limit reached — please wait a minute and try again.',
    errTimeout: 'The connection to Cloudflare timed out — check your internet and try again.',
    autoSync: 'Auto Sync (instant cloud updates)',
    autoSyncDesc: 'Every stock in/out or sale reaches your cloud database within seconds — no button to press.',
    autoSyncLast: 'Last auto sync',
    autoSyncPending: 'Some changes are not synced yet — they will sync automatically when you are online',
    autoSyncFirstNote: 'When enabled, a full backup runs first; after that only the changes are pushed',
    autoSyncRunNow: 'Sync now',
    autoSyncRunning: 'Syncing…',
    autoSyncDone: 'Auto sync complete — cloud is up to date',
    autoSyncFailed: 'Auto sync failed — will retry automatically',
    invalidDatabaseIdHint: 'Database ID does not look right — it looks like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx. Pasting the whole URL also works; the correct part is picked automatically.',
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
    login: 'लॉगइन',
    signup: 'साइनअप',
    forgotPassword: 'पासवर्ड भूल गए',
    email: 'ईमेल',
    password: 'पासवर्ड',
    newPassword: 'नया पासवर्ड',
    confirmPassword: 'पासवर्ड की पुष्टि करें',
    name: 'नाम',
    shopName: 'दुकान का नाम',
    loginBtn: 'लॉगइन करें',
    signupBtn: 'साइनअप करें',
    resetPassword: 'पासवर्ड रीसेट',
    noAccount: 'अकाउंट नहीं है?',
    hasAccount: 'अकाउंट है?',
    forgotLink: 'भूल गए?',
    backToLogin: 'लॉगइन पर वापस',
    dashboard: 'डैशबोर्ड',
    totalItems: 'कुल आइटम',
    lowItems: 'कम स्टॉक',
    todayTransaction: 'आज का लेनदेन',
    stockValue: 'स्टॉक मूल्य',
    categories: 'कैटेगरी',
    addCategory: 'कैटेगरी जोड़ें',
    searchProducts: 'प्रोडक्ट खोजें...',
    addProduct: 'प्रोडक्ट जोड़ें',
    totalItem: 'कुल आइटम',
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
    addItem: 'आइटम जोड़ें',
    productDetails: 'प्रोडक्ट विवरण',
    profit: 'लाभ',
    daily: 'दैनिक',
    monthly: 'मासिक',
    revenue: 'आय',
    cost: 'खर्च',
    totalProfit: 'कुल लाभ',
    history: 'इतिहास',
    stockInLabel: 'स्टॉक इन',
    stockOutLabel: 'स्टॉक आउट',
    sellLabel: 'बिक्री',
    date: 'तारीख',
    time: 'समय',
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
    deleteCategory: 'कैटेगरी मिटाएं',
    logout: 'लॉगआउट',
    reports: 'रिपोर्ट',
    categoryWise: 'कैटेगरी अनुसार',
    dailyReport: 'दैनिक रिपोर्ट',
    monthlyReport: 'मासिक रिपोर्ट',
    item: 'आइटम',
    sale: 'बिक्री',
    purchase: 'खरीद',
    exportPDF: 'PDF एक्सपोर्ट',
    exportExcel: 'Excel एक्सपोर्ट',
    stockInTitle: 'स्टॉक इन',
    stockOutTitle: 'स्टॉक आउट',
    instantSellTitle: 'तुरंत बिक्री',
    enterQuantity: 'मात्रा दर्ज करें',
    price: 'मूल्य',
    confirm: 'पुष्टि करें',
    invoice: 'इनवॉइस',
    invoiceNo: 'इनवॉइस नंबर',
    customerName: 'ग्राहक का नाम',
    customerPhone: 'ग्राहक का फोन',
    generateInvoice: 'इनवॉइस बनाएं',
    thankYou: 'धन्यवाद',
    lowStockAlert: 'कम स्टॉक अलर्ट',
    lowStockMsg: 'कुछ प्रोडक्ट का स्टॉक कम है',
    noData: 'कोई डेटा नहीं',
    delete: 'मिटाएं',
    edit: 'संपादन',
    close: 'बंद करें',
    ok: 'ठीक है',
    areYouSure: 'क्या आप सुनिश्चित हैं?',
    thisActionCannot: 'यह काम पूर्ववत नहीं किया जा सकता',
    added: 'सफलतापूर्वक जोड़ा गया',
    csvDownloaded: 'CSV डाउनलोड हो गया',
    jsonDownloaded: 'JSON डाउनलोड हो गया',
    updated: 'सफलतापूर्वक अपडेट किया',
    deleted: 'सफलतापूर्वक मिटाया गया',
    success: 'सफल',
    error: 'त्रुटि',
    allCategories: 'सभी कैटेगरी',
    filterBy: 'फिल्टर',
    sortBy: 'क्रमबद्ध',
    dailyBook: 'डेली बुक',
    handCash: 'हैंड कैश',
    liquidCash: 'लिक्विड कैश',
    totalCash: 'कुल कैश',
    addCashEntry: 'कैश एंट्री जोड़ें',
    addExpense: 'खर्चा जोड़ें',
    expenseCategory: 'खर्चे की श्रेणी',
    expenseAmount: 'खर्चे की राशि',
    expenseDesc: 'खर्चे का विवरण',
    todayCash: 'आज का कैश',
    weeklyCash: 'साप्ताहिक कैश',
    monthlyCash: 'मासिक कैश',
    cashHistory: 'कैश इतिहास',
    expenseHistory: 'खर्चे का इतिहास',
    noEntries: 'कोई एंट्री नहीं',
    noExpenses: 'कोई खर्चा नहीं',
    rent: 'किराया',
    electricity: 'बिजली',
    salary: 'वेतन',
    transport: 'यातायात',
    food: 'खाना',
    maintenance: 'मरम्मत',
    other: 'अन्य',
    dailyBookNote: 'नोट',
    deleteEntry: 'एंट्री हटाएं',
    totalExpenses: 'कुल खर्चे',
    netCash: 'नेट कैश',
    cashIn: 'कैश इन',
    cashOut: 'कैश आउट',
    duplicateProduct: 'इस नाम का प्रोडक्ट इस कैटेगरी में पहले से मौजूद है!',
    billingSettings: 'बिलिंग सेटिंग्स',
    billingSettingsDesc: 'दुकान, GST, हस्ताक्षर, QR',
    shopAddress: 'दुकान का पता',
    shopPhone: 'दुकान का फोन',
    proprietorName: 'स्वामी का नाम',
    billSharedWithPdf: 'बिल शेयर हो गया — WhatsApp पर PDF के साथ जाएगा ✓',
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
    shareWhatsappHint: 'PDF डाउनलोड हो गया — WhatsApp चैट में जोड़ें',
    pdfAttachManually: 'PDF डाउनलोड हो गया — WhatsApp चैट में 📎 दबाकर फाइल जोड़कर भेजें',
    shareOpenInNewTab: 'शेयर करने के लिए पहले ऊपर दाईं ओर "Open in New Tab" दबाकर ऐप को अपने टैब में खोलें, फिर दोबारा कोशिश करें',
    walkInCustomer: 'सामान्य ग्राहक',
    billed: 'बिल बना',
    makeBill: 'ई-बिल बनाएं',
    deleteBill: 'बिल मिटाएं',
    billDeleted: 'बिल मिटा दिया गया',
    viewBill: 'बिल देखें',
    soldAmount: 'बिक्री',
    saved: 'सहेजा गया',
    cloudSync: 'क्लाउड बैकअप',
    cloudSyncDesc: 'Cloudflare D1 डेटाबेस में डेटा रखें',
    accountId: 'Account ID',
    databaseId: 'Database ID',
    apiToken: 'API Token',
    saveTestConnection: 'सहेजें और कनेक्शन जांचें',
    connecting: 'जांच हो रही है...',
    connectionOk: 'कनेक्ट हो गया! टेबल तैयार',
    connectionFailed: 'कनेक्शन विफल हुआ',
    cloudStatusConnected: 'कनेक्टेड',
    cloudStatusNotConnected: 'कनेक्ट नहीं है',
    backupToCloud: 'क्लाउड पर बैकअप करें',
    restoreFromCloud: 'क्लाउड से रिस्टोर करें',
    backingUp: 'बैकअप हो रहा है...',
    restoring: 'रिस्टोर हो रहा है...',
    cloudBackupDone: 'क्लाउड बैकअप पूरा!',
    cloudRestoreDone: 'क्लाउड से रिस्टोर पूरा!',
    cloudRestoreTitle: 'क्लाउड से रिस्टोर करें?',
    cloudRestoreDesc: 'इस फोन का सारा मौजूदा डेटा हटकर क्लाउड बैकअप आ जाएगा।',
    lastCloudBackup: 'अंतिम क्लाउड बैकअप',
    never: 'अभी तक नहीं',
    setupGuide: 'Cloudflare सेटअप गाइड',
    setupStep1: 'dash.cloudflare.com पर लॉगिन करें',
    setupStep2: 'Workers & Pages → D1 → "Create database" (नाम: ps-telecom)',
    setupStep3: 'डेटाबेस खोलकर "Database ID" कॉपी करें; Account ID Workers & Pages के दाईं ओर मिलेगा',
    setupStep4: 'My Profile → API Tokens → Create Token → Custom Token: Account → D1 → Edit',
    setupStep5: 'तीनों मान नीचे पेस्ट करके "सहेजें और कनेक्शन जांचें" दबाएं',
    clearCredentials: 'कनेक्शन हटाएं',
    cloudDbEmpty: 'क्लाउड डेटाबेस खाली है — पहले बैकअप करें',
    cloudAutoRestore: 'क्लाउड से आपका डेटा लाया जा रहा है…',
    cloudManagedTitle: 'ऐप-प्रबंधित क्लाउड कनेक्शन',
    cloudManagedDesc: 'क्लाउड बैकअप ऐप के अपने सुरक्षित कनेक्शन से काम करता है — नए डिवाइस पर कोई कुंजी देने की ज़रूरत नहीं।',
    cloudUseOwnCreds: 'अपना Cloudflare खाता उपयोग करना चाहते हैं?',
    errMissingCreds: 'इस साइट पर क्लाउड कनेक्शन कॉन्फ़िगर नहीं है — अपनी Cloudflare कुंजी दर्ज करें',
    fillAllFields: 'तीनों जानकारी भरें',
    cloudInfo: 'आपका डेटा आपके ही Cloudflare अकाउंट में रहता है — फोन खोने पर भी डेटा सुरक्षित।',
    reauthTitle: 'पासवर्ड से पुष्टि करें',
    reauthDesc: 'इस संवेदनशील काम के लिए अपना पासवर्ड दर्ज करें',
    wrongPassword: 'गलत पासवर्ड — काम रद्द कर दिया गया',
    cloudBackupOwner: 'बैकअप का मालिक',
    restoreDifferentAccountWarn: 'यह क्लाउड बैकअप {email} अकाउंट का है — रिस्टोर करने पर इस फोन का पूरा डेटा उससे बदल जाएगा। जारी रखें?',
    tokenSavedHint: 'टोकन सहेजा गया है — मौजूदा टोकन रखने के लिए खाली छोड़ें',
    noAccountOnDevice: 'इस डिवाइस पर कोई अकाउंट नहीं है',
    noAccountOnDeviceDesc: 'डेटा हर डिवाइस पर अलग-अलग सेव रहता है। पहले साइनअप करें — अगर पहले क्लाउड बैकअप लिया था, तो साइनअप के बाद Profile → Cloud Backup से वापस ला सकते हैं।',
    invalidAccountIdHint: 'Account ID सही नहीं लग रहा — यह 32 अक्षरों का कोड होता है। पूरा URL पेस्ट करने पर भी सही हिस्सा अपने आप निकाल लिया जाता है।',
    errTokenInvalid: 'आपका API Token काम नहीं कर रहा — token गलत कॉपी हुआ, डिलीट हो गया, या इसमें "D1: Edit" permission नहीं है। Cloudflare पर नया token बनाकर फिर कोशिश करें।',
    errIdsWrong: 'Account ID या Database ID गलत है — दोनों Cloudflare से फिर से कॉपी करके भरें।',
    errIdsMalformed: 'Account ID या Database ID का फॉर्मैट सही नहीं — सिर्फ कोड पेस्ट करें, बिना किसी अतिरिक्त टेक्स्ट के।',
    errRateLimit: 'Cloudflare पर बहुत ज़्यादा request गई — एक मिनट बाद फिर कोशिश करें।',
    errTimeout: 'Cloudflare से कनेक्शन में देरी हो रही है — इंटरनेट जाँचकर फिर कोशिश करें।',
    autoSync: 'ऑटो सिंक (तुरंत क्लाउड अपडेट)',
    autoSyncDesc: 'स्टॉक इन/आउट या बिक्री करते ही कुछ सेकंड में क्लाउड डेटाबेस अपने आप अपडेट हो जाएगा — कोई बटन दबाना नहीं पड़ेगा।',
    autoSyncLast: 'अंतिम ऑटो सिंक',
    autoSyncPending: 'कुछ बदलाव अभी सिंक नहीं हुए — ऑनलाइन आने पर अपने आप हो जाएँगे',
    autoSyncFirstNote: 'चालू करने पर पहले एक पूरा बैकअप चलेगा, उसके बाद सिर्फ बदलाव ही जाएँगे',
    autoSyncRunNow: 'अभी सिंक करें',
    autoSyncRunning: 'सिंक हो रहा है…',
    autoSyncDone: 'ऑटो सिंक पूरा — क्लाउड अपडेट हो गया',
    autoSyncFailed: 'ऑटो सिंक विफल — अपने आप फिर कोशिश होगी',
    invalidDatabaseIdHint: 'Database ID सही नहीं लग रहा — यह xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx आकार का होता है। पूरा URL पेस्ट करने पर भी सही हिस्सा अपने आप निकाल लिया जाता है।',
  },
};

export function t(key: keyof TranslationKeys, lang: Language): string {
  return translations[lang]?.[key] || translations.en[key] || key;
}
