'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { motion } from 'framer-motion';
import { ArrowLeft, FileText, Download, ChevronDown, ChevronUp, Package, IndianRupee, TrendingUp, AlertTriangle, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
import { getReports } from '@/lib/supabase-service';
import { Bar, BarChart, XAxis, YAxis, CartesianGrid, Cell } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

type ReportTab = 'stock-value' | 'category' | 'daily' | 'monthly';

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

interface StockValueProduct {
  id: string;
  name: string;
  quantity: number;
  purchasePrice: number;
  sellingPrice: number;
  stockValue: number;
  purchaseValue: number;
  lowStock: boolean;
}

interface StockValueCategory {
  categoryId: string;
  categoryName: string;
  categoryImage: string;
  productCount: number;
  totalQty: number;
  totalPurchaseValue: number;
  totalSellingValue: number;
  totalProfit: number;
  lowStockCount: number;
  products: StockValueProduct[];
}

interface GrandTotal {
  totalProducts: number;
  totalQty: number;
  totalPurchaseValue: number;
  totalSellingValue: number;
  totalProfit: number;
  totalLowStock: number;
}

const stockValueChartConfig: ChartConfig = {
  totalSellingValue: {
    label: 'Stock Value (₹)',
    color: '#00f0ff',
  },
  totalPurchaseValue: {
    label: 'Purchase Value (₹)',
    color: '#b44aff',
  },
};

const BAR_COLORS = ['#00f0ff', '#b44aff', '#39ff14', '#ff6b00', '#ff006e', '#ffd700', '#00e5ff', '#e040fb', '#76ff03', '#ff9100', '#f50057', '#ffea00', '#18ffff', '#d500f9', '#64dd17', '#ff3d00', '#c51162', '#aeea00', '#00b8d4'];

export default function ReportsScreen() {
  const { user, language, goBack } = useAppStore();

  const [tab, setTab] = useState<ReportTab>('stock-value');
  const [categoryData, setCategoryData] = useState<CategoryReport[]>([]);
  const [dailyData, setDailyData] = useState<DailyReport[]>([]);
  const [monthlyData, setMonthlyData] = useState<MonthlyReport[]>([]);
  const [stockValueData, setStockValueData] = useState<StockValueCategory[]>([]);
  const [grandTotal, setGrandTotal] = useState<GrandTotal | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const [svReport, catReport, dailyReport, monthlyReport] = await Promise.all([
        getReports(user.id, 'stock-value'),
        getReports(user.id, 'category'),
        getReports(user.id, 'daily'),
        getReports(user.id, 'monthly'),
      ]);
      setStockValueData((svReport.data || []) as StockValueCategory[]);
      setGrandTotal(svReport.grandTotal || null);
      setCategoryData((catReport.data || []) as CategoryReport[]);
      setDailyData((dailyReport.data || []) as DailyReport[]);
      setMonthlyData((monthlyReport.data || []) as MonthlyReport[]);
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
      case 'stock-value': return stockValueData;
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
    if (tab === 'stock-value') {
      csv = 'Category,Products,Quantity,Purchase Value,Selling Value,Profit,Low Stock\n';
      stockValueData.forEach((d) => {
        csv += `"${d.categoryName}",${d.productCount},${d.totalQty},${d.totalPurchaseValue},${d.totalSellingValue},${d.totalProfit},${d.lowStockCount}\n`;
      });
      if (grandTotal) {
        csv += `\nTOTAL,${grandTotal.totalProducts},${grandTotal.totalQty},${grandTotal.totalPurchaseValue},${grandTotal.totalSellingValue},${grandTotal.totalProfit},${grandTotal.totalLowStock}\n`;
      }
      // Add product details
      csv += '\n\n--- Product Details ---\n';
      csv += 'Category,Product,Quantity,Purchase Price,Selling Price,Stock Value,Low Stock\n';
      stockValueData.forEach((cat) => {
        cat.products.forEach((p) => {
          csv += `"${cat.categoryName}","${p.name}",${p.quantity},${p.purchasePrice},${p.sellingPrice},${p.stockValue},${p.lowStock ? 'Yes' : 'No'}\n`;
        });
      });
    } else if (tab === 'category') {
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
    a.download = `ps-telecom-${tab}-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV ' + t('added', language).replace(/^[^]*? /, ''));
  };

  const exportJSON = () => {
    const data = getCurrentData();
    if (data.length === 0) {
      toast.error(t('noData', language));
      return;
    }

    const exportData = tab === 'stock-value' 
      ? { stockValueData, grandTotal, exportedAt: new Date().toISOString() }
      : data;

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ps-telecom-${tab}-report-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('JSON ✓');
  };

  const toggleCategory = (catId: string) => {
    setExpandedCategory(prev => prev === catId ? null : catId);
  };

  const tabs: { key: ReportTab; label: string; icon: React.ReactNode }[] = [
    { key: 'stock-value', label: 'Stock Value', icon: <BarChart3 size={12} /> },
    { key: 'category', label: t('categoryWise', language), icon: <Package size={12} /> },
    { key: 'daily', label: t('dailyReport', language), icon: <TrendingUp size={12} /> },
    { key: 'monthly', label: t('monthlyReport', language), icon: <FileText size={12} /> },
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
          className="flex gap-1.5 mb-5 overflow-x-auto pb-1"
        >
          {tabs.map((tabItem) => (
            <button
              key={tabItem.key}
              onClick={() => setTab(tabItem.key)}
              className={`flex items-center gap-1 px-3 py-2 text-[11px] font-semibold rounded-xl transition-all whitespace-nowrap ${
                tab === tabItem.key
                  ? 'neon-btn-solid'
                  : 'glass-card text-white/60'
              }`}
            >
              {tabItem.icon}
              {tabItem.label}
            </button>
          ))}
        </motion.div>

        {/* Stock Value Tab Content */}
        {tab === 'stock-value' && (
          <>
            {/* Grand Total Summary */}
            {grandTotal && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="grid grid-cols-2 gap-3 mb-5"
              >
                <div className="rounded-2xl p-3" style={{ background: 'linear-gradient(135deg, rgba(0,240,255,0.12), rgba(0,200,212,0.05))', border: '1px solid rgba(0,240,255,0.2)' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <IndianRupee size={14} className="text-cyan-400" />
                    <span className="text-[10px] text-white/50">Stock Value</span>
                  </div>
                  <p className="text-lg font-bold text-cyan-400">₹{grandTotal.totalSellingValue.toLocaleString()}</p>
                </div>
                <div className="rounded-2xl p-3" style={{ background: 'linear-gradient(135deg, rgba(57,255,20,0.12), rgba(0,200,120,0.05))', border: '1px solid rgba(57,255,20,0.2)' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <TrendingUp size={14} className="text-green-400" />
                    <span className="text-[10px] text-white/50">Expected Profit</span>
                  </div>
                  <p className="text-lg font-bold text-green-400">₹{grandTotal.totalProfit.toLocaleString()}</p>
                </div>
                <div className="rounded-2xl p-3" style={{ background: 'linear-gradient(135deg, rgba(180,74,255,0.12), rgba(140,50,220,0.05))', border: '1px solid rgba(180,74,255,0.2)' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Package size={14} className="text-purple-400" />
                    <span className="text-[10px] text-white/50">Total Products</span>
                  </div>
                  <p className="text-lg font-bold text-purple-400">{grandTotal.totalProducts}</p>
                </div>
                <div className={`rounded-2xl p-3 ${grandTotal.totalLowStock > 0 ? '' : ''}`} style={{ background: grandTotal.totalLowStock > 0 ? 'linear-gradient(135deg, rgba(255,107,0,0.12), rgba(255,180,0,0.05))' : 'linear-gradient(135deg, rgba(57,255,20,0.12), rgba(0,200,120,0.05))', border: grandTotal.totalLowStock > 0 ? '1px solid rgba(255,107,0,0.2)' : '1px solid rgba(57,255,20,0.2)' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <AlertTriangle size={14} className={grandTotal.totalLowStock > 0 ? 'text-orange-400' : 'text-green-400'} />
                    <span className="text-[10px] text-white/50">Low Stock</span>
                  </div>
                  <p className={`text-lg font-bold ${grandTotal.totalLowStock > 0 ? 'text-orange-400' : 'text-green-400'}`}>{grandTotal.totalLowStock}</p>
                </div>
              </motion.div>
            )}

            {/* Stock Value Bar Chart */}
            {stockValueData.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="glass-card-strong p-4 mb-5"
              >
                <h3 className="text-xs font-semibold text-white/60 mb-3">Category-wise Stock Value</h3>
                <ChartContainer config={stockValueChartConfig} className="h-[200px] w-full">
                  <BarChart data={stockValueData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                    <XAxis
                      type="number"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 9 }}
                      tickFormatter={(val: number) => `₹${val >= 1000 ? `${(val/1000).toFixed(0)}k` : val}`}
                    />
                    <YAxis
                      type="category"
                      dataKey="categoryName"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 9 }}
                      width={80}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="totalSellingValue" radius={[0, 4, 4, 0]} maxBarSize={16}>
                      {stockValueData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </motion.div>
            )}
          </>
        )}

        {/* Export buttons */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="flex gap-3 mb-5"
        >
          <button onClick={exportCSV} className="flex-1 neon-btn py-2.5 text-xs font-semibold flex items-center justify-center gap-1">
            <Download size={14} />
            CSV
          </button>
          <button onClick={exportJSON} className="flex-1 neon-btn py-2.5 text-xs font-semibold flex items-center justify-center gap-1">
            <Download size={14} />
            JSON
          </button>
        </motion.div>

        {/* Report data */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="space-y-3 max-h-[calc(100vh-400px)] overflow-y-auto"
        >
          {loading ? (
            <div className="text-center py-8 text-white/40">{t('loading', language)}</div>
          ) : currentData.length === 0 ? (
            <div className="text-center py-12 text-white/40">{t('noData', language)}</div>
          ) : tab === 'stock-value' ? (
            // Stock Value: Expandable category cards
            stockValueData.map((cat, idx) => (
              <motion.div
                key={cat.categoryId}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.03 * idx }}
                className="glass-card overflow-hidden"
              >
                {/* Category header row */}
                <button
                  onClick={() => toggleCategory(cat.categoryId)}
                  className="w-full p-4 text-left"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: BAR_COLORS[idx % BAR_COLORS.length] }} />
                      <p className="text-sm font-semibold truncate">{cat.categoryName}</p>
                      {cat.lowStockCount > 0 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 font-medium shrink-0">
                          {cat.lowStockCount} low
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <p className="text-sm font-bold text-cyan-400">₹{cat.totalSellingValue.toLocaleString()}</p>
                        <p className="text-[10px] text-white/40">{cat.totalQty} pcs • {cat.productCount} items</p>
                      </div>
                      {expandedCategory === cat.categoryId ? (
                        <ChevronUp size={16} className="text-white/40" />
                      ) : (
                        <ChevronDown size={16} className="text-white/40" />
                      )}
                    </div>
                  </div>

                  {/* Progress bar showing stock value share */}
                  {grandTotal && grandTotal.totalSellingValue > 0 && (
                    <div className="mt-2 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(cat.totalSellingValue / grandTotal.totalSellingValue) * 100}%`,
                          backgroundColor: BAR_COLORS[idx % BAR_COLORS.length],
                        }}
                      />
                    </div>
                  )}
                </button>

                {/* Expanded product list */}
                {expandedCategory === cat.categoryId && (
                  <div className="px-4 pb-4 border-t border-white/5">
                    {/* Category value breakdown */}
                    <div className="grid grid-cols-3 gap-2 mt-3 mb-3">
                      <div>
                        <p className="text-[9px] text-white/40">Purchase</p>
                        <p className="text-xs font-medium text-purple-400">₹{cat.totalPurchaseValue.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-white/40">Selling</p>
                        <p className="text-xs font-medium text-cyan-400">₹{cat.totalSellingValue.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-white/40">Profit</p>
                        <p className={`text-xs font-medium ${cat.totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          ₹{Math.abs(cat.totalProfit).toLocaleString()}
                        </p>
                      </div>
                    </div>

                    {/* Product rows */}
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {cat.products.map((prod) => (
                        <div
                          key={prod.id}
                          className="flex items-center justify-between py-1.5 px-2 rounded-lg"
                          style={{ background: 'rgba(255,255,255,0.03)' }}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="text-xs text-white/80 truncate">{prod.name}</span>
                            {prod.lowStock && (
                              <AlertTriangle size={10} className="text-orange-400 shrink-0" />
                            )}
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-[10px] text-white/40">{prod.quantity} pcs</span>
                            <span className="text-xs font-medium text-cyan-400/80">₹{prod.stockValue.toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            ))
          ) : (
            // Original report display for category/daily/monthly
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
