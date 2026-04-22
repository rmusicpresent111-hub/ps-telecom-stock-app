'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { TrendingUp, IndianRupee, BarChart3, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { getReportsOffline } from '@/lib/offline-service';
import dynamic from 'next/dynamic';

// Lazy load recharts - heavy library (~200KB)
const LazyAreaChart = dynamic(
  () => import('recharts').then(mod => {
    const { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } = mod;
    return function AreaChartComponent({ data }: { data: { name: string; profit: number; revenue: number; cost: number }[] }) {
      return (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#F5DEB3" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#F5DEB3" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#D4A853" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#D4A853" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
            <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
            <Tooltip
              contentStyle={{
                background: 'rgba(10, 10, 26, 0.9)',
                border: '1px solid rgba(212, 168, 83, 0.2)',
                borderRadius: '8px',
                fontSize: '12px',
              }}
            />
            <Area type="monotone" dataKey="revenue" stroke="#D4A853" fill="url(#revenueGradient)" strokeWidth={2} />
            <Area type="monotone" dataKey="profit" stroke="#F5DEB3" fill="url(#profitGradient)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      );
    };
  }),
  { ssr: false, loading: () => <div className="h-48 flex items-center justify-center"><div className="w-6 h-6 border-2 border-[#D4A853]/30 border-t-[#D4A853] rounded-full animate-spin" /></div> }
);

interface DailyData {
  date: string;
  revenue: number;
  cost: number;
  profit: number;
}

interface MonthlyData {
  month: string;
  revenue: number;
  cost: number;
  profit: number;
}

export default function ProfitScreen() {
  const user = useAppStore(s => s.user);
  const language = useAppStore(s => s.language);
  const [tab, setTab] = useState<'daily' | 'monthly'>('daily');
  const [dailyData, setDailyData] = useState<DailyData[]>([]);
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const [dailyReport, monthlyReport] = await Promise.all([
        getReportsOffline(user.id, 'daily'),
        getReportsOffline(user.id, 'monthly'),
      ]);
      setDailyData((dailyReport.data || []) as DailyData[]);
      setMonthlyData((monthlyReport.data || []) as MonthlyData[]);
    } catch {
      toast.error(t('error', language));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const currentData = tab === 'daily' ? dailyData : monthlyData;
  const totalProfit = useMemo(() => currentData.reduce((sum, d) => sum + d.profit, 0), [currentData]);
  const totalRevenue = useMemo(() => currentData.reduce((sum, d) => sum + d.revenue, 0), [currentData]);
  const totalCost = useMemo(() => currentData.reduce((sum, d) => sum + d.cost, 0), [currentData]);

  const chartData = useMemo(() => currentData.map((d) => ({
    name: tab === 'daily' ? (d as DailyData).date?.substring(5) : (d as MonthlyData).month?.substring(5),
    profit: d.profit,
    revenue: d.revenue,
    cost: d.cost,
  })), [currentData, tab]);

  return (
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <div className="flex items-center justify-center mb-6">
          <div className="flex items-center gap-2">
            <TrendingUp size={24} className="text-emerald-400" />
            <h1 className="text-lg font-bold neon-glow">{t('profit', language)}</h1>
          </div>
        </div>

        {/* Tab toggle */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setTab('daily')}
            className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${
              tab === 'daily' ? 'neon-btn-solid' : 'glass-card text-white/60'
            }`}
          >
            {t('daily', language)}
          </button>
          <button
            onClick={() => setTab('monthly')}
            className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${
              tab === 'monthly' ? 'neon-btn-solid' : 'glass-card text-white/60'
            }`}
          >
            {t('monthly', language)}
          </button>
        </div>

        {/* Total profit card */}
        <div className="glass-card-strong p-6 mb-6 text-center neon-border-glow">
          <p className="text-xs text-white/60 mb-1">{t('totalProfit', language)}</p>
          <p className={`text-3xl font-bold neon-glow ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            ₹{totalProfit.toLocaleString()}
          </p>
        </div>

        {/* Chart */}
        <div className="glass-card p-4 mb-6">
          {loading ? (
            <div className="h-48 flex items-center justify-center text-white/40">
              {t('loading', language)}
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-white/40">
              {t('noData', language)}
            </div>
          ) : (
            <LazyAreaChart data={chartData} />
          )}
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="stat-card-blue rounded-2xl p-4 text-center">
            <BarChart3 size={16} className="text-emerald-400 mx-auto mb-1" />
            <p className="text-xs text-white/60">{t('revenue', language)}</p>
            <p className="text-sm font-bold text-emerald-400">₹{totalRevenue.toLocaleString()}</p>
          </div>
          <div className="stat-card-orange rounded-2xl p-4 text-center">
            <Wallet size={16} className="text-orange-400 mx-auto mb-1" />
            <p className="text-xs text-white/60">{t('cost', language)}</p>
            <p className="text-sm font-bold text-orange-400">₹{totalCost.toLocaleString()}</p>
          </div>
          <div className="stat-card-green rounded-2xl p-4 text-center">
            <IndianRupee size={16} className="text-green-400 mx-auto mb-1" />
            <p className="text-xs text-white/60">{t('profit', language)}</p>
            <p className={`text-sm font-bold ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              ₹{totalProfit.toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
