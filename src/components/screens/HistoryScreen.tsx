'use client';

import { useEffect, useState, useMemo, useCallback, memo } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Transaction, Bill, BillingSettings } from '@/lib/types';
import { getTransactionsOffline, getBillsOffline, deleteBillOffline, getBillingSettingsOffline } from '@/lib/offline-service';
import { Clock, Search, FileText, MessageCircle, Share2, Trash2, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  generateBillPdf, downloadBlob, sharePdfFile, buildBillMessage, whatsappUrl,
  formatMoney, formatDate,
} from '@/lib/bill-pdf';

type FilterType = 'ALL' | 'STOCK_IN' | 'STOCK_OUT' | 'SELL';
type ViewType = 'transactions' | 'bills';

// ============ Date grouping helpers ============

interface DayGroup<T> {
  date: string;
  label: string;
  rows: T[];
  salesTotal: number;
  count: number;
  secondaryTotal: number; // stock-in total for txns / due total for bills
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function prettyDate(date: string, lang: 'bn' | 'en' | 'hi'): string {
  if (date === todayStr()) return t('today', lang);
  if (date === yesterdayStr()) return t('yesterday', lang);
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

function groupByDate<T extends { date: string }>(
  rows: T[],
  lang: 'bn' | 'en' | 'hi',
  computeTotals: (rows: T[]) => { salesTotal: number; secondaryTotal: number }
): DayGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.date) || [];
    list.push(row);
    map.set(row.date, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, list]) => {
      const totals = computeTotals(list);
      return { date, label: prettyDate(date, lang), rows: list, count: list.length, ...totals };
    });
}

// ============ Components ============

const TransactionItem = memo(function TransactionItem({ txn, typeColor, typeLabel, language, canBill, onMakeBill }: {
  txn: Transaction;
  typeColor: { bg: string; text: string };
  typeLabel: string;
  language: 'bn' | 'en' | 'hi';
  canBill: boolean;
  onMakeBill: (txn: Transaction) => void;
}) {
  return (
    <div className="glass-card p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${typeColor.bg} ${typeColor.text}`}>
            {typeLabel}
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
          <p className={`text-sm font-bold ${typeColor.text}`}>₹{txn.totalAmount.toLocaleString()}</p>
          <p className="text-[10px] text-white/40">
            {new Date(txn.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>
      {canBill && (
        <button
          onClick={() => onMakeBill(txn)}
          className="mt-3 w-full py-2 text-xs font-semibold rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 flex items-center justify-center gap-1.5 hover:bg-amber-500/25 transition-colors"
        >
          <FileText size={13} /> {t('makeBill', language)}
        </button>
      )}
    </div>
  );
});

export default function HistoryScreen() {
  const user = useAppStore(s => s.user);
  const language = useAppStore(s => s.language);
  const historyView = useAppStore(s => s.historyView);
  const setHistoryView = useAppStore(s => s.setHistoryView);
  const setPendingBillData = useAppStore(s => s.setPendingBillData);
  const setSelectedBillId = useAppStore(s => s.setSelectedBillId);
  const navigateTo = useAppStore(s => s.navigateTo);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [billingSettings, setBillingSettings] = useState<BillingSettings | null>(null);
  const [filter, setFilter] = useState<FilterType>('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyBillId, setBusyBillId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Bill | null>(null);

  // Load BOTH lists in parallel once — local IndexedDB is instant
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id) return;
      setLoading(true);
      try {
        const [txns, billRows, settings] = await Promise.all([
          getTransactionsOffline(user.id),
          getBillsOffline(user.id),
          getBillingSettingsOffline(user.id),
        ]);
        if (cancelled) return;
        setTransactions(txns || []);
        setBills(billRows || []);
        setBillingSettings(settings);
      } catch {
        if (!cancelled) toast.error(t('error', language));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, language]);

  const billedTxnIds = useMemo(() => new Set(bills.map(b => b.transactionId)), [bills]);

  // Client-side filtering — instant, no refetch
  const filteredTxns = useMemo(() => {
    let rows = filter === 'ALL' ? transactions : transactions.filter(x => x.type === filter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(x =>
        (x.product?.name || '').toLowerCase().includes(q) ||
        String(x.unitPrice).includes(q)
      );
    }
    return rows;
  }, [transactions, filter, search]);

  const filteredBills = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bills;
    return bills.filter(b =>
      b.customerName.toLowerCase().includes(q) ||
      b.customerMobile.includes(q) ||
      b.billNumber.toLowerCase().includes(q) ||
      b.items.some(i => i.name.toLowerCase().includes(q))
    );
  }, [bills, search]);

  const txnGroups = useMemo(
    () => groupByDate(filteredTxns, language, (rows) => ({
      salesTotal: rows.filter(r => r.type === 'SELL').reduce((s, r) => s + r.totalAmount, 0),
      secondaryTotal: rows.filter(r => r.type === 'STOCK_IN').reduce((s, r) => s + r.totalAmount, 0),
    })),
    [filteredTxns, language]
  );

  const billGroups = useMemo(
    () => groupByDate(filteredBills, language, (rows) => ({
      salesTotal: rows.reduce((s, b) => s + b.total, 0),
      secondaryTotal: rows.reduce((s, b) => s + b.dueAmount, 0),
    })),
    [filteredBills, language]
  );

  // ---- Bill actions ----
  const withPdf = useCallback(async (bill: Bill, action: 'whatsapp' | 'share' | 'download' | 'view') => {
    if (!user?.id) return;
    setBusyBillId(bill.id);
    try {
      const pdf = await generateBillPdf(bill, {
        signatureDataUrl: billingSettings?.signatureDataUrl,
        qrCodeDataUrl: billingSettings?.qrCodeDataUrl,
        upiId: billingSettings?.upiId,
        thankYouNote: billingSettings?.thankYouNote,
        termsText: billingSettings?.termsText,
      });
      if (action === 'download') {
        downloadBlob(pdf.blob, pdf.fileName);
        toast.success(t('downloadPdf', language) + ' ✓');
        return;
      }
      if (action === 'view') {
        const url = URL.createObjectURL(pdf.blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return;
      }
      if (action === 'whatsapp') {
        downloadBlob(pdf.blob, pdf.fileName);
        if (bill.customerMobile) {
          window.open(whatsappUrl(bill.customerMobile, buildBillMessage(bill)), '_blank');
          toast.success(t('shareWhatsappHint', language));
        } else {
          toast.error(t('customerPhone', language) + ' ' + t('error', language));
        }
        return;
      }
      // share
      const shared = await sharePdfFile(pdf.blob, pdf.fileName, buildBillMessage(bill));
      if (!shared) {
        downloadBlob(pdf.blob, pdf.fileName);
        if (bill.customerMobile) {
          window.open(whatsappUrl(bill.customerMobile, buildBillMessage(bill)), '_blank');
          toast.success(t('shareWhatsappHint', language));
        } else {
          toast.success(t('downloadPdf', language));
        }
      }
    } catch (error) {
      toast.error((error as Error).message || t('error', language));
    } finally {
      setBusyBillId(null);
    }
  }, [user?.id, language, billingSettings]);

  const handleDeleteBill = useCallback(async () => {
    if (!user?.id || !deleteTarget) return;
    try {
      await deleteBillOffline(deleteTarget.id, user.id);
      setBills(prev => prev.filter(b => b.id !== deleteTarget.id));
      toast.success(t('billDeleted', language));
    } catch {
      toast.error(t('error', language));
    } finally {
      setDeleteTarget(null);
    }
  }, [user?.id, deleteTarget, language]);

  const handleMakeBillFromTxn = useCallback((txn: Transaction) => {
    setPendingBillData({
      transactionId: txn.id,
      productId: txn.productId,
      productName: txn.product?.name || 'Product',
      quantity: txn.quantity,
      unitPrice: txn.unitPrice,
      totalAmount: txn.totalAmount,
      date: txn.date,
    });
    navigateTo('invoice');
  }, [setPendingBillData, navigateTo]);

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
      case 'SELL': return { bg: 'bg-emerald-700/20', text: 'text-emerald-600' };
      default: return { bg: 'bg-emerald-500/20', text: 'text-emerald-400' };
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

  const paymentLabel = (pm: string) => t((['cash', 'upi', 'card', 'due'].includes(pm) ? pm : 'cash') as 'cash', language);

  return (
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <div className="flex items-center justify-center mb-4">
          <div className="flex items-center gap-2">
            <Clock size={24} className="text-emerald-400" />
            <h1 className="text-lg font-bold neon-glow">{t('history', language)}</h1>
          </div>
        </div>

        {/* View switch: Transactions | Bills */}
        <div className="grid grid-cols-2 gap-2 p-1 glass-card rounded-xl mb-3">
          <button
            onClick={() => setHistoryView('transactions')}
            className={`py-2 text-xs font-semibold rounded-lg transition-all ${historyView === 'transactions' ? 'neon-btn-solid' : 'text-white/60'}`}
          >
            {t('transactionsLabel', language)}
          </button>
          <button
            onClick={() => setHistoryView('bills')}
            className={`py-2 text-xs font-semibold rounded-lg transition-all relative ${historyView === 'bills' ? 'neon-btn-solid' : 'text-white/60'}`}
          >
            <span className="inline-flex items-center gap-1.5">
              <FileText size={13} />
              {t('bills', language)}
              {bills.length > 0 && (
                <span className="text-[9px] bg-amber-500/30 text-amber-200 px-1.5 py-0.5 rounded-full">{bills.length}</span>
              )}
            </span>
          </button>
        </div>

        {/* Search (both views) */}
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={historyView === 'bills'
              ? `${t('bills', language)} / ${t('customerName', language)} / ${t('search', language)}...`
              : `${t('searchProducts', language)}`}
            className="glass-input w-full pl-10 pr-4 py-2.5 text-sm"
          />
        </div>

        {/* Type filter (transactions view only) */}
        {historyView === 'transactions' && (
          <div className="flex gap-2 mb-4 overflow-x-auto">
            {filterTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`px-4 py-2 text-xs font-semibold rounded-xl whitespace-nowrap transition-all ${
                  filter === tab.key ? 'neon-btn-solid' : 'glass-card text-white/60'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* ================= TRANSACTIONS ================= */}
        {historyView === 'transactions' && (
          <div className="space-y-5 max-h-[calc(100vh-260px)] overflow-y-auto pr-0.5">
            {loading ? (
              <div className="text-center py-8 text-white/40">{t('loading', language)}</div>
            ) : txnGroups.length === 0 ? (
              <div className="text-center py-12 text-white/40">{t('noData', language)}</div>
            ) : (
              txnGroups.map((group) => (
                <div key={group.date}>
                  {/* date header */}
                  <div className="sticky top-0 z-10 -mx-1 px-1 py-1.5 mb-2 backdrop-blur-md bg-[#0B0E18]/70">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-amber-300">{group.label}</span>
                      <span className="text-[10px] text-white/40">
                        {group.count} {t('transactionsLabel', language).toLowerCase()}
                        {group.salesTotal > 0 && <> • <span className="text-emerald-400 font-semibold">{t('soldAmount', language)} ₹{formatMoney(group.salesTotal)}</span></>}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {group.rows.map((txn) => (
                      <TransactionItem
                        key={txn.id}
                        txn={txn}
                        typeColor={getTypeColor(txn.type)}
                        typeLabel={getTypeLabel(txn.type)}
                        language={language}
                        canBill={(txn.type === 'SELL' || txn.type === 'STOCK_OUT') && !billedTxnIds.has(txn.id)}
                        onMakeBill={handleMakeBillFromTxn}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ================= BILLS ================= */}
        {historyView === 'bills' && (
          <div className="space-y-5 max-h-[calc(100vh-220px)] overflow-y-auto pr-0.5">
            {loading ? (
              <div className="text-center py-8 text-white/40">{t('loading', language)}</div>
            ) : billGroups.length === 0 ? (
              <div className="text-center py-12 text-white/40">
                <FileText size={30} className="mx-auto mb-3 opacity-40" />
                {t('noData', language)}
                <p className="text-[11px] text-white/30 mt-2">{t('eBillPromptDesc', language)}</p>
              </div>
            ) : (
              billGroups.map((group) => (
                <div key={group.date}>
                  <div className="sticky top-0 z-10 -mx-1 px-1 py-1.5 mb-2 backdrop-blur-md bg-[#0B0E18]/70">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-amber-300">{group.label}</span>
                      <span className="text-[10px] text-white/40">
                        {group.count} {t('bills', language).toLowerCase()}
                        <> • <span className="text-emerald-400 font-semibold">₹{formatMoney(group.salesTotal)}</span></>
                        {group.secondaryTotal > 0 && <> • <span className="text-red-400">{t('dueAmount', language)} ₹{formatMoney(group.secondaryTotal)}</span></>}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {group.rows.map((bill) => (
                      <BillCard
                        key={bill.id}
                        bill={bill}
                        busy={busyBillId === bill.id}
                        language={language}
                        paymentLabel={paymentLabel}
                        onView={() => { setSelectedBillId(bill.id); navigateTo('invoice'); }}
                        onWhatsapp={() => withPdf(bill, 'whatsapp')}
                        onShare={() => withPdf(bill, 'share')}
                        onDownload={() => withPdf(bill, 'download')}
                        onDelete={() => setDeleteTarget(bill)}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setDeleteTarget(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="glass-card-strong p-6 mx-4 max-w-sm w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold mb-2 text-red-400">{t('deleteBill', language)}</h3>
              <p className="text-sm text-white/60 mb-1">{deleteTarget.billNumber} — {deleteTarget.customerName}</p>
              <p className="text-sm text-white/60 mb-6">{t('thisActionCannot', language)}</p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteTarget(null)} className="flex-1 neon-btn py-2 text-sm font-semibold">{t('cancel', language)}</button>
                <button onClick={handleDeleteBill} className="flex-1 py-2 text-sm font-semibold rounded-xl bg-red-500/20 border border-red-500/30 text-red-400">{t('delete', language)}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============ Bill Card ============

const BillCard = memo(function BillCard({ bill, busy, language, paymentLabel, onView, onWhatsapp, onShare, onDownload, onDelete }: {
  bill: Bill;
  busy: boolean;
  language: 'bn' | 'en' | 'hi';
  paymentLabel: (pm: string) => string;
  onView: () => void;
  onWhatsapp: () => void;
  onShare: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="glass-card p-4">
      <button onClick={onView} className="w-full text-left">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-amber-300 shrink-0" />
              <span className="text-xs font-bold text-amber-200">{bill.billNumber}</span>
              {bill.dueAmount > 0 && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 font-semibold">{t('dueAmount', language)} ₹{formatMoney(bill.dueAmount)}</span>
              )}
            </div>
            <p className="text-sm font-medium text-white/90 mt-1.5 truncate">{bill.customerName}</p>
            <p className="text-[11px] text-white/50 truncate">
              {bill.items.map(i => `${i.name} ×${i.quantity}`).join(', ')}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-white/40">{bill.customerMobile}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/40">{paymentLabel(bill.paymentMethod)}</span>
            </div>
          </div>
          <div className="text-right ml-3 shrink-0">
            <p className="text-sm font-bold text-emerald-400">₹{formatMoney(bill.total)}</p>
            <p className="text-[10px] text-white/40">{formatDate(bill.date)}</p>
          </div>
        </div>
      </button>

      {/* actions */}
      <div className="grid grid-cols-4 gap-1.5 mt-3 pt-3 border-t border-white/10">
        <button onClick={onWhatsapp} disabled={busy} className="py-2 rounded-lg bg-green-600/20 border border-green-600/30 text-green-400 flex flex-col items-center gap-1 disabled:opacity-40" aria-label={t('whatsappSend', language)}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
          <span className="text-[9px] font-semibold">WhatsApp</span>
        </button>
        <button onClick={onShare} disabled={busy} className="py-2 rounded-lg bg-white/5 border border-white/10 text-white/70 flex flex-col items-center gap-1 disabled:opacity-40" aria-label={t('sharePdf', language)}>
          <Share2 size={14} />
          <span className="text-[9px] font-semibold">{t('sharePdf', language)}</span>
        </button>
        <button onClick={onDownload} disabled={busy} className="py-2 rounded-lg bg-white/5 border border-white/10 text-white/70 flex flex-col items-center gap-1 disabled:opacity-40" aria-label={t('downloadPdf', language)}>
          <Download size={14} />
          <span className="text-[9px] font-semibold">{t('downloadPdf', language)}</span>
        </button>
        <button onClick={onDelete} className="py-2 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 flex flex-col items-center gap-1" aria-label={t('deleteBill', language)}>
          <Trash2 size={14} />
          <span className="text-[9px] font-semibold">{t('delete', language)}</span>
        </button>
      </div>
    </div>
  );
});
