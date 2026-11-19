'use client';

/**
 * Admin Due Book — THE single place for every due (v2.44.0 unified):
 *
 *  • সব বাকি / All Dues — one customer-wise list merging BILL dues and
 *    standalone DUE ENTRIES; each group is expandable and carries both a
 *    WhatsApp and a native SMS reminder.
 *  • বাকি এন্ট্রি / Due Entries — the full due-entry manager embedded as a
 *    tab (photos, schedules, installments) instead of a separate section.
 *  • হিস্ট্রি / History — day-wise due growth + collection tally.
 *
 * The dashboard "To Collect" card links here and shows the SAME combined
 * total, so nothing about dues lives outside this page anymore.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown, Users, BadgeIndianRupee, ReceiptText, MessageCircle, Smartphone,
  CheckCircle2, LineChart as LineChartIcon, Banknote, ArrowDownLeft, ArrowUpRight,
  HandCoins, CalendarClock, Plus, CreditCard, Landmark, History as HistoryIcon,
} from 'lucide-react';
import { getBillsOffline, markBillPaidOffline, getDueEntriesOffline, recordDueEntryPaymentOffline, dueEntryOutstanding } from '@/lib/offline-service';
import { buildDueDaily } from '@/lib/cash-daily';
import type { DueEntry, DuePaymentMethod, DuePaymentRecord } from '@/lib/types';
import { DEFAULT_USER_ID } from '@/lib/local-auth';
import { useAdminStore } from '@/store/adminStore';
import { ta, taf } from '@/lib/admin-i18n';
import { useAdminDataTick } from './useAdminData';
import {
  AdminCard,
  Badge,
  Btn,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  StatCard,
  TextInput,
  adminToast,
  fmtMoney,
  fmtDate,
  fmtDateTime,
} from './admin-ui';
import { PeriodToggle, windowPoints, DailyTallyChart, collapseFlat, type Period, type ChartPoint, type TallyRow } from './AdminHistoryKit';
import type { Bill } from '@/lib/types';
import AdminDueEntry from './AdminDueEntry';

const EPS = 0.009;

/** v2.45.0 — how each installment method renders in the history timeline. */
const PAY_METHOD_META: Record<DuePaymentMethod, { icon: typeof Banknote; tone: 'green' | 'orange' | 'amber' | 'slate' }> = {
  cash: { icon: Banknote, tone: 'green' },
  upi: { icon: Smartphone, tone: 'orange' },
  card: { icon: CreditCard, tone: 'amber' },
  bank: { icon: Landmark, tone: 'slate' },
};

/** YYYY-MM-DD for "today" in the device's LOCAL timezone (never UTC). */
const todayLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** HH:MM for "now" (local) — used as the default installment time. */
const nowHHMM = (): string => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Combine the modal's date + time inputs into a local ISO instant. */
const atFromInputs = (date: string, time: string): string =>
  new Date(`${date}T${(time || '00:00').slice(0, 5)}:00`).toISOString();

/** Parse a free-typed amount field into a clean 2-decimal rupee number. */
const round2Number = (v: string): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

/** One open due item — either a bill's remaining due or a due entry. */
interface UnifiedItem {
  kind: 'bill' | 'entry';
  id: string;
  label: string;
  date: string;
  due: number;
  total: number;
  paid: number;
  /** v2.45.0 — installment payment ledger (bill or entry). */
  payments: DuePaymentRecord[];
  bill?: Bill;
  entry?: DueEntry;
}

interface DueGroup {
  key: string;
  name: string;
  mobile: string;
  items: UnifiedItem[];
  totalDue: number;
}

type DueTab = 'all' | 'entries' | 'history';

/** v2.45.0 — the installment-payment modal target (amount+date+time+method+note). */
interface PayTarget {
  item: UnifiedItem;
  amount: string;
  date: string;
  time: string;
  method: DuePaymentMethod;
  note: string;
}

export default function AdminDueBook() {
  const lang = useAdminStore((s) => s.language);
  const t = (k: string) => ta(k, lang);
  const tf = (k: string, v: Record<string, string | number>) => taf(k, lang, v);
  const tick = useAdminDataTick();

  const [bills, setBills] = useState<Bill[]>([]);
  const [dueEntries, setDueEntries] = useState<DueEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [payModal, setPayModal] = useState<PayTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<DueTab>('all');
  const [period, setPeriod] = useState<Period>('30');
  /** v2.45.0 — which item's installment-history timeline is open ("kind-id"). */
  const [payHistoryOpen, setPayHistoryOpen] = useState<string | null>(null);
  // v2.44.0 — "+ নতুন বাকি" pops the entry form inside the entries tab
  const [formSignal, setFormSignal] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [rows, entries] = await Promise.all([
        getBillsOffline(DEFAULT_USER_ID),
        getDueEntriesOffline(DEFAULT_USER_ID),
      ]);
      if (!alive) return;
      setBills(rows.filter((b) => (b.dueAmount || 0) > EPS));
      setDueEntries(entries);
    })();
    return () => {
      alive = false;
    };
  }, [tick]);

  // ── UNIFIED groups: bill dues + due entries per customer ──────────
  const groups = useMemo<DueGroup[]>(() => {
    const map = new Map<string, DueGroup>();
    const touch = (key: string, name: string, mobile: string): DueGroup => {
      const g = map.get(key) || { key, name, mobile, items: [], totalDue: 0 };
      map.set(key, g);
      return g;
    };
    for (const b of bills) {
      const mobile = (b.customerMobile || '').trim();
      const name = (b.customerName || '').trim();
      const key = mobile || name || 'walk-in';
      const g = touch(key, name || (mobile ? mobile : t('due.walkIn')), mobile);
      g.items.push({
        kind: 'bill',
        id: b.id,
        label: b.billNumber || '—',
        date: b.date,
        due: Number(b.dueAmount) || 0,
        total: Number(b.total) || 0,
        paid: Number(b.paidAmount) || 0,
        payments: (b as Bill).duePayments || [],
        bill: b,
      });
      g.totalDue += Number(b.dueAmount) || 0;
    }
    for (const e of dueEntries) {
      const out = dueEntryOutstanding(e);
      if (out <= EPS) continue; // settled entries don't clutter the due list
      const mobile = (e.customerMobile || '').trim();
      const name = (e.customerName || '').trim();
      const key = mobile || name || 'walk-in';
      const g = touch(key, name || (mobile ? mobile : t('due.walkIn')), mobile);
      g.items.push({
        kind: 'entry',
        id: e.id,
        label: e.productName,
        date: e.date,
        due: out,
        total: Number(e.amount) || 0,
        paid: Number(e.paidAmount) || 0,
        payments: e.duePayments || [],
        entry: e,
      });
      g.totalDue += out;
    }
    for (const g of map.values()) g.items.sort((a, b) => b.date.localeCompare(a.date));
    return [...map.values()].sort((a, b) => b.totalDue - a.totalDue);
  }, [bills, dueEntries, t]);

  const totalDue = groups.reduce((s, g) => s + g.totalDue, 0);
  const openItems = groups.reduce((s, g) => s + g.items.length, 0);
  /** v2.45.0 — newest installment across every open item of a group. */
  const lastPayments = useMemo(() => {
    const m = new Map<string, DuePaymentRecord>();
    for (const g of groups) {
      let last: DuePaymentRecord | null = null;
      for (const it of g.items) {
        for (const p of it.payments) if (!last || p.at > last.at) last = p;
      }
      if (last) m.set(g.key, last);
    }
    return m;
  }, [groups]);
  const overdueItems = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    let n = 0;
    for (const e of dueEntries) {
      if (dueEntryOutstanding(e) <= EPS) continue;
      for (const it of e.schedule || []) {
        if (it.dueDate && it.dueDate < today && it.amount - (it.paidAmount || 0) > EPS) n++;
      }
    }
    return n;
  }, [dueEntries]);

  // ── history: day-wise due made/collected + running outstanding ──
  const daily = useMemo(() => {
    const events: { date: string; dueMade: number; collected: number }[] = [];
    // open bill dues — remaining due attributed to the bill's own date;
    // day-end balance still converges EXACTLY to today's real outstanding
    for (const b of bills) {
      if ((b.dueAmount || 0) > EPS) events.push({ date: b.date, dueMade: Number(b.dueAmount) || 0, collected: 0 });
      // v2.45.0 — bill collections dated by their ledger timestamp (exact,
      // even for back-filled installments); falls through for legacy bills.
      for (const p of (b as Bill).duePayments || []) {
        events.push({ date: String(p.at).slice(0, 10), dueMade: 0, collected: Number(p.amount) || 0 });
      }
    }
    // standalone due entries — full amount on creation date
    for (const e of dueEntries) {
      if ((Number(e.amount) || 0) > 0) events.push({ date: e.date, dueMade: Number(e.amount) || 0, collected: 0 });
      // v2.45.0 — collections dated by the ledger's exact date+time
      for (const p of e.duePayments || []) {
        events.push({ date: String(p.at).slice(0, 10), dueMade: 0, collected: Number(p.amount) || 0 });
      }
      // legacy fallback (pre-2.45 rows without a ledger): collections dated
      // by each installment's paidAt (exact when paid in one go)
      if (!(e.duePayments || []).length) {
        for (const it of e.schedule || []) {
          const got = Number(it.paidAmount) || 0;
          if (got > 0 && it.paidAt) events.push({ date: String(it.paidAt).slice(0, 10), dueMade: 0, collected: got });
        }
        // schedule-less entries: collection dated by last update (best effort)
        const noSched = (e.schedule || []).length === 0 ? Number(e.paidAmount) || 0 : 0;
        if (noSched > 0 && e.updatedAt) events.push({ date: String(e.updatedAt).slice(0, 10), dueMade: 0, collected: noSched });
      }
    }
    return buildDueDaily(events);
  }, [bills, dueEntries]);

  const chartData: ChartPoint[] = useMemo(
    () => windowPoints(daily, period).map((p) => ({ date: p.date, bar: p.net, line: Math.max(0, p.endDue) })),
    [daily, period]
  );
  const histRows: TallyRow<(typeof daily)[number]>[] = useMemo(
    () => collapseFlat(daily, (p) => p.dueMade > 0 || p.collected > 0, (p) => Math.max(0, p.endDue)),
    [daily]
  );

  // ── actions ──────────────────────────────────────────────────────

  const openNewEntry = () => {
    setFormSignal((s) => s + 1);
    setTab('entries');
  };

  /** v2.45.0 — record one installment (amount + date + time + method + note).
   *  Works for BOTH bill dues and due entries; the service layer appends to
   *  the item's `duePayments` ledger and fills any kisti schedule. */
  const doRecordPayment = async () => {
    if (!payModal) return;
    const { item, amount, date, time, method, note } = payModal;
    const pay = round2Number(amount);
    if (!date || !time) {
      adminToast(t('due.payNeedWhen'), 'err');
      return;
    }
    if (!(pay > 0)) {
      adminToast(t('due.payNeedAmount'), 'err');
      return;
    }
    if (pay > item.due + EPS) {
      adminToast(t('due.payTooMuch'), 'err');
      return;
    }
    if (Date.parse(atFromInputs(date, time)) > Date.now() + 60_000) {
      adminToast(t('due.payFuture'), 'err');
      return;
    }
    setBusy(true);
    try {
      const at = atFromInputs(date, time);
      const opts = { at, method, note: note.trim() };
      if (item.kind === 'bill' && item.bill) {
        await markBillPaidOffline(item.bill.id, DEFAULT_USER_ID, pay, opts);
      } else if (item.entry) {
        await recordDueEntryPaymentOffline(item.entry.id, DEFAULT_USER_ID, pay, opts);
      }
      adminToast(t('due.paySaved'));
      setPayModal(null);
    } catch (err) {
      adminToast((err as Error)?.message || t('c.error'), 'err');
    } finally {
      setBusy(false);
    }
  };

  /** WhatsApp reminder with the customer's combined due summary. */
  const remindWhatsApp = (g: DueGroup) => {
    const phone = g.mobile.replace(/\D/g, '');
    if (!phone) {
      adminToast(t('due.walkIn'), 'info');
      return;
    }
    const msg = encodeURIComponent(
      `${ta('due.remindMsg', lang)}\n\n${g.name} — ${fmtMoney(g.totalDue)} (${g.items.length} ${ta('due.itemsCount', lang)})`
    );
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
  };

  /** v2.44.0 — native SMS app reminder (sms: URI, Android/iOS). */
  const remindSms = (g: DueGroup) => {
    const phone = g.mobile.replace(/\D/g, '');
    if (!phone) {
      adminToast(t('due.walkIn'), 'info');
      return;
    }
    const msg = encodeURIComponent(
      `${ta('due.remindMsg', lang)}\n\n${g.name} — ${fmtMoney(g.totalDue)} (${g.items.length} ${ta('due.itemsCount', lang)})`
    );
    window.location.href = `sms:${phone}?body=${msg}`;
  };

  return (
    <div>
      <PageHeader
        title={t('due.title')}
        action={
          <Btn onClick={openNewEntry}>
            <Plus size={16} /> {t('dentry.add')}
          </Btn>
        }
      />

      {/* one combined snapshot — bills + due entries together */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatCard icon={<BadgeIndianRupee size={18} />} label={t('due.totalDue')} value={fmtMoney(totalDue)} tone="red" />
        <StatCard icon={<Users size={18} />} label={t('due.customers')} value={groups.length} tone="orange" />
        <StatCard icon={<ReceiptText size={18} />} label={t('due.itemsCount')} value={openItems} tone="amber" />
        <StatCard
          icon={<CalendarClock size={18} />}
          label={t('dentry.overdue')}
          value={overdueItems}
          tone={overdueItems > 0 ? 'amber' : 'slate'}
        />
      </div>

      {/* growth graph — daily due bars + outstanding line (both sources) */}
      <AdminCard
        title={
          <span className="inline-flex items-center gap-2">
            <LineChartIcon size={16} className="text-[#DC2626]" /> {t('due.growth')}
          </span>
        }
        action={<PeriodToggle value={period} onChange={setPeriod} labels={{ d7: t('cash.growth7'), d30: t('cash.growth30'), all: t('cash.growthAll') }} />}
      >
        <p className="text-[11px] text-[var(--psa-muted)] -mt-2 mb-2">{t('due.growthSub')}</p>
        {chartData.length === 0 ? (
          <EmptyState icon={<LineChartIcon size={22} />} title={t('due.noDue')} body={t('due.growthSub')} />
        ) : (
          <DailyTallyChart
            data={chartData}
            period={period}
            barFill={(p) => (p.bar >= 0 ? '#DC2626' : '#16A34A')}
            lineColor="#D97706"
            formatBar={(v) => (v >= 0 ? '+ ' : '− ') + fmtMoney(Math.abs(v))}
            barSeriesName={(p) => (p.bar >= 0 ? t('due.dayNew') : t('due.dayGot'))}
            legend={{ red: t('due.legendMade'), green: t('due.legendGot'), line: t('due.legendOut') }}
            testId="due-growth-chart"
          />
        )}
      </AdminCard>

      <AdminCard
        title={tab === 'history' ? t('due.historyTitle') : undefined}
        action={
          <div className="flex items-center gap-1.5" role="tablist" aria-label={t('due.title')}>
            {(
              [
                ['all', 'due.tabAll'],
                ['entries', 'due.tabEntries'],
                ['history', 'due.tabHistory'],
              ] as [DueTab, string][]
            ).map(([v, key]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={tab === v}
                onClick={() => {
                  setTab(v);
                  // a manual tab visit must not auto-pop the entry form
                  if (v === 'entries') setFormSignal(0);
                }}
                className={`h-8 px-3 rounded-lg text-xs font-bold transition-colors ${
                  tab === v
                    ? 'bg-[#FA6E41] text-white shadow-sm'
                    : 'border border-[var(--psa-border)] text-[var(--psa-sub)] hover:bg-[var(--psa-hover)]'
                }`}
              >
                {t(key)}
              </button>
            ))}
          </div>
        }
        bodyClass="!p-0"
      >
        {/* ── বাকি এন্ট্রি tab: the full due-entry manager, embedded ── */}
        {tab === 'entries' ? (
          <div className="p-4 sm:p-5">
            <AdminDueEntry formSignal={formSignal} />
          </div>
        ) : tab === 'history' ? (
          histRows.length === 0 ? (
            <div className="p-4 sm:p-5">
              <EmptyState icon={<CheckCircle2 size={22} />} title={t('due.noDue')} body={t('due.growthSub')} />
            </div>
          ) : (
            <div className="max-h-[62vh] overflow-y-auto ledger-scroll divide-y divide-[var(--psa-line)] px-4 sm:px-5">
              {histRows.map((r) =>
                r.type === 'active' ? (
                  <div key={r.p.date} className="flex items-center gap-3 py-2.5">
                    <span
                      aria-hidden
                      className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
                        r.p.net >= 0 ? 'bg-[var(--psa-soft-red)] text-[#DC2626]' : 'bg-[var(--psa-soft-green)] text-[#16A34A]'
                      }`}
                    >
                      {r.p.net >= 0 ? <ArrowUpRight size={17} /> : <ArrowDownLeft size={17} />}
                    </span>
                    <div className="min-w-0 grow">
                      <p className="text-sm font-semibold text-[var(--psa-ink)]">{fmtDate(r.p.date)}</p>
                      <p className="text-[11px] tabular-nums">
                        {r.p.dueMade > 0 && (
                          <span className="text-[#DC2626] font-semibold">{t('due.dayNew')} {fmtMoney(r.p.dueMade)}</span>
                        )}
                        {r.p.dueMade > 0 && r.p.collected > 0 && ' · '}
                        {r.p.collected > 0 && (
                          <span className="text-[#16A34A] font-semibold">{t('due.dayGot')} {fmtMoney(r.p.collected)}</span>
                        )}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-bold tabular-nums ${r.p.net >= 0 ? 'text-[#DC2626]' : 'text-[#16A34A]'}`}>
                        {r.p.net >= 0 ? '+' : '−'} {fmtMoney(Math.abs(r.p.net))}
                      </p>
                      <Badge tone="amber">
                        {t('due.dayWas')} {fmtMoney(Math.max(0, r.p.endDue))}
                      </Badge>
                    </div>
                  </div>
                ) : (
                  <div key={r.from} className="flex items-center gap-3 py-2.5 opacity-70">
                    <span
                      aria-hidden
                      className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-[var(--psa-soft-slate)] text-[var(--psa-sub)]"
                    >
                      <Banknote size={15} />
                    </span>
                    <div className="min-w-0 grow">
                      <p className="text-sm font-semibold text-[var(--psa-sub)]">
                        {r.from === r.to ? fmtDate(r.from) : `${fmtDate(r.from)} – ${fmtDate(r.to)}`}
                      </p>
                      <p className="text-[11px] text-[var(--psa-faint)]">{t('due.noTxn')}</p>
                    </div>
                    <Badge tone="slate">
                      {t('due.dayWas')} {fmtMoney(r.lineValue)}
                    </Badge>
                  </div>
                )
              )}
            </div>
          )
        ) : groups.length === 0 ? (
          <div className="p-4 sm:p-5">
            <EmptyState icon={<CheckCircle2 size={22} />} title={t('due.noDue')} />
          </div>
        ) : (
          <div className="divide-y divide-[var(--psa-line)] max-h-[68vh] overflow-y-auto">
            {groups.map((g) => (
              <div key={g.key}>
                <button
                  onClick={() => setExpanded(expanded === g.key ? null : g.key)}
                  className="w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 hover:bg-[var(--psa-row-hover)] transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-full bg-[var(--psa-soft-red)] text-[#DC2626] flex items-center justify-center shrink-0 text-sm font-bold">
                      {g.name.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--psa-ink)] truncate">{g.name}</p>
                      <p className="text-[11px] text-[var(--psa-faint)]">
                        {g.items.length} {t('due.itemsCount')}{g.mobile ? ` · ${g.mobile}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {lastPayments.get(g.key) && (
                      <span className="hidden md:inline-flex items-center gap-1 text-[10px] font-semibold text-[#16A34A] bg-[var(--psa-soft-green)] rounded-full px-2 py-0.5 tabular-nums">
                        {t('due.payLast')} {fmtMoney(lastPayments.get(g.key)!.amount)} · {fmtDate(String(lastPayments.get(g.key)!.at).slice(0, 10))}
                      </span>
                    )}
                    <span className="text-sm font-bold text-[#DC2626] tabular-nums">{fmtMoney(g.totalDue)}</span>
                    <ChevronDown
                      size={16}
                      className={`text-[var(--psa-faint)] transition-transform ${expanded === g.key ? 'rotate-180' : ''}`}
                    />
                  </div>
                </button>

                {expanded === g.key && (
                  <div className="px-4 sm:px-5 pb-4 space-y-2">
                    {g.items.map((item) => {
                      const itemKey = `${item.kind}-${item.id}`;
                      const pct = item.total > 0 ? Math.min(100, Math.round((item.paid / item.total) * 100)) : 0;
                      // history timeline — newest first + running balance after each kisti
                      const ledger = [...item.payments].sort((a, b) => b.at.localeCompare(a.at));
                      const ledgerTotal = item.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
                      const legacyPaid = Math.max(0, item.paid - ledgerTotal);
                      const runAfter = new Map<string, number>(); // paymentId → remaining after it
                      {
                        let acc = legacyPaid;
                        for (const p of [...item.payments].sort((a, b) => a.at.localeCompare(b.at))) {
                          acc += Number(p.amount) || 0;
                          runAfter.set(p.id, Math.max(0, item.total - acc));
                        }
                      }
                      const lastPay = item.payments.reduce<DuePaymentRecord | null>((L, p) => (!L || p.at > L.at ? p : L), null);
                      return (
                      <div
                        key={itemKey}
                        className="bg-[var(--psa-hover)] rounded-lg px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-[var(--psa-ink)] truncate">
                              <Badge tone={item.kind === 'bill' ? 'orange' : 'slate'}>
                                {item.kind === 'bill' ? t('due.tagBill') : t('due.tagEntry')}
                              </Badge>{' '}
                              {item.label} · {fmtDate(item.date)}
                            </p>
                            <p className="text-[11px] text-[var(--psa-faint)] tabular-nums">
                              {t('bills.total')} {fmtMoney(item.total)} · {t('dentry.collectedOf')} {fmtMoney(item.paid)}
                              {item.payments.length > 0 ? ` · ${tf('due.payCount', { n: item.payments.length })}` : ''}
                            </p>
                            {lastPay && (
                              <p className="text-[10px] text-[#16A34A] font-semibold tabular-nums mt-0.5">
                                {t('due.payLast')}: {fmtMoney(lastPay.amount)} · {fmtDateTime(lastPay.at)}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge tone="red">{fmtMoney(item.due)}</Badge>
                            <Btn
                              size="sm"
                              variant="green"
                              onClick={() =>
                                setPayModal({
                                  item,
                                  amount: '',
                                  date: todayLocal(),
                                  time: nowHHMM(),
                                  method: 'cash',
                                  note: '',
                                })
                              }
                            >
                              <HandCoins size={13} /> {t('due.payTitle')}
                            </Btn>
                          </div>
                        </div>

                        {/* collection progress */}
                        <div className="mt-2">
                          <div className="h-1.5 rounded-full bg-[var(--psa-card)] overflow-hidden">
                            <div className="h-full rounded-full bg-[#16A34A] transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <p className="text-[10px] text-[var(--psa-faint)] mt-1 tabular-nums">{pct}% {t('dentry.collectedOf')}</p>
                        </div>

                        {/* v2.45.0 — installment history timeline */}
                        {item.payments.length > 0 && (
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => setPayHistoryOpen(payHistoryOpen === itemKey ? null : itemKey)}
                              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--psa-sub)] hover:text-[var(--psa-ink)] transition-colors"
                              aria-expanded={payHistoryOpen === itemKey}
                            >
                              <HistoryIcon size={12} />
                              {tf('due.payCount', { n: item.payments.length })}
                              <ChevronDown size={11} className={`transition-transform ${payHistoryOpen === itemKey ? 'rotate-180' : ''}`} />
                            </button>
                            {payHistoryOpen === itemKey && (
                              <div className="mt-1.5 divide-y divide-[var(--psa-line)]">
                                {ledger.map((p) => {
                                  const M = PAY_METHOD_META[p.method] || PAY_METHOD_META.cash;
                                  return (
                                    <div key={p.id} className="flex items-center gap-2.5 py-1.5">
                                      <span className="w-6 h-6 rounded-full bg-[var(--psa-soft-green)] text-[#16A34A] flex items-center justify-center shrink-0">
                                        <M.icon size={12} />
                                      </span>
                                      <div className="min-w-0 grow">
                                        <p className="text-[11px] font-semibold text-[var(--psa-ink)] tabular-nums">
                                          {fmtMoney(p.amount)}
                                          <span className="text-[var(--psa-faint)] font-normal"> · {fmtDateTime(p.at)}</span>
                                        </p>
                                        <p className="text-[10px] text-[var(--psa-faint)]">
                                          {t(`due.method.${p.method}`)}
                                          {p.note ? ` · ${p.note}` : ''}
                                          {` · ${t('due.payRemaining')}: ${fmtMoney(runAfter.get(p.id) ?? 0)}`}
                                        </p>
                                      </div>
                                      <Badge tone={M.tone}>{t(`due.method.${p.method}`)}</Badge>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      );
                    })}
                    {g.mobile && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Btn size="sm" variant="outline" onClick={() => remindWhatsApp(g)}>
                          <MessageCircle size={14} /> {t('due.remind')}
                        </Btn>
                        <Btn size="sm" variant="outline" onClick={() => remindSms(g)}>
                          <Smartphone size={14} /> {t('due.remindSms')}
                        </Btn>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      {/* v2.45.0 installment-payment modal — amount + date + time + method + note */}
      <Modal
        open={!!payModal}
        onClose={() => setPayModal(null)}
        title={t('due.payTitle')}
        footer={
          <>
            <Btn variant="outline" onClick={() => setPayModal(null)}>
              {t('c.cancel')}
            </Btn>
            <Btn variant="green" onClick={doRecordPayment} disabled={busy}>
              {t('c.confirm')}
            </Btn>
          </>
        }
      >
        {payModal && (() => {
          const outstanding = Math.max(0, payModal.item.due);
          const typed = round2Number(payModal.amount);
          const afterRemaining = Math.max(0, outstanding - (typed > 0 ? typed : 0));
          const half = Math.round(outstanding) / 2;
          const chips: number[] = [outstanding];
          if (half > 0 && half < outstanding) chips.push(half);
          for (const c of [100, 500, 1000]) if (c < outstanding) chips.push(c);
          return (
            <div className="space-y-3.5">
              <p className="text-sm text-[var(--psa-sub)]">
                {payModal.item.kind === 'bill' ? `${t('due.tagBill')} · ${payModal.item.label}` : `${t('due.tagEntry')} · ${payModal.item.label}`}
                {' — '}
                <b>{fmtMoney(outstanding)}</b>
              </p>

              <Field label={t('due.payAmount')}>
                <TextInput
                  type="number"
                  min="0"
                  max={String(outstanding)}
                  step="0.01"
                  value={payModal.amount}
                  onChange={(e) => setPayModal({ ...payModal, amount: e.target.value })}
                  placeholder={String(outstanding)}
                  autoFocus
                />
              </Field>
              {/* quick amount chips — সব / half / common notes */}
              <div className="flex flex-wrap gap-1.5 -mt-1.5">
                {chips.map((c, i) => (
                  <button
                    key={`${c}-${i}`}
                    type="button"
                    onClick={() => setPayModal({ ...payModal, amount: String(c) })}
                    className={`h-7 px-2.5 rounded-full text-[11px] font-bold tabular-nums transition-colors border ${
                      round2Number(payModal.amount) === Math.round(c * 100) / 100
                        ? 'bg-[#FA6E41] text-white border-transparent'
                        : 'border-[var(--psa-border)] text-[var(--psa-sub)] hover:bg-[var(--psa-hover)]'
                    }`}
                  >
                    {i === 0 ? `${t('c.all')} · ${fmtMoney(c)}` : fmtMoney(c)}
                  </button>
                ))}
              </div>

              {/* date + time — the money's exact moment (back-fill allowed) */}
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('due.payDate')}>
                  <TextInput
                    type="date"
                    value={payModal.date}
                    max={todayLocal()}
                    onChange={(e) => setPayModal({ ...payModal, date: e.target.value })}
                  />
                </Field>
                <Field label={t('due.payTime')}>
                  <TextInput
                    type="time"
                    value={payModal.time}
                    onChange={(e) => setPayModal({ ...payModal, time: e.target.value })}
                  />
                </Field>
              </div>

              {/* collection method */}
              <Field label={t('due.payMethod')}>
                <div className="grid grid-cols-4 gap-1.5">
                  {(['cash', 'upi', 'card', 'bank'] as DuePaymentMethod[]).map((m) => {
                    const M = PAY_METHOD_META[m];
                    const active = payModal.method === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPayModal({ ...payModal, method: m })}
                        aria-pressed={active}
                        className={`h-9 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors border ${
                          active
                            ? 'bg-[#FA6E41] text-white border-transparent shadow-sm'
                            : 'border-[var(--psa-border)] text-[var(--psa-sub)] hover:bg-[var(--psa-hover)]'
                        }`}
                      >
                        <M.icon size={13} />
                        <span className="truncate">{t(`due.method.${m}`)}</span>
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label={t('due.payNote')}>
                <TextInput
                  value={payModal.note}
                  onChange={(e) => setPayModal({ ...payModal, note: e.target.value })}
                  maxLength={200}
                />
              </Field>

              <p className="text-xs text-[var(--psa-muted)] bg-[var(--psa-soft-green)] rounded-lg p-3 tabular-nums">
                {t('due.payRemaining')}: <b>{fmtMoney(afterRemaining)}</b>
              </p>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
