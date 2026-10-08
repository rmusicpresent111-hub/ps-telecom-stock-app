'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { ServiceTransaction, ServiceCategoryType } from '@/lib/types';
import { getServiceTransactionsOffline, createServiceTransactionOffline, deleteServiceTransactionOffline } from '@/lib/offline-service';
import { ArrowLeft, Plus, Trash2, TrendingUp, TrendingDown, IndianRupee, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

const categoryMeta: Record<string, { name: string; emoji: string; incomeLabel: string; expenseLabel: string }> = {
  repairing: {
    name: 'Repairing',
    emoji: '🔧',
    incomeLabel: 'Income',
    expenseLabel: 'Expense',
  },
  'withdraw-deposit': {
    name: 'Withdraw/Deposit',
    emoji: '💰',
    incomeLabel: 'Deposit',
    expenseLabel: 'Withdraw',
  },
};

export default function ServiceCategoryScreen() {
  const user = useAppStore(s => s.user);
  const language = useAppStore(s => s.language);
  const goBack = useAppStore(s => s.goBack);
  const selectedServiceCategory = useAppStore(s => s.selectedServiceCategory);

  const categoryType = selectedServiceCategory as ServiceCategoryType | null;
  const meta = categoryType ? categoryMeta[categoryType] : null;

  const [transactions, setTransactions] = useState<ServiceTransaction[]>([]);
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [transactionType, setTransactionType] = useState<'income' | 'expense'>('income');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Delete needs an explicit confirmation - single-tap delete destroyed data instantly
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchTransactions = useCallback(async () => {
    if (!user?.id || !categoryType) return;
    try {
      setLoading(true);
      const txns = await getServiceTransactionsOffline(user.id, { categoryType });
      setTransactions(txns || []);
    } catch {
      toast.error(t('error', language));
    } finally {
      setLoading(false);
    }
  }, [user?.id, categoryType, language]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const handleSave = async () => {
    if (!user?.id || !categoryType) return;
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      toast.error(language === 'bn' ? 'পরিমাণ লিখুন' : language === 'hi' ? 'राशि दर्ज करें' : 'Enter amount');
      return;
    }

    setSaving(true);
    try {
      await createServiceTransactionOffline({
        categoryType,
        transactionType,
        amount: parsedAmount,
        purpose: purpose.trim(),
        userId: user.id,
      });
      toast.success(t('success', language));
      setAmount('');
      setPurpose('');
      fetchTransactions();
    } catch {
      toast.error(t('error', language));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    // Close the dialog FIRST so a double-tap can never fire the delete twice
    const target = confirmDeleteId;
    setConfirmDeleteId(null);
    if (!target || !user?.id) return;
    try {
      await deleteServiceTransactionOffline(target, user.id);
      toast.success(language === 'bn' ? 'মুছে ফেলা হয়েছে' : language === 'hi' ? 'हटाया गया' : 'Deleted');
      fetchTransactions();
    } catch {
      toast.error(t('error', language));
    }
  };

  if (!meta || !categoryType) {
    return (
      <div className="animated-bg min-h-screen flex items-center justify-center">
        <p className="text-white/40">Invalid category</p>
      </div>
    );
  }

  const totalIncome = transactions.filter(t => t.transactionType === 'income').reduce((sum, t) => sum + (t.amount || 0), 0);
  const totalExpense = transactions.filter(t => t.transactionType === 'expense').reduce((sum, t) => sum + (t.amount || 0), 0);
  const netAmount = totalIncome - totalExpense;

  return (
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <button onClick={goBack} className="p-2 rounded-full glass-card" aria-label="Back">
            <ArrowLeft size={20} className="text-emerald-400" />
          </button>
          <h1 className="text-lg font-bold neon-glow">
            {meta.emoji} {meta.name}
          </h1>
          <div className="w-10" />
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="stat-card-green rounded-2xl p-3 text-center">
            <TrendingUp size={14} className="text-green-400 mx-auto mb-1" />
            <p className="text-[10px] text-white/50">{meta.incomeLabel}</p>
            <p className="text-sm font-bold text-green-400">₹{totalIncome.toLocaleString()}</p>
          </div>
          <div className="stat-card-orange rounded-2xl p-3 text-center">
            <TrendingDown size={14} className="text-orange-400 mx-auto mb-1" />
            <p className="text-[10px] text-white/50">{meta.expenseLabel}</p>
            <p className="text-sm font-bold text-orange-400">₹{totalExpense.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl p-3 text-center" style={{ background: netAmount >= 0 ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)', border: `1px solid ${netAmount >= 0 ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)'}` }}>
            <IndianRupee size={14} className={netAmount >= 0 ? 'text-green-400 mx-auto mb-1' : 'text-red-400 mx-auto mb-1'} />
            <p className="text-[10px] text-white/50">Net</p>
            <p className={`text-sm font-bold ${netAmount >= 0 ? 'text-green-400' : 'text-red-400'}`}>₹{netAmount.toLocaleString()}</p>
          </div>
        </div>

        {/* Form Card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card-strong p-5 mb-6"
        >
          {/* Transaction Type Toggle */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setTransactionType('income')}
              className={`flex-1 py-2.5 text-xs font-semibold rounded-xl transition-all ${
                transactionType === 'income'
                  ? 'neon-btn-solid'
                  : 'glass-card text-white/60 hover:text-white/80'
              }`}
            >
              {transactionType === 'income' ? '✓ ' : ''}{meta.incomeLabel}
            </button>
            <button
              onClick={() => setTransactionType('expense')}
              className={`flex-1 py-2.5 text-xs font-semibold rounded-xl transition-all ${
                transactionType === 'expense'
                  ? 'text-white font-semibold'
                  : 'glass-card text-white/60 hover:text-white/80'
              }`}
              style={transactionType === 'expense' ? {
                background: 'linear-gradient(135deg, rgba(248,113,113,0.3), rgba(220,38,38,0.5))',
                border: '1px solid rgba(248,113,113,0.5)',
              } : undefined}
            >
              {transactionType === 'expense' ? '✓ ' : ''}{meta.expenseLabel}
            </button>
          </div>

          {/* Amount Input */}
          <div className="mb-3">
            <label className="text-xs text-white/60 mb-1 block">
              {language === 'bn' ? 'পরিমাণ' : language === 'hi' ? 'राशि' : 'Amount'}
            </label>
            <div className="relative">
              <IndianRupee size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="glass-input w-full pl-10 pr-4 py-3 text-sm"
                autoFocus
              />
            </div>
          </div>

          {/* Purpose Input */}
          <div className="mb-4">
            <label className="text-xs text-white/60 mb-1 block">
              {language === 'bn' ? 'উদ্দেশ্য' : language === 'hi' ? 'उद्देश्य' : 'Purpose'}
            </label>
            <div className="relative">
              <FileText size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder={language === 'bn' ? 'উদ্দেশ্য লিখুন...' : language === 'hi' ? 'उद्देश्य दर्ज करें...' : 'Enter purpose...'}
                className="glass-input w-full pl-10 pr-4 py-3 text-sm"
              />
            </div>
          </div>

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={saving || !amount}
            className="neon-btn-solid w-full py-3 text-sm font-semibold disabled:opacity-50"
          >
            {saving
              ? t('loading', language)
              : `${language === 'bn' ? 'সেভ করুন' : language === 'hi' ? 'सेव करें' : 'Instant Save'} ${transactionType === 'income' ? meta.incomeLabel : meta.expenseLabel}`
            }
          </button>
        </motion.div>

        {/* Transaction History */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <IndianRupee size={16} className="text-emerald-400" />
            <h2 className="text-sm font-bold">
              {language === 'bn' ? 'লেনদেনের ইতিহাস' : language === 'hi' ? 'लेनदेन इतिहास' : 'Transaction History'}
            </h2>
          </div>

          {loading ? (
            <div className="text-center py-8 text-white/40">{t('loading', language)}</div>
          ) : transactions.length === 0 ? (
            <div className="glass-card p-6 text-center text-white/40">
              {t('noData', language)}
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              <AnimatePresence>
                {transactions.map((txn, idx) => (
                  <motion.div
                    key={txn.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ delay: idx * 0.03 }}
                    className="glass-card p-4"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          {txn.transactionType === 'income' ? (
                            <TrendingUp size={14} className="text-green-400 shrink-0" />
                          ) : (
                            <TrendingDown size={14} className="text-orange-400 shrink-0" />
                          )}
                          <span className="text-sm font-semibold">
                            {txn.transactionType === 'income' ? meta.incomeLabel : meta.expenseLabel}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                            txn.transactionType === 'income' ? 'bg-green-500/20 text-green-400' : 'bg-orange-500/20 text-orange-400'
                          }`}>
                            {txn.transactionType === 'income' ? '↑' : '↓'}
                          </span>
                        </div>
                        {txn.purpose && (
                          <p className="text-xs text-white/50 mt-1 line-clamp-1">{txn.purpose}</p>
                        )}
                        <p className="text-[10px] text-white/30 mt-1">
                          {txn.date} • {new Date(txn.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold ${
                          txn.transactionType === 'income' ? 'text-green-400' : 'text-orange-400'
                        }`}>
                          {txn.transactionType === 'income' ? '+' : '-'}₹{txn.amount.toLocaleString()}
                        </span>
                        <button
                          onClick={() => setConfirmDeleteId(txn.id)}
                          className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors"
                          aria-label="Delete"
                        >
                          <Trash2 size={14} className="text-red-400/60 hover:text-red-400" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <AnimatePresence>
        {confirmDeleteId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6"
            onClick={() => setConfirmDeleteId(null)}
          >
            <div className="absolute inset-0 bg-black/60" />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-card-strong p-6 w-full max-w-sm relative z-10"
            >
              <div className="w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center mx-auto mb-4">
                <Trash2 size={24} className="text-red-400" />
              </div>
              <h3 className="text-lg font-bold text-center mb-2">
                {language === 'bn' ? 'মুছে ফেলবেন?' : language === 'hi' ? 'हटाएं?' : 'Delete this entry?'}
              </h3>
              <p className="text-sm text-white/50 text-center mb-6">
                {language === 'bn' ? 'এই অ্যাকশনটি ফেরানো যাবে না।' : language === 'hi' ? 'यह कार्य वापस नहीं किया जा सकता।' : 'This action cannot be undone.'}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="flex-1 glass-card py-3 text-sm font-semibold text-white/70 rounded-xl hover:bg-white/10 transition-colors"
                >
                  {language === 'bn' ? 'বাতিল' : language === 'hi' ? 'रद्द करें' : 'Cancel'}
                </button>
                <button
                  onClick={confirmDelete}
                  className="flex-1 py-3 text-sm font-semibold rounded-xl text-white transition-all"
                  style={{
                    background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
                    border: '1px solid rgba(220,38,38,0.5)',
                  }}
                >
                  {language === 'bn' ? 'মুছুন' : language === 'hi' ? 'हटाएं' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
