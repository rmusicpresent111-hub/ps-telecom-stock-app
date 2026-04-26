import { Language } from './types';

type TranslationKeys = {
  // App
  appName: string;
  // Splash
  loading: string;
  // Onboarding
  onboarding1Title: string;
  onboarding1Desc: string;
  onboarding2Title: string;
  onboarding2Desc: string;
  onboarding3Title: string;
  onboarding3Desc: string;
  onboarding4Title: string;
  onboarding4Desc: string;
  onboarding5Title: string;
  onboarding5Desc: string;
  onboarding6Title: string;
  onboarding6Desc: string;
  onboarding7Title: string;
  onboarding7Desc: string;
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
};

const translations: Record<Language, TranslationKeys> = {
  bn: {
    appName: 'PS TELECOM',
    loading: 'লোড হচ্ছে...',
    onboarding1Title: 'স্টক ট্র্যাক',
    onboarding1Desc: 'সব প্রোডাক্টের স্টক সহজে ট্র্যাক করুন',
    onboarding2Title: 'প্রোডাক্ট যোগ',
    onboarding2Desc: 'দ্রুত প্রোডাক্ট যোগ করুন ও ম্যানেজ করুন',
    onboarding3Title: 'প্রফিট ট্র্যাকিং',
    onboarding3Desc: 'প্রতিদিনের লাভ-ক্ষতি সহজে দেখুন',
    onboarding4Title: 'রিপোর্ট',
    onboarding4Desc: 'বিস্তারিত রিপোর্ট তৈরি করুন',
    onboarding5Title: 'ব্যাকআপ সিস্টেম',
    onboarding5Desc: 'ডেটা ব্যাকআপ ও রিস্টোর করুন',
    onboarding6Title: 'মাল্টি ল্যাঙ্গুয়েজ',
    onboarding6Desc: 'বাংলা, ইংরেজি ও হিন্দিতে ব্যবহার করুন',
    onboarding7Title: 'ফাস্ট সার্চ',
    onboarding7Desc: 'প্রোডাক্ট দ্রুত খুঁজে বের করুন',
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
  },
  en: {
    appName: 'PS TELECOM',
    loading: 'Loading...',
    onboarding1Title: 'Stock Track',
    onboarding1Desc: 'Track all your product stock easily',
    onboarding2Title: 'Easy Add Product',
    onboarding2Desc: 'Quickly add and manage products',
    onboarding3Title: 'Profit Tracking',
    onboarding3Desc: 'View daily profit and loss easily',
    onboarding4Title: 'Reports',
    onboarding4Desc: 'Generate detailed reports',
    onboarding5Title: 'Backup System',
    onboarding5Desc: 'Backup and restore your data',
    onboarding6Title: 'Multi Language',
    onboarding6Desc: 'Use in Bengali, English & Hindi',
    onboarding7Title: 'Fast Search',
    onboarding7Desc: 'Find products quickly',
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
  },
  hi: {
    appName: 'PS TELECOM',
    loading: 'लोड हो रहा है...',
    onboarding1Title: 'स्टॉक ट्रैक',
    onboarding1Desc: 'सभी प्रोडक्ट का स्टॉक आसानी से ट्रैक करें',
    onboarding2Title: 'प्रोडक्ट जोड़ें',
    onboarding2Desc: 'जल्दी से प्रोडक्ट जोड़ें और मैनेज करें',
    onboarding3Title: 'लाभ ट्रैकिंग',
    onboarding3Desc: 'दैनिक लाभ-हानि आसानी से देखें',
    onboarding4Title: 'रिपोर्ट',
    onboarding4Desc: 'विस्तृत रिपोर्ट बनाएं',
    onboarding5Title: 'बैकअप सिस्टम',
    onboarding5Desc: 'डेटा बैकअप और रिस्टोर करें',
    onboarding6Title: 'बहुभाषी',
    onboarding6Desc: 'बांग्ला, अंग्रेजी और हिंदी में उपयोग करें',
    onboarding7Title: 'तेज़ खोज',
    onboarding7Desc: 'प्रोडक्ट जल्दी खोजें',
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
  },
};

export function t(key: keyof TranslationKeys, lang: Language): string {
  return translations[lang]?.[key] || translations.en[key] || key;
}

export default translations;
