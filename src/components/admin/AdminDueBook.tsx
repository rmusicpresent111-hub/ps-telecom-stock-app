'use client';

/**
 * Admin Due Book — customer-wise dues (same grouping rules as the app's screen):
 * summary cards, expandable customer groups, two-tap mark paid, WhatsApp reminder.
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Users, BadgeIndianRupee, ReceiptText, MessageCircle, CheckCircle2, LineChart as LineChartIcon, Banknote, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { getBillsOffline, markBillPaidOffline, getDueEntriesOffline } from '@/lib/offline-service';
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

interface DueGroup {
  key: string;
  name: string;
  mobile: string;
  bills: Bill[];
  totalDue: number;
}

type DueTab = 'list' | 'history';

export default function AdminDueBook() {
  const lang = useAdminStore((s) => s.language);
  const t = (k: string) => ta(k, lang);
  const tf = (k: string, v: Record<string, string | number>) => taf(k, lang, v);
  const tick = useAdminDataTick();

  const [bills, setBills] = useState<Bill[]>([]);
  const [dueEntries, setDueEntries] = useState<DueEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [payModal, setPayModal] = useState<{ bill: Bill; partial: boolean; amount: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<DueTab>('list');
  const [period, setPeriod] = useState<Period>('30');

  useEffect(() => {
    let alive = true;
    (async () => {
      const [rows, entries] = await Promise.all([
        getBillsOffline(DEFAULT_USER_ID),
        getDueEntriesOffline(DEFAULT_USER_ID),
      ]);
      if (!alive) return;
      setBills(rows.filter((b) => (b.dueAmount || 0) > 0.009));
      setDueEntries(entries);
    })();
    return () => {
      alive = false;
    };
  }, [tick]);

  const groups = useMemo<DueGroup[]>(() => {
    const map = new Map<string, DueGroup>();
    for (const b of bills) {
      const mobile = (b.customerMobile || '').trim();
      const name = (b.customerName || '').trim();
      const key = mobile || name || 'walk-in';
      const g = map.get(key) || {
        key,
        name: name || (mobile ? mobile : t('due.walkIn')),
        mobile,
        bills: [],
        totalDue: 0,
      };
      g.bills.push(b);
      g.totalDue += b.dueAmount || 0;
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.totalDue - a.totalDue);
  }, [bills, t]);

  const totalDue = groups.reduce((s, g) => s + g.totalDue, 0);

  // ── history: day-wise due made/collected + running outstanding (v2.27) ──
  const daily = useMemo(() => {
    const events: { date: string; dueMade: number; collected: number }[] = [];
    // open bill dues — remaining due attributed to the bill's own date;
    // day-end balance still converges EXACTLY to today's real outstanding
    for (const b of bills) {
      if ((b.dueAmount || 0) > 0.009) events.push({ date: b.date, dueMade: Number(b.dueAmount) || 0, collected: 0 });
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

  const doMarkPaid = async () => {
    if (!payModal) return;
    setBusy(true);
    try {
      const amount = payModal.partial ? Number(payModal.amount) : undefined;
      await markBillPaidOffline(payModal.bill.id, DEFAULT_USER_ID, amount);
      adminToast(t('bills.paidDone'));
      setPayModal(null);
    } catch (err) {
      adminToast((err as Error)?.message || t('c.error'), 'err');
    } finally {
      setBusy(false);
    }
  };

  const remind = (g: DueGroup) => {
    const phone = g.mobile.replace(/\D/g, '');
    if (!phone) {
      adminToast(t('due.walkIn'), 'info');
      return;
    }
    const msg = encodeURIComponent(
      `${ta('due.remindMsg', lang)}\n\n${g.name} — ${fmtMoney(g.totalDue)} (${g.bills.length} ${ta('bills.billNo', lang)})`
    );
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
  };

  return (
    <div>
      <PageHeader title={t('due.title')} />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <StatCard icon={<BadgeIndianRupee size={18} />} label={t('due.totalDue')} value={fmtMoney(totalDue)} tone="red" />
        <StatCard icon={<Users size={18} />} label={t('due.customers')} value={groups.length} tone="orange" />
        <StatCard icon={<ReceiptText size={18} />} label={t('bills.billNo')} value={bills.length} tone="amber" />
      </div>

      {/* growth graph — daily due bars + outstanding line */}
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
                ['list', 'due.tabList'],
                ['history', 'due.tabHistory'],
              ] as [DueTab, string][]
            ).map(([v, key]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={tab === v}
                onClick={() => setTab(v)}
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
        {tab === 'history' ? (
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
                        {g.bills.length} {t('due.billsCount')}{g.mobile ? ` · ${g.mobile}` : ''}
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
                    {g.bills.map((b) => (
                      <div key={b.id} className="flex items-center justify-between gap-3 bg-[var(--psa-hover)] rounded-lg px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[var(--psa-ink)]">
                            {b.billNumber || '—'} · {fmtDate(b.date)}
                          </p>
                          <p className="text-[11px] text-[var(--psa-faint)] tabular-nums">
                            {t('bills.total')} {fmtMoney(b.total)} · {t('bills.paid')} {fmtMoney(b.paidAmount)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge tone="red">{fmtMoney(b.dueAmount)}</Badge>
                          <Btn size="sm" variant="green" onClick={() => setPayModal({ bill: b, partial: false, amount: '' })}>
                            {t('bills.markPaid')}
                          </Btn>
                        </div>
                      </div>
                    ))}
                    {g.mobile && (
                      <Btn size="sm" variant="outline" onClick={() => remind(g)}>
                        <MessageCircle size={14} /> {t('due.remind')}
                      </Btn>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      <Modal
        open={!!payModal}
        onClose={() => setPayModal(null)}
        title={t('bills.markPaid')}
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
              {payModal.bill.billNumber} · {payModal.bill.customerName || t('due.walkIn')} — <b>{fmtMoney(payModal.bill.dueAmount)}</b>
            </p>
            {!payModal.partial ? (
              <p className="text-xs text-[var(--psa-muted)] bg-[var(--psa-soft-green)] rounded-lg p-3">
                {tf('bills.markPaidFull', { amount: fmtMoney(payModal.bill.dueAmount) })}
              </p>
            ) : (
              <Field label={tf('bills.markPaidPartial', { amount: fmtMoney(payModal.bill.dueAmount) })}>
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
