'use client';

/**
 * Due Book (বাকির খাতা) — every customer's outstanding credit in one place.
 *
 * Built entirely on the existing `bills` store (synced to the same Cloudflare
 * D1 database as the APK), so nothing new needs syncing:
 *   • bills with dueAmount > 0 are grouped by customer (mobile → name)
 *   • "Mark Paid" settles a bill via markBillPaidOffline → the updated
 *     `updatedAt` rides the normal D1 push to every device
 *   • WhatsApp reminder opens the customer's chat with a polite due message
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { getBillsOffline, markBillPaidOffline } from '@/lib/offline-service';
import { openWhatsappChat } from '@/lib/bill-pdf';
import { Bill } from '@/lib/types';
import {
  ArrowLeft, HandCoins, Search, MessageCircle, Check, ChevronDown,
  ChevronUp, IndianRupee, Users, ReceiptText,
} from 'lucide-react';
import { toast } from 'sonner';

interface CustomerGroup {
  key: string;
  name: string;
  mobile: string;
  totalDue: number;
  bills: Bill[];
}

export default function DueBookScreen() {
  const user = useAppStore(s => s.user);
  const language = useAppStore(s => s.language);
  const shopName = useAppStore(s => s.shopName);
  const goBack = useAppStore(s => s.goBack);

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
    title: t('dueBook', language),
    desc: t('dueBookDesc', language),
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
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <button onClick={goBack} className="p-2 rounded-full glass-card" aria-label="Back">
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-bold flex items-center gap-2">
              <HandCoins size={18} className="text-red-400" />
              {labels.title}
            </h1>
            <p className="text-[11px] text-white/40 truncate">{labels.desc}</p>
          </div>
        </div>

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
    </div>
  );
}
