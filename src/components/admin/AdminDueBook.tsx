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
  HandCoins, CalendarClock, Plus,
} from 'lucide-react';
import { getBillsOffline, markBillPaidOffline, getDueEntriesOffline, recordDueEntryPaymentOffline, dueEntryOutstanding } from '@/lib/offline-service';
import { buildDueDaily } from '@/lib/cash-daily';
import type { DueEntry } from '@/lib/types';
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
} from './admin-ui';
import { PeriodToggle, windowPoints, DailyTallyChart, collapseFlat, type Period, type ChartPoint, type TallyRow } from './AdminHistoryKit';
import type { Bill } from '@/lib/types';
import AdminDueEntry from './AdminDueEntry';

const EPS = 0.009;

/** One open due item — either a bill's remaining due or a due entry. */
interface UnifiedItem {
  kind: 'bill' | 'entry';
  id: string;
  label: string;
  date: string;
  due: number;
  total: number;
  paid: number;
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

/** Which kind of record the unified payment modal is settling. */
type PayTarget = { item: UnifiedItem; partial: boolean; amount: string };

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
        entry: e,
      });
      g.totalDue += out;
    }
    for (const g of map.values()) g.items.sort((a, b) => b.date.localeCompare(a.date));
    return [...map.values()].sort((a, b) => b.totalDue - a.totalDue);
  }, [bills, dueEntries, t]);

  const totalDue = groups.reduce((s, g) => s + g.totalDue, 0);
  const openItems = groups.reduce((s, g) => s + g.items.length, 0);
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
    }
    // standalone due entries — full amount on creation date
    for (const e of dueEntries) {
      if ((Number(e.amount) || 0) > 0) events.push({ date: e.date, dueMade: Number(e.amount) || 0, collected: 0 });
      // collections dated by each installment's paidAt (exact when paid in one go)
      for (const it of e.schedule || []) {
        const got = Number(it.paidAmount) || 0;
        if (got > 0 && it.paidAt) events.push({ date: String(it.paidAt).slice(0, 10), dueMade: 0, collected: got });
      }
      // schedule-less entries: collection dated by last update (best effort)
      const noSched = (e.schedule || []).length === 0 ? Number(e.paidAmount) || 0 : 0;
      if (noSched > 0 && e.updatedAt) events.push({ date: String(e.updatedAt).slice(0, 10), dueMade: 0, collected: noSched });
    }
    return buildDueDaily(events);
  }, [bills, dueEntries]);

  const chartData: ChartPoint[] = useMemo(
    () => windowPoints(daily, period).map((p) => ({ date: p.date, bar: p.net, line: p.endDue })),
    [daily, period]
  );
  const histRows: TallyRow<(typeof daily)[number]>[] = useMemo(
    () => collapseFlat(daily, (p) => p.dueMade > 0 || p.collected > 0, (p) => p.endDue),
    [daily]
  );

  // ── actions ──────────────────────────────────────────────────────

  const openNewEntry = () => {
    setFormSignal((s) => s + 1);
    setTab('entries');
  };

  const doMarkPaid = async () => {
    if (!payModal) return;
    setBusy(true);
    try {
      const { item, partial, amount } = payModal;
      if (item.kind === 'bill' && item.bill) {
        await markBillPaidOffline(item.bill.id, DEFAULT_USER_ID, partial ? Number(amount) : undefined);
      } else if (item.entry) {
        await recordDueEntryPaymentOffline(item.entry.id, DEFAULT_USER_ID, partial ? Number(amount) : undefined);
      }
      adminToast(t('bills.paidDone'));
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
                        {t('due.dayWas')} {fmtMoney(r.p.endDue)}
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
                    <span className="text-sm font-bold text-[#DC2626] tabular-nums">{fmtMoney(g.totalDue)}</span>
                    <ChevronDown
                      size={16}
                      className={`text-[var(--psa-faint)] transition-transform ${expanded === g.key ? 'rotate-180' : ''}`}
                    />
                  </div>
                </button>

                {expanded === g.key && (
                  <div className="px-4 sm:px-5 pb-4 space-y-2">
                    {g.items.map((item) => (
                      <div
                        key={`${item.kind}-${item.id}`}
                        className="flex items-center justify-between gap-3 bg-[var(--psa-hover)] rounded-lg px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[var(--psa-ink)] truncate">
                            <Badge tone={item.kind === 'bill' ? 'orange' : 'slate'}>
                              {item.kind === 'bill' ? t('due.tagBill') : t('due.tagEntry')}
                            </Badge>{' '}
                            {item.label} · {fmtDate(item.date)}
                          </p>
                          <p className="text-[11px] text-[var(--psa-faint)] tabular-nums">
                            {t('bills.total')} {fmtMoney(item.total)} · {t('dentry.collectedOf')} {fmtMoney(item.paid)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge tone="red">{fmtMoney(item.due)}</Badge>
                          <Btn
                            size="sm"
                            variant="green"
                            onClick={() => setPayModal({ item, partial: false, amount: '' })}
                          >
                            {item.kind === 'bill' ? (
                              t('bills.markPaid')
                            ) : (
                              <>
                                <HandCoins size={13} /> {t('dentry.recordPayment')}
                              </>
                            )}
                          </Btn>
                        </div>
                      </div>
                    ))}
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

      {/* unified payment modal — settles bills AND due entries */}
      <Modal
        open={!!payModal}
        onClose={() => setPayModal(null)}
        title={payModal?.item.kind === 'bill' ? t('bills.markPaid') : t('dentry.recordPayment')}
        footer={
          <>
            <Btn variant="outline" onClick={() => setPayModal(null)}>
              {t('c.cancel')}
            </Btn>
            <Btn variant="green" onClick={doMarkPaid} disabled={busy}>
              {t('c.confirm')}
            </Btn>
          </>
        }
      >
        {payModal && (
          <div className="space-y-3.5">
            <p className="text-sm text-[var(--psa-sub)]">
              {payModal.item.kind === 'bill' ? `${t('due.tagBill')} · ${payModal.item.label}` : `${t('due.tagEntry')} · ${payModal.item.label}`}
              {' — '}
              <b>{fmtMoney(payModal.item.due)}</b>
            </p>
            {!payModal.partial ? (
              <p className="text-xs text-[var(--psa-muted)] bg-[var(--psa-soft-green)] rounded-lg p-3">
                {tf('bills.markPaidFull', { amount: fmtMoney(payModal.item.due) })}
              </p>
            ) : (
              <Field label={tf('bills.markPaidPartial', { amount: fmtMoney(payModal.item.due) })}>
                <TextInput
                  type="number"
                  min="0"
                  value={payModal.amount}
                  onChange={(e) => setPayModal({ ...payModal, amount: e.target.value })}
                  autoFocus
                />
              </Field>
            )}
            <div className="flex gap-2">
              <Btn size="sm" variant={payModal.partial ? 'outline' : 'green'} onClick={() => setPayModal({ ...payModal, partial: false })}>
                {t('c.all')}
              </Btn>
              <Btn size="sm" variant={payModal.partial ? 'green' : 'outline'} onClick={() => setPayModal({ ...payModal, partial: true, amount: '' })}>
                {t('bills.partial')}
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
