'use client';

/**
 * Admin Due Book — THE single place for every due (v2.44.0 unified):
 *
 *  • সব বাকি / All Dues — one customer-wise list merging BILL dues and
 *    standalone DUE ENTRIES; each group is expandable and carries both a
 *    WhatsApp and a native SMS reminder.
 *  • পেমেন্ট শিডিউল / Payment schedule (v2.46.0) — per-customer kisti PLAN
 *    in the সব বাকি tab: dated installments with one-tap collect that
 *    distributes the money across the group's open items through the normal
 *    payment services, so every ledger stays consistent.
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
  Trash2, CircleAlert,
} from 'lucide-react';
import { getBillsOffline, markBillPaidOffline, getDueEntriesOffline, recordDueEntryPaymentOffline, getDuePlansOffline, saveDuePlanOffline, deleteDuePlanOffline, dueEntryOutstanding, localDateStr } from '@/lib/offline-service';
import { buildDueDaily } from '@/lib/cash-daily';
import type { DueEntry, DuePaymentMethod, DuePaymentRecord, DuePaymentPlan, DuePlanFrequency, DuePlanItem } from '@/lib/types';
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

/** Local YYYY-MM-DD of a UTC ISO timestamp (ledger `at`, `paidAt`, `updatedAt`).
 *  String-slicing a UTC ISO gives the UTC day — wrong between local midnight
 *  and UTC midnight (e.g. IST 00:00–05:30) — so convert through Date. Falls
 *  back to the raw slice for unparseable input instead of "NaN-NaN-NaN". */
const dayOfIso = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : localDateStr(d);
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

/** Round a number to 2 decimals (plan row math). */
const r2 = (n: number): number => Math.round(n * 100) / 100;

// ── v2.46.0 — payment schedule (কিস্তি শিডিউল) helpers ──────────────────

/** Hard cap on planned installments (matches the due-entry kisti cap). */
const PLAN_MAX_KISTI = 60;

/** Row input style for the plan modal (raw inputs — TextInput's w-full base
 *  would force every row onto two lines inside the flex row). */
const PLAN_ROW_INPUT =
  'h-9 min-w-0 rounded-lg border border-transparent bg-[var(--psa-card)] px-2 text-xs text-[var(--psa-ink)] outline-none focus:border-[#FA6E41] transition-shadow';

/** One editable installment row inside the plan modal. */
interface PlanRowState {
  key: string;
  /** Preserved from the saved plan so collected progress (paidAt) carries over. */
  id?: string;
  dueDate: string;
  amount: string;
  /** Preserved collection stamp — never editable in the modal. */
  paidAt?: string;
}

/** Same-day-of-month month add that never overflows (Jan 31 → Feb 28). */
function addMonthsSafePlan(d: Date, months: number): Date {
  const y = d.getFullYear();
  const m = d.getMonth() + months;
  const day = Math.min(d.getDate(), new Date(y, m + 1, 0).getDate());
  return new Date(y, m, day);
}

/** Step a plan start-date forward by `times` frequency units. */
function addPlanStep(d: Date, freq: DuePlanFrequency, times: number): Date {
  if (freq === 'daily') {
    const x = new Date(d);
    x.setDate(x.getDate() + times);
    return x;
  }
  if (freq === 'weekly') {
    const x = new Date(d);
    x.setDate(x.getDate() + 7 * times);
    return x;
  }
  return addMonthsSafePlan(d, times);
}

/** Build an even installment plan: every row = floor(total/n) except the
 *  last, which absorbs the remainder so Σ rows == total exactly.
 *  When editing, prev's id/paidAt carry over BY INDEX so re-generating
 *  the plan never erases collection progress. */
function buildPlanRows(
  total: number,
  count: number,
  freq: DuePlanFrequency,
  start: string,
  prev?: PlanRowState[]
): PlanRowState[] {
  const n = Math.max(1, Math.min(PLAN_MAX_KISTI, Math.round(count || 1)));
  const t = r2(Math.max(0, total));
  const per = Math.floor((t / n) * 100) / 100;
  const s = /^\d{4}-\d{2}-\d{2}$/.test(start) ? new Date(`${start}T00:00:00`) : new Date();
  const rows: PlanRowState[] = [];
  let assigned = 0;
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    const amt = last ? r2(t - assigned) : Math.min(per, r2(t - assigned));
    assigned = r2(assigned + amt);
    const paidAt = prev?.[i]?.paidAt;
    rows.push({
      key: `pr-${i}`,
      id: prev?.[i]?.id,
      dueDate: localDateStr(addPlanStep(s, freq, i)),
      amount: String(amt),
      ...(paidAt ? { paidAt } : {}),
    });
  }
  return rows;
}

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

/** v2.46.0 — the payment-schedule modal state (one plan per customer group). */
interface PlanModalState {
  groupKey: string;
  name: string;
  mobile: string;
  /** Live outstanding due when the modal opened (the generator basis). */
  liveDue: number;
  /** Existing plan id — edit mode; undefined = create. */
  planId?: string;
  count: string;
  freq: DuePlanFrequency;
  start: string;
  rows: PlanRowState[];
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
  // v2.46.0 — payment schedule (kisti plan) per customer group
  const [plans, setPlans] = useState<DuePaymentPlan[]>([]);
  const [planModal, setPlanModal] = useState<PlanModalState | null>(null);
  const [planListOpen, setPlanListOpen] = useState<string | null>(null);
  const [planDeleting, setPlanDeleting] = useState<DuePaymentPlan | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  /** `${planId}:${slotId}` of the installment whose one-tap collect is running. */
  const [slotBusy, setSlotBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [rows, entries, planRows] = await Promise.all([
        getBillsOffline(DEFAULT_USER_ID),
        getDueEntriesOffline(DEFAULT_USER_ID),
        getDuePlansOffline(DEFAULT_USER_ID),
      ]);
      if (!alive) return;
      // ALL bills (settled ones too): the due LIST below filters open bills,
      // but the day-wise history must keep settled bills' due-made and
      // installment collections or they vanish once a bill is paid off.
      setBills(rows);
      setDueEntries(entries);
      setPlans(planRows);
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
      if ((Number(b.dueAmount) || 0) <= EPS) continue; // settled bills don't clutter the due list
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

  /** v2.46.0 — plans keyed by the SAME group key (one plan per customer). */
  const plansByKey = useMemo(() => {
    const m = new Map<string, DuePaymentPlan>();
    for (const p of plans) if (!m.has(p.customerKey)) m.set(p.customerKey, p);
    return m;
  }, [plans]);
  /** v2.47.0 audit — plans whose customer has NO open due (group gone):
   *  settled schedules + cross-device orphans. They used to vanish entirely
   *  (undeletable, invisible) and a stale plan re-attached to the customer's
   *  next due with months-old overdue chips. */
  const settledPlans = useMemo(() => {
    const openKeys = new Set(groups.map((g) => g.key));
    return plans.filter((p) => !openKeys.has(p.customerKey));
  }, [plans, groups]);
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
    const today = todayLocal(); // local day — UTC slicing mislabels 00:00–05:30 IST
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
    // bill dues — ALL bills (settled included, so their history rows survive):
    // the principal that went to due at bill time is `dueAmount + Σ(duePayments)`
    // (paidAmount = paid-at-creation + every installment), NOT the remaining
    // `dueAmount` — pushing the remaining due AND the installments subtracted
    // each installment twice and the day-end balance landed below the real
    // outstanding (₹1000 bill, ₹400 kisti → showed ₹200 outstanding, real ₹600).
    for (const b of bills) {
      const paySum = ((b as Bill).duePayments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const made = (Number(b.dueAmount) || 0) + paySum;
      if (made > EPS) events.push({ date: b.date, dueMade: made, collected: 0 });
      // v2.45.0 — bill collections dated by their ledger timestamp's LOCAL day
      // (exact, even for back-filled installments); falls through for legacy bills.
      for (const p of (b as Bill).duePayments || []) {
        events.push({ date: dayOfIso(p.at), dueMade: 0, collected: Number(p.amount) || 0 });
      }
    }
    // standalone due entries — full amount on creation date
    for (const e of dueEntries) {
      if ((Number(e.amount) || 0) > 0) events.push({ date: e.date, dueMade: Number(e.amount) || 0, collected: 0 });
      // v2.45.0 — collections dated by the ledger's exact date+time (local day)
      for (const p of e.duePayments || []) {
        events.push({ date: dayOfIso(p.at), dueMade: 0, collected: Number(p.amount) || 0 });
      }
      // legacy fallback (pre-2.45 rows without a ledger): collections dated
      // by each installment's paidAt (exact when paid in one go)
      if (!(e.duePayments || []).length) {
        for (const it of e.schedule || []) {
          const got = Number(it.paidAmount) || 0;
          if (got > 0 && it.paidAt) events.push({ date: dayOfIso(it.paidAt), dueMade: 0, collected: got });
        }
        // schedule-less entries: collection dated by last update (best effort)
        const noSched = (e.schedule || []).length === 0 ? Number(e.paidAmount) || 0 : 0;
        if (noSched > 0 && e.updatedAt) events.push({ date: dayOfIso(e.updatedAt), dueMade: 0, collected: noSched });
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

  // ── v2.46.0 — payment schedule (পেমেন্ট শিডিউল) actions ─────────────

  /** Open the plan modal for a group — prefilled edit when a plan exists,
   *  or an even split of the live due (1 kisti per ₹1000, capped at 60). */
  const openPlanModal = (g: DueGroup, plan?: DuePaymentPlan) => {
    const existing = plan || plansByKey.get(g.key);
    if (existing && existing.items.length > 0) {
      setPlanModal({
        groupKey: g.key,
        name: g.name,
        mobile: g.mobile,
        liveDue: g.totalDue,
        planId: existing.id,
        count: String(existing.items.length),
        freq: existing.frequency,
        start: existing.items[0]?.dueDate || todayLocal(),
        rows: existing.items.map((it, i) => ({
          key: `pr-${i}`,
          id: it.id,
          dueDate: it.dueDate,
          amount: String(it.amount),
          ...(it.paidAt ? { paidAt: it.paidAt } : {}),
        })),
      });
    } else {
      const count = Math.max(1, Math.min(PLAN_MAX_KISTI, Math.ceil(g.totalDue / 1000) || 1));
      setPlanModal({
        groupKey: g.key,
        name: g.name,
        mobile: g.mobile,
        liveDue: g.totalDue,
        count: String(count),
        freq: 'monthly',
        start: todayLocal(),
        rows: buildPlanRows(g.totalDue, count, 'monthly', todayLocal()),
      });
    }
  };

  /** Re-generate the modal rows from count/frequency/start — v2.47.0 audit
   *  fix: ALREADY-COLLECTED rows are preserved verbatim (dates, amounts,
   *  paid stamps — they are historical facts recorded in the ledger) and
   *  only the UNPAID portion is rebuilt over the remaining due. Shrinking
   *  the count used to silently drop paid slots (progress vanished from the
   *  plan while the money stayed in the ledger). */
  const regenPlan = (patch: Partial<Pick<PlanModalState, 'count' | 'freq' | 'start'>>) => {
    setPlanModal((p) => {
      if (!p) return p;
      const next = { ...p, ...patch };
      const count = Math.max(1, Math.min(PLAN_MAX_KISTI, Math.round(Number(next.count) || 1)));
      const paidRows = p.rows.filter((r) => r.paidAt && /^\d{4}-\d{2}-\d{2}$/.test(r.dueDate) && (Number(r.amount) || 0) > 0);
      const paidTotal = r2(paidRows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
      const remainDue = Math.max(0, r2(next.liveDue - paidTotal));
      const freshCount = Math.max(0, count - paidRows.length);
      const freshRows = freshCount > 0 ? buildPlanRows(remainDue, freshCount, next.freq, next.start) : [];
      const rows = [...paidRows.map((r) => ({ ...r })), ...freshRows];
      return { ...next, count: String(rows.length), rows };
    });
  };

  const updPlanRow = (key: string, patch: Partial<PlanRowState>) =>
    setPlanModal((p) => (p ? { ...p, rows: p.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) } : p));

  const delPlanRow = (key: string) =>
    setPlanModal((p) => (p ? { ...p, rows: p.rows.filter((r) => r.key !== key) } : p));

  const addPlanRow = () =>
    setPlanModal((p) => {
      if (!p || p.rows.length >= PLAN_MAX_KISTI) return p;
      const s = /^\d{4}-\d{2}-\d{2}$/.test(p.start) ? new Date(`${p.start}T00:00:00`) : new Date();
      return {
        ...p,
        rows: [...p.rows, { key: `pr-add-${Date.now().toString(36)}`, dueDate: localDateStr(addPlanStep(s, p.freq, p.rows.length)), amount: '' }],
      };
    });

  /** Save the schedule (create or update; id reuse defends against a plan
   *  synced in from another device between open and save). */
  const doSavePlan = async () => {
    if (!planModal || planBusy) return;
    const rows = planModal.rows;
    if (rows.length === 0 || rows.length > PLAN_MAX_KISTI) {
      adminToast(tf('due.plan.needCount', { max: PLAN_MAX_KISTI }), 'err');
      return;
    }
    for (const r of rows) {
      // v2.47.0 audit: amount must clear the service's DUE_EPS filter or the
      // row is silently dropped at save ("Schedule saved" with one fewer
      // kisti than the modal showed).
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.dueDate) || !(Number(r.amount) >= 0.01)) {
        adminToast(t('due.plan.needRow'), 'err');
        return;
      }
    }
    // v2.47.0 audit fix: the over-assignment guard counted ALREADY-COLLECTED
    // slots against the LIVE due — but collected money is no longer part of
    // the due, so after the first kisti the edit banner showed "exceeds by
    // ₹X" permanently and Confirm was blocked (only escape: regen, which
    // rebuilt the whole agreement). Only the UNPAID rows must fit the
    // remaining due; paid rows are historical facts.
    const unpaidSum = r2(rows.filter((r) => !r.paidAt).reduce((s, r) => s + (Number(r.amount) || 0), 0));
    if (unpaidSum > planModal.liveDue + EPS) {
      adminToast(tf('due.plan.overAssigned', { amount: fmtMoney(r2(unpaidSum - planModal.liveDue)) }), 'err');
      return;
    }
    setPlanBusy(true);
    try {
      await saveDuePlanOffline({
        userId: DEFAULT_USER_ID,
        id: planModal.planId || plansByKey.get(planModal.groupKey)?.id,
        customerKey: planModal.groupKey,
        customerName: planModal.name,
        customerMobile: planModal.mobile,
        frequency: planModal.freq,
        // v2.47.0: adopt any same-key plan if the addressed one vanished
        // remotely between open and save — never leave an invisible duplicate.
        adoptExisting: true,
        items: rows.map((r) => ({
          id: r.id,
          dueDate: r.dueDate,
          amount: round2Number(r.amount),
          ...(r.paidAt ? { paidAt: r.paidAt } : {}),
        })),
      });
      adminToast(t('due.plan.saved'));
      setPlanModal(null);
    } catch (err) {
      adminToast((err as Error)?.message || t('c.error'), 'err');
    } finally {
      setPlanBusy(false);
    }
  };

  /** ONE-TAP collect of a scheduled kisti: distributes the slot's amount
   *  (capped at the live due) across the group's open items OLDEST-FIRST
   *  through the normal payment services, so bill/entry ledgers, the cash
   *  book and every report stay exactly as a manual কিস্তি would. */
  const collectPlanSlot = async (plan: DuePaymentPlan, slot: DuePlanItem, seq: number) => {
    if (slotBusy) return;
    const g = groups.find((x) => x.key === plan.customerKey);
    const liveDue = g ? g.totalDue : 0;
    if (liveDue <= EPS) {
      adminToast(t('due.plan.doneAll'), 'info');
      return;
    }
    setSlotBusy(`${plan.id}:${slot.id}`);
    try {
      const pay = Math.min(slot.amount, liveDue);
      const at = new Date().toISOString();
      const note = tf('due.plan.payNote', { n: seq });
      let left = r2(pay);
      let done = 0;
      for (const it of [...(g?.items || [])].sort((a, b) => a.date.localeCompare(b.date))) {
        if (left <= EPS) break;
        const cap = r2(Math.min(left, it.due));
        if (cap <= EPS) continue;
        try {
          if (it.kind === 'bill' && it.bill) {
            await markBillPaidOffline(it.bill.id, DEFAULT_USER_ID, cap, { at, method: 'cash', note });
          } else if (it.entry) {
            await recordDueEntryPaymentOffline(it.entry.id, DEFAULT_USER_ID, cap, { at, method: 'cash', note });
          } else {
            continue;
          }
          done = r2(done + cap);
          left = r2(left - cap);
        } catch {
          // the item vanished underneath us (deleted on another device) — skip it
        }
      }
      if (done <= EPS) throw new Error(t('due.payNeedAmount'));
      // mark the slot collected — the money lives in the bill/entry ledgers,
      // the plan only tracks WHICH scheduled kisti has been paid.
      await saveDuePlanOffline({
        userId: DEFAULT_USER_ID,
        id: plan.id,
        customerKey: plan.customerKey,
        customerName: plan.customerName,
        customerMobile: plan.customerMobile,
        frequency: plan.frequency,
        items: plan.items.map((x) => (x.id === slot.id ? { ...x, paidAt: at } : x)),
      });
      adminToast(t('due.plan.collected'));
    } catch (err) {
      adminToast((err as Error)?.message || t('c.error'), 'err');
    } finally {
      setSlotBusy(null);
    }
  };

  const doDeletePlan = async () => {
    if (!planDeleting || planBusy) return;
    setPlanBusy(true);
    try {
      await deleteDuePlanOffline(planDeleting.id, DEFAULT_USER_ID);
      adminToast(t('due.plan.deleted'));
      setPlanDeleting(null);
    } catch (err) {
      adminToast((err as Error)?.message || t('c.error'), 'err');
    } finally {
      setPlanBusy(false);
    }
  };

  /** v2.46.0 — the payment-schedule block rendered inside each expanded
   *  সব বাকি group (create / progress / per-slot collect / edit / delete). */
  const planBlock = (g: DueGroup) => {
    const plan = plansByKey.get(g.key);
    if (!plan || plan.items.length === 0) {
      return (
        <div className="rounded-lg border border-[var(--psa-border)] bg-[var(--psa-card)] px-3 py-2.5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-bold text-[var(--psa-ink)] inline-flex items-center gap-1.5">
              <CalendarClock size={13} className="text-[#FA6E41]" /> {t('due.plan.title')}
            </p>
            <p className="text-[10px] text-[var(--psa-faint)] mt-0.5">{t('due.plan.addHint')}</p>
          </div>
          <Btn size="sm" variant="outline" onClick={() => openPlanModal(g)} disabled={g.totalDue <= EPS}>
            <Plus size={13} /> {t('due.plan.add')}
          </Btn>
        </div>
      );
    }
    const today = todayLocal();
    const paidCount = plan.items.filter((x) => !!x.paidAt).length;
    const overdueCount = plan.items.filter((x) => !x.paidAt && x.dueDate && x.dueDate < today).length;
    const settled = g.totalDue <= EPS;
    const nextSlot = plan.items.find((x) => !x.paidAt) || null;
    const pct = Math.round((paidCount / plan.items.length) * 100);
    return (
      <div className="rounded-lg border border-[var(--psa-border)] bg-[var(--psa-card)] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold text-[var(--psa-ink)] inline-flex items-center gap-1.5">
            <CalendarClock size={13} className="text-[#FA6E41]" /> {t('due.plan.title')}
          </p>
          <div className="flex items-center gap-1">
            {overdueCount > 0 && <Badge tone="red">{tf('due.plan.overdueChip', { n: overdueCount })}</Badge>}
            <Btn size="sm" variant="ghost" onClick={() => openPlanModal(g, plan)}>
              {t('due.plan.edit')}
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => setPlanDeleting(plan)} aria-label={t('c.delete')}>
              <Trash2 size={13} />
            </Btn>
          </div>
        </div>

        <div className="mt-2 h-1.5 rounded-full bg-[var(--psa-hover)] overflow-hidden">
          <div className="h-full rounded-full bg-[#16A34A] transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[10px] text-[var(--psa-faint)] mt-1 tabular-nums">
          {tf('due.plan.progress', { paid: paidCount, total: plan.items.length })}
          {nextSlot && !settled
            ? ` · ${tf('due.plan.next', { amount: fmtMoney(nextSlot.amount), date: fmtDate(nextSlot.dueDate) })}`
            : ''}
        </p>

        <button
          type="button"
          onClick={() => setPlanListOpen(planListOpen === g.key ? null : g.key)}
          aria-expanded={planListOpen === g.key}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--psa-sub)] hover:text-[var(--psa-ink)] transition-colors mt-1.5"
        >
          {t('due.plan.rows')} ({plan.items.length})
          <ChevronDown size={11} className={`transition-transform ${planListOpen === g.key ? 'rotate-180' : ''}`} />
        </button>

        {planListOpen === g.key && (
          <div className="mt-1.5 divide-y divide-[var(--psa-line)]">
            {plan.items.map((slot, i) => {
              const paid = !!slot.paidAt;
              const overdue = !paid && !!slot.dueDate && slot.dueDate < today;
              const seq = i + 1;
              const thisBusy = slotBusy === `${plan.id}:${slot.id}`;
              return (
                <div
                  key={slot.id}
                  className={`flex items-center gap-2 py-1.5 ${overdue ? 'bg-[var(--psa-soft-red)] -mx-2 px-2 rounded-md' : ''}`}
                >
                  <span
                    aria-hidden
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                      paid
                        ? 'bg-[var(--psa-soft-green)] text-[#16A34A]'
                        : overdue
                          ? 'bg-[#DC2626] text-white'
                          : 'bg-[var(--psa-soft-slate)] text-[var(--psa-sub)]'
                    }`}
                  >
                    {seq}
                  </span>
                  <div className="min-w-0 grow">
                    <p className="text-[11px] font-semibold text-[var(--psa-ink)] tabular-nums">
                      {fmtMoney(slot.amount)}
                      <span className="text-[var(--psa-faint)] font-normal"> · {fmtDate(slot.dueDate)}</span>
                    </p>
                    {paid && slot.paidAt && (
                      <p className="text-[10px] text-[#16A34A] tabular-nums">
                        {t('due.plan.slotPaid')} · {fmtDateTime(slot.paidAt)}
                      </p>
                    )}
                    {overdue && <p className="text-[10px] text-[#DC2626] font-semibold">{t('dentry.filterPending')}</p>}
                  </div>
                  {paid ? (
                    <Badge tone="green">{t('dentry.statusPaid')}</Badge>
                  ) : settled ? (
                    <Badge tone="slate">{t('due.plan.settled')}</Badge>
                  ) : (
                    <Btn size="sm" variant="green" disabled={thisBusy || slotBusy !== null} onClick={() => collectPlanSlot(plan, slot, seq)}>
                      <HandCoins size={12} /> {t('due.plan.collect')}
                    </Btn>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {settled && <p className="text-[10px] text-[#16A34A] font-semibold mt-1.5">{t('due.plan.doneAll')}</p>}
      </div>
    );
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
          <div className="p-4 sm:p-5 space-y-3">
            {/* v2.47.0 audit: with zero open dues the settled schedules still
                list (view + delete) instead of vanishing under the empty state. */}
            {settledPlans.map((plan) => (
              <div key={plan.id} className="rounded-lg border border-[var(--psa-border)] bg-[var(--psa-card)] px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-[var(--psa-ink)] inline-flex items-center gap-1.5">
                    <CalendarClock size={13} className="text-[#16A34A]" /> {t('due.plan.title')}
                    <span className="text-[var(--psa-faint)] font-normal">· {plan.customerName || plan.customerMobile || plan.customerKey}</span>
                  </p>
                  <div className="flex items-center gap-1">
                    <Badge tone="green">{t('due.plan.settled')}</Badge>
                    <Btn size="sm" variant="ghost" onClick={() => setPlanDeleting(plan)} aria-label={t('c.delete')}>
                      <Trash2 size={13} />
                    </Btn>
                  </div>
                </div>
                <p className="text-[10px] text-[var(--psa-faint)] mt-1 tabular-nums">
                  {tf('due.plan.progress', { paid: plan.items.filter((x) => !!x.paidAt).length, total: plan.items.length })}
                  {' · '}{t('due.plan.doneAll')}
                </p>
              </div>
            ))}
            <EmptyState icon={<CheckCircle2 size={22} />} title={t('due.noDue')} />
          </div>
        ) : (
          <div className="divide-y divide-[var(--psa-line)] max-h-[68vh] overflow-y-auto">
            {/* v2.47.0 audit fix — SETTLED/ORPHAN schedules: plans whose customer
              has no open due never rendered (the group disappears once settled),
              so "settled slots show বাকি শেষ" could never appear, the plan was
              undeletable, and a stale plan silently re-attached (old overdue
              chips) when the customer returned with a NEW due. They list here. */}
            {settledPlans.map((plan) => (
              <div key={plan.id} className="px-4 sm:px-5 py-3">
                <div className="rounded-lg border border-[var(--psa-border)] bg-[var(--psa-card)] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-[var(--psa-ink)] inline-flex items-center gap-1.5">
                      <CalendarClock size={13} className="text-[#16A34A]" /> {t('due.plan.title')}
                      <span className="text-[var(--psa-faint)] font-normal">· {plan.customerName || plan.customerMobile || plan.customerKey}</span>
                    </p>
                    <div className="flex items-center gap-1">
                      <Badge tone="green">{t('due.plan.settled')}</Badge>
                      <Btn size="sm" variant="ghost" onClick={() => setPlanDeleting(plan)} aria-label={t('c.delete')}>
                        <Trash2 size={13} />
                      </Btn>
                    </div>
                  </div>
                  <p className="text-[10px] text-[var(--psa-faint)] mt-1 tabular-nums">
                    {tf('due.plan.progress', { paid: plan.items.filter((x) => !!x.paidAt).length, total: plan.items.length })}
                    {' · '}{t('due.plan.doneAll')}
                  </p>
                </div>
              </div>
            ))}
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
                        {t('due.payLast')} {fmtMoney(lastPayments.get(g.key)!.amount)} · {fmtDate(dayOfIso(lastPayments.get(g.key)!.at))}
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
                    {/* v2.46.0 — payment schedule (kisti plan) for this customer */}
                    {planBlock(g)}
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

      {/* v2.46.0 — payment-schedule modal: generator (count/frequency/start)
          + editable installment rows + live Σ check against the live due */}
      <Modal
        open={!!planModal}
        onClose={() => setPlanModal(null)}
        title={
          <span className="inline-flex items-center gap-2">
            <CalendarClock size={16} className="text-[#FA6E41]" />
            {t('due.plan.title')}
            {planModal?.name ? ` · ${planModal.name}` : ''}
          </span>
        }
        footer={
          <>
            <Btn variant="outline" onClick={() => setPlanModal(null)}>
              {t('c.cancel')}
            </Btn>
            <Btn variant="green" onClick={doSavePlan} disabled={planBusy}>
              {t('c.confirm')}
            </Btn>
          </>
        }
      >
        {planModal && (() => {
          // v2.47.0 audit: banner on the UNPAID basis — matches the save
          // guard; collected slots are history, not part of the remaining due.
          const sum = r2(planModal.rows.filter((r) => !r.paidAt).reduce((s, r) => s + (Number(r.amount) || 0), 0));
          const over = r2(sum - planModal.liveDue);
          const per = Number(planModal.count) > 0 ? r2(planModal.liveDue / Number(planModal.count)) : 0;
          return (
            <div className="space-y-3.5">
              <p className="text-xs text-[var(--psa-sub)] bg-[var(--psa-soft-slate)] rounded-lg p-3 tabular-nums">
                {tf('due.plan.basis', { amount: fmtMoney(planModal.liveDue), per: fmtMoney(per) })}
              </p>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t('due.plan.count')}>
                  <TextInput
                    type="number"
                    min="1"
                    max={String(PLAN_MAX_KISTI)}
                    value={planModal.count}
                    onChange={(e) => regenPlan({ count: e.target.value })}
                  />
                </Field>
                <Field label={t('due.plan.start')}>
                  <TextInput
                    type="date"
                    value={planModal.start}
                    onChange={(e) => regenPlan({ start: e.target.value })}
                  />
                </Field>
              </div>

              <Field label={t('due.plan.freq')}>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['daily', 'weekly', 'monthly'] as DuePlanFrequency[]).map((f) => {
                    const active = planModal.freq === f;
                    return (
                      <button
                        key={f}
                        type="button"
                        aria-pressed={active}
                        onClick={() => regenPlan({ freq: f })}
                        className={`h-9 rounded-lg text-xs font-bold transition-colors border ${
                          active
                            ? 'bg-[#FA6E41] text-white border-transparent shadow-sm'
                            : 'border-[var(--psa-border)] text-[var(--psa-sub)] hover:bg-[var(--psa-hover)]'
                        }`}
                      >
                        {t(`due.plan.freq.${f}`)}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field
                label={`${t('due.plan.rows')} (${planModal.rows.length})`}
                hint={planModal.rows.length >= PLAN_MAX_KISTI ? tf('due.plan.needCount', { max: PLAN_MAX_KISTI }) : undefined}
              >
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1 ledger-scroll">
                  {planModal.rows.map((r, i) => (
                    <div key={r.key} className="flex items-center gap-1">
                      <span
                        aria-hidden
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                          r.paidAt ? 'bg-[var(--psa-soft-green)] text-[#16A34A]' : 'bg-[var(--psa-soft-slate)] text-[var(--psa-sub)]'
                        }`}
                      >
                        {i + 1}
                      </span>
                      <input
                        type="date"
                        value={r.dueDate}
                        onChange={(e) => updPlanRow(r.key, { dueDate: e.target.value })}
                        className={`${PLAN_ROW_INPUT} flex-1`}
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={r.amount}
                        onChange={(e) => updPlanRow(r.key, { amount: e.target.value })}
                        placeholder="0"
                        className={`${PLAN_ROW_INPUT} w-[76px] sm:w-24 shrink-0 tabular-nums`}
                      />
                      <button
                        type="button"
                        aria-label={t('c.delete')}
                        onClick={() => delPlanRow(r.key)}
                        className="w-7 h-9 shrink-0 rounded-lg text-[var(--psa-muted)] hover:bg-[var(--psa-hover2)] hover:text-[#DC2626] flex items-center justify-center"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addPlanRow}
                  disabled={planModal.rows.length >= PLAN_MAX_KISTI}
                  className="mt-2 h-8 px-3 rounded-lg text-xs font-bold border border-[var(--psa-border)] text-[var(--psa-sub)] hover:bg-[var(--psa-hover)] transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <Plus size={13} /> {t('due.plan.addRow')}
                </button>
              </Field>

              <p
                className={`text-xs rounded-lg p-3 tabular-nums ${
                  over > EPS
                    ? 'text-[#DC2626] font-semibold bg-[var(--psa-soft-red)]'
                    : 'text-[var(--psa-muted)] bg-[var(--psa-soft-green)]'
                }`}
              >
                {over > EPS
                  ? tf('due.plan.overAssigned', { amount: fmtMoney(over) })
                  : `${t('bills.total')}: ${fmtMoney(sum)} / ${fmtMoney(planModal.liveDue)}`}
              </p>
            </div>
          );
        })()}
      </Modal>

      {/* v2.46.0 — schedule delete confirm (collections stay untouched) */}
      <Modal
        open={!!planDeleting}
        onClose={() => setPlanDeleting(null)}
        title={t('c.delete')}
        footer={
          <>
            <Btn variant="outline" onClick={() => setPlanDeleting(null)}>{t('c.cancel')}</Btn>
            <Btn variant="danger" onClick={doDeletePlan} disabled={planBusy}>{t('c.confirm')}</Btn>
          </>
        }
      >
        {planDeleting && (
          <p className="text-sm text-[var(--psa-sub)] flex items-start gap-2">
            <CircleAlert size={16} className="text-[#DC2626] shrink-0 mt-0.5" />
            {t('due.plan.deleteConfirm')}
          </p>
        )}
      </Modal>
    </div>
  );
}
