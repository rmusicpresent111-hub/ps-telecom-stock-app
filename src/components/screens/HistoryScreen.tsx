'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Transaction } from '@/lib/types';
import { getTransactions } from '@/lib/supabase-service';
import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';
import { toast } from 'sonner';

type FilterType = 'ALL' | 'STOCK_IN' | 'STOCK_OUT' | 'SELL';

export default function HistoryScreen() {
  const { user, language } = useAppStore();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filter, setFilter] = useState<FilterType>('ALL');
  const [loading, setLoading] = useState(true);

  const fetchTransactions = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const data = filter !== 'ALL'
        ? await getTransactions(user.id, { type: filter })
        : await getTransactions(user.id);
      setTransactions(data.transactions || []);
    } catch {
      toast.error(t('error', language));
    } finally {
      setLoading(false);
    }
  }, [user?.id, filter, language]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const filterTabs: { key: FilterType; label: string }[] = [
    { key: 'ALL', label: 'All' },
    { key: 'STOCK_IN', label: t('stockInLabel', language) },
    { key: 'STOCK_OUT', label: t('stockOutLabel', language) },
    { key: 'SELL', label: t('sellLabel', language) },
  ];

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'STOCK_IN': return { bg: 'bg-green-500/20', text: 'text-green-400' };
      case 'STOCK_OUT': return { bg: 'bg-orange-500/20', text: 'text-orange-400' };
      case 'SELL': return { bg: 'bg-purple-500/20', text: 'text-purple-400' };
      default: return { bg: 'bg-cyan-500/20', text: 'text-cyan-400' };
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'STOCK_IN': return t('stockInLabel', language);
      case 'STOCK_OUT': return t('stockOutLabel', language);
      case 'SELL': return t('sellLabel', language);
      default: return type;
    }
  };

  return (
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-center mb-6"
        >
          <div className="flex items-center gap-2">
            <Clock size={24} className="text-cyan-400" />
            <h1 className="text-lg font-bold neon-glow">{t('history', language)}</h1>
          </div>
        </motion.div>

        {/* Filter tabs */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex gap-2 mb-6 overflow-x-auto"
        >
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`px-4 py-2 text-xs font-semibold rounded-xl whitespace-nowrap transition-all ${
                filter === tab.key
                  ? 'neon-btn-solid'
                  : 'glass-card text-white/60'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </motion.div>

        {/* Transaction list */}
        <div className="space-y-3 max-h-[calc(100vh-200px)] overflow-y-auto">
          {loading ? (
            <div className="text-center py-8 text-white/40">{t('loading', language)}</div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-12 text-white/40">{t('noData', language)}</div>
          ) : (
            transactions.map((txn, idx) => {
              const colors = getTypeColor(txn.type);
              return (
                <motion.div
                  key={txn.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.03 * idx }}
                  className="glass-card p-4"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${colors.bg} ${colors.text}`}>
                        {getTypeLabel(txn.type)}
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-medium">
                          {txn.product?.name || 'Unknown Product'}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-white/50">×{txn.quantity}</span>
                          <span className="text-xs text-white/50">₹{txn.unitPrice}/unit</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right ml-3">
                      <p className={`text-sm font-bold ${colors.text}`}>₹{txn.totalAmount.toLocaleString()}</p>
                      <p className="text-[10px] text-white/40">{txn.date}</p>
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
