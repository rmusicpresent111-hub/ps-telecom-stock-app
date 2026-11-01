'use client';

/**
 * Due Book (বাকির খাতা) — v2.23.0, TWO tabs:
 *
 *  1. বিল বাকি (Bill Dues)   — customer-grouped outstanding `bills`
 *     (bills with dueAmount > 0, mark-paid, WhatsApp reminder) — unchanged.
 *  2. বাকি এন্ট্রি (Due Entry) — the CUSTOM credit ledger (`dueEntries` store,
 *     synced via D1): customer photo + product photo, product name, amount,
 *     optional কিস্তি payment schedule, per-installment collection, edit/delete.
 *     Entries created in the Admin Panel appear here automatically (and vice versa).
 */

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import {
  getBillsOffline, markBillPaidOffline,
  getDueEntriesOffline, createDueEntryOffline, updateDueEntryOffline,
  deleteDueEntryOffline, recordDueEntryPaymentOffline,
  dueEntryOutstanding, localDateStr,
} from '@/lib/offline-service';
import { fileToResizedDataUrl } from '@/lib/image-utils';
import { openWhatsappChat } from '@/lib/bill-pdf';
import { registerBackModal } from '@/lib/modal-back';
import { Bill, DueEntry, DueScheduleItem } from '@/lib/types';
import {
  ArrowLeft, HandCoins, Search, MessageCircle, Check, ChevronDown,
  ChevronUp, IndianRupee, Users, ReceiptText, Plus, Pencil, Trash2,
  Package, CalendarClock, X, Upload, Loader2, WalletCards,
} from 'lucide-react';
import { toast } from 'sonner';

const EPS = 0.009;

interface CustomerGroup {
  key: string;
  name: string;
  mobile: string;
  totalDue: number;
  bills: Bill[];
}

// ── due-entry helpers ───────────────────────────────────────────

type EntryStatus = 'paid' | 'partial' | 'pending';

function entryStatus(e: DueEntry): EntryStatus {
  if (dueEntryOutstanding(e) <= EPS) return 'paid';
  if ((Number(e.paidAmount) || 0) > EPS) return 'partial';
  return 'pending';
}

function nextDueItem(e: DueEntry): DueScheduleItem | null {
  const unpaid = (e.schedule || []).filter(it => it.amount - (it.paidAmount || 0) > EPS);
  if (unpaid.length === 0) return null;
  return unpaid.reduce((a, b) => ((a.dueDate || '9999') <= (b.dueDate || '9999') ? a : b));
}

function isItemOverdue(it: DueScheduleItem): boolean {
  return !!it.dueDate && it.dueDate < localDateStr() && it.amount - (it.paidAmount || 0) > EPS;
}

/** Same-day-of-month month addition that never overflows (Jan 31 → Feb 28). */
function addMonthsSafe(d: Date, months: number): Date {
  const y = d.getFullYear();
  const mo = d.getMonth() + months;
  const day = Math.min(d.getDate(), new Date(y, mo + 1, 0).getDate());
  return new Date(y, mo, day);
}

// ═════════════════════════════════════════════════════════════════

export default function DueBookScreen() {
  const language = useAppStore(s => s.language);

  const [tab, setTab] = useState<'bills' | 'entry'>('bills');

  return (
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <BackBtn />
          <div className="min-w-0">
            <h1 className="text-lg font-bold flex items-center gap-2">
              <HandCoins size={18} className="text-red-400" />
              {t('dueBook', language)}
            </h1>
            <p className="text-[11px] text-white/40 truncate">{t('dueBookDesc', language)}</p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setTab('bills')}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all border ${
              tab === 'bills'
                ? 'bg-red-500/15 border-red-400/40 text-red-300'
                : 'glass-card border-transparent text-white/50'
            }`}
          >
            <ReceiptText size={14} />
            {t('deTabBill', language)}
          </button>
          <button
            onClick={() => setTab('entry')}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all border ${
              tab === 'entry'
                ? 'bg-amber-400/15 border-amber-400/40 text-amber-300'
                : 'glass-card border-transparent text-white/50'
            }`}
          >
            <WalletCards size={14} />
            {t('deTabEntry', language)}
          </button>
        </div>

        {tab === 'bills' ? <BillsTab /> : <EntryTab />}
      </div>
    </div>
  );
}

function BackBtn() {
  const goBack = useAppStore(s => s.goBack);
  return (
    <button onClick={goBack} className="p-2 rounded-full glass-card" aria-label="Back">
      <ArrowLeft size={18} />
    </button>
  );
}

// ═════════════════════════════════════════════════════════════════
// TAB 1 — Bill Dues (unchanged behaviour)
// ═════════════════════════════════════════════════════════════════

function BillsTab() {
  const user = useAppStore(s => s.user);
  const language = useAppStore(s => s.language);
  const shopName = useAppStore(s => s.shopName);

  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [armedBill, setArmedBill] = useState<string | null>(null);
  const [payingBill, setPayingBill] = useState<string | null>(null);

  const fetchBills = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    try {
      const rows = await getBillsOffline(user.id);
      setBills(rows.filter(b => (b.dueAmount || 0) > 0.009));
    } catch {
      toast.error(t('error', language));
    } finally {
      setLoading(false);
    }
  }, [user?.id, language]);

  useEffect(() => {
    fetchBills();
  }, [fetchBills]);

  // Disarm the two-tap confirm after a short window (accidental-double-tap guard)
  useEffect(() => {
    if (!armedBill) return;
    const timer = setTimeout(() => setArmedBill(null), 3000);
    return () => clearTimeout(timer);
  }, [armedBill]);

  const groups = useMemo<CustomerGroup[]>(() => {
    const map = new Map<string, CustomerGroup>();
    for (const b of bills) {
      const name = b.customerName?.trim() || 'Walk-in Customer';
      const mobile = (b.customerMobile || '').trim();
      const key = mobile || `name:${name.toLowerCase()}`;
      const existing = map.get(key);
      if (existing) {
        existing.bills.push(b);
        existing.totalDue += b.dueAmount || 0;
        if (!existing.mobile && mobile) existing.mobile = mobile;
      } else {
        map.set(key, { key, name, mobile, totalDue: b.dueAmount || 0, bills: [b] });
      }
    }
    return Array.from(map.values())
      .map(g => ({ ...g, totalDue: Math.round(g.totalDue * 100) / 100, bills: g.bills.sort((a, b) => b.date.localeCompare(a.date)) }))
      .sort((a, b) => b.totalDue - a.totalDue);
  }, [bills]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(g =>
      g.name.toLowerCase().includes(q) || g.mobile.includes(q)
    );
  }, [groups, query]);

  const grandTotal = useMemo(() => groups.reduce((sum, g) => sum + g.totalDue, 0), [groups]);

  const handleMarkPaid = useCallback(async (bill: Bill) => {
    // Two-tap confirm — the first tap only arms the button
    if (armedBill !== bill.id) {
      setArmedBill(bill.id);
      return;
    }
    setArmedBill(null);
    if (!user?.id) return;
    setPayingBill(bill.id);
    try {
      await markBillPaidOffline(bill.id, user.id);
      toast.success(t('paymentRecorded', language));
      await fetchBills();
    } catch (err) {
      toast.error((err as Error)?.message || t('error', language));
    } finally {
      setPayingBill(null);
    }
  }, [armedBill, user?.id, language, fetchBills]);

  const handleRemind = useCallback((group: CustomerGroup) => {
    if (!group.mobile) return;
    const message = t('dueRemindMsg', language)
      .replace('{name}', group.name)
      .replace('{amount}', group.totalDue.toLocaleString('en-IN'))
      .replace('{bills}', String(group.bills.length))
      .replace('{shop}', shopName || 'PS TELECOM');
    openWhatsappChat(group.mobile, message);
  }, [language, shopName]);

  const labels = useMemo(() => ({
    totalDue: t('totalDue', language),
    customers: t('dueCustomersLabel', language),
    bills: t('dueBillsLabel', language),
    markPaid: t('markPaid', language),
    markPaidConfirm: t('markPaidConfirm', language),
    remind: t('whatsappRemind', language),
    noDues: t('noDues', language),
    noDuesDesc: t('noDuesDesc', language),
    search: t('searchDueCustomer', language),
    error: t('error', language),
  }), [language]);

  return (
    <div>
      {/* Summary card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card-strong rounded-2xl p-4 mb-4 border-red-500/20"
      >
        <div className="flex items-center gap-2 mb-1">
          <IndianRupee size={15} className="text-red-400" />
          <span className="text-xs text-white/60">{labels.totalDue}</span>
        </div>
        <p className="text-3xl font-bold text-red-400 mb-3">
          ₹{loading ? '…' : grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        <div className="flex items-center gap-4 text-[11px] text-white/50">
          <span className="flex items-center gap-1.5">
            <Users size={12} className="text-amber-300" />
            {loading ? '…' : groups.length} {labels.customers}
          </span>
          <span className="flex items-center gap-1.5">
            <ReceiptText size={12} className="text-amber-300" />
            {loading ? '…' : bills.length} {labels.bills}
          </span>
        </div>
      </motion.div>

      {/* Search */}
      {groups.length > 0 && (
        <div className="relative mb-4">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={labels.search}
            className="glass-input w-full pl-10 pr-4 py-2.5 text-sm"
            aria-label={labels.search}
          />
        </div>
      )}

      {/* Customer groups */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(n => (
            <div key={n} className="glass-card rounded-2xl p-4 animate-pulse">
              <div className="h-4 w-1/3 bg-white/10 rounded mb-2" />
              <div className="h-3 w-1/4 bg-white/5 rounded" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-card rounded-2xl p-10 text-center"
        >
          <HandCoins size={40} className="mx-auto text-emerald-400/60 mb-3" />
          <p className="text-base font-semibold text-emerald-300 mb-1">{labels.noDues}</p>
          <p className="text-xs text-white/40">{labels.noDuesDesc}</p>
        </motion.div>
      ) : (
        <div className="space-y-3">
          {filtered.map((group, gi) => {
            const isOpen = expanded === group.key;
            return (
              <motion.div
                key={group.key}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(gi * 0.04, 0.3) }}
                className="glass-card rounded-2xl overflow-hidden"
              >
                {/* Customer row */}
                <button
                  onClick={() => setExpanded(isOpen ? null : group.key)}
                  className="w-full p-4 flex items-center justify-between gap-3 text-left"
                  aria-expanded={isOpen}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{group.name}</p>
                    <p className="text-[11px] text-white/40">
                      {group.mobile || '—'} · {group.bills.length} {labels.bills}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-base font-bold text-red-400">
                      ₹{group.totalDue.toLocaleString('en-IN')}
                    </span>
                    {isOpen ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
                  </div>
                </button>

                {/* Expanded: bills + actions */}
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    className="border-t border-white/10"
                  >
                    <div className="p-3 space-y-2">
                      {group.bills.map(bill => (
                        <div
                          key={bill.id}
                          className="rounded-xl bg-white/[0.04] border border-white/5 p-3"
                        >
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="min-w-0">
                              <p className="text-xs font-medium truncate">
                                #{bill.billNumber} · {bill.date}
                              </p>
                              <p className="text-[11px] text-white/40 truncate">
                                {bill.items.map(i => `${i.name}×${i.quantity}`).join(', ')}
                              </p>
                            </div>
                            <span className="text-sm font-bold text-red-400 shrink-0">
                              ₹{(bill.dueAmount || 0).toLocaleString('en-IN')}
                            </span>
                          </div>
                          <button
                            onClick={() => handleMarkPaid(bill)}
                            disabled={payingBill === bill.id}
                            className={`w-full py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 ${
                              armedBill === bill.id
                                ? 'bg-emerald-500/25 border border-emerald-400/40 text-emerald-300'
                                : 'bg-white/5 border border-white/10 text-white/80 hover:bg-white/10'
                            }`}
                          >
                            {payingBill === bill.id ? (
                              <span className="w-3.5 h-3.5 border-2 border-emerald-300/30 border-t-emerald-300 rounded-full animate-spin" />
                            ) : (
                              <Check size={13} />
                            )}
                            {armedBill === bill.id ? labels.markPaidConfirm : labels.markPaid}
                          </button>
                        </div>
                      ))}

                      {/* WhatsApp reminder */}
                      {group.mobile && (
                        <button
                          onClick={() => handleRemind(group)}
                          className="w-full py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 transition-colors"
                        >
                          <MessageCircle size={14} />
                          WhatsApp {labels.remind}
                        </button>
                      )}
                    </div>
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// TAB 2 — Due Entry (custom credit ledger)
// ═════════════════════════════════════════════════════════════════

interface ScheduleRow { key: string; id?: string; dueDate: string; amount: string }

interface EntryForm {
  customerName: string;
  customerMobile: string;
  customerPhoto: string;
  productName: string;
  productPhoto: string;
  amount: string;
  date: string;
  note: string;
  schedule: ScheduleRow[];
}

function emptyEntryForm(): EntryForm {
  return {
    customerName: '', customerMobile: '', customerPhoto: '',
    productName: '', productPhoto: '', amount: '',
    date: localDateStr(), note: '', schedule: [],
  };
}

function EntryTab() {
  const user = useAppStore(s => s.user);
  const language = useAppStore(s => s.language);
  const shopName = useAppStore(s => s.shopName);

  const [entries, setEntries] = useState<DueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // form modal
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DueEntry | null>(null);
  const [form, setForm] = useState<EntryForm>(emptyEntryForm());
  const [splitCount, setSplitCount] = useState('');
  const [photoBusy, setPhotoBusy] = useState<'customer' | 'product' | null>(null);
  const [busy, setBusy] = useState(false);
  const uploadingRef = useRef(false);

  // payments
  const [payModal, setPayModal] = useState<{ entry: DueEntry; partial: boolean; amount: string } | null>(null);
  const [armedItem, setArmedItem] = useState<string | null>(null);
  const [payingItem, setPayingItem] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DueEntry | null>(null);

  const fetchEntries = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    try {
      const rows = await getDueEntriesOffline(user.id);
      setEntries(rows);
    } catch {
      toast.error(t('error', language));
    } finally {
      setLoading(false);
    }
  }, [user?.id, language]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Android back closes the topmost dialog first
  useEffect(() => {
    if (!formOpen) return;
    return registerBackModal(() => setFormOpen(false));
  }, [formOpen]);
  useEffect(() => {
    if (!payModal) return;
    return registerBackModal(() => setPayModal(null));
  }, [payModal]);
  useEffect(() => {
    if (!deleteTarget) return;
    return registerBackModal(() => setDeleteTarget(null));
  }, [deleteTarget]);

  // disarm the two-tap installment confirm
  useEffect(() => {
    if (!armedItem) return;
    const timer = setTimeout(() => setArmedItem(null), 3000);
    return () => clearTimeout(timer);
  }, [armedItem]);

  const labels = useMemo(() => ({
    outstanding: t('deOutstanding', language),
    collected: t('deCollected', language),
    search: t('searchDueCustomer', language),
    noEntries: t('deNoEntries', language),
    noEntriesDesc: t('deNoEntriesDesc', language),
    add: t('deAdd', language),
  }), [language]);

  const stats = useMemo(() => {
    let outstanding = 0;
    let collected = 0;
    for (const e of entries) {
      outstanding += dueEntryOutstanding(e);
      collected += Number(e.paidAmount) || 0;
    }
    return {
      outstanding: Math.round(outstanding * 100) / 100,
      collected: Math.round(collected * 100) / 100,
    };
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(e =>
      e.customerName.toLowerCase().includes(q) ||
      (e.customerMobile || '').includes(q) ||
      e.productName.toLowerCase().includes(q)
    );
  }, [entries, query]);

  // ── form handlers ──

  const openAdd = () => {
    setEditing(null);
    setForm(emptyEntryForm());
    setSplitCount('');
    setFormOpen(true);
  };

  const openEdit = (e: DueEntry) => {
    setEditing(e);
    setForm({
      customerName: e.customerName,
      customerMobile: e.customerMobile || '',
      customerPhoto: e.customerPhotoDataUrl || '',
      productName: e.productName,
      productPhoto: e.productPhotoDataUrl || '',
      amount: String(e.amount || ''),
      date: e.date || localDateStr(),
      note: e.note || '',
      schedule: (e.schedule || []).map(it => ({
        key: it.id, id: it.id, dueDate: it.dueDate, amount: String(it.amount || ''),
      })),
    });
    setSplitCount('');
    setFormOpen(true);
  };

  const handlePhotoFile = async (which: 'customer' | 'product', e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || uploadingRef.current) return;
    uploadingRef.current = true;
    setPhotoBusy(which);
    try {
      const url = which === 'customer'
        ? await fileToResizedDataUrl(file, 512, 60 * 1024)
        : await fileToResizedDataUrl(file, 640, 80 * 1024);
      setForm(p => ({ ...p, [which === 'customer' ? 'customerPhoto' : 'productPhoto']: url }));
    } catch (err) {
      toast.error((err as Error)?.message || t('error', language));
    } finally {
      uploadingRef.current = false;
      setPhotoBusy(null);
    }
  };

  const removePhoto = (which: 'customer' | 'product') => {
    setForm(p => ({ ...p, [which === 'customer' ? 'customerPhoto' : 'productPhoto']: '' }));
  };

  const applyAutoSplit = () => {
    const n = Math.floor(Number(splitCount) || 0);
    const total = Math.round((Number(form.amount) || 0) * 100) / 100;
    if (n < 2 || total <= 0) {
      toast.info(t('deScheduleHint', language));
      return;
    }
    const per = Math.floor((total / n) * 100) / 100;
    const start = form.date ? new Date(form.date + 'T00:00:00') : new Date();
    const rows: ScheduleRow[] = [];
    let assigned = 0;
    for (let i = 0; i < n; i++) {
      const isLast = i === n - 1;
      const amt = isLast ? Math.round((total - assigned) * 100) / 100 : per;
      assigned = Math.round((assigned + amt) * 100) / 100;
      rows.push({
        key: `sp-${Date.now().toString(36)}-${i}`,
        dueDate: localDateStr(addMonthsSafe(start, i + 1)),
        amount: String(amt),
      });
    }
    setForm(p => ({ ...p, schedule: rows }));
  };

  const scheduleTotal = useMemo(
    () => Math.round(form.schedule.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100,
    [form.schedule]
  );
  const formAmount = Math.round((Number(form.amount) || 0) * 100) / 100;
  const scheduleDiff = Math.round((formAmount - scheduleTotal) * 100) / 100;

  const saveForm = async () => {
    if (!user?.id) return;
    if (!form.customerName.trim() || !form.productName.trim() || !(formAmount > 0)) {
      toast.error(t('error', language));
      return;
    }
    for (const r of form.schedule) {
      if (!(Number(r.amount) > 0) || !r.dueDate) {
        toast.error(t('error', language));
        return;
      }
    }
    if (scheduleDiff < 0) {
      toast.error(t('deOverAssigned', language).replace('{amount}', Math.abs(scheduleDiff).toLocaleString('en-IN')));
      return;
    }
    setBusy(true);
    try {
      const schedule = form.schedule.map(r => ({
        ...(r.id ? { id: r.id } : {}),
        dueDate: r.dueDate,
        amount: Number(r.amount),
      }));
      if (editing) {
        await updateDueEntryOffline(editing.id, {
          customerName: form.customerName,
          customerMobile: form.customerMobile,
          customerPhotoDataUrl: form.customerPhoto,
          productName: form.productName,
          productPhotoDataUrl: form.productPhoto,
          amount: formAmount,
          date: form.date,
          note: form.note,
          schedule,
        }, user.id);
        toast.success(t('save', language));
      } else {
        await createDueEntryOffline({
          userId: user.id,
          customerName: form.customerName,
          customerMobile: form.customerMobile,
          customerPhotoDataUrl: form.customerPhoto,
          productName: form.productName,
          productPhotoDataUrl: form.productPhoto,
          amount: formAmount,
          schedule,
          note: form.note,
          date: form.date,
        });
        toast.success(t('deAdd', language) + ' ✓');
      }
      setFormOpen(false);
      await fetchEntries();
    } catch (err) {
      toast.error((err as Error)?.message || t('error', language));
    } finally {
      setBusy(false);
    }
  };

  // ── payment / delete ──

  const doPay = async () => {
    if (!user?.id || !payModal) return;
    setBusy(true);
    try {
      if (payModal.partial) {
        const amt = Number(payModal.amount);
        if (!(amt > 0)) { setBusy(false); return; }
        await recordDueEntryPaymentOffline(payModal.entry.id, user.id, amt);
      } else {
        await recordDueEntryPaymentOffline(payModal.entry.id, user.id);
      }
      toast.success(t('paymentRecorded', language));
      setPayModal(null);
      await fetchEntries();
    } catch (err) {
      toast.error((err as Error)?.message || t('error', language));
    } finally {
      setBusy(false);
    }
  };

  const payInstallment = async (entryId: string, itemId: string) => {
    if (!user?.id) return;
    // two-tap confirm
    if (armedItem !== itemId) {
      setArmedItem(itemId);
      return;
    }
    setArmedItem(null);
    setPayingItem(itemId);
    try {
      await recordDueEntryPaymentOffline(entryId, user.id, undefined, { scheduleItemId: itemId });
      toast.success(t('deInstallmentPaid', language));
      await fetchEntries();
    } catch (err) {
      toast.error((err as Error)?.message || t('error', language));
    } finally {
      setPayingItem(null);
    }
  };

  const doDelete = async () => {
    if (!user?.id || !deleteTarget) return;
    setBusy(true);
    try {
      await deleteDueEntryOffline(deleteTarget.id, user.id);
      toast.success(t('deTabEntry', language) + ' ✓');
      setDeleteTarget(null);
      await fetchEntries();
    } catch (err) {
      toast.error((err as Error)?.message || t('error', language));
    } finally {
      setBusy(false);
    }
  };

  const remindEntry = (e: DueEntry) => {
    if (!e.customerMobile) return;
    const message = t('dueRemindMsg', language)
      .replace('{name}', e.customerName)
      .replace('{amount}', dueEntryOutstanding(e).toLocaleString('en-IN'))
      .replace('{bills}', '1')
      .replace('{shop}', shopName || 'PS TELECOM');
    openWhatsappChat(e.customerMobile, message);
  };

  const statusChip = (e: DueEntry) => {
    const s = entryStatus(e);
    const cls = s === 'paid'
      ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
      : s === 'partial'
        ? 'bg-amber-400/15 border-amber-400/40 text-amber-300'
        : 'bg-red-500/15 border-red-400/40 text-red-300';
    const txt = s === 'paid' ? t('deStatusPaid', language) : s === 'partial' ? t('deStatusPartial', language) : t('deStatusPending', language);
    return <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${cls}`}>{txt}</span>;
  };

  return (
    <div>
      {/* Summary */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card-strong rounded-2xl p-4 mb-4 border-amber-400/20"
      >
        <div className="flex items-center gap-2 mb-1">
          <IndianRupee size={15} className="text-red-400" />
          <span className="text-xs text-white/60">{labels.outstanding}</span>
        </div>
        <p className="text-3xl font-bold text-red-400 mb-3">
          ₹{loading ? '…' : stats.outstanding.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        <div className="flex items-center gap-4 text-[11px] text-white/50">
          <span className="flex items-center gap-1.5">
            <HandCoins size={12} className="text-emerald-300" />
            {labels.collected}: ₹{loading ? '…' : stats.collected.toLocaleString('en-IN')}
          </span>
          <span className="flex items-center gap-1.5">
            <Users size={12} className="text-amber-300" />
            {loading ? '…' : entries.length}
          </span>
        </div>
      </motion.div>

      {/* Search */}
      {entries.length > 0 && (
        <div className="relative mb-4">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={labels.search}
            className="glass-input w-full pl-10 pr-4 py-2.5 text-sm"
            aria-label={labels.search}
          />
        </div>
      )}

      {/* Entries */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(n => (
            <div key={n} className="glass-card rounded-2xl p-4 animate-pulse">
              <div className="h-4 w-1/3 bg-white/10 rounded mb-2" />
              <div className="h-3 w-1/4 bg-white/5 rounded" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-card rounded-2xl p-10 text-center"
        >
          <WalletCards size={40} className="mx-auto text-amber-300/60 mb-3" />
          <p className="text-base font-semibold text-amber-300 mb-1">{labels.noEntries}</p>
          <p className="text-xs text-white/40 mb-4">{labels.noEntriesDesc}</p>
          <button
            onClick={openAdd}
            className="neon-btn-solid inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold"
          >
            <Plus size={14} /> {labels.add}
          </button>
        </motion.div>
      ) : (
        <div className="space-y-3">
          {filtered.map((e, gi) => {
            const isOpen = expanded === e.id;
            const outstanding = dueEntryOutstanding(e);
            const pct = e.amount > 0 ? Math.min(100, Math.round(((e.paidAmount || 0) / e.amount) * 100)) : 0;
            const next = nextDueItem(e);
            return (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(gi * 0.04, 0.3) }}
                className="glass-card rounded-2xl overflow-hidden"
              >
                {/* collapsed row */}
                <button
                  onClick={() => setExpanded(isOpen ? null : e.id)}
                  className="w-full p-4 flex items-center justify-between gap-3 text-left"
                  aria-expanded={isOpen}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-11 h-11 rounded-xl overflow-hidden shrink-0 bg-white/5 flex items-center justify-center">
                      {e.customerPhotoDataUrl ? (
                         
                        <img src={e.customerPhotoDataUrl} alt={e.customerName} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-sm font-bold text-amber-300">{e.customerName.charAt(0).toUpperCase()}</span>
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold truncate">{e.customerName}</p>
                        {statusChip(e)}
                      </div>
                      <p className="text-[11px] text-white/40 truncate">{e.productName} · {e.date}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="h-1 w-20 rounded-full bg-white/10 overflow-hidden">
                          <span className="block h-full rounded-full bg-emerald-400" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="text-[9px] text-white/40 tabular-nums">{pct}%</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <p className="text-base font-bold text-red-400">₹{outstanding.toLocaleString('en-IN')}</p>
                      <p className="text-[9px] text-white/40">
                        {next ? `${t('deNextDue', language)}: ${next.dueDate}` : t('deNoSchedule', language)}
                      </p>
                    </div>
                    {isOpen ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
                  </div>
                </button>

                {/* expanded */}
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    className="border-t border-white/10"
                  >
                    <div className="p-3 space-y-2.5">
                      {/* photos + meta */}
                      <div className="flex gap-2">
                        <div className="w-20 h-20 rounded-xl overflow-hidden bg-white/5 flex items-center justify-center shrink-0">
                          {e.customerPhotoDataUrl ? (
                             
                            <img src={e.customerPhotoDataUrl} alt={e.customerName} className="w-full h-full object-cover" />
                          ) : (
                            <Users size={20} className="text-white/20" />
                          )}
                        </div>
                        <div className="w-20 h-20 rounded-xl overflow-hidden bg-white/5 flex items-center justify-center shrink-0">
                          {e.productPhotoDataUrl ? (
                             
                            <img src={e.productPhotoDataUrl} alt={e.productName} className="w-full h-full object-cover" />
                          ) : (
                            <Package size={20} className="text-white/20" />
                          )}
                        </div>
                        <div className="min-w-0 grow grid grid-cols-2 gap-1 text-[10px]">
                          <span className="text-white/40">{t('deAmount', language)}</span>
                          <span className="font-bold text-white/80 text-right tabular-nums">₹{e.amount.toLocaleString('en-IN')}</span>
                          <span className="text-white/40">{t('deCollectedOf', language)}</span>
                          <span className="font-bold text-emerald-300 text-right tabular-nums">₹{(e.paidAmount || 0).toLocaleString('en-IN')}</span>
                          <span className="text-white/40">{t('deEntryDate', language)}</span>
                          <span className="text-white/70 text-right">{e.date}</span>
                          {e.customerMobile && (
                            <>
                              <span className="text-white/40">{t('deMobile', language)}</span>
                              <span className="text-white/70 text-right">{e.customerMobile}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {e.note && (
                        <p className="text-[11px] text-white/50 bg-white/[0.04] border border-white/5 rounded-xl p-2.5">{e.note}</p>
                      )}

                      {/* schedule */}
                      {(e.schedule || []).length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-[10px] font-bold text-white/40 uppercase tracking-wide">{t('deSchedule', language)}</p>
                          {e.schedule.map((it, ix) => {
                            const done = it.amount - (it.paidAmount || 0) <= EPS;
                            const part = !done && (it.paidAmount || 0) > EPS;
                            return (
                              <div
                                key={it.id}
                                className={`flex items-center gap-2 rounded-xl px-3 py-2 border ${
                                  done
                                    ? 'bg-emerald-500/10 border-emerald-400/20'
                                    : isItemOverdue(it)
                                      ? 'bg-red-500/10 border-red-400/20'
                                      : 'bg-white/[0.04] border-white/5'
                                }`}
                              >
                                <span className={`w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 ${done ? 'bg-emerald-400 text-black' : 'border border-white/20 text-white/30'}`}>
                                  {done && <Check size={11} />}
                                </span>
                                <div className="min-w-0 grow">
                                  <p className="text-[11px] font-semibold">
                                    {t('deKisti', language)} {ix + 1} · {it.dueDate || '—'}
                                  </p>
                                  <p className="text-[9px] text-white/40 tabular-nums">
                                    {part ? `₹${(it.paidAmount || 0).toLocaleString('en-IN')} / ` : ''}₹{it.amount.toLocaleString('en-IN')}
                                    {it.paidAt ? ` · ${t('dePaidOn', language)} ${it.paidAt.slice(0, 10)}` : ''}
                                  </p>
                                </div>
                                {!done && outstanding > EPS && (
                                  <button
                                    onClick={() => payInstallment(e.id, it.id)}
                                    disabled={payingItem === it.id}
                                    className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all disabled:opacity-50 ${
                                      armedItem === it.id
                                        ? 'bg-emerald-500/30 border border-emerald-400/50 text-emerald-200'
                                        : 'bg-white/5 border border-white/10 text-white/70'
                                    }`}
                                  >
                                    {payingItem === it.id ? (
                                      <span className="w-3 h-3 border-2 border-emerald-300/30 border-t-emerald-300 rounded-full animate-spin" />
                                    ) : (
                                      <HandCoins size={11} />
                                    )}
                                    {armedItem === it.id ? '✓' : t('deCollectKisti', language)}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* actions */}
                      {outstanding > EPS && (
                        <button
                          onClick={() => setPayModal({ entry: e, partial: false, amount: '' })}
                          className="w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 transition-colors"
                        >
                          <HandCoins size={14} />
                          {t('deRecordPayment', language)} — ₹{outstanding.toLocaleString('en-IN')}
                        </button>
                      )}
                      <div className="flex gap-2">
                        {e.customerMobile && (
                          <button
                            onClick={() => remindEntry(e)}
                            className="grow py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 transition-colors"
                          >
                            <MessageCircle size={14} /> WhatsApp
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(e)}
                          className="grow py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 transition-colors"
                        >
                          <Pencil size={13} /> {t('deEdit', language)}
                        </button>
                        <button
                          onClick={() => setDeleteTarget(e)}
                          className="py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 bg-red-500/10 border border-red-400/25 text-red-300 hover:bg-red-500/20 transition-colors"
                          aria-label={t('deDeleteConfirm', language)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* FAB — add entry */}
      <motion.button
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={openAdd}
        className="fixed bottom-24 right-4 z-40 w-14 h-14 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 text-black shadow-[0_8px_24px_rgba(212,168,83,0.4)] flex items-center justify-center active:scale-95 transition-transform"
        aria-label={labels.add}
      >
        <Plus size={24} />
      </motion.button>

      {/* ── add/edit modal ── */}
      <AnimatePresence>
        {formOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
          >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setFormOpen(false)} />
            <motion.div
              initial={{ y: 60, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 40, opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="relative glass-card-strong w-full max-w-md rounded-t-3xl sm:rounded-3xl max-h-[88vh] flex flex-col border-white/10"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
                <h3 className="text-base font-bold">{editing ? t('deEdit', language) : t('deAdd', language)}</h3>
                <button onClick={() => setFormOpen(false)} className="p-1.5 rounded-full bg-white/5" aria-label="Close">
                  <X size={16} />
                </button>
              </div>

              <div className="overflow-y-auto px-5 py-4 grow space-y-3">
                {/* photos */}
                <div className="grid grid-cols-2 gap-3">
                  <PhotoPicker
                    which="customer"
                    label={t('deCustomerPhoto', language)}
                    value={form.customerPhoto}
                    busy={photoBusy === 'customer'}
                    onFile={handlePhotoFile}
                    onRemove={removePhoto}
                  />
                  <PhotoPicker
                    which="product"
                    label={t('deProductPhoto', language)}
                    value={form.productPhoto}
                    busy={photoBusy === 'product'}
                    onFile={handlePhotoFile}
                    onRemove={removePhoto}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-white/50 mb-1.5">{t('deCustomer', language)} *</label>
                  <input
                    value={form.customerName}
                    onChange={(e) => setForm(p => ({ ...p, customerName: e.target.value }))}
                    className="glass-input w-full px-3 py-2.5 text-sm"
                    placeholder={t('deCustomer', language)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-white/50 mb-1.5">{t('deMobile', language)}</label>
                    <input
                      value={form.customerMobile}
                      onChange={(e) => setForm(p => ({ ...p, customerMobile: e.target.value }))}
                      className="glass-input w-full px-3 py-2.5 text-sm"
                      inputMode="tel"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-white/50 mb-1.5">{t('deDate', language)}</label>
                    <input
                      type="date"
                      value={form.date}
                      onChange={(e) => setForm(p => ({ ...p, date: e.target.value }))}
                      className="glass-input w-full px-3 py-2.5 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-white/50 mb-1.5">{t('deProduct', language)} *</label>
                  <input
                    value={form.productName}
                    onChange={(e) => setForm(p => ({ ...p, productName: e.target.value }))}
                    className="glass-input w-full px-3 py-2.5 text-sm"
                    placeholder={t('deProduct', language)}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-white/50 mb-1.5">{t('deAmount', language)} *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm(p => ({ ...p, amount: e.target.value }))}
                    className="glass-input w-full px-3 py-2.5 text-sm"
                    inputMode="decimal"
                  />
                </div>

                {/* schedule */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[11px] font-bold text-white/60">{t('deSchedule', language)}</span>
                    <span className={`text-[10px] font-semibold tabular-nums ${scheduleDiff < 0 ? 'text-red-300' : 'text-white/40'}`}>
                      {scheduleDiff > EPS
                        ? t('deUnassigned', language).replace('{amount}', scheduleDiff.toLocaleString('en-IN'))
                        : scheduleDiff < -EPS
                          ? t('deOverAssigned', language).replace('{amount}', Math.abs(scheduleDiff).toLocaleString('en-IN'))
                          : ''}
                    </span>
                  </div>
                  <p className="text-[10px] text-white/30 mb-2.5">{t('deScheduleHint', language)}</p>

                  <div className="space-y-2">
                    {form.schedule.map((r, ix) => (
                      <div key={r.key} className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-white/30 w-6 shrink-0">#{ix + 1}</span>
                        <input
                          type="date"
                          value={r.dueDate}
                          onChange={(e) => setForm(p => ({ ...p, schedule: p.schedule.map(x => x.key === r.key ? { ...x, dueDate: e.target.value } : x) }))}
                          className="glass-input grow min-w-0 px-2 py-1.5 text-[11px]"
                          aria-label={`${t('deDueOn', language)} ${ix + 1}`}
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={r.amount}
                          onChange={(e) => setForm(p => ({ ...p, schedule: p.schedule.map(x => x.key === r.key ? { ...x, amount: e.target.value } : x) }))}
                          className="glass-input w-20 px-2 py-1.5 text-[11px] tabular-nums"
                          inputMode="decimal"
                          aria-label={`${t('deKisti', language)} ${ix + 1}`}
                        />
                        <button
                          onClick={() => setForm(p => ({ ...p, schedule: p.schedule.filter(x => x.key !== r.key) }))}
                          className="p-1.5 rounded-lg text-white/40 hover:text-red-300 shrink-0"
                          aria-label={t('deRemove', language)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 mt-2.5">
                    <button
                      onClick={() => setForm(p => ({
                        ...p,
                        schedule: [...p.schedule, { key: `s-${Date.now().toString(36)}`, dueDate: localDateStr(addMonthsSafe(new Date(), p.schedule.length + 1)), amount: '' }],
                      }))}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold bg-amber-400/15 border border-amber-400/30 text-amber-300"
                    >
                      <Plus size={12} /> {t('deAddInstallment', language)}
                    </button>
                    <input
                      type="number"
                      min="2"
                      value={splitCount}
                      onChange={(e) => setSplitCount(e.target.value)}
                      className="glass-input w-14 px-2 py-2 text-[11px]"
                      placeholder="6"
                      aria-label={t('deAutoSplit', language)}
                    />
                    <button
                      onClick={applyAutoSplit}
                      className="px-3 py-2 rounded-xl text-[11px] font-bold bg-white/5 border border-white/10 text-white/70"
                    >
                      {t('deAutoSplitBtn', language)}
                    </button>
                    <span className="text-[10px] text-white/30">{t('deAutoSplit', language)}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-white/50 mb-1.5">{t('deNote', language)}</label>
                  <textarea
                    value={form.note}
                    onChange={(e) => setForm(p => ({ ...p, note: e.target.value }))}
                    className="glass-input w-full px-3 py-2.5 text-sm min-h-16"
                    rows={2}
                  />
                </div>
              </div>

              <div className="flex gap-2 px-5 py-3.5 border-t border-white/10 shrink-0">
                <button
                  onClick={() => setFormOpen(false)}
                  className="grow py-3 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/70"
                >
                  {t('cancel', language)}
                </button>
                <button
                  onClick={saveForm}
                  disabled={busy}
                  className="grow py-3 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-300 to-amber-500 text-black flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {busy && <Loader2 size={14} className="animate-spin" />}
                  {t('save', language)}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── record payment modal ── */}
      <AnimatePresence>
        {payModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setPayModal(null)} />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="relative glass-card-strong w-full max-w-xs rounded-3xl p-5 border-white/10"
            >
              <h3 className="text-base font-bold mb-1 flex items-center gap-2">
                <HandCoins size={16} className="text-emerald-300" />
                {t('deRecordPayment', language)}
              </h3>
              <p className="text-xs text-white/40 mb-4">
                {payModal.entry.customerName} · {payModal.entry.productName}
              </p>
              <p className="text-2xl font-bold text-red-400 mb-4 tabular-nums">
                ₹{dueEntryOutstanding(payModal.entry).toLocaleString('en-IN')}
              </p>
              {payModal.partial && (
                <div className="mb-3">
                  <label className="block text-[11px] font-semibold text-white/50 mb-1.5">
                    {t('dePartialAmount', language).replace('{amount}', dueEntryOutstanding(payModal.entry).toLocaleString('en-IN'))}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={payModal.amount}
                    onChange={(e) => setPayModal({ ...payModal, amount: e.target.value })}
                    className="glass-input w-full px-3 py-2.5 text-sm"
                    inputMode="decimal"
                    autoFocus
                  />
                </div>
              )}
              {!payModal.partial && (
                <p className="text-[11px] text-white/50 bg-emerald-500/10 border border-emerald-400/20 rounded-xl p-2.5 mb-3">
                  {t('deFullRemaining', language).replace('{amount}', dueEntryOutstanding(payModal.entry).toLocaleString('en-IN'))}
                </p>
              )}
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => setPayModal({ ...payModal, partial: false })}
                  className={`grow py-2 rounded-xl text-[11px] font-bold border transition-colors ${!payModal.partial ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300' : 'bg-white/5 border-white/10 text-white/60'}`}
                >
                  {t('totalDue', language)}
                </button>
                <button
                  onClick={() => setPayModal({ ...payModal, partial: true, amount: '' })}
                  className={`grow py-2 rounded-xl text-[11px] font-bold border transition-colors ${payModal.partial ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300' : 'bg-white/5 border-white/10 text-white/60'}`}
                >
                  {t('deStatusPartial', language)}
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPayModal(null)}
                  className="grow py-3 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/70"
                >
                  {t('cancel', language)}
                </button>
                <button
                  onClick={doPay}
                  disabled={busy}
                  className="grow py-3 rounded-xl text-xs font-bold bg-emerald-500/80 text-white flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {busy && <Loader2 size={14} className="animate-spin" />}
                  {t('markPaid', language)}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── delete confirm modal ── */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setDeleteTarget(null)} />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="relative glass-card-strong w-full max-w-xs rounded-3xl p-5 border-white/10 text-center"
            >
              <Trash2 size={28} className="mx-auto text-red-400 mb-2" />
              <p className="text-sm font-semibold mb-1">{t('deDeleteConfirm', language)}</p>
              <p className="text-xs text-white/40 mb-4">{deleteTarget.customerName} · {deleteTarget.productName}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="grow py-3 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-white/70"
                >
                  {t('cancel', language)}
                </button>
                <button
                  onClick={doDelete}
                  disabled={busy}
                  className="grow py-3 rounded-xl text-xs font-bold bg-red-500/80 text-white flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {busy && <Loader2 size={14} className="animate-spin" />}
                  {t('deRemove', language)}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── photo picker (app-style) ────────────────────────────────────

function PhotoPicker({
  which, label, value, busy, onFile, onRemove,
}: {
  which: 'customer' | 'product';
  label: string;
  value: string;
  busy: boolean;
  onFile: (which: 'customer' | 'product', e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (which: 'customer' | 'product') => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const language = useAppStore(s => s.language);
  return (
    <div>
      <span className="block text-[11px] font-semibold text-white/50 mb-1.5">{label}</span>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
        className="relative w-full aspect-square rounded-2xl border border-dashed border-white/20 bg-white/[0.03] flex items-center justify-center overflow-hidden cursor-pointer hover:border-amber-400/40 transition-colors"
      >
        {value ? (
           
          <img src={value} alt={label} className="w-full h-full object-cover" />
        ) : which === 'customer' ? (
          <Users size={22} className="text-white/20" />
        ) : (
          <Package size={22} className="text-white/20" />
        )}
        {!value && (
          <span className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-full bg-amber-400/20 border border-amber-400/30 text-amber-300 flex items-center justify-center">
            <Upload size={11} />
          </span>
        )}
        {busy && (
          <span className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <Loader2 size={18} className="animate-spin text-amber-300" />
          </span>
        )}
      </div>
      {value ? (
        <button
          onClick={() => onRemove(which)}
          className="mt-1 text-[10px] font-semibold text-red-300/80 hover:text-red-300"
        >
          {t('deRemove', language)}
        </button>
      ) : (
        <span className="block mt-1 text-[9px] text-white/25">{t('dePhotoHint', language)}</span>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={(e) => onFile(which, e)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}
