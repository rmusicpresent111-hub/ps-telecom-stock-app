'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Product, Transaction, ServiceTransaction } from '@/lib/types';
import { TrendingUp, Calendar, ChevronDown, Package, IndianRupee, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { toast } from 'sonner';
import { getTransactionsOffline, getProductsOffline, getServiceTransactionsOffline, localDateStr } from '@/lib/offline-service';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';

// Lazy load recharts
const LazyBarChart = dynamic(
  () => import('recharts').then(mod => {
    const { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } = mod;
    return function ProfitBarChartComponent({ data }: { data: { name: string; profit: number; revenue: number }[] }) {
      return (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} tickFormatter={(val: number) => `₹${val >= 1000 ? `${(val/1000).toFixed(0)}k` : val}`} />
            <Tooltip
              contentStyle={{
                background: 'rgba(10, 10, 26, 0.95)',
                border: '1px solid rgba(212, 168, 83, 0.3)',
                borderRadius: '10px',
                fontSize: '12px',
              }}
              formatter={(value: number, name: string) => [`₹${value.toLocaleString()}`, name === 'profit' ? 'Profit' : 'Revenue']}
            />
            <Bar dataKey="revenue" radius={[4, 4, 0, 0]} maxBarSize={20} fill="rgba(212,168,83,0.3)" />
            <Bar dataKey="profit" radius={[4, 4, 0, 0]} maxBarSize={20}>
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.profit >= 0 ? '#4ade80' : '#f87171'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      );
    };
  }),
  { ssr: false, loading: () => <div className="h-[220px] flex items-center justify-center"><div className="w-6 h-6 border-2 border-[#D4A853]/30 border-t-[#D4A853] rounded-full animate-spin" /></div> }
);

// Product-wise profit detail
interface ProductProfit {
  productId: string;
  productName: string;
  quantitySold: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number; // percentage
}

// Date range preset
type DatePreset = 'today' | 'yesterday' | '7days' | '30days' | 'thisMonth' | 'custom';

const presetLabels: Record<DatePreset, { en: string; bn: string; hi: string }> = {
  today: { en: 'Today', bn: 'আজ', hi: 'आज' },
  yesterday: { en: 'Yesterday', bn: 'গতকাল', hi: 'कल' },
  '7days': { en: '7 Days', bn: '৭ দিন', hi: '7 दिन' },
  '30days': { en: '30 Days', bn: '৩০ দিন', hi: '30 दिन' },
  thisMonth: { en: 'This Month', bn: 'এই মাস', hi: 'इस महीने' },
  custom: { en: 'Custom', bn: 'কাস্টম', hi: 'कस्टम' },
};

function getDateRange(preset: DatePreset, customFrom?: string, customTo?: string): { from: string; to: string } {
  const today = localDateStr();
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const yStr = localDateStr(y);
      return { from: yStr, to: yStr };
    }
    case '7days': {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      return { from: localDateStr(d), to: today };
    }
    case '30days': {
      const d = new Date();
      d.setDate(d.getDate() - 29);
      return { from: localDateStr(d), to: today };
    }
    case 'thisMonth': {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: localDateStr(firstDay), to: today };
    }
    case 'custom': {
      // Guard against inverted custom ranges (from > to) — swap instead of silently showing nothing.
      const from = customFrom || today;
      const to = customTo || today;
      return from <= to ? { from, to } : { from: to, to: from };
    }
    default:
      return { from: today, to: today };
  }
}

export default function ProfitScreen() {
  const user = useAppStore(s => s.user);
  const language = useAppStore(s => s.language);

  const [preset, setPreset] = useState<DatePreset>('today');
  const [customFrom, setCustomFrom] = useState(localDateStr());
  const [customTo, setCustomTo] = useState(localDateStr());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [serviceTransactions, setServiceTransactions] = useState<ServiceTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllProducts, setShowAllProducts] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const [txns, prods, svcTxns] = await Promise.all([
        getTransactionsOffline(user.id),
        getProductsOffline(user.id),
        getServiceTransactionsOffline(user.id),
      ]);
      setTransactions(txns || []);
      setProducts(prods || []);
      setServiceTransactions(svcTxns || []);
    } catch {
      toast.error(t('error', language));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Date range
  const dateRange = useMemo(() => getDateRange(preset, customFrom, customTo), [preset, customFrom, customTo]);

  // Filter SELL transactions within date range
  const sellTransactions = useMemo(() => {
    return transactions.filter(t =>
      t.type === 'SELL' &&
      t.date >= dateRange.from &&
      t.date <= dateRange.to
    );
  }, [transactions, dateRange]);

  // Product map for quick lookup
  const productMap = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products) {
      map.set(p.id, p);
    }
    return map;
  }, [products]);

  // Cost basis uses the SNAPSHOT captured on the transaction at sale time —
  // editing a product's purchase price today must never rewrite historical profit.
  const costOf = useCallback((t: Transaction): number => {
    const snapshot = t.product?.purchasePrice;
    const current = productMap.get(t.productId)?.purchasePrice;
    return (t.quantity || 0) * (snapshot ?? current ?? 0);
  }, [productMap]);

  // Product-only profit (Revenue − Cost) — consistent with the stat cards below.
  const productProfit = useMemo(() => {
    let profit = 0;
    for (const t of sellTransactions) {
      profit += (t.totalAmount || 0) - costOf(t);
    }
    return profit;
  }, [sellTransactions, costOf]);

  // Calculate total profit for the selected period (product profit + net service income)
  const totalProfit = useMemo(() => {
    let profit = productProfit;
    // Add service income and subtract service expense
    const filteredServiceTxns = serviceTransactions.filter(
      s => s.date >= dateRange.from && s.date <= dateRange.to
    );
    for (const s of filteredServiceTxns) {
      if (s.transactionType === 'income') {
        profit += s.amount || 0;
      } else {
        profit -= s.amount || 0;
      }
    }
    return profit;
  }, [productProfit, serviceTransactions, dateRange]);

  const totalRevenue = useMemo(() => {
    return sellTransactions.reduce((sum, t) => sum + (t.totalAmount || 0), 0);
  }, [sellTransactions]);

  const totalCost = useMemo(() => {
    let cost = 0;
    for (const t of sellTransactions) {
      cost += costOf(t);
    }
    return cost;
  }, [sellTransactions, costOf]);

  const totalItemsSold = useMemo(() => {
    return sellTransactions.reduce((sum, t) => sum + (t.quantity || 0), 0);
  }, [sellTransactions]);

  // Product-wise profit breakdown
  const productProfits = useMemo(() => {
    const map = new Map<string, ProductProfit>();

    for (const t of sellTransactions) {
      const product = productMap.get(t.productId);
      // Deleted products still count — their sale-time snapshot (t.product) keeps
      // totals consistent with the breakdown.
      const name = product?.name ?? t.product?.name ?? 'Unknown';

      const existing = map.get(t.productId) || {
        productId: t.productId,
        productName: name,
        quantitySold: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
        margin: 0,
      };

      const saleRevenue = t.totalAmount || 0;
      const saleCost = (t.quantity || 0) * (t.product?.purchasePrice ?? product?.purchasePrice ?? 0);

      existing.quantitySold += t.quantity || 0;
      existing.revenue += saleRevenue;
      existing.cost += saleCost;
      existing.profit += saleRevenue - saleCost;
      existing.margin = existing.revenue > 0 ? Math.round((existing.profit / existing.revenue) * 100) : 0;

      map.set(t.productId, existing);
    }

    // Sort by profit descending
    return Array.from(map.values()).sort((a, b) => b.profit - a.profit);
  }, [sellTransactions, productMap]);

  // Chart data - daily profit breakdown for the selected period
  const chartData = useMemo(() => {
    const dailyMap = new Map<string, { name: string; profit: number; revenue: number }>();

    // Fill all dates in range (local dates — never UTC)
    const [sy, sm, sd] = dateRange.from.split('-').map(Number);
    const [ey, em, ed] = dateRange.to.split('-').map(Number);
    const start = new Date(sy, (sm || 1) - 1, sd || 1);
    const end = new Date(ey, (em || 1) - 1, ed || 1);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = localDateStr(d);
      const dayLabel = d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
      dailyMap.set(dateStr, { name: dayLabel, profit: 0, revenue: 0 });
    }

    for (const t of sellTransactions) {
      const existing = dailyMap.get(t.date);
      if (existing) {
        const cost = (t.quantity || 0) * (t.product?.purchasePrice ?? productMap.get(t.productId)?.purchasePrice ?? 0);
        existing.revenue += t.totalAmount || 0;
        existing.profit += (t.totalAmount || 0) - cost;
      }
    }

    return Array.from(dailyMap.values());
  }, [sellTransactions, dateRange, productMap]);

  // Display products - show top 5 by default, expandable
  const displayedProducts = useMemo(() => {
    return showAllProducts ? productProfits : productProfits.slice(0, 5);
  }, [productProfits, showAllProducts]);

  // Margin based on PRODUCT profit vs product revenue (service income would
  // otherwise push margin above 100%).
  const profitMargin = totalRevenue > 0 ? Math.round((productProfit / totalRevenue) * 100) : 0;

  return (
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <TrendingUp size={24} className="text-emerald-400" />
            <h1 className="text-lg font-bold neon-glow">{t('profit', language)}</h1>
          </div>
        </div>

        {/* Date Selector */}
        <div className="mb-6">
          <button
            onClick={() => setShowDatePicker(!showDatePicker)}
            className="glass-card w-full p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <Calendar size={18} className="text-emerald-400" />
              <div className="text-left">
                <p className="text-sm font-semibold">
                  {preset === 'custom'
                    ? `${dateRange.from} → ${dateRange.to}`
                    : presetLabels[preset]?.[language === 'bn' ? 'bn' : language === 'hi' ? 'hi' : 'en']
                  }
                </p>
                <p className="text-[10px] text-white/40">
                  {dateRange.from === dateRange.to
                    ? dateRange.from
                    : `${dateRange.from} — ${dateRange.to}`
                  }
                </p>
              </div>
            </div>
            <ChevronDown size={18} className={`text-white/40 transition-transform ${showDatePicker ? 'rotate-180' : ''}`} />
          </button>

          <AnimatePresence>
            {showDatePicker && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="glass-card mt-2 p-4 space-y-3">
                  {/* Preset buttons */}
                  <div className="grid grid-cols-3 gap-2">
                    {(Object.keys(presetLabels) as DatePreset[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => {
                          setPreset(p);
                          if (p !== 'custom') setShowDatePicker(false);
                        }}
                        className={`py-2 text-xs font-semibold rounded-xl transition-all ${
                          preset === p
                            ? 'neon-btn-solid'
                            : 'glass-card text-white/60 hover:text-white/80'
                        }`}
                      >
                        {presetLabels[p][language === 'bn' ? 'bn' : language === 'hi' ? 'hi' : 'en']}
                      </button>
                    ))}
                  </div>

                  {/* Custom date inputs */}
                  {preset === 'custom' && (
                    <div className="space-y-3 pt-2">
                      <div>
                        <label className="text-xs text-white/60 mb-1 block">
                          {language === 'bn' ? 'থেকে' : language === 'hi' ? 'से' : 'From'}
                        </label>
                        <input
                          type="date"
                          value={customFrom}
                          onChange={(e) => setCustomFrom(e.target.value)}
                          className="glass-input w-full px-4 py-2.5 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-white/60 mb-1 block">
                          {language === 'bn' ? 'পর্যন্ত' : language === 'hi' ? 'तक' : 'To'}
                        </label>
                        <input
                          type="date"
                          value={customTo}
                          onChange={(e) => setCustomTo(e.target.value)}
                          className="glass-input w-full px-4 py-2.5 text-sm"
                        />
                      </div>
                      <button
                        onClick={() => setShowDatePicker(false)}
                        className="neon-btn-solid w-full py-2.5 text-sm font-semibold"
                      >
                        {language === 'bn' ? 'প্রয়োগ করুন' : language === 'hi' ? 'लागू करें' : 'Apply'}
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Total Profit Card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card-strong p-6 mb-6 text-center"
          style={{
            background: totalProfit >= 0
              ? 'linear-gradient(135deg, rgba(74, 222, 128, 0.08), rgba(212, 168, 83, 0.05))'
              : 'linear-gradient(135deg, rgba(248, 113, 113, 0.08), rgba(212, 168, 83, 0.05))',
            border: `1px solid ${totalProfit >= 0 ? 'rgba(74, 222, 128, 0.2)' : 'rgba(248, 113, 113, 0.2)'}`,
          }}
        >
          <p className="text-xs text-white/60 mb-1">
            {preset === 'today'
              ? (language === 'bn' ? 'আজকের প্রফিট' : language === 'hi' ? 'आज का लाभ' : "Today's Profit")
              : (language === 'bn' ? 'মোট প্রফিট' : language === 'hi' ? 'कुल लाभ' : 'Total Profit')
            }
          </p>
          <p className={`text-4xl font-bold ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            ₹{totalProfit.toLocaleString()}
          </p>
          <div className="flex items-center justify-center gap-4 mt-2">
            <span className="text-xs text-white/50">
              {language === 'bn' ? 'মার্জিন' : language === 'hi' ? 'मार्जिन' : 'Margin'}: <span className={profitMargin >= 0 ? 'text-green-400' : 'text-red-400'}>{profitMargin}%</span>
            </span>
            <span className="text-xs text-white/50">
              {language === 'bn' ? 'বিক্রি' : language === 'hi' ? 'बिक्री' : 'Sold'}: <span className="text-white/70">{totalItemsSold} pcs</span>
            </span>
          </div>
        </motion.div>

        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="stat-card-green rounded-2xl p-4 text-center">
            <IndianRupee size={16} className="text-emerald-400 mx-auto mb-1" />
            <p className="text-[10px] text-white/50">{language === 'bn' ? 'আয়' : language === 'hi' ? 'आय' : 'Revenue'}</p>
            <p className="text-sm font-bold text-emerald-400">₹{totalRevenue.toLocaleString()}</p>
          </div>
          <div className="stat-card-orange rounded-2xl p-4 text-center">
            <Package size={16} className="text-orange-400 mx-auto mb-1" />
            <p className="text-[10px] text-white/50">{language === 'bn' ? 'খরচ' : language === 'hi' ? 'लागत' : 'Cost'}</p>
            <p className="text-sm font-bold text-orange-400">₹{totalCost.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl p-4 text-center" style={{ background: totalProfit >= 0 ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)', border: `1px solid ${totalProfit >= 0 ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)'}` }}>
            <TrendingUp size={16} className={totalProfit >= 0 ? 'text-green-400 mx-auto mb-1' : 'text-red-400 mx-auto mb-1'} />
            <p className="text-[10px] text-white/50">{language === 'bn' ? 'প্রফিট' : language === 'hi' ? 'लाभ' : 'Profit'}</p>
            <p className={`text-sm font-bold ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>₹{totalProfit.toLocaleString()}</p>
          </div>
        </div>

        {/* Profit Graph */}
        <div className="glass-card p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={16} className="text-emerald-400" />
            <h2 className="text-sm font-bold">
              {language === 'bn' ? 'প্রফিট গ্রাফ' : language === 'hi' ? 'लाभ ग्राफ' : 'Profit Graph'}
            </h2>
          </div>
          {loading ? (
            <div className="h-[220px] flex items-center justify-center text-white/40">
              {t('loading', language)}
            </div>
          ) : chartData.length === 0 || chartData.every(d => d.profit === 0 && d.revenue === 0) ? (
            <div className="h-[220px] flex items-center justify-center text-white/40">
              {t('noData', language)}
            </div>
          ) : (
            <LazyBarChart data={chartData} />
          )}
        </div>

        {/* Product-wise Profit Breakdown */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Package size={16} className="text-emerald-400" />
            <h2 className="text-sm font-bold">
              {language === 'bn' ? 'প্রোডাক্ট অনুযায়ী প্রফিট' : language === 'hi' ? 'उत्पाद अनुसार लाभ' : 'Product-wise Profit'}
            </h2>
          </div>

          {loading ? (
            <div className="text-center py-8 text-white/40">{t('loading', language)}</div>
          ) : productProfits.length === 0 ? (
            <div className="glass-card p-6 text-center text-white/40">
              {t('noData', language)}
            </div>
          ) : (
            <div className="space-y-2">
              {displayedProducts.map((pp, idx) => (
                <motion.div
                  key={pp.productId}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.04 }}
                  className="glass-card p-4"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{pp.productName}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          pp.profit >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          {pp.margin}%
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-[11px] text-white/50">
                          {language === 'bn' ? 'বিক্রি' : language === 'hi' ? 'बिक्री' : 'Sold'}: {pp.quantitySold}
                        </span>
                        <span className="text-[11px] text-white/50">
                          {language === 'bn' ? 'আয়' : language === 'hi' ? 'आय' : 'Rev'}: ₹{pp.revenue.toLocaleString()}
                        </span>
                        <span className="text-[11px] text-white/50">
                          {language === 'bn' ? 'খরচ' : language === 'hi' ? 'लागत' : 'Cost'}: ₹{pp.cost.toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className="text-right flex items-center gap-1">
                      {pp.profit >= 0 ? (
                        <ArrowUpRight size={14} className="text-green-400" />
                      ) : (
                        <ArrowDownRight size={14} className="text-red-400" />
                      )}
                      <span className={`text-sm font-bold ${pp.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ₹{pp.profit.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Profit bar visual */}
                  <div className="mt-2 h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, totalProfit > 0 ? Math.abs(pp.profit / totalProfit) * 100 : 0)}%`,
                        background: pp.profit >= 0
                          ? 'linear-gradient(90deg, #4ade80, #22c55e)'
                          : 'linear-gradient(90deg, #f87171, #ef4444)',
                      }}
                    />
                  </div>
                </motion.div>
              ))}

              {/* Show more / less */}
              {productProfits.length > 5 && (
                <button
                  onClick={() => setShowAllProducts(!showAllProducts)}
                  className="w-full py-3 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  {showAllProducts
                    ? (language === 'bn' ? 'কম দেখান' : language === 'hi' ? 'कम दिखाएं' : 'Show Less')
                    : (language === 'bn' ? `আরও ${productProfits.length - 5}টি দেখুন` : language === 'hi' ? `और ${productProfits.length - 5} देखें` : `Show ${productProfits.length - 5} more`)
                  }
                </button>
              )}
            </div>
          )}
        </div>

        {/* Service Income Breakdown */}
        {!loading && serviceTransactions.length > 0 && (() => {
          const filteredSvcTxns = serviceTransactions.filter(
            s => s.date >= dateRange.from && s.date <= dateRange.to
          );
          const repairingIncome = filteredSvcTxns
            .filter(s => s.categoryType === 'repairing' && s.transactionType === 'income')
            .reduce((sum, s) => sum + (s.amount || 0), 0);
          const repairingExpense = filteredSvcTxns
            .filter(s => s.categoryType === 'repairing' && s.transactionType === 'expense')
            .reduce((sum, s) => sum + (s.amount || 0), 0);
          const wdIncome = filteredSvcTxns
            .filter(s => s.categoryType === 'withdraw-deposit' && s.transactionType === 'income')
            .reduce((sum, s) => sum + (s.amount || 0), 0);
          const wdExpense = filteredSvcTxns
            .filter(s => s.categoryType === 'withdraw-deposit' && s.transactionType === 'expense')
            .reduce((sum, s) => sum + (s.amount || 0), 0);
          const totalServiceIncome = repairingIncome + wdIncome;
          const totalServiceExpense = repairingExpense + wdExpense;

          if (totalServiceIncome === 0 && totalServiceExpense === 0) return null;

          return (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={16} className="text-emerald-400" />
                <h2 className="text-sm font-bold">
                  {language === 'bn' ? 'সার্ভিস আয়' : language === 'hi' ? 'सेवा आय' : 'Service Income'}
                </h2>
              </div>
              <div className="space-y-2">
                {/* Repairing */}
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="glass-card p-4"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">🔧 Repairing</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-[11px] text-green-400">
                          {language === 'bn' ? 'আয়' : language === 'hi' ? 'आय' : 'Income'}: ₹{repairingIncome.toLocaleString()}
                        </span>
                        <span className="text-[11px] text-orange-400">
                          {language === 'bn' ? 'খরচ' : language === 'hi' ? 'लागत' : 'Expense'}: ₹{repairingExpense.toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className="text-right flex items-center gap-1">
                      {(repairingIncome - repairingExpense) >= 0 ? (
                        <ArrowUpRight size={14} className="text-green-400" />
                      ) : (
                        <ArrowDownRight size={14} className="text-red-400" />
                      )}
                      <span className={`text-sm font-bold ${(repairingIncome - repairingExpense) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ₹{(repairingIncome - repairingExpense).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </motion.div>

                {/* Withdraw/Deposit */}
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.05 }}
                  className="glass-card p-4"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">💰 Withdraw/Deposit</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-[11px] text-green-400">
                          {language === 'bn' ? 'আয়' : language === 'hi' ? 'आय' : 'Income'}: ₹{wdIncome.toLocaleString()}
                        </span>
                        <span className="text-[11px] text-orange-400">
                          {language === 'bn' ? 'খরচ' : language === 'hi' ? 'लागत' : 'Expense'}: ₹{wdExpense.toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className="text-right flex items-center gap-1">
                      {(wdIncome - wdExpense) >= 0 ? (
                        <ArrowUpRight size={14} className="text-green-400" />
                      ) : (
                        <ArrowDownRight size={14} className="text-red-400" />
                      )}
                      <span className={`text-sm font-bold ${(wdIncome - wdExpense) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ₹{(wdIncome - wdExpense).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </motion.div>
              </div>
            </div>
          );
        })()}

        {/* Summary */}
        {!loading && productProfits.length > 0 && (
          <div className="glass-card-strong p-4 mb-6">
            <div className="grid grid-cols-2 gap-3">
              <div className="text-center">
                <p className="text-[10px] text-white/40 mb-0.5">
                  {language === 'bn' ? 'সবচেয়ে লাভজনক' : language === 'hi' ? 'सबसे लाभदायक' : 'Most Profitable'}
                </p>
                <p className="text-sm font-bold text-green-400 truncate">
                  {productProfits[0]?.productName || '-'}
                </p>
                <p className="text-xs text-green-400/70">+₹{productProfits[0]?.profit.toLocaleString() || 0}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-white/40 mb-0.5">
                  {language === 'bn' ? 'সর্বোচ্চ মার্জিন' : language === 'hi' ? 'उच्चतम मार्जिन' : 'Highest Margin'}
                </p>
                <p className="text-sm font-bold text-emerald-400 truncate">
                  {productProfits.length > 0
                    ? [...productProfits].sort((a, b) => b.margin - a.margin)[0]?.productName || '-'
                    : '-'
                  }
                </p>
                <p className="text-xs text-emerald-400/70">
                  {[...productProfits].sort((a, b) => b.margin - a.margin)[0]?.margin || 0}%
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
