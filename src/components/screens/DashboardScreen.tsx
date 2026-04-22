'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { getDashboard } from '@/lib/supabase-service';
import { DashboardStats, Category, Product } from '@/lib/types';
import { motion } from 'framer-motion';
import { Search, Plus, Package, AlertTriangle, ArrowLeftRight, IndianRupee, User, ChevronRight, TrendingUp, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
import { Bar, BarChart, XAxis, YAxis, CartesianGrid, Cell, Pie, PieChart as RechartsPieChart, ResponsiveContainer } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

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

const saleChartConfig: ChartConfig = {
  sales: {
    label: 'Sales (₹)',
    color: '#D4A853',
  },
  quantity: {
    label: 'Items Sold',
    color: '#A07C3E',
  },
};

const stockChartConfig: ChartConfig = {
  quantity: {
    label: 'Stock Qty',
    color: '#F5DEB3',
  },
  value: {
    label: 'Value (₹)',
    color: '#D4A853',
  },
};

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

export default function DashboardScreen() {
  const {
    user, language, shopName, navigateTo,
    setSelectedCategoryId, setSearchQuery, searchQuery,
    categories, setCategories,
  } = useAppStore();

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [lowStockProducts, setLowStockProducts] = useState<Product[]>([]);
  const [saleOverview, setSaleOverview] = useState<SaleOverviewItem[]>([]);
  const [stockOverview, setStockOverview] = useState<StockOverviewItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const data = await getDashboard(user.id);
      setStats(data.stats);
      setLowStockProducts(data.lowStockProducts || []);
      setSaleOverview(data.saleOverview || []);
      setStockOverview(data.stockOverview || []);
      if (data.categories?.length > 0) {
        setCategories(data.categories);
      }
    } catch {
      toast.error(t('error', language));
    } finally {
      setLoading(false);
    }
  }, [user?.id, language, setCategories]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const handleCategoryTap = (cat: Category) => {
    setSelectedCategoryId(cat.id);
    navigateTo('category-detail');
  };

  const handleSearch = (value: string) => {
    setSearchQuery(value);
  };

  const handleSearchSubmit = () => {
    if (searchQuery.trim()) {
      navigateTo('product-list');
    }
  };

  const displayCategories = categories.length > 0 ? categories : [];

  const totalSaleAmount = saleOverview.reduce((sum, d) => sum + d.sales, 0);
  const totalSoldItems = saleOverview.reduce((sum, d) => sum + d.quantity, 0);
  const totalStockQty = stockOverview.reduce((sum, d) => sum + d.quantity, 0);
  const totalStockVal = stockOverview.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-6"
        >
          <button
            onClick={() => navigateTo('profile')}
            className="p-2 rounded-full glass-card"
            aria-label="Profile"
          >
            <User size={20} className="text-emerald-400" />
          </button>
          <h1 className="text-xl font-bold neon-glow">{shopName}</h1>
          <button
            onClick={() => navigateTo('add-product')}
            className="p-2 rounded-full glass-card"
            aria-label="Add Product"
          >
            <Plus size={20} className="text-emerald-400" />
          </button>
        </motion.div>

        {/* Search bar */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="relative mb-6"
        >
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearchSubmit()}
            placeholder={t('searchProducts', language)}
            className="glass-input w-full pl-11 pr-4 py-3 text-sm"
          />
        </motion.div>

        {/* Stats section */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-2 gap-3 mb-6"
        >
          <div className="stat-card-green rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Package size={16} className="text-green-400" />
              <span className="text-xs text-white/60">{t('totalItems', language)}</span>
            </div>
            <p className="text-2xl font-bold text-green-400">
              {loading ? '...' : (stats?.totalItems ?? 0)}
            </p>
          </div>
          <div className={`rounded-2xl p-4 ${(stats?.lowItems ?? 0) > 0 ? 'stat-card-orange' : 'stat-card-green'}`}>
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle size={16} className={(stats?.lowItems ?? 0) > 0 ? 'text-orange-400' : 'text-green-400'} />
              <span className="text-xs text-white/60">{t('lowItems', language)}</span>
            </div>
            <p className={`text-2xl font-bold ${(stats?.lowItems ?? 0) > 0 ? 'text-orange-400' : 'text-green-400'}`}>
              {loading ? '...' : (stats?.lowItems ?? 0)}
            </p>
          </div>
          <div className="stat-card-blue rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <ArrowLeftRight size={16} className="text-emerald-400" />
              <span className="text-xs text-white/60">{t('todayTransaction', language)}</span>
            </div>
            <p className="text-2xl font-bold text-emerald-400">
              {loading ? '...' : (stats?.todayTransactions ?? 0)}
            </p>
          </div>
          <div className="stat-card-purple rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <IndianRupee size={16} className="text-emerald-600" />
              <span className="text-xs text-white/60">{t('stockValue', language)}</span>
            </div>
            <p className="text-2xl font-bold text-emerald-600">
              {loading ? '...' : `₹${(stats?.stockValue ?? 0).toLocaleString()}`}
            </p>
          </div>
        </motion.div>

        {/* Low stock alert */}
        {lowStockProducts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
            className="glass-card p-4 mb-6 border-orange-500/30"
            onClick={() => navigateTo('product-list')}
            role="button"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
                <AlertTriangle size={20} className="text-orange-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-orange-400">{t('lowStockAlert', language)}</p>
                <p className="text-xs text-white/60">
                  {lowStockProducts.length} {t('lowStockMsg', language).toLowerCase()}
                </p>
              </div>
              <ChevronRight size={18} className="text-white/40" />
            </div>
          </motion.div>
        )}

        {/* Categories section */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">{t('categories', language)}</h2>
            <button
              onClick={() => navigateTo('add-category')}
              className="neon-btn px-3 py-1.5 text-xs font-semibold"
            >
              + {t('addCategory', language)}
            </button>
          </div>

          {displayCategories.length > 0 ? (
            <div className="grid grid-cols-3 gap-3">
              {displayCategories.map((cat, idx) => {
                const defaultCat = defaultCategories.find(dc => dc.name === cat.name);
                const imgSrc = cat.image?.startsWith('/categories/') ? cat.image : (defaultCat?.image || '');
                return (
                  <motion.button
                    key={cat.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: Math.min(0.03 * idx, 0.5) }}
                    onClick={() => handleCategoryTap(cat)}
                    className="glass-card glass-shine category-card p-3 flex flex-col items-center gap-2"
                  >
                    <div className="category-img-wrapper w-14 h-14 bg-white/5 flex items-center justify-center">
                      {imgSrc ? (
                        <>
                          <img src={imgSrc} alt={cat.name} className="w-full h-full object-cover" />
                          <div className="category-img-overlay" />
                        </>
                      ) : (
                        <span className="text-2xl">{cat.image || '📦'}</span>
                      )}
                    </div>
                    <span className="text-[11px] font-medium text-white/90 truncate w-full text-center leading-tight">
                      {cat.name}
                    </span>
                    <span className="text-[10px] text-emerald-400/70 font-medium">
                      {cat._count?.products ?? 0} items
                    </span>
                  </motion.button>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {defaultCategories.map((cat, idx) => (
                <motion.div
                  key={cat.name}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: Math.min(0.03 * idx, 0.5) }}
                  onClick={() => {
                    navigateTo('add-category');
                  }}
                  className="glass-card glass-shine category-card p-3 flex flex-col items-center gap-2 cursor-pointer"
                >
                  <div className="category-img-wrapper w-14 h-14 bg-white/5 flex items-center justify-center">
                    {cat.image ? (
                      <>
                        <img src={cat.image} alt={cat.name} className="w-full h-full object-cover" />
                        <div className="category-img-overlay" />
                      </>
                    ) : (
                      <span className="text-2xl">{cat.emoji}</span>
                    )}
                  </div>
                  <span className="text-[11px] font-medium text-white/90 truncate w-full text-center leading-tight">
                    {cat.name}
                  </span>
                  <span className="text-[10px] text-emerald-400/70 font-medium">0 items</span>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Sale Overview Section */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mt-8"
        >
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={18} className="text-emerald-400" />
            <h2 className="text-lg font-bold">Sale Overview</h2>
          </div>

          <div className="glass-card-strong p-4">
            {/* Summary stats */}
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

            {/* Bar chart */}
            {saleOverview.length > 0 ? (
              <ChartContainer config={saleChartConfig} className="h-[180px] w-full">
                <BarChart data={saleOverview} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
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
                  <ChartTooltip
                    content={<ChartTooltipContent />}
                  />
                  <Bar
                    dataKey="sales"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  >
                    {saleOverview.map((_entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={index === saleOverview.length - 1 ? '#D4A853' : 'rgba(212,168,83,0.4)'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="h-[120px] flex items-center justify-center">
                <p className="text-xs text-white/30">No sales data yet</p>
              </div>
            )}
          </div>
        </motion.div>

        {/* Stock Overview Section */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mt-6"
        >
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={18} className="text-green-400" />
            <h2 className="text-lg font-bold">Stock Overview</h2>
          </div>

          <div className="glass-card-strong p-4">
            {/* Summary stats */}
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

            {/* Pie chart for stock distribution */}
            {stockOverview.length > 0 ? (
              <>
                <ChartContainer config={stockChartConfig} className="h-[200px] w-full">
                  <RechartsPieChart>
                    <ChartTooltip
                      content={<ChartTooltipContent />}
                    />
                    <Pie
                      data={stockOverview}
                      dataKey="quantity"
                      nameKey="category"
                      cx="50%"
                      cy="50%"
                      outerRadius={75}
                      innerRadius={40}
                      strokeWidth={2}
                      stroke="rgba(10,10,30,0.8)"
                    >
                      {stockOverview.map((_entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={PIE_COLORS[index % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                  </RechartsPieChart>
                </ChartContainer>

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
        </motion.div>
      </div>
    </div>
  );
}
