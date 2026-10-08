'use client';

import { useEffect, useState, useCallback, useMemo, memo, useRef } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { getDashboard, localDateStr } from '@/lib/offline-service';
import { DashboardStats, Category, Product } from '@/lib/types';
import { Search, Plus, Package, AlertTriangle, ArrowLeftRight, IndianRupee, User, ChevronRight, TrendingUp, BarChart3, ArrowUpRight, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import dynamic from 'next/dynamic';

// Lazy load recharts - saves ~200KB from initial bundle
const LazyBarChart = dynamic(
  () => import('recharts').then(mod => {
    const { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, ResponsiveContainer } = mod;
    return function BarChartComponent({ data, config }: { data: SaleOverviewItem[]; config: ChartConfig }) {
      return (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
              tickFormatter={(val: number) => `₹${val >= 1000 ? `${(val/1000).toFixed(0)}k` : val}`}
            />
            <Bar dataKey="sales" radius={[4, 4, 0, 0]} maxBarSize={28}>
              {data.map((_entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={index === data.length - 1 ? '#D4A853' : 'rgba(212,168,83,0.4)'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      );
    };
  }),
  { ssr: false, loading: () => <div className="h-[180px] flex items-center justify-center"><div className="w-6 h-6 border-2 border-[#D4A853]/30 border-t-[#D4A853] rounded-full animate-spin" /></div> }
);

const LazyPieChart = dynamic(
  () => import('recharts').then(mod => {
    const { PieChart, Pie, Cell, ResponsiveContainer } = mod;
    return function PieChartComponent({ data, colors }: { data: StockOverviewItem[]; colors: string[] }) {
      return (
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={data}
              dataKey="quantity"
              nameKey="category"
              cx="50%"
              cy="50%"
              outerRadius={75}
              innerRadius={40}
              strokeWidth={2}
              stroke="rgba(10,10,30,0.8)"
            >
              {data.map((_entry, index) => (
                <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      );
    };
  }),
  { ssr: false, loading: () => <div className="h-[200px] flex items-center justify-center"><div className="w-6 h-6 border-2 border-[#D4A853]/30 border-t-[#D4A853] rounded-full animate-spin" /></div> }
);

const defaultCategories = [
  { name: 'Mobile', image: '/categories/mobile.png', emoji: '📱' },
  { name: 'Display/Combo', image: '/categories/display.png', emoji: '🖥️' },
  { name: 'Tempered Glass', image: '/categories/tempered-glass.png', emoji: '🛡️' },
  { name: 'Flip Cover', image: '/categories/flip-cover.png', emoji: '📱' },
  { name: 'Back Cover', image: '/categories/back-cover.png', emoji: '📱' },
  { name: 'UV Glass', image: '/categories/uv-glass.png', emoji: '✨' },
  { name: 'Smart Watch', image: '/categories/smart-watch.png', emoji: '⌚' },
  { name: 'Battery', image: '/categories/battery.png', emoji: '🔋' },
  { name: 'Charger', image: '/categories/charger.png', emoji: '🔌' },
  { name: 'Neck Band', image: '/categories/neckband.png', emoji: '🎵' },
  { name: 'Ear Pods', image: '/categories/earpods.png', emoji: '🎧' },
  { name: 'Selfie Stick', image: '/categories/selfie-stick.png', emoji: '📸' },
  { name: 'Ring Light', image: '/categories/ring-light.png', emoji: '💡' },
  { name: 'Mobile Stand', image: '/categories/mobile-stand.png', emoji: '📐' },
  { name: 'Watch Strap', image: '/categories/watch-strap.png', emoji: '⌚' },
  { name: 'Earphone', image: '/categories/earphone.png', emoji: '🎧' },
  { name: 'Memory Card', image: '/categories/memory-card.png', emoji: '💾' },
  { name: 'Data Cable', image: '/categories/data-cable.png', emoji: '🔌' },
  { name: 'Home Theater', image: '/categories/home-theater.png', emoji: '🔊' },
  { name: 'Refrigerator', image: '/categories/refrigerator.png', emoji: '❄️' },
];

const PIE_COLORS = ['#D4A853', '#A07C3E', '#F5DEB3', '#ff6b00', '#ff006e', '#ffd700', '#00e5ff', '#e040fb', '#76ff03', '#ff9100', '#f50057', '#ffea00', '#18ffff', '#d500f9', '#64dd17', '#ff3d00', '#c51162', '#aeea00', '#00b8d4'];

interface SaleOverviewItem {
  date: string;
  label: string;
  sales: number;
  quantity: number;
}

interface StockOverviewItem {
  category: string;
  quantity: number;
  value: number;
}

// Stagger animation variants for category grid
const categoryContainerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.1 },
  },
};

const categoryItemVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.92 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 260, damping: 20 },
  },
};

// Memoized category card component
const CategoryCard = memo(function CategoryCard({ cat, defaultCat, onTap, index }: { cat: Category; defaultCat: typeof defaultCategories[0] | undefined; onTap: () => void; index: number }) {
  const imgSrc = cat.image?.startsWith('/categories/') ? cat.image : (defaultCat?.image || '');
  return (
    <motion.div
      variants={categoryItemVariants}
      whileHover={{ scale: 1.06, y: -2 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      <button
        onClick={onTap}
        className="glass-card category-card p-3 flex flex-col items-center gap-2 w-full"
      >
        <div className="category-img-wrapper w-14 h-14 bg-white/5 flex items-center justify-center">
          {imgSrc ? (
            <>
              <img src={imgSrc} alt={cat.name} className="w-full h-full object-cover category-img-zoom" loading="lazy" />
              <div className="category-img-overlay" />
            </>
          ) : (
            <span className="text-2xl category-emoji-bounce">{cat.image || '📦'}</span>
          )}
        </div>
        <span className="text-[11px] font-medium text-white/90 truncate w-full text-center leading-tight">
          {cat.name}
        </span>
        <span className="text-[10px] text-emerald-400/70 font-medium">
          {cat._count?.products ?? 0} items
        </span>
      </button>
    </motion.div>
  );
});

// ✅ Memoized stat card to prevent re-renders
const StatCard = memo(function StatCard({ icon: Icon, label, value, iconColor, className }: {
  icon: React.ComponentType<{ size: number; className?: string }>;
  label: string;
  value: string;
  iconColor: string;
  className: string;
}) {
  return (
    <div className={`${className} rounded-2xl p-4`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={16} className={iconColor} />
        <span className="text-xs text-white/60">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${iconColor}`}>
        {value}
      </p>
    </div>
  );
});

export default function DashboardScreen() {
  const user = useAppStore(s => s.user);
  const language = useAppStore(s => s.language);
  const shopName = useAppStore(s => s.shopName);
  const navigateTo = useAppStore(s => s.navigateTo);
  const navigateToTab = useAppStore(s => s.navigateToTab);
  const setSelectedCategoryId = useAppStore(s => s.setSelectedCategoryId);
  const setSelectedProductId = useAppStore(s => s.setSelectedProductId);
  const setSelectedServiceCategory = useAppStore(s => s.setSelectedServiceCategory);
  const setSearchQuery = useAppStore(s => s.setSearchQuery);
  const searchQuery = useAppStore(s => s.searchQuery);
  const categories = useAppStore(s => s.categories);
  const setCategories = useAppStore(s => s.setCategories);

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [lowStockProducts, setLowStockProducts] = useState<Product[]>([]);
  const [saleOverview, setSaleOverview] = useState<SaleOverviewItem[]>([]);
  const [stockOverview, setStockOverview] = useState<StockOverviewItem[]>([]);
  const [todayProfit, setTodayProfit] = useState(0);
  const [loading, setLoading] = useState(true);
  const isFetchingRef = useRef(false);
  const fetchDashboard = useCallback(async (isBackground = false) => {
    if (!user?.id || isFetchingRef.current) return;

    isFetchingRef.current = true;
    try {
      if (!isBackground) setLoading(true);
      const data = await getDashboard(user.id) as Record<string, unknown>;
      setStats(data.stats as DashboardStats | null);
      setLowStockProducts((data.lowStockProducts as Product[]) || []);
      setSaleOverview((data.saleOverview as SaleOverviewItem[]) || []);
      setStockOverview((data.stockOverview as StockOverviewItem[]) || []);
      if ((data.categories as Category[] | undefined)?.length) {
        setCategories(data.categories as Category[]);
      }

      // Calculate today's profit from transactions
      // Profit = totalAmount - (quantity × purchase price SNAPSHOT at sale time)
      const today = localDateStr();
      const { getTransactionsOffline: getTxns } = await import('@/lib/offline-service');
      const todayTxns = await getTxns(user.id, { from: today, to: today });
      const sellTxns = (todayTxns || []).filter((tx) => tx.type === 'SELL');
      let profit = 0;
      for (const tx of sellTxns) {
        // Use the snapshot captured on the transaction — current product price edits
        // must not rewrite today's profit.
        const cost = (tx.quantity || 0) * (tx.product?.purchasePrice ?? 0);
        profit += (tx.totalAmount || 0) - cost;
      }
      setTodayProfit(profit);
    } catch {
      if (!isBackground) toast.error(t('error', language));
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, [user?.id]);

  // Initial load
  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // ✅ Background refresh on window focus (stale-while-revalidate)
  useEffect(() => {
    const handleFocus = () => {
      fetchDashboard(true);
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchDashboard]);

  const handleCategoryTap = useCallback((cat: Category) => {
    setSelectedCategoryId(cat.id);
    navigateTo('category-detail');
  }, [setSelectedCategoryId, navigateTo]);

  const handleSearch = useCallback((value: string) => {
    setSearchQuery(value);
  }, [setSearchQuery]);

  const handleSearchSubmit = useCallback(() => {
    if (searchQuery.trim()) {
      navigateToTab('product-list');
    }
  }, [searchQuery, navigateToTab]);

  // Memoize computed values
  const totalSaleAmount = useMemo(() => saleOverview.reduce((sum, d) => sum + d.sales, 0), [saleOverview]);
  const totalSoldItems = useMemo(() => saleOverview.reduce((sum, d) => sum + d.quantity, 0), [saleOverview]);
  const totalStockQty = useMemo(() => stockOverview.reduce((sum, d) => sum + d.quantity, 0), [stockOverview]);
  const totalStockVal = useMemo(() => stockOverview.reduce((sum, d) => sum + d.value, 0), [stockOverview]);

  // Precompute defaultCategory lookup - stable reference
  const defaultCatMap = useMemo(() => {
    const map = new Map<string, typeof defaultCategories[0]>();
    for (const dc of defaultCategories) {
      map.set(dc.name, dc);
    }
    return map;
  }, []);

  // ✅ Memoize stat values to prevent string recreation
  const statValues = useMemo(() => ({
    totalItems: loading ? '...' : String(stats?.totalItems ?? 0),
    lowItems: loading ? '...' : String(stats?.lowItems ?? 0),
    todayTransactions: loading ? '...' : String(stats?.todayTransactions ?? 0),
    stockValue: loading ? '...' : `₹${(stats?.stockValue ?? 0).toLocaleString()}`,
  }), [loading, stats]);

  // ✅ Memoize i18n labels
  const labels = useMemo(() => ({
    totalItems: t('totalItems', language),
    lowItems: t('lowItems', language),
    todayTransaction: t('todayTransaction', language),
    stockValue: t('stockValue', language),
    searchProducts: t('searchProducts', language),
    categories: t('categories', language),
    addCategory: t('addCategory', language),
    lowStockAlert: t('lowStockAlert', language),
    lowStockMsg: t('lowStockMsg', language).toLowerCase(),
  }), [language]);

  return (
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigateToTab('profile')}
            className="p-2 rounded-full glass-card"
            aria-label="Profile"
          >
            <User size={20} className="text-emerald-400" />
          </button>
          <h1 className="text-xl font-bold neon-glow">{shopName}</h1>
          <button
            onClick={() => { setSelectedProductId(null); navigateTo('add-product'); }}
            className="p-2 rounded-full glass-card"
            aria-label="Add Product"
          >
            <Plus size={20} className="text-emerald-400" />
          </button>
        </div>

        {/* Search bar */}
        <div className="relative mb-6">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearchSubmit()}
            placeholder={labels.searchProducts}
            className="glass-input w-full pl-11 pr-4 py-3 text-sm"
          />
        </div>

        {/* Stats section */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <StatCard icon={Package} label={labels.totalItems} value={statValues.totalItems} iconColor="text-green-400" className="stat-card-green" />
          <StatCard
            icon={AlertTriangle}
            label={labels.lowItems}
            value={statValues.lowItems}
            iconColor={(stats?.lowItems ?? 0) > 0 ? 'text-orange-400' : 'text-green-400'}
            className={(stats?.lowItems ?? 0) > 0 ? 'stat-card-orange' : 'stat-card-green'}
          />
          <StatCard icon={ArrowLeftRight} label={labels.todayTransaction} value={statValues.todayTransactions} iconColor="text-emerald-400" className="stat-card-blue" />
          <StatCard icon={IndianRupee} label={labels.stockValue} value={statValues.stockValue} iconColor="text-emerald-600" className="stat-card-purple" />
        </div>

        {/* Today's Profit Card */}
        <button
          onClick={() => navigateToTab('profit')}
          className="glass-card w-full p-4 mb-6 flex items-center justify-between"
          style={{
            background: 'linear-gradient(135deg, rgba(74, 222, 128, 0.06), rgba(212, 168, 83, 0.04))',
            border: '1px solid rgba(74, 222, 128, 0.15)',
          }}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-500/15 flex items-center justify-center">
              <TrendingUp size={20} className="text-green-400" />
            </div>
            <div className="text-left">
              <p className="text-xs text-white/60">
                {language === 'bn' ? "আজকের প্রফিট" : language === 'hi' ? "आज का लाभ" : "Today's Profit"}
              </p>
              <p className="text-lg font-bold text-green-400">
                ₹{todayProfit.toLocaleString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-emerald-400/60">
            <span className="text-xs">
              {language === 'bn' ? 'বিস্তারিত' : language === 'hi' ? 'विवरण' : 'Details'}
            </span>
            <ChevronRight size={16} />
          </div>
        </button>

        {/* Low stock alert */}
        {lowStockProducts.length > 0 && (
          <div
            className="glass-card p-4 mb-6 border-orange-500/30"
            onClick={() => navigateToTab('product-list')}
            role="button"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
                <AlertTriangle size={20} className="text-orange-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-orange-400">{labels.lowStockAlert}</p>
                <p className="text-xs text-white/60">
                  {lowStockProducts.length} {labels.lowStockMsg}
                </p>
              </div>
              <ChevronRight size={18} className="text-white/40" />
            </div>
          </div>
        )}

        {/* Categories section */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">{labels.categories}</h2>
            <button
              onClick={() => navigateTo('add-category')}
              className="neon-btn px-3 py-1.5 text-xs font-semibold"
            >
              + {labels.addCategory}
            </button>
          </div>

          {categories.length > 0 ? (
            <motion.div
              className="grid grid-cols-3 gap-3"
              variants={categoryContainerVariants}
              initial="hidden"
              animate="show"
            >
              {categories.map((cat, idx) => (
                <CategoryCard
                  key={cat.id}
                  cat={cat}
                  defaultCat={defaultCatMap.get(cat.name)}
                  onTap={() => handleCategoryTap(cat)}
                  index={idx}
                />
              ))}
            </motion.div>
          ) : (
            <motion.div
              className="grid grid-cols-3 gap-3"
              variants={categoryContainerVariants}
              initial="hidden"
              animate="show"
            >
              {defaultCategories.map((cat, idx) => (
                <motion.div
                  key={cat.name}
                  variants={categoryItemVariants}
                  whileHover={{ scale: 1.06, y: -2 }}
                  whileTap={{ scale: 0.95 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                >
                  <div
                    onClick={() => navigateTo('add-category')}
                    className="glass-card category-card p-3 flex flex-col items-center gap-2 cursor-pointer"
                  >
                    <div className="category-img-wrapper w-14 h-14 bg-white/5 flex items-center justify-center">
                      {cat.image ? (
                        <>
                          <img src={cat.image} alt={cat.name} className="w-full h-full object-cover category-img-zoom" loading="lazy" />
                          <div className="category-img-overlay" />
                        </>
                      ) : (
                        <span className="text-2xl category-emoji-bounce">{cat.emoji}</span>
                      )}
                    </div>
                    <span className="text-[11px] font-medium text-white/90 truncate w-full text-center leading-tight">
                      {cat.name}
                    </span>
                    <span className="text-[10px] text-emerald-400/70 font-medium">0 items</span>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>

        {/* Services Section */}
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-4">
            <Wrench size={18} className="text-emerald-400" />
            <h2 className="text-lg font-bold">Services</h2>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <motion.button
              whileHover={{ scale: 1.03, y: -2 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              onClick={() => {
                setSelectedServiceCategory('repairing');
                navigateTo('service-category');
              }}
              className="glass-card p-4 flex flex-col items-center gap-3"
              style={{
                background: 'linear-gradient(135deg, rgba(212,168,83,0.08), rgba(180,140,60,0.04))',
                border: '1px solid rgba(212,168,83,0.2)',
              }}
            >
              <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
                <span className="text-2xl">🔧</span>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-white/90">Repairing</p>
                <p className="text-[10px] text-white/40">Track repair income & expenses</p>
              </div>
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.03, y: -2 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              onClick={() => {
                setSelectedServiceCategory('withdraw-deposit');
                navigateTo('service-category');
              }}
              className="glass-card p-4 flex flex-col items-center gap-3"
              style={{
                background: 'linear-gradient(135deg, rgba(74,222,128,0.08), rgba(34,197,94,0.04))',
                border: '1px solid rgba(74,222,128,0.2)',
              }}
            >
              <div className="w-14 h-14 rounded-full bg-green-500/15 flex items-center justify-center">
                <span className="text-2xl">💰</span>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-white/90">Withdraw/Deposit</p>
                <p className="text-[10px] text-white/40">Manage deposits & withdrawals</p>
              </div>
            </motion.button>
          </div>
        </div>

        {/* Sale Overview Section */}
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={18} className="text-emerald-400" />
            <h2 className="text-lg font-bold">Sale Overview</h2>
          </div>

          <div className="glass-card-strong p-4">
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="rounded-xl p-3" style={{ background: 'linear-gradient(135deg, rgba(212,168,83,0.12), rgba(180,140,60,0.05))', border: '1px solid rgba(212,168,83,0.2)' }}>
                <p className="text-[10px] text-white/50 mb-1">7-Day Sales</p>
                <p className="text-lg font-bold text-emerald-400">₹{totalSaleAmount.toLocaleString()}</p>
              </div>
              <div className="rounded-xl p-3" style={{ background: 'linear-gradient(135deg, rgba(160,124,62,0.12), rgba(140,105,50,0.05))', border: '1px solid rgba(160,124,62,0.2)' }}>
                <p className="text-[10px] text-white/50 mb-1">Items Sold</p>
                <p className="text-lg font-bold text-emerald-600">{totalSoldItems}</p>
              </div>
            </div>

            {saleOverview.length > 0 ? (
              <LazyBarChart data={saleOverview} config={saleChartConfig} />
            ) : (
              <div className="h-[120px] flex items-center justify-center">
                <p className="text-xs text-white/30">No sales data yet</p>
              </div>
            )}
          </div>
        </div>

        {/* Stock Overview Section */}
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={18} className="text-green-400" />
            <h2 className="text-lg font-bold">Stock Overview</h2>
          </div>

          <div className="glass-card-strong p-4">
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="rounded-xl p-3" style={{ background: 'linear-gradient(135deg, rgba(245,222,179,0.12), rgba(200,160,80,0.05))', border: '1px solid rgba(245,222,179,0.2)' }}>
                <p className="text-[10px] text-white/50 mb-1">Total Stock</p>
                <p className="text-lg font-bold text-green-400">{totalStockQty.toLocaleString()} pcs</p>
              </div>
              <div className="rounded-xl p-3" style={{ background: 'linear-gradient(135deg, rgba(212,168,83,0.12), rgba(34,90,75,0.05))', border: '1px solid rgba(212,168,83,0.2)' }}>
                <p className="text-[10px] text-white/50 mb-1">Stock Value</p>
                <p className="text-lg font-bold text-emerald-400">₹{totalStockVal.toLocaleString()}</p>
              </div>
            </div>

            {stockOverview.length > 0 ? (
              <>
                <LazyPieChart data={stockOverview} colors={PIE_COLORS} />

                {/* Legend */}
                <div className="mt-3 max-h-36 overflow-y-auto space-y-1.5">
                  {stockOverview.map((item, index) => (
                    <div key={item.category} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                        />
                        <span className="text-white/70 truncate max-w-[120px]">{item.category}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-white/50">{item.quantity} pcs</span>
                        <span className="text-emerald-400/70 font-medium">₹{item.value.toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-[120px] flex items-center justify-center">
                <p className="text-xs text-white/30">No stock data yet</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Chart configs - outside component to avoid recreation
const saleChartConfig = {
  sales: { label: 'Sales (₹)', color: '#D4A853' },
  quantity: { label: 'Items Sold', color: '#A07C3E' },
};

type ChartConfig = Record<string, { label: string; color: string }>;
