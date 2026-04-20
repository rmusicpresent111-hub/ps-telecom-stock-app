'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { motion } from 'framer-motion';
import { ArrowLeft, FileText, Download } from 'lucide-react';
import { toast } from 'sonner';

type ReportTab = 'category' | 'daily' | 'monthly';

interface CategoryReport {
  categoryName: string;
  revenue: number;
  cost: number;
  profit: number;
  sell: number;
  stockIn: number;
}

interface DailyReport {
  date: string;
  revenue: number;
  cost: number;
  profit: number;
  sell: number;
  stockIn: number;
  stockOut: number;
}

interface MonthlyReport {
  month: string;
  revenue: number;
  cost: number;
  profit: number;
  sell: number;
  stockIn: number;
  stockOut: number;
}

export default function ReportsScreen() {
  const { user, language, goBack } = useAppStore();

  const [tab, setTab] = useState<ReportTab>('category');
  const [categoryData, setCategoryData] = useState<CategoryReport[]>([]);
  const [dailyData, setDailyData] = useState<DailyReport[]>([]);
  const [monthlyData, setMonthlyData] = useState<MonthlyReport[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const [catRes, dailyRes, monthlyRes] = await Promise.all([
        fetch(`/api/reports?userId=${user.id}&type=category`),
        fetch(`/api/reports?userId=${user.id}&type=daily`),
        fetch(`/api/reports?userId=${user.id}&type=monthly`),
      ]);
      if (catRes.ok) {
        const data = await catRes.json();
        setCategoryData(data.data || []);
      }
      if (dailyRes.ok) {
        const data = await dailyRes.json();
        setDailyData(data.data || []);
      }
      if (monthlyRes.ok) {
        const data = await monthlyRes.json();
        setMonthlyData(data.data || []);
      }
    } catch {
      toast.error(t('error', language));
    } finally {
      setLoading(false);
    }
  }, [user?.id, language]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getCurrentData = () => {
    switch (tab) {
      case 'category': return categoryData;
      case 'daily': return dailyData;
      case 'monthly': return monthlyData;
    }
  };

  const exportCSV = () => {
    const data = getCurrentData();
    if (data.length === 0) {
      toast.error(t('noData', language));
      return;
    }

    let csv = '';
    if (tab === 'category') {
      csv = 'Category,Revenue,Cost,Profit,Items Sold,Items Stocked In\n';
      categoryData.forEach((d) => {
        csv += `${d.categoryName},${d.revenue},${d.cost},${d.profit},${d.sell},${d.stockIn}\n`;
      });
    } else if (tab === 'daily') {
      csv = 'Date,Revenue,Cost,Profit,Items Sold,Stock In,Stock Out\n';
      dailyData.forEach((d) => {
        csv += `${d.date},${d.revenue},${d.cost},${d.profit},${d.sell},${d.stockIn},${d.stockOut}\n`;
      });
    } else {
      csv = 'Month,Revenue,Cost,Profit,Items Sold,Stock In,Stock Out\n';
      monthlyData.forEach((d) => {
        csv += `${d.month},${d.revenue},${d.cost},${d.profit},${d.sell},${d.stockIn},${d.stockOut}\n`;
      });
    }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ps-telecom-report-${tab}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('exportExcel', language) + ' ✓');
  };

  const exportJSON = () => {
    const data = getCurrentData();
    if (data.length === 0) {
      toast.error(t('noData', language));
      return;
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ps-telecom-report-${tab}-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('exportPDF', language) + ' ✓');
  };

  const tabs: { key: ReportTab; label: string }[] = [
    { key: 'category', label: t('categoryWise', language) },
    { key: 'daily', label: t('dailyReport', language) },
    { key: 'monthly', label: t('monthlyReport', language) },
  ];

  const currentData = getCurrentData();

  return (
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-6"
        >
          <button onClick={goBack} className="p-2 rounded-full glass-card" aria-label="Back">
            <ArrowLeft size={20} className="text-cyan-400" />
          </button>
          <div className="flex items-center gap-2">
            <FileText size={20} className="text-cyan-400" />
            <h1 className="text-lg font-bold">{t('reports', language)}</h1>
          </div>
          <div className="w-10" />
        </motion.div>

        {/* Tab toggle */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex gap-2 mb-6"
        >
          {tabs.map((tabItem) => (
            <button
              key={tabItem.key}
              onClick={() => setTab(tabItem.key)}
              className={`flex-1 py-2.5 text-xs font-semibold rounded-xl transition-all ${
                tab === tabItem.key
                  ? 'neon-btn-solid'
                  : 'glass-card text-white/60'
              }`}
            >
              {tabItem.label}
            </button>
          ))}
        </motion.div>

        {/* Export buttons */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="flex gap-3 mb-6"
        >
          <button onClick={exportJSON} className="flex-1 neon-btn py-2.5 text-xs font-semibold flex items-center justify-center gap-1">
            <Download size={14} />
            {t('exportPDF', language)}
          </button>
          <button onClick={exportCSV} className="flex-1 neon-btn py-2.5 text-xs font-semibold flex items-center justify-center gap-1">
            <Download size={14} />
            {t('exportExcel', language)}
          </button>
        </motion.div>

        {/* Report table */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="space-y-3 max-h-[calc(100vh-300px)] overflow-y-auto"
        >
          {loading ? (
            <div className="text-center py-8 text-white/40">{t('loading', language)}</div>
          ) : currentData.length === 0 ? (
            <div className="text-center py-12 text-white/40">{t('noData', language)}</div>
          ) : (
            currentData.map((item, idx) => {
              const name = tab === 'category'
                ? (item as CategoryReport).categoryName
                : tab === 'daily'
                  ? (item as DailyReport).date
                  : (item as MonthlyReport).month;
              const revenue = (item as Record<string, number>).revenue || 0;
              const cost = (item as Record<string, number>).cost || 0;
              const profit = (item as Record<string, number>).profit || 0;
              const sell = (item as Record<string, number>).sell || 0;

              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.03 * idx }}
                  className="glass-card p-4"
                >
                  <div className="flex items-start justify-between mb-2">
                    <p className="text-sm font-semibold">{name}</p>
                    <span className={`text-xs font-bold ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {profit >= 0 ? '+' : ''}₹{profit.toLocaleString()}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-[10px] text-white/40">{t('sale', language)}</p>
                      <p className="text-xs font-medium text-cyan-400">₹{revenue.toLocaleString()}</p>
                      <p className="text-[10px] text-white/30">{sell} units</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-white/40">{t('purchase', language)}</p>
                      <p className="text-xs font-medium text-orange-400">₹{cost.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-white/40">{t('profit', language)}</p>
                      <p className={`text-xs font-medium ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ₹{Math.abs(profit).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </motion.div>
      </div>
    </div>
  );
}
