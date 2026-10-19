/**
 * Admin Panel i18n — PS TELECOM Web Admin (Vyapar-style dashboard).
 *
 * COMPLETELY SEPARATE from the mobile app's src/lib/i18n.ts:
 * the admin panel is a standalone surface with its own design system,
 * so it ships its own flat dictionary (bn / en / hi) to stay independent
 * from the app's TranslationKeys shape.
 */

export type AdminLang = 'bn' | 'en' | 'hi';

type Entry = Record<AdminLang, string>;

const D: Record<string, Entry> = {
  // ── shell / nav ──────────────────────────────────────────────
  'nav.dashboard': { bn: 'ড্যাশবোর্ড', en: 'Dashboard', hi: 'डैशबोर्ड' },
  'nav.products': { bn: 'স্টক / প্রোডাক্ট', en: 'Products / Stock', hi: 'स्टॉक / प्रोडक्ट' },
  'nav.bills': { bn: 'বিল / বিক্রি', en: 'Bills / Sales', hi: 'बिल / बिक्री' },
  'nav.due': { bn: 'বাকির খাতা', en: 'Due Book', hi: 'बाकी खाता' },
  'nav.expenses': { bn: 'খরচ', en: 'Expenses', hi: 'खर्च' },
  'nav.reports': { bn: 'রিপোর্ট', en: 'Reports', hi: 'रिपोर्ट' },
  'nav.sync': { bn: 'ক্লাউড সিঙ্ক', en: 'Cloud Sync', hi: 'क्लाउड सिंक' },
  'shell.title': { bn: 'অ্যাডমিন প্যানেল', en: 'Admin Panel', hi: 'एडमिन पैनल' },
  'shell.subtitle': { bn: 'ওয়েব ম্যানেজমেন্ট কনসোল', en: 'Web management console', hi: 'वेब मैनेजमेंट कंसोल' },
  'shell.menu': { bn: 'মেনু', en: 'Menu', hi: 'मेन्यू' },
  'shell.backToApp': { bn: 'অ্যাপে ফিরে যান', en: 'Back to app', hi: 'ऐप पर वापस जाएं' },
  'shell.langLabel': { bn: 'ভাষা', en: 'Language', hi: 'भाषा' },

  // ── dashboard ────────────────────────────────────────────────
  'dash.stockValue': { bn: 'স্টকের মূল্য', en: 'Stock Value', hi: 'स्टॉक मूल्य' },
  'dash.todaySale': { bn: 'আজকের বিক্রি', en: "Today's Sale", hi: 'आज की बिक्री' },
  'dash.todayProfit': { bn: 'আজকের লাভ', en: "Today's Profit", hi: 'आज का लाभ' },
  'dash.toCollect': { bn: 'বাকি আদায়', en: 'To Collect', hi: 'वसूली बाकी' },
  'dash.totalItems': { bn: 'মোট আইটেম', en: 'Total Items', hi: 'कुल आइटम' },
  'dash.lowStock': { bn: 'কম স্টক', en: 'Low Stock', hi: 'कम स्टॉक' },
  'dash.saleOverview': { bn: 'শেষ ৭ দিনের বিক্রি', en: 'Last 7 Days Sale', hi: 'पिछले 7 दिन की बिक्री' },
  'dash.stockByCategory': { bn: 'ক্যাটাগরি অনুযায়ী স্টক', en: 'Stock by Category', hi: 'श्रेणी अनुसार स्टॉक' },
  'dash.recentBills': { bn: 'সাম্প্রতিক বিল', en: 'Recent Bills', hi: 'हाल के बिल' },
  'dash.lowStockAlert': { bn: 'কম স্টক সতর্কতা', en: 'Low Stock Alert', hi: 'कम स्टॉक चेतावनी' },
  'dash.noLowStock': { bn: 'সব প্রোডাক্টে যথেষ্ট স্টক আছে 🎉', en: 'All products are well stocked 🎉', hi: 'सभी प्रोडक्ट में पर्याप्त स्टॉक है 🎉' },
  'dash.quickActions': { bn: 'কুইক অ্যাকশন', en: 'Quick Actions', hi: 'क्विक एक्शन' },
  'dash.viewAll': { bn: 'সব দেখুন', en: 'View all', hi: 'सभी देखें' },
  'dash.items': { bn: 'টি বিল', en: 'bills', hi: 'बिल' },

  // ── products ─────────────────────────────────────────────────
  'prod.title': { bn: 'স্টক / প্রোডাক্ট', en: 'Products / Stock', hi: 'स्टॉक / प्रोडक्ट' },
  'prod.add': { bn: 'নতুন প্রোডাক্ট', en: 'Add Product', hi: 'नया प्रोडक्ट' },
  'prod.newCategory': { bn: 'নতুন ক্যাটাগরি', en: 'New category', hi: 'नई श्रेणी' },
  'prod.categoryName': { bn: 'ক্যাটাগরির নাম', en: 'Category name', hi: 'श्रेणी का नाम' },
  'prod.search': { bn: 'প্রোডাক্ট খুঁজুন…', en: 'Search products…', hi: 'प्रोडक्ट खोजें…' },
  'prod.allCategories': { bn: 'সব ক্যাটাগরি', en: 'All categories', hi: 'सभी श्रेणी' },
  'prod.name': { bn: 'প্রোডাক্টের নাম', en: 'Product name', hi: 'प्रोडक्ट का नाम' },
  'prod.category': { bn: 'ক্যাটাগরি', en: 'Category', hi: 'श्रेणी' },
  'prod.quantity': { bn: 'স্টক (পরিমাণ)', en: 'Quantity', hi: 'मात्रा' },
  'prod.box': { bn: 'বক্স নম্বর', en: 'Box number', hi: 'बॉक्स नंबर' },
  'prod.purchasePrice': { bn: 'কেনা দাম', en: 'Purchase price', hi: 'खरीद मूल्य' },
  'prod.sellingPrice': { bn: 'বিক্রির দাম', en: 'Selling price', hi: 'बिक्री मूल्य' },
  'prod.lowThreshold': { bn: 'কম স্টক সতর্কতা (সংখ্যা)', en: 'Low stock alert level', hi: 'कम स्टॉक स्तर' },
  'prod.value': { bn: 'মূল্য', en: 'Value', hi: 'मूल्य' },
  'prod.status': { bn: 'অবস্থা', en: 'Status', hi: 'स्थिति' },
  'prod.inStock': { bn: 'স্টকে আছে', en: 'In stock', hi: 'स्टॉक में' },
  'prod.low': { bn: 'কম', en: 'Low', hi: 'कम' },
  'prod.out': { bn: 'ফুরিয়ে গেছে', en: 'Out of stock', hi: 'स्टॉक खत्म' },
  'prod.stockIn': { bn: 'স্টক ইন', en: 'Stock In', hi: 'स्टॉक इन' },
  'prod.stockOut': { bn: 'স্টক আউট', en: 'Stock Out', hi: 'स्टॉक आउट' },
  'prod.addCategoryFirst': { bn: 'প্রথমে অ্যাপে একটি ক্যাটাগরি যোগ করুন', en: 'Add a category in the app first', hi: 'पहले ऐप में एक श्रेणी जोड़ें' },
  'prod.confirmDelete': { bn: 'প্রোডাক্টটি মুছে ফেলবেন?', en: 'Delete this product?', hi: 'यह प्रोडक्ट हटाएं?' },
  'prod.deleteNote': { bn: 'পুরোনো বিক্রির ইতিহাস রিপোর্টে রেকর্ড থাকবে (স্ন্যাপশটসহ)।', en: 'Past sales history is kept and still counts in reports.', hi: 'पुराना बिक्री इतिहास रिपोर्ट में रहेगा।' },
  'prod.qty': { bn: 'পরিমাণ', en: 'Qty', hi: 'मात्रा' },
  'prod.rate': { bn: 'দর', en: 'Rate', hi: 'दर' },
  'prod.rateHint': { bn: 'স্টক ইনে নতুন কেনা দাম (খালি রাখলে পুরোনো থাকবে)', en: 'New purchase price for this stock-in (blank = keep old)', hi: 'इस स्टॉक इन का नया खरीद मूल्य (खाली = पुराना)' },

  // ── bills ────────────────────────────────────────────────────
  'bills.title': { bn: 'বিল / বিক্রি', en: 'Bills / Sales', hi: 'बिल / बिक्री' },
  'bills.search': { bn: 'বিল নম্বর বা কাস্টমার…', en: 'Bill no or customer…', hi: 'बिल नंबर या ग्राहक…' },
  'bills.billNo': { bn: 'বিল নং', en: 'Bill No', hi: 'बिल नं' },
  'bills.customer': { bn: 'কাস্টমার', en: 'Customer', hi: 'ग्राहक' },
  'bills.total': { bn: 'মোট', en: 'Total', hi: 'कुल' },
  'bills.paid': { bn: 'জমা', en: 'Paid', hi: 'भुगतान' },
  'bills.due': { bn: 'বাকি', en: 'Due', hi: 'बाकी' },
  'bills.method': { bn: 'পেমেন্ট', en: 'Payment', hi: 'भुगतान' },
  'bills.markPaid': { bn: 'বাকি পরিশোধ', en: 'Mark Paid', hi: 'भुगतान दर्ज' },
  'bills.markPaidFull': { bn: 'পুরো বাকি ({amount}) জমা হিসেবে রেকর্ড হবে।', en: 'Record the FULL due ({amount}) as paid.', hi: 'पूरी बाकी ({amount}) भुगतान दर्ज होगी।' },
  'bills.markPaidPartial': { bn: 'আংশিক পরিমাণ দিন (বাকি: {amount})', en: 'Enter a partial amount (due: {amount})', hi: 'आंशिक राशि दर्ज करें (बाकी: {amount})' },
  'bills.paidDone': { bn: 'পেমেন্ট রেকর্ড হয়েছে', en: 'Payment recorded', hi: 'भुगतान दर्ज हुआ' },
  'bills.partial': { bn: 'আংশিক জমা', en: 'Partial payment', hi: 'आंशिक भुगतान' },
  'bills.confirmDelete': { bn: 'বিলটি মুছে ফেলবেন?', en: 'Delete this bill?', hi: 'यह बिल हटाएं?' },
  'bills.items': { bn: 'আইটেম', en: 'Items', hi: 'आइटम' },
  'bills.subtotal': { bn: 'সাবটোটাল', en: 'Subtotal', hi: 'सबटोटल' },
  'bills.discount': { bn: 'ডিস্কাউন্ট', en: 'Discount', hi: 'छूट' },
  'bills.gst': { bn: 'জিএসটি', en: 'GST', hi: 'जीएसटी' },
  'bills.note': { bn: 'নোট', en: 'Note', hi: 'नोट' },
  'bills.noBills': { bn: 'এখনও কোনো বিল নেই', en: 'No bills yet', hi: 'अभी कोई बिल नहीं' },
  'bills.allTime': { bn: 'সব সময়', en: 'All time', hi: 'सभी समय' },

  // ── due book ─────────────────────────────────────────────────
  'due.title': { bn: 'বাকির খাতা', en: 'Due Book', hi: 'बाकी खाता' },
  'due.totalDue': { bn: 'মোট বাকি', en: 'Total Due', hi: 'कुल बाकी' },
  'due.customers': { bn: 'কাস্টমার', en: 'Customers', hi: 'ग्राहक' },
  'due.billsCount': { bn: 'টি বিলে বাকি', en: 'bills with due', hi: 'बिल में बाकी' },
  'due.noDue': { bn: 'কারো কোনো বাকি নেই 🎉', en: 'No dues from anyone 🎉', hi: 'किसी की कोई बाकी नहीं 🎉' },
  'due.remind': { bn: 'WhatsApp রিমাইন্ডার', en: 'WhatsApp reminder', hi: 'WhatsApp रिमाइंडर' },
  'due.remindMsg': { bn: 'নমস্কার! আপনার কিছু বাকি টাকা আছে — অনুগ্রহ করে পরিশোধ করুন। 🙏', en: 'Hello! You have a pending due — please settle it when convenient. 🙏', hi: 'नमस्ते! आपकी कुछ बाकी राशि है — कृपया भुगतान करें। 🙏' },
  'due.walkIn': { bn: 'নাম-নেই কাস্টমার', en: 'Unnamed customer', hi: 'अनाम ग्राहक' },

  // ── expenses ─────────────────────────────────────────────────
  'exp.title': { bn: 'খরচ', en: 'Expenses', hi: 'खर्च' },
  'exp.add': { bn: 'নতুন খরচ', en: 'Add Expense', hi: 'नया खर्च' },
  'exp.amount': { bn: 'পরিমাণ (₹)', en: 'Amount (₹)', hi: 'राशि (₹)' },
  'exp.category': { bn: 'খরচের খাত', en: 'Expense category', hi: 'खर्च श्रेणी' },
  'exp.description': { bn: 'বিবরণ', en: 'Description', hi: 'विवरण' },
  'exp.date': { bn: 'তারিখ', en: 'Date', hi: 'तारिख' },
  'exp.total': { bn: 'মোট খরচ', en: 'Total expense', hi: 'कुल खर्च' },
  'exp.noExpenses': { bn: 'এখনও কোনো খরচ নেই', en: 'No expenses yet', hi: 'अभी कोई खर्च नहीं' },
  'exp.thisMonth': { bn: 'এই মাসে', en: 'This month', hi: 'इस महीने' },

  // ── reports ──────────────────────────────────────────────────
  'rep.title': { bn: 'রিপোর্ট', en: 'Reports', hi: 'रिपोर्ट' },
  'rep.period': { bn: 'সময়কাল', en: 'Period', hi: 'अवधि' },
  'rep.today': { bn: 'আজ', en: 'Today', hi: 'आज' },
  'rep.week': { bn: '৭ দিন', en: '7 days', hi: '7 दिन' },
  'rep.month': { bn: '৩০ দিন', en: '30 days', hi: '30 दिन' },
  'rep.custom': { bn: 'কাস্টম', en: 'Custom', hi: 'कस्टम' },
  'rep.from': { bn: 'থেকে', en: 'From', hi: 'से' },
  'rep.to': { bn: 'পর্যন্ত', en: 'To', hi: 'तक' },
  'rep.salesProfit': { bn: 'বিক্রি বনাম লাভ', en: 'Sales vs Profit', hi: 'बिक्री बनाम लाभ' },
  'rep.topProducts': { bn: 'সবচেয়ে বেশি বিক্রি হওয়া প্রোডাক্ট', en: 'Top selling products', hi: 'सबसे ज्यादा बिकने वाले प्रोडक्ट' },
  'rep.netProfit': { bn: 'নিট লাভ (খরচ বাদে)', en: 'Net profit (before expenses)', hi: 'शुद्ध लाभ (खर्च पहले)' },
  'rep.totalSales': { bn: 'মোট বিক্রি', en: 'Total sales', hi: 'कुल बिक्री' },
  'rep.totalProfit': { bn: 'মোট লাভ', en: 'Total profit', hi: 'कुल लाभ' },
  'rep.expenseTotal': { bn: 'মোট খরচ', en: 'Total expense', hi: 'कुल खर्च' },
  'rep.noData': { bn: 'এই সময়ে কোনো লেনদেন নেই', en: 'No transactions in this period', hi: 'इस अवधि में कोई लेनदेन नहीं' },
  'rep.sold': { bn: 'বিক্রি', en: 'sold', hi: 'बिक्री' },

  // ── sync & settings ──────────────────────────────────────────
  'sync.title': { bn: 'ক্লাউড সিঙ্ক ও সেটিংস', en: 'Cloud Sync & Settings', hi: 'क्लाउड सिंक और सेटिंग्स' },
  'sync.sameDb': { bn: 'মোবাইল অ্যাপের সেই একই এনক্রিপ্টেড ডেটাবেসে সংযোগ করুন — একই Sync ID ও PIN ব্যবহার করুন।', en: 'Connect to the SAME encrypted database as the mobile app — use the same Sync ID and PIN.', hi: 'मोबाइल ऐप के उसी एन्क्रिप्टेड डेटाबेस से जुड़ें — वही Sync ID और PIN इस्तेमाल करें।' },
  'sync.status': { bn: 'অবস্থা', en: 'Status', hi: 'स्थिति' },
  'sync.connected': { bn: 'সংযুক্ত', en: 'Connected', hi: 'जुड़ा हुआ' },
  'sync.off': { bn: 'বন্ধ', en: 'Off', hi: 'बंद' },
  'sync.syncing': { bn: 'সিঙ্ক হচ্ছে…', en: 'Syncing…', hi: 'सिंक हो रहा है…' },
  'sync.error': { bn: 'ত্রুটি', en: 'Error', hi: 'त्रुटि' },
  'sync.offline': { bn: 'অফলাইন', en: 'Offline', hi: 'ऑफ़लाइन' },
  'sync.lastSync': { bn: 'শেষ সিঙ্ক', en: 'Last sync', hi: 'अंतिम सिंक' },
  'sync.never': { bn: 'কখনও হয়নি', en: 'Never', hi: 'कभी नहीं' },
  'sync.syncNow': { bn: 'এখনই সিঙ্ক', en: 'Sync now', hi: 'अभी सिंक करें' },
  'sync.disconnect': { bn: 'সংযোগ বিচ্ছিন্ন', en: 'Disconnect', hi: 'डिस्कनेक्ट' },
  'sync.id': { bn: 'Sync ID', en: 'Sync ID', hi: 'Sync ID' },
  'sync.pin': { bn: 'PIN (কমপক্ষে ৪ অঙ্ক)', en: 'PIN (min 4 digits)', hi: 'पिन (कम से कम 4)' },
  'sync.join': { bn: 'সংযোগ করুন', en: 'Connect', hi: 'कनेक्ट करें' },
  'sync.createNew': { bn: 'নতুন অ্যাকাউন্ট বানান', en: 'Create new account', hi: 'नया खाता बनाएं' },
  'sync.useExisting': { bn: 'পুরোনো অ্যাকাউন্টে ঢুকুন', en: 'Use existing account', hi: 'मौजूदा खाता इस्तेमाल करें' },
  'sync.connecting': { bn: 'সংযোগ হচ্ছে…', en: 'Connecting…', hi: 'कनेक्ट हो रहा है…' },
  'sync.errBadId': { bn: 'Sync ID ভুল ফরম্যাটে (৪–৬৩ অক্ষর)', en: 'Bad Sync ID format (4–63 chars)', hi: 'Sync ID फॉर्मेट गलत (4–63)' },
  'sync.errBadPin': { bn: 'PIN ছোট হয়ে গেছে', en: 'PIN too short', hi: 'PIN बहुत छोटा' },
  'sync.errTaken': { bn: 'এই Sync ID আগে থেকেই আছে', en: 'This Sync ID already exists', hi: 'यह Sync ID पहले से है' },
  'sync.errNotFound': { bn: 'এই Sync ID খুঁজে পাওয়া যায়নি', en: 'Sync ID not found', hi: 'Sync ID नहीं मिला' },
  'sync.errWrongPin': { bn: 'PIN ভুল', en: 'Wrong PIN', hi: 'PIN गलत' },
  'sync.errOffline': { bn: 'ইন্টারনেট নেই', en: 'No internet', hi: 'इंटरनेट नहीं' },
  'sync.errFail': { bn: 'সংযোগ ব্যর্থ হয়েছে', en: 'Connection failed', hi: 'कनेक्शन विफल' },
  'sync.errStatic': { bn: 'এই স্ট্যাটিক মিররে ক্লাউড সিঙ্ক বন্ধ — সিঙ্ক-সহ ভার্সন সার্ভার হোস্ট করা ওয়েব অ্যাপে চলে (প্রিভিউ লিংক / Vercel)।', en: 'Cloud sync is off on this static mirror — sync-capable version runs on the server-hosted web app (preview link / Vercel).', hi: 'इस स्टैटिक मिरर पर क्लाउड सिंक बंद — सिंक-सक्षम वर्शन सर्वर-होस्टेड वेब ऐप पर चलता है।' },
  'sync.exportCsv': { bn: 'CSV এক্সপোর্ট', en: 'CSV Export', hi: 'CSV निर्यात' },
  'sync.csvProducts': { bn: 'প্রোডাক্ট CSV', en: 'Products CSV', hi: 'प्रोडक्ट CSV' },
  'sync.csvBills': { bn: 'বিল CSV', en: 'Bills CSV', hi: 'बिल CSV' },
  'sync.csvDone': { bn: 'CSV ডাউনলোড হয়েছে', en: 'CSV downloaded', hi: 'CSV डाउनलोड हुआ' },
  'sync.shop': { bn: 'দোকানের নাম', en: 'Shop name', hi: 'दुकान का नाम' },
  'sync.autoNote': { bn: 'সংযুক্ত থাকলে প্রতিটি পরিবর্তন ~১ সেকেন্ডে ক্লাউডে চলে যায়, অন্য ডিভাইস সর্বোচ্চ ১২ সেকেন্ডে পায়।', en: 'When connected, every change reaches the cloud in ~1s; other devices get it within 12s.', hi: 'जुड़े होने पर हर बदलाव ~1s में क्लाउड तक पहुंचता है; दूसरे डिवाइस 12s में पाते हैं।' },

  // ── theme (dark / light) ─────────────────────────────────────
  'theme.toDark': { bn: 'ডার্ক মোড', en: 'Dark mode', hi: 'डार्क मोड' },
  'theme.toLight': { bn: 'লাইট মোড', en: 'Light mode', hi: 'लाइट मोड' },

  // ── quick sell ───────────────────────────────────────────────
  'shell.quickSell': { bn: 'কুইক সেল', en: 'Quick Sell', hi: 'क्विक सेल' },
  'qsell.pickProduct': { bn: 'যে প্রোডাক্ট বিক্রি হবে সেটি বাছুন', en: 'Pick the product to sell', hi: 'बिक्री के लिए प्रोडक्ट चुनें' },
  'qsell.searchProduct': { bn: 'প্রোডাক্ট খুঁজুন…', en: 'Search product…', hi: 'प्रोडक्ट खोजें…' },
  'qsell.noProduct': { bn: 'কোনো প্রোডাক্ট মেলেনি', en: 'No product matched', hi: 'कोई प्रोडक्ट नहीं मिला' },
  'qsell.saleDetails': { bn: 'বিক্রির বিবরণ', en: 'Sale details', hi: 'बिक्री विवरण' },
  'qsell.customer': { bn: 'কাস্টমারের নাম (ঐচ্ছিক)', en: 'Customer name (optional)', hi: 'ग्राहक का नाम (वैकल्पिक)' },
  'qsell.mobile': { bn: 'মোবাইল (ঐচ্ছিক)', en: 'Mobile (optional)', hi: 'मोबाइल (वैकल्पिक)' },
  'qsell.note': { bn: 'নোট (ঐচ্ছিক)', en: 'Note (optional)', hi: 'नोट (वैकल्पिक)' },
  'qsell.complete': { bn: 'বিক্রি সম্পন্ন করুন', en: 'Complete sale', hi: 'बिक्री पूरी करें' },
  'qsell.done': { bn: 'বিক্রি হয়ে গেছে', en: 'Sale completed', hi: 'बिक्री पूरी हुई' },
  'qsell.doneDesc': { bn: 'বিল তৈরি হয়েছে এবং "বিল / বিক্রি" তালিকায় যোগ হয়েছে।', en: 'The bill was created and added to the Bills / Sales list.', hi: 'बिल बन गया और "बिल / बिक्री" सूची में जुड़ गया।' },
  'qsell.printReceipt': { bn: 'রিসিট প্রিন্ট', en: 'Print receipt', hi: 'रसीद प्रिंट' },
  'qsell.sellAgain': { bn: 'নতুন বিক্রি', en: 'New sale', hi: 'नई बिक्री' },
  'qsell.viewBills': { bn: 'বিল দেখুন', en: 'View bills', hi: 'बिल देखें' },
  'qsell.stockLeft': { bn: 'স্টকে', en: 'in stock', hi: 'स्टॉक में' },
  'qsell.outOfStock': { bn: 'স্টক নেই', en: 'Out of stock', hi: 'स्टॉक नहीं' },
  'qsell.errStock': { bn: 'স্টকে যথেষ্ট নেই', en: 'Not enough stock', hi: 'पर्याप्त स्टॉक नहीं' },
  'qsell.dueNote': { bn: 'পেমেন্ট "বাকি" হলে বিলটি বাকির খাতায়ও যোগ হবে।', en: 'Choosing "Due" also adds the bill to the Due Book.', hi: '"बाकी" चुनने पर बिल बाकी खाते में भी जुड़ जाएगा।' },

  // ── category suggestions ─────────────────────────────────────
  'cat.searchOrCreate': { bn: 'ক্যাটাগরি খুঁজুন বা নতুন লিখুন…', en: 'Search or type a new category…', hi: 'श्रेणी खोजें या नई लिखें…' },
  'cat.create': { bn: 'নতুন ক্যাটাগরি বানান', en: 'Create new category', hi: 'नई श्रेणी बनाएं' },
  'cat.none': { bn: 'কোনো ক্যাটাগরি নেই — নাম লিখে নতুন বানান', en: 'No categories yet — type a name to create one', hi: 'कोई श्रेणी नहीं — नाम लिखकर बनाएं' },

  // ── print / PDF ──────────────────────────────────────────────
  'bills.print': { bn: 'প্রিন্ট / PDF', en: 'Print / PDF', hi: 'प्रिंट / PDF' },
  'bills.soldReport': { bn: 'বিক্রি হওয়া প্রোডাক্টের রিপোর্ট', en: 'Sold Products Report', hi: 'बिक्री प्रोडक्ट रिपोर्ट' },
  'bills.noBillsPrint': { bn: 'প্রিন্ট করার মতো কোনো বিল নেই', en: 'No bills to print', hi: 'प्रिंट के लिए कोई बिल नहीं' },
  'bills.qtySold': { bn: 'বিক্রি সংখ্যা', en: 'Qty sold', hi: 'बिक्री संख्या' },
  'bills.grandTotal': { bn: 'সর্বমোট', en: 'Grand total', hi: 'कुल योग' },
  'print.productSummary': { bn: 'প্রোডাক্ট সারসংক্ষেপ', en: 'Product summary', hi: 'प्रोडक्ट सारांश' },
  'print.detailList': { bn: 'বিস্তারিত তালিকা', en: 'Detailed list', hi: 'विस्तृत सूची' },
  'print.generated': { bn: 'তৈরি হয়েছে', en: 'Generated', hi: 'निर्मित' },
  'print.signature': { bn: 'স্বাক্ষর', en: 'Signature', hi: 'हस्ताक्षर' },
  'print.totalPaid': { bn: 'মোট জমা', en: 'Total paid', hi: 'कुल भुगतान' },
  'print.totalDue': { bn: 'মোট বাকি', en: 'Total due', hi: 'कुल बाकी' },
  'print.thankyou': { bn: 'কেনাকাটার জন্য ধন্যবাদ!', en: 'Thank you for your purchase!', hi: 'खरीदारी के लिए धन्यवाद!' },

  // ── common ───────────────────────────────────────────────────
  'c.save': { bn: 'সেভ', en: 'Save', hi: 'सेव' },
  'c.add': { bn: 'যোগ করুন', en: 'Add', hi: 'जोड़ें' },
  'c.edit': { bn: 'এডিট', en: 'Edit', hi: 'बदलें' },
  'c.delete': { bn: 'মুছুন', en: 'Delete', hi: 'हटाएं' },
  'c.cancel': { bn: 'বাতিল', en: 'Cancel', hi: 'रद्द' },
  'c.confirm': { bn: 'নিশ্চিত', en: 'Confirm', hi: 'पुष्टि' },
  'c.close': { bn: 'বন্ধ', en: 'Close', hi: 'बंद' },
  'c.search': { bn: 'খুঁজুন…', en: 'Search…', hi: 'खोजें…' },
  'c.all': { bn: 'সব', en: 'All', hi: 'सभी' },
  'c.noData': { bn: 'কিছু নেই', en: 'Nothing here', hi: 'कुछ नहीं' },
  'c.loading': { bn: 'লোড হচ্ছে…', en: 'Loading…', hi: 'लोड हो रहा है…' },
  'c.saved': { bn: 'সেভ হয়েছে', en: 'Saved', hi: 'सेव हुआ' },
  'c.added': { bn: 'যোগ হয়েছে', en: 'Added', hi: 'जुड़ गया' },
  'c.deleted': { bn: 'মুছে ফেলা হয়েছে', en: 'Deleted', hi: 'हटा दिया' },
  'c.error': { bn: 'সমস্যা হয়েছে', en: 'Something went wrong', hi: 'समस्या हुई' },
  'c.required': { bn: 'এই ঘরটি পূরণ করুন', en: 'This field is required', hi: 'यह खाना भरें' },
  'c.cash': { bn: 'ক্যাশ', en: 'Cash', hi: 'कैश' },
  'c.upi': { bn: 'UPI', en: 'UPI', hi: 'UPI' },
  'c.card': { bn: 'কার্ড', en: 'Card', hi: 'कार्ड' },
  'c.due': { bn: 'বাকি', en: 'Due', hi: 'बाकी' },
  'c.of': { bn: 'এর', en: 'of', hi: 'का' },
};

/** Translate an admin key. Falls back to English → the key itself. */
export function ta(key: string, lang: AdminLang): string {
  const e = D[key];
  if (!e) return key;
  return e[lang] || e.en || key;
}

/** Translate with {var} interpolation. */
export function taf(key: string, lang: AdminLang, vars: Record<string, string | number>): string {
  let s = ta(key, lang);
  for (const [k, v] of Object.entries(vars)) {
    s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}
