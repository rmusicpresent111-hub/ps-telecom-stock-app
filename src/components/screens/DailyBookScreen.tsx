'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Plus, Wallet, Banknote, TrendingUp, TrendingDown,
  Calendar, Trash2, ChevronDown, ChevronUp, Edit3, IndianRupee,
  Receipt, ShoppingBag, Zap, Home, Car, UtensilsCrossed, MoreHorizontal, X
} from 'lucide-react';
import { toast } from 'sonner';
import { 
  getCashEntriesOffline, 
  getExpensesOffline, 
  upsertCashEntryOffline, 
  updateCashEntryOffline, 
  deleteCashEntryOffline,
  createExpenseOffline, 
  updateExpenseOffline, 
  deleteExpenseOffline 
} from '@/lib/offline-service';
import { localDateStr } from '@/lib/offline-service';

interface CashEntry {
  id: string;
  userId: string;
  date: string;
  handCash: number;
  liquidCash: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

interface Expense {
  id: string;
  userId: string;
  date: string;
  amount: number;
  category: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

type PeriodFilter = 'today' | 'week' | 'month';
type TabView = 'overview' | 'cash' | 'expenses' | 'history';

const EXPENSE_CATEGORIES = [
  { key: 'rent', label: 'Rent', labelBn: 'ভাড়া', labelHi: 'किराया', icon: Home, color: 'text-blue-400' },
  { key: 'transport', label: 'Transport', labelBn: 'যানবাহন', labelHi: 'परिवहन', icon: Car, color: 'text-green-400' },
  { key: 'food', label: 'Food', labelBn: 'খাবার', labelHi: 'खाना', icon: UtensilsCrossed, color: 'text-orange-400' },
  { key: 'electricity', label: 'Electricity', labelBn: 'বিদ্যুৎ', labelHi: 'बिजली', icon: Zap, color: 'text-yellow-400' },
  { key: 'shopping', label: 'Shopping', labelBn: 'শপিং', labelHi: 'शॉपिंग', icon: ShoppingBag, color: 'text-pink-400' },
  { key: 'other', label: 'Other', labelBn: 'অন্যান্য', labelHi: 'अन्य', icon: MoreHorizontal, color: 'text-gray-400' },
];

export default function DailyBookScreen() {
  const { user, language, goBack } = useAppStore();
  const [activeTab, setActiveTab] = useState<TabView>('overview');
  const [period, setPeriod] = useState<PeriodFilter>('today');

  // Cash entry state
  const [cashEntries, setCashEntries] = useState<CashEntry[]>([]);
  const [summary, setSummary] = useState({ totalHandCash: 0, totalLiquidCash: 0, totalCash: 0 });
  const [showCashForm, setShowCashForm] = useState(false);
  const [cashDate, setCashDate] = useState(localDateStr());
  const [handCashInput, setHandCashInput] = useState('');
  const [liquidCashInput, setLiquidCashInput] = useState('');
  const [cashNote, setCashNote] = useState('');
  const [editingCashId, setEditingCashId] = useState<string | null>(null);

  // Expense state
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expenseSummary, setExpenseSummary] = useState({ totalExpense: 0, byCategory: {} as Record<string, number>, count: 0 });
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseDate, setExpenseDate] = useState(localDateStr());
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('other');
  const [expenseDesc, setExpenseDesc] = useState('');
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);

  // Expanded entries in history
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);

  // Delete confirmation (single-tap delete used to destroy data instantly)
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'cash' | 'expense'; id: string } | null>(null);

  const isBn = language === 'bn';
  const isHi = language === 'hi';

  const fetchCashEntries = useCallback(async () => {
    if (!user?.id) return;
    try {
      const data = await getCashEntriesOffline(user.id, { period }) as Record<string, unknown>;
      setCashEntries((data.entries as CashEntry[] || []) as CashEntry[]);
      setSummary((data.summary as { totalHandCash: number; totalLiquidCash: number; totalCash: number }) || { totalHandCash: 0, totalLiquidCash: 0, totalCash: 0 });
    } catch {
      // silent
    }
  }, [user?.id, period]);

  const fetchExpenses = useCallback(async () => {
    if (!user?.id) return;
    try {
      const data = await getExpensesOffline(user.id, { period }) as Record<string, unknown>;
      setExpenses((data.expenses as Expense[] || []) as Expense[]);
      setExpenseSummary((data.summary as { totalExpense: number; byCategory: Record<string, number>; count: number }) || { totalExpense: 0, byCategory: {}, count: 0 });
    } catch {
      // silent
    }
  }, [user?.id, period]);

  useEffect(() => {
    fetchCashEntries();
    fetchExpenses();
  }, [fetchCashEntries, fetchExpenses]);

  // Cash form handlers
  const handleSaveCash = async () => {
    if (!user?.id) return;

    // Validate amounts — NaN/negative values poison the cash summary ("₹NaN")
    const hand = Number(handCashInput || 0);
    const liquid = Number(liquidCashInput || 0);
    if (!Number.isFinite(hand) || hand < 0 || !Number.isFinite(liquid) || liquid < 0) {
      toast.error(isBn ? 'ত্রুটি' : isHi ? 'ত্রুটি' : 'Error', { description: 'Cash amounts cannot be negative' });
      return;
    }
    if (hand === 0 && liquid === 0) {
      toast.error(isBn ? 'ত্রুটি' : isHi ? 'ত্রুটি' : 'Error', { description: 'Enter at least one cash amount' });
      return;
    }

    setLoading(true);
    try {
      if (editingCashId) {
        await updateCashEntryOffline(editingCashId, {
          handCash: hand,
          liquidCash: liquid,
          note: cashNote,
        }, user.id);
      } else {
        await upsertCashEntryOffline({
          userId: user.id,
          date: cashDate,
          handCash: hand,
          liquidCash: liquid,
          note: cashNote,
        });
      }
      toast.success(isBn ? 'সংরক্ষিত হয়েছে' : isHi ? 'संरक्षित' : 'Saved successfully');
      resetCashForm();
      fetchCashEntries();
    } catch (error) {
      toast.error(isBn ? 'ত্রুটি' : isHi ? 'त्रुटि' : 'Error', { description: (error as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const resetCashForm = () => {
    setShowCashForm(false);
    setHandCashInput('');
    setLiquidCashInput('');
    setCashNote('');
    setEditingCashId(null);
    setCashDate(localDateStr());
  };

  const handleEditCash = (entry: CashEntry) => {
    setEditingCashId(entry.id);
    setCashDate(entry.date);
    setHandCashInput(entry.handCash.toString());
    setLiquidCashInput(entry.liquidCash.toString());
    setCashNote(entry.note);
    setShowCashForm(true);
  };

  const confirmDeleteCash = async () => {
    // Close the dialog FIRST so a double-tap can never fire the delete twice
    const target = confirmDelete;
    setConfirmDelete(null);
    if (!target || target.type !== 'cash') return;
    try {
      await deleteCashEntryOffline(target.id, user?.id || '');
      toast.success(isBn ? 'মুছে ফেলা হয়েছে' : isHi ? 'मिटाया गया' : 'Deleted');
      fetchCashEntries();
    } catch {
      toast.error(isBn ? 'ত্রুটি' : isHi ? 'त्रुटि' : 'Error');
    }
  };

  const handleSaveExpense = async () => {
    if (!user?.id || !expenseAmount) return;

    const amount = Number(expenseAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(isBn ? 'ত্রুটি' : isHi ? 'त्रुटि' : 'Error', { description: 'Expense amount must be greater than 0' });
      return;
    }

    setLoading(true);
    try {
      if (editingExpenseId) {
        await updateExpenseOffline(editingExpenseId, {
          amount,
          category: expenseCategory,
          description: expenseDesc,
        }, user.id);
      } else {
        await createExpenseOffline({
          userId: user.id,
          date: expenseDate,
          amount,
          category: expenseCategory,
          description: expenseDesc,
        });
      }
      toast.success(isBn ? 'সংরক্ষিত হয়েছে' : isHi ? 'संरक्षित' : 'Saved successfully');
      resetExpenseForm();
      fetchExpenses();
    } catch (error) {
      toast.error(isBn ? 'ত্রুটি' : isHi ? 'त्रुटि' : 'Error', { description: (error as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const resetExpenseForm = () => {
    setShowExpenseForm(false);
    setExpenseAmount('');
    setExpenseCategory('other');
    setExpenseDesc('');
    setEditingExpenseId(null);
    setExpenseDate(localDateStr());
  };

  const handleEditExpense = (exp: Expense) => {
    setEditingExpenseId(exp.id);
    setExpenseDate(exp.date);
    setExpenseAmount(exp.amount.toString());
    setExpenseCategory(exp.category);
    setExpenseDesc(exp.description);
    setShowExpenseForm(true);
  };

  const confirmDeleteExpense = async () => {
    const target = confirmDelete;
    setConfirmDelete(null);
    if (!target || target.type !== 'expense') return;
    try {
      await deleteExpenseOffline(target.id, user?.id || '');
      toast.success(isBn ? 'মুছে ফেলা হয়েছে' : isHi ? 'मिटाया गया' : 'Deleted');
      fetchExpenses();
    } catch {
      toast.error(isBn ? 'ত্রুটি' : isHi ? 'त्रुटि' : 'Error');
    }
  };

  const getCategoryInfo = (key: string) => {
    return EXPENSE_CATEGORIES.find(c => c.key === key) || EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
    return d.toLocaleDateString(isBn ? 'bn-BD' : isHi ? 'hi-IN' : 'en-US', options);
  };

  const formatCurrency = (amount: number) => {
    return '₹' + amount.toLocaleString(isBn ? 'bn-BD' : isHi ? 'hi-IN' : 'en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  };

  // Group history by date
  const historyByDate = () => {
    const allItems: { date: string; type: 'cash' | 'expense'; data: CashEntry | Expense }[] = [
      ...cashEntries.map(e => ({ date: e.date, type: 'cash' as const, data: e as CashEntry | Expense })),
      ...expenses.map(e => ({ date: e.date, type: 'expense' as const, data: e as CashEntry | Expense })),
    ];
    allItems.sort((a, b) => b.date.localeCompare(a.date));

    const grouped: Record<string, { date: string; items: { type: 'cash' | 'expense'; data: CashEntry | Expense }[] }> = {};
    allItems.forEach(item => {
      if (!grouped[item.date]) grouped[item.date] = { date: item.date, items: [] };
      grouped[item.date].items.push(item);
    });
    return Object.values(grouped);
  };

  const netCash = summary.totalCash - expenseSummary.totalExpense;

  const periodLabel = (p: PeriodFilter) => {
    if (p === 'today') return isBn ? 'আজ' : isHi ? 'आज' : 'Today';
    if (p === 'week') return isBn ? 'সপ্তাহ' : isHi ? 'सप्ताह' : 'Week';
    return isBn ? 'মাস' : isHi ? 'महीना' : 'Month';
  };

  const tabLabel = (tab: TabView) => {
    switch (tab) {
      case 'overview': return isBn ? 'সারসংক্ষেপ' : isHi ? 'अवलोकन' : 'Overview';
      case 'cash': return isBn ? 'ক্যাশ' : isHi ? 'कैश' : 'Cash';
      case 'expenses': return isBn ? 'খরচ' : isHi ? 'खर्च' : 'Expenses';
      case 'history': return isBn ? 'ইতিহাস' : isHi ? 'इतिहास' : 'History';
    }
  };

  return (
    <div className="animated-bg min-h-screen pb-6">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 mb-4"
        >
          <button onClick={goBack} className="p-2 rounded-xl glass-card">
            <ArrowLeft size={20} className="text-white/70" />
          </button>
          <div className="flex items-center gap-2">
            <Receipt size={22} className="text-emerald-400" />
            <h1 className="text-lg font-bold neon-glow">
              {isBn ? 'দৈনিক বই' : isHi ? 'दैनिक बही' : 'Daily Book'}
            </h1>
          </div>
        </motion.div>

        {/* Period Filter */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex gap-2 mb-4"
        >
          {(['today', 'week', 'month'] as PeriodFilter[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${
                period === p
                  ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-400'
                  : 'glass-card text-white/60'
              }`}
            >
              {periodLabel(p)}
            </button>
          ))}
        </motion.div>

        {/* Summary Cards - Always visible */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="grid grid-cols-2 gap-3 mb-4"
        >
          {/* Total Hand Cash */}
          <div className="glass-card-strong p-4">
            <div className="flex items-center gap-2 mb-2">
              <Wallet size={16} className="text-green-400" />
              <span className="text-xs text-white/50">
                {isBn ? 'হ্যান্ড ক্যাশ' : isHi ? 'हैंड कैश' : 'Hand Cash'}
              </span>
            </div>
            <p className="text-lg font-bold text-green-400">{formatCurrency(summary.totalHandCash)}</p>
          </div>

          {/* Total Liquid Cash */}
          <div className="glass-card-strong p-4">
            <div className="flex items-center gap-2 mb-2">
              <Banknote size={16} className="text-emerald-400" />
              <span className="text-xs text-white/50">
                {isBn ? 'লিকুইড ক্যাশ' : isHi ? 'लिक्विड कैश' : 'Liquid Cash'}
              </span>
            </div>
            <p className="text-lg font-bold text-emerald-400">{formatCurrency(summary.totalLiquidCash)}</p>
          </div>

          {/* Total Expense */}
          <div className="glass-card-strong p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown size={16} className="text-red-400" />
              <span className="text-xs text-white/50">
                {isBn ? 'মোট খরচ' : isHi ? 'कुल खर्च' : 'Total Expense'}
              </span>
            </div>
            <p className="text-lg font-bold text-red-400">{formatCurrency(expenseSummary.totalExpense)}</p>
          </div>

          {/* Net Cash */}
          <div className="glass-card-strong p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp size={16} className={netCash >= 0 ? 'text-emerald-400' : 'text-red-400'} />
              <span className="text-xs text-white/50">
                {isBn ? 'নেট ক্যাশ' : isHi ? 'नेट कैश' : 'Net Cash'}
              </span>
            </div>
            <p className={`text-lg font-bold ${netCash >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatCurrency(netCash)}
            </p>
          </div>
        </motion.div>

        {/* Total Cash Banner */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-card-strong p-4 mb-4 text-center"
          style={{
            background: 'linear-gradient(135deg, rgba(52,120,100,0.15), rgba(40,80,65,0.15))',
          }}
        >
          <span className="text-xs text-white/50">
            {isBn ? 'মোট ক্যাশ (হ্যান্ড + লিকুইড)' : isHi ? 'कुल कैश (हैंड + लिक्विड)' : 'Total Cash (Hand + Liquid)'}
          </span>
          <p className="text-2xl font-bold text-emerald-400 mt-1">{formatCurrency(summary.totalCash)}</p>
        </motion.div>

        {/* Tab Navigation */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="flex gap-1 mb-4 glass-card-strong p-1 rounded-xl"
        >
          {(['overview', 'cash', 'expenses', 'history'] as TabView[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                activeTab === tab
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'text-white/50 hover:text-white/70'
              }`}
            >
              {tabLabel(tab)}
            </button>
          ))}
        </motion.div>

        {/* Tab Content */}
        <AnimatePresence mode="wait">
          {/* OVERVIEW TAB */}
          {activeTab === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              {/* Quick Actions */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => { resetCashForm(); setShowCashForm(true); }}
                  className="glass-card p-4 flex flex-col items-center gap-2 hover:bg-white/5 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-green-500/15 flex items-center justify-center">
                    <Wallet size={20} className="text-green-400" />
                  </div>
                  <span className="text-xs font-semibold">
                    {isBn ? 'ক্যাশ এন্ট্রি' : isHi ? 'कैश एंट्री' : 'Cash Entry'}
                  </span>
                </button>

                <button
                  onClick={() => { resetExpenseForm(); setShowExpenseForm(true); }}
                  className="glass-card p-4 flex flex-col items-center gap-2 hover:bg-white/5 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center">
                    <IndianRupee size={20} className="text-red-400" />
                  </div>
                  <span className="text-xs font-semibold">
                    {isBn ? 'খরচ এন্ট্রি' : isHi ? 'खर्च एंट्री' : 'Add Expense'}
                  </span>
                </button>
              </div>

              {/* Expense Breakdown by Category */}
              {Object.keys(expenseSummary.byCategory).length > 0 && (
                <div className="glass-card-strong p-4">
                  <h3 className="text-sm font-bold mb-3">
                    {isBn ? 'খরচের বিবরণ' : isHi ? 'खर्च विवरण' : 'Expense Breakdown'}
                  </h3>
                  <div className="space-y-2">
                    {Object.entries(expenseSummary.byCategory).map(([cat, amount]) => {
                      const catInfo = getCategoryInfo(cat);
                      const CatIcon = catInfo.icon;
                      const percent = expenseSummary.totalExpense > 0 ? (amount / expenseSummary.totalExpense) * 100 : 0;
                      return (
                        <div key={cat} className="flex items-center gap-3">
                          <CatIcon size={16} className={catInfo.color} />
                          <div className="flex-1">
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-xs text-white/70">
                                {isBn ? catInfo.labelBn : isHi ? catInfo.labelHi : catInfo.label}
                              </span>
                              <span className="text-xs font-semibold">{formatCurrency(amount)}</span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-white/5">
                              <div
                                className="h-full rounded-full bg-emerald-500/40 transition-all"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Recent entries */}
              <div className="glass-card-strong p-4">
                <h3 className="text-sm font-bold mb-3">
                  {isBn ? 'সাম্প্রতিক এন্ট্রি' : isHi ? 'हालिया एंट्री' : 'Recent Entries'}
                </h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {cashEntries.slice(0, 3).map(entry => (
                    <div key={entry.id} className="flex items-center justify-between p-2 rounded-lg bg-white/5">
                      <div className="flex items-center gap-2">
                        <Wallet size={14} className="text-green-400" />
                        <div>
                          <p className="text-xs font-semibold">{formatDate(entry.date)}</p>
                          <p className="text-[10px] text-white/40">
                            {isBn ? 'হ্যান্ড' : isHi ? 'हैंड' : 'Hand'}: {formatCurrency(entry.handCash)} | {isBn ? 'লিকুইড' : isHi ? 'लिक्विड' : 'Liquid'}: {formatCurrency(entry.liquidCash)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {expenses.slice(0, 3).map(exp => {
                    const catInfo = getCategoryInfo(exp.category);
                    const CatIcon = catInfo.icon;
                    return (
                      <div key={exp.id} className="flex items-center justify-between p-2 rounded-lg bg-white/5">
                        <div className="flex items-center gap-2">
                          <CatIcon size={14} className={catInfo.color} />
                          <div>
                            <p className="text-xs font-semibold">{exp.description || (isBn ? catInfo.labelBn : isHi ? catInfo.labelHi : catInfo.label)}</p>
                            <p className="text-[10px] text-white/40">{formatDate(exp.date)}</p>
                          </div>
                        </div>
                        <span className="text-xs font-bold text-red-400">-{formatCurrency(exp.amount)}</span>
                      </div>
                    );
                  })}
                  {cashEntries.length === 0 && expenses.length === 0 && (
                    <p className="text-xs text-white/30 text-center py-4">
                      {isBn ? 'কোনো এন্ট্রি নেই' : isHi ? 'कोई एंट्री नहीं' : 'No entries yet'}
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* CASH TAB */}
          {activeTab === 'cash' && (
            <motion.div
              key="cash"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-3"
            >
              {/* Add button */}
              <button
                onClick={() => { resetCashForm(); setShowCashForm(true); }}
                className="w-full glass-card p-3 flex items-center justify-center gap-2 hover:bg-white/5 transition-colors"
              >
                <Plus size={18} className="text-emerald-400" />
                <span className="text-sm font-semibold">
                  {isBn ? 'নতুন ক্যাশ এন্ট্রি' : isHi ? 'नई कैश एंट्री' : 'New Cash Entry'}
                </span>
              </button>

              {/* Cash entries list */}
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {cashEntries.map(entry => (
                  <div key={entry.id} className="glass-card p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Calendar size={14} className="text-white/40" />
                        <span className="text-sm font-semibold">{formatDate(entry.date)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleEditCash(entry)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                          <Edit3 size={14} className="text-white/40" />
                        </button>
                        <button onClick={() => setConfirmDelete({ type: 'cash', id: entry.id })} className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors" aria-label="Delete entry">
                          <Trash2 size={14} className="text-red-400/60" />
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div>
                        <span className="text-[10px] text-white/40">
                          {isBn ? 'হ্যান্ড ক্যাশ' : isHi ? 'हैंड कैश' : 'Hand Cash'}
                        </span>
                        <p className="text-sm font-bold text-green-400">{formatCurrency(entry.handCash)}</p>
                      </div>
                      <div>
                        <span className="text-[10px] text-white/40">
                          {isBn ? 'লিকুইড ক্যাশ' : isHi ? 'लिक्विड कैश' : 'Liquid Cash'}
                        </span>
                        <p className="text-sm font-bold text-emerald-400">{formatCurrency(entry.liquidCash)}</p>
                      </div>
                    </div>
                    {entry.note && (
                      <p className="text-[10px] text-white/30 mt-1">📝 {entry.note}</p>
                    )}
                  </div>
                ))}
                {cashEntries.length === 0 && (
                  <div className="text-center py-8">
                    <Wallet size={32} className="text-white/10 mx-auto mb-2" />
                    <p className="text-sm text-white/30">
                      {isBn ? 'কোনো ক্যাশ এন্ট্রি নেই' : isHi ? 'कोई कैश एंट्री नहीं' : 'No cash entries'}
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* EXPENSES TAB */}
          {activeTab === 'expenses' && (
            <motion.div
              key="expenses"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-3"
            >
              {/* Add button */}
              <button
                onClick={() => { resetExpenseForm(); setShowExpenseForm(true); }}
                className="w-full glass-card p-3 flex items-center justify-center gap-2 hover:bg-white/5 transition-colors"
              >
                <Plus size={18} className="text-red-400" />
                <span className="text-sm font-semibold">
                  {isBn ? 'খরচ যোগ করুন' : isHi ? 'खर्च जोड़ें' : 'Add Expense'}
                </span>
              </button>

              {/* Expense entries list */}
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {expenses.map(exp => {
                  const catInfo = getCategoryInfo(exp.category);
                  const CatIcon = catInfo.icon;
                  return (
                    <div key={exp.id} className="glass-card p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full bg-white/5 flex items-center justify-center`}>
                            <CatIcon size={16} className={catInfo.color} />
                          </div>
                          <div>
                            <p className="text-sm font-semibold">{exp.description || (isBn ? catInfo.labelBn : isHi ? catInfo.labelHi : catInfo.label)}</p>
                            <p className="text-[10px] text-white/40">{formatDate(exp.date)} • {isBn ? catInfo.labelBn : isHi ? catInfo.labelHi : catInfo.label}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-red-400">-{formatCurrency(exp.amount)}</span>
                          <div className="flex flex-col gap-0.5">
                            <button onClick={() => handleEditExpense(exp)} className="p-1 rounded hover:bg-white/10">
                              <Edit3 size={12} className="text-white/30" />
                            </button>
                            <button onClick={() => setConfirmDelete({ type: 'expense', id: exp.id })} className="p-1 rounded hover:bg-red-500/10" aria-label="Delete expense">
                              <Trash2 size={12} className="text-red-400/40" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {expenses.length === 0 && (
                  <div className="text-center py-8">
                    <IndianRupee size={32} className="text-white/10 mx-auto mb-2" />
                    <p className="text-sm text-white/30">
                      {isBn ? 'কোনো খরচ নেই' : isHi ? 'कोई खर्च नहीं' : 'No expenses'}
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* HISTORY TAB */}
          {activeTab === 'history' && (
            <motion.div
              key="history"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-2 max-h-[70vh] overflow-y-auto"
            >
              {historyByDate().map(group => {
                const isExpanded = expandedDate === group.date;
                const dayHandCash = group.items
                  .filter(i => i.type === 'cash')
                  .reduce((s, i) => s + (i.data as CashEntry).handCash, 0);
                const dayLiquidCash = group.items
                  .filter(i => i.type === 'cash')
                  .reduce((s, i) => s + (i.data as CashEntry).liquidCash, 0);
                const dayExpense = group.items
                  .filter(i => i.type === 'expense')
                  .reduce((s, i) => s + (i.data as Expense).amount, 0);

                return (
                  <div key={group.date} className="glass-card overflow-hidden">
                    {/* Date header */}
                    <button
                      onClick={() => setExpandedDate(isExpanded ? null : group.date)}
                      className="w-full p-3 flex items-center justify-between hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Calendar size={14} className="text-emerald-400" />
                        <span className="text-sm font-bold">{formatDate(group.date)}</span>
                        <span className="text-[10px] text-white/30">({group.items.length})</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-green-400">+{formatCurrency(dayHandCash + dayLiquidCash)}</span>
                        {dayExpense > 0 && <span className="text-xs text-red-400">-{formatCurrency(dayExpense)}</span>}
                        {isExpanded ? <ChevronUp size={16} className="text-white/30" /> : <ChevronDown size={16} className="text-white/30" />}
                      </div>
                    </button>

                    {/* Expanded items */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-3 pb-3 space-y-1.5">
                            {group.items.map((item, idx) => {
                              if (item.type === 'cash') {
                                const c = item.data as CashEntry;
                                return (
                                  <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-green-500/5">
                                    <div className="flex items-center gap-2">
                                      <Wallet size={12} className="text-green-400" />
                                      <span className="text-[10px] text-white/60">
                                        {isBn ? 'হ্যান্ড' : isHi ? 'हैंड' : 'Hand'}: {formatCurrency(c.handCash)} | {isBn ? 'লিকুইড' : isHi ? 'लिक्विड' : 'Liquid'}: {formatCurrency(c.liquidCash)}
                                      </span>
                                    </div>
                                    <span className="text-[10px] text-green-400 font-semibold">+{formatCurrency(c.handCash + c.liquidCash)}</span>
                                  </div>
                                );
                              } else {
                                const e = item.data as Expense;
                                const catInfo = getCategoryInfo(e.category);
                                const CatIcon = catInfo.icon;
                                return (
                                  <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-red-500/5">
                                    <div className="flex items-center gap-2">
                                      <CatIcon size={12} className={catInfo.color} />
                                      <span className="text-[10px] text-white/60">
                                        {e.description || (isBn ? catInfo.labelBn : isHi ? catInfo.labelHi : catInfo.label)}
                                      </span>
                                    </div>
                                    <span className="text-[10px] text-red-400 font-semibold">-{formatCurrency(e.amount)}</span>
                                  </div>
                                );
                              }
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
              {historyByDate().length === 0 && (
                <div className="text-center py-8">
                  <Calendar size={32} className="text-white/10 mx-auto mb-2" />
                  <p className="text-sm text-white/30">
                    {isBn ? 'কোনো ইতিহাস নেই' : isHi ? 'कोई इतिहास नहीं' : 'No history'}
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Cash Entry Form Modal */}
      <AnimatePresence>
        {showCashForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
            onClick={resetCashForm}
          >
            <motion.div
              initial={{ y: 300, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 300, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-card-strong p-6 w-full max-w-md rounded-t-3xl"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">
                  {editingCashId
                    ? isBn ? 'ক্যাশ সম্পাদনা' : isHi ? 'कैश संपादन' : 'Edit Cash Entry'
                    : isBn ? 'নতুন ক্যাশ এন্ট্রি' : isHi ? 'नई कैश एंट्री' : 'New Cash Entry'}
                </h3>
                <button onClick={resetCashForm} className="p-2 rounded-full hover:bg-white/10">
                  <X size={18} className="text-white/40" />
                </button>
              </div>

              {/* Date */}
              <div className="mb-3">
                <label className="text-xs text-white/50 mb-1 block">
                  {isBn ? 'তারিখ' : isHi ? 'तारीख' : 'Date'}
                </label>
                <input
                  type="date"
                  value={cashDate}
                  onChange={(e) => setCashDate(e.target.value)}
                  disabled={!!editingCashId}
                  className="glass-input w-full px-4 py-3 text-sm disabled:opacity-50"
                />
              </div>

              {/* Hand Cash */}
              <div className="mb-3">
                <label className="text-xs text-white/50 mb-1 block">
                  {isBn ? 'হ্যান্ড ক্যাশ (₹)' : isHi ? 'हैंड कैश (₹)' : 'Hand Cash (₹)'}
                </label>
                <input
                  type="number"
                  value={handCashInput}
                  onChange={(e) => setHandCashInput(e.target.value)}
                  placeholder="0"
                  className="glass-input w-full px-4 py-3 text-sm"
                  inputMode="decimal"
                />
              </div>

              {/* Liquid Cash */}
              <div className="mb-3">
                <label className="text-xs text-white/50 mb-1 block">
                  {isBn ? 'লিকুইড ক্যাশ (₹)' : isHi ? 'लिक्विड कैश (₹)' : 'Liquid Cash (₹)'}
                </label>
                <input
                  type="number"
                  value={liquidCashInput}
                  onChange={(e) => setLiquidCashInput(e.target.value)}
                  placeholder="0"
                  className="glass-input w-full px-4 py-3 text-sm"
                  inputMode="decimal"
                />
              </div>

              {/* Note */}
              <div className="mb-4">
                <label className="text-xs text-white/50 mb-1 block">
                  {isBn ? 'নোট (ঐচ্ছিক)' : isHi ? 'नोट (वैकल्पिक)' : 'Note (optional)'}
                </label>
                <input
                  type="text"
                  value={cashNote}
                  onChange={(e) => setCashNote(e.target.value)}
                  placeholder={isBn ? 'নোট লিখুন...' : isHi ? 'नोट लिखें...' : 'Add a note...'}
                  className="glass-input w-full px-4 py-3 text-sm"
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={resetCashForm}
                  className="flex-1 neon-btn py-3 text-sm font-semibold"
                >
                  {isBn ? 'বাতিল' : isHi ? 'रद्द करें' : 'Cancel'}
                </button>
                <button
                  onClick={handleSaveCash}
                  disabled={loading || (!handCashInput && !liquidCashInput)}
                  className="flex-1 neon-btn-solid py-3 text-sm font-semibold disabled:opacity-50"
                >
                  {loading ? '...' : isBn ? 'সংরক্ষণ' : isHi ? 'संरक्षित करें' : 'Save'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expense Form Modal */}
      <AnimatePresence>
        {showExpenseForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
            onClick={resetExpenseForm}
          >
            <motion.div
              initial={{ y: 300, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 300, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-card-strong p-6 w-full max-w-md rounded-t-3xl"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">
                  {editingExpenseId
                    ? isBn ? 'খরচ সম্পাদনা' : isHi ? 'खर्च संपादन' : 'Edit Expense'
                    : isBn ? 'নতুন খরচ' : isHi ? 'नया खर्च' : 'Add Expense'}
                </h3>
                <button onClick={resetExpenseForm} className="p-2 rounded-full hover:bg-white/10">
                  <X size={18} className="text-white/40" />
                </button>
              </div>

              {/* Date */}
              <div className="mb-3">
                <label className="text-xs text-white/50 mb-1 block">
                  {isBn ? 'তারিখ' : isHi ? 'तारीख' : 'Date'}
                </label>
                <input
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  disabled={!!editingExpenseId}
                  className="glass-input w-full px-4 py-3 text-sm disabled:opacity-50"
                />
              </div>

              {/* Amount */}
              <div className="mb-3">
                <label className="text-xs text-white/50 mb-1 block">
                  {isBn ? 'পরিমাণ (₹)' : isHi ? 'राशि (₹)' : 'Amount (₹)'}
                </label>
                <input
                  type="number"
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                  placeholder="0"
                  className="glass-input w-full px-4 py-3 text-sm"
                  inputMode="decimal"
                  autoFocus
                />
              </div>

              {/* Category */}
              <div className="mb-3">
                <label className="text-xs text-white/50 mb-1 block">
                  {isBn ? 'ক্যাটেগরি' : isHi ? 'कैटेगरी' : 'Category'}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {EXPENSE_CATEGORIES.map(cat => {
                    const CatIcon = cat.icon;
                    return (
                      <button
                        key={cat.key}
                        onClick={() => setExpenseCategory(cat.key)}
                        className={`p-2 rounded-xl flex flex-col items-center gap-1 transition-all ${
                          expenseCategory === cat.key
                            ? 'bg-emerald-500/20 border border-emerald-500/40'
                            : 'glass-card'
                        }`}
                      >
                        <CatIcon size={16} className={expenseCategory === cat.key ? 'text-emerald-400' : 'text-white/40'} />
                        <span className="text-[10px] text-white/60">
                          {isBn ? cat.labelBn : isHi ? cat.labelHi : cat.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Description */}
              <div className="mb-4">
                <label className="text-xs text-white/50 mb-1 block">
                  {isBn ? 'বিবরণ (ঐচ্ছিক)' : isHi ? 'विवरण (वैकल्पिक)' : 'Description (optional)'}
                </label>
                <input
                  type="text"
                  value={expenseDesc}
                  onChange={(e) => setExpenseDesc(e.target.value)}
                  placeholder={isBn ? 'খরচের বিবরণ...' : isHi ? 'खर्च का विवरण...' : 'Expense description...'}
                  className="glass-input w-full px-4 py-3 text-sm"
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={resetExpenseForm}
                  className="flex-1 neon-btn py-3 text-sm font-semibold"
                >
                  {isBn ? 'বাতিল' : isHi ? 'रद्द करें' : 'Cancel'}
                </button>
                <button
                  onClick={handleSaveExpense}
                  disabled={loading || !expenseAmount}
                  className="flex-1 py-3 text-sm font-semibold rounded-xl text-white disabled:opacity-50 transition-all"
                  style={{
                    background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                    border: '1px solid rgba(239,68,68,0.5)',
                  }}
                >
                  {loading ? '...' : isBn ? 'সংরক্ষণ' : isHi ? 'संरक्षित करें' : 'Save'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete confirmation dialog (cash & expense) */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6"
            onClick={() => setConfirmDelete(null)}
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
                {isBn ? 'মুছে ফেলবেন?' : isHi ? 'हटाएं?' : 'Delete this entry?'}
              </h3>
              <p className="text-sm text-white/50 text-center mb-6">
                {isBn ? 'এই অ্যাকশনটি ফেরানো যাবে না।' : isHi ? 'यह कार्य वापस नहीं किया जा सकता।' : 'This action cannot be undone.'}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="flex-1 glass-card py-3 text-sm font-semibold text-white/70 rounded-xl hover:bg-white/10 transition-colors"
                >
                  {isBn ? 'বাতিল' : isHi ? 'रद्द करें' : 'Cancel'}
                </button>
                <button
                  onClick={confirmDelete.type === 'cash' ? confirmDeleteCash : confirmDeleteExpense}
                  className="flex-1 py-3 text-sm font-semibold rounded-xl text-white transition-all"
                  style={{
                    background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
                    border: '1px solid rgba(220,38,38,0.5)',
                  }}
                >
                  {isBn ? 'মুছুন' : isHi ? 'हटाएं' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
