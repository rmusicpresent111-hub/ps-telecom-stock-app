'use client';

/**
 * Admin Cash — the Cash Book (v2.26.0).
 *
 * One merged ledger of every rupee that moves cash:
 *  - বিক্রয় (sales): collected sale money — sell amount with its profit —
 *    deposited into cash (bill paidAmount / bill-less sale transactions)
 *  - Others Invest: extra cash brought into the business (+)
 *  - Expenses: cash taken out (−)
 * Dues are NOT cash until collected; collecting a due raises the bill's
 * paidAmount, so the cash balance follows reality automatically.
 *
 * v2.26.0 — CASH GROWTH:
 *  - Growth graph: daily net change bars (green up / red down) with the
 *    day-end balance line riding on top, switchable 7d / 30d / all-time.
 *  - Daily History tab inside the ledger card: every day, how much came in,
 *    went out, and "koto tarikhe koto taka chilo" — the day-end balance.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  TrendingUp,
  PiggyBank,
  Coins,
  ArrowDownLeft,
  ArrowUpRight,
  ReceiptText,
  Info,
  LineChart as LineChartIcon,
} from 'lucide-react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { CashBook, CashLedgerEntry, CashDailyPoint } from '@/lib/offline-service';
import { DEFAULT_USER_ID } from '@/lib/local-auth';
import { useAdminStore } from '@/store/adminStore';
import { ta } from '@/lib/admin-i18n';
import { useAdminDataTick } from './useAdminData';
import { loadCached } from './adminCache';
import { AdminCard, StatCard, Badge, Btn, fmtMoney, fmtDate, EmptyState } from './admin-ui';

type KindTone = {
  icon: React.ComponentType<{ size?: number | string }>;
  iconBg: string;
  labelKey: string;
};

const KIND: Record<CashLedgerEntry['kind'], KindTone> = {
  sale: { icon: ReceiptText, iconBg: 'var(--psa-soft-green)', labelKey: 'cash.sale' },
  invest: { icon: PiggyBank, iconBg: 'var(--psa-soft-orange)', labelKey: 'cash.invest' },
  expense: { icon: Coins, iconBg: 'var(--psa-soft-red)', labelKey: 'cash.expense' },
};

type Period = '7' | '30' | 'all';
type CashTab = 'ledger' | 'daily';

/** Locale-aware short date for chart ticks / history rows (bn/en/hi). */
const LOCALES = { bn: 'bn-BD', en: 'en-IN', hi: 'hi-IN' } as const;
function shortDate(date: string, lang: 'bn' | 'en' | 'hi'): string {
  const d = new Date(date + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat(LOCALES[lang], { day: 'numeric', month: 'short' }).format(d);
}

export default function AdminCash() {
  const lang = useAdminStore((s) => s.language);
  const dark = useAdminStore((s) => s.theme === 'dark');
  const t = (k: string) => ta(k, lang);
  const tick = useAdminDataTick();

  const [book, setBook] = useState<CashBook | null>(null);
  const [period, setPeriod] = useState<Period>('30');
  const [tab, setTab] = useState<CashTab>('ledger');

  useEffect(() => {
    let alive = true;
    void import('@/lib/offline-service').then((m) =>
      loadCached('admin:cashbook', () => m.getCashBookOffline(DEFAULT_USER_ID))
        .then((b) => {
          if (alive) setBook(b);
        })
        .catch(() => undefined)
    );
    return () => {
      alive = false;
    };
  }, [tick]);

  // chart window — daily is ascending; slice the tail for 7d / 30d
  const chartData: CashDailyPoint[] = useMemo(() => {
    const daily = book?.daily ?? [];
    if (period === 'all') return daily;
    const n = period === '7' ? 7 : 30;
    return daily.slice(-n);
  }, [book, period]);

  // daily history rows (newest first) — flat no-activity runs collapse
  // into ONE row so the list stays readable, balance still shown.
  type HistRow =
    | { type: 'active'; p: CashDailyPoint }
    | { type: 'flat'; from: string; to: string; endBalance: number };

  const histRows: HistRow[] = useMemo(() => {
    const daily = book?.daily ?? [];
    const rows: HistRow[] = [];
    let flat: { from: string; to: string; endBalance: number } | null = null;
    for (const p of [...daily].reverse()) {
      if (p.cashIn > 0 || p.cashOut > 0) {
        if (flat) {
          rows.push({ type: 'flat', ...flat });
          flat = null;
        }
        rows.push({ type: 'active', p });
      } else if (flat) {
        flat.from = p.date; // walking newest → oldest, extend the run older
      } else {
        flat = { from: p.date, to: p.date, endBalance: p.endBalance };
      }
    }
    if (flat) rows.push({ type: 'flat', ...flat });
    return rows;
  }, [book]);

  const fmtTick = (date: string) => shortDate(date, lang);

  // round Y-axis ticks (1/2/2.5/5 × 10^k) covering both bars (net) and line (balance)
  const yTicks: number[] = useMemo(() => {
    const vals = chartData.flatMap((p) => [p.net, p.endBalance, 0]);
    if (vals.length === 0) return [];
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = Math.max(hi - lo, 100);
    const mag = Math.pow(10, Math.floor(Math.log10(span / 4)));
    const step = ([1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= 5) ?? span / 4);
    const ticks: number[] = [];
    for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.999; v += step) ticks.push(Math.round(v * 100) / 100);
    if (ticks[ticks.length - 1] < hi) ticks.push(Math.ceil(hi / step) * step);
    return ticks;
  }, [chartData]);

  if (!book) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-28 bg-[var(--psa-card)] rounded-xl border border-[var(--psa-border)]" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-[var(--psa-card)] rounded-xl border border-[var(--psa-border)]" />
          ))}
        </div>
      </div>
    );
  }

  const tickFill = dark ? '#8E9AAB' : '#6B7280';
  const gridStroke = dark ? 'rgba(142,154,171,0.15)' : 'rgba(107,114,128,0.18)';
  const tooltipStyle = {
    borderRadius: 10,
    border: '1px solid var(--psa-border)',
    background: 'var(--psa-card)',
    color: 'var(--psa-ink)',
    fontSize: 12,
  } as const;

  return (
    <div className="space-y-4">
      {/* hero — cash in hand */}
      <div className="relative overflow-hidden rounded-xl border border-[var(--psa-border)] bg-gradient-to-r from-[#16A34A] to-[#0E7A3D] text-white p-5 sm:p-6 shadow-[0_8px_24px_rgba(22,163,74,0.25)]">
        <div className="absolute -right-6 -top-8 opacity-15" aria-hidden>
          <Banknote size={150} strokeWidth={1.2} />
        </div>
        <p className="text-[13px] font-semibold text-white/85">{t('cash.inHand')}</p>
        <p className="text-3xl sm:text-4xl font-black tabular-nums mt-1 tracking-tight">{fmtMoney(book.balance)}</p>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold">
            <ArrowDownLeft size={13} /> {t('cash.todayIn')}: {fmtMoney(book.todayIn)}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/15 px-3 py-1 text-xs font-bold">
            <ArrowUpRight size={13} /> {t('cash.todayOut')}: {fmtMoney(book.todayOut)}
          </span>
        </div>
      </div>

      {/* breakdown */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={<TrendingUp size={18} />}
          label={t('cash.salesIn')}
          value={fmtMoney(book.salesIn)}
          tone="green"
          sub={`+ ${fmtMoney(book.salesIn)}`}
        />
        <StatCard
          icon={<PiggyBank size={18} />}
          label={t('cash.investIn')}
          value={fmtMoney(book.investIn)}
          tone="orange"
        />
        <StatCard
          icon={<Coins size={18} />}
          label={t('cash.expenseOut')}
          value={fmtMoney(book.expenseOut)}
          tone="red"
          sub={`− ${fmtMoney(book.expenseOut)}`}
        />
        <StatCard
          icon={<Banknote size={18} />}
          label={t('cash.inHand')}
          value={fmtMoney(book.balance)}
          tone="amber"
        />
      </div>

      {/* growth graph — daily net bars + day-end balance line */}
      <AdminCard
        title={
          <span className="inline-flex items-center gap-2">
            <LineChartIcon size={16} className="text-[#16A34A]" /> {t('cash.growth')}
          </span>
        }
        action={
          <div className="flex items-center gap-1.5" role="group" aria-label={t('cash.growth')}>
            {(
              [
                ['7', 'cash.growth7'],
                ['30', 'cash.growth30'],
                ['all', 'cash.growthAll'],
              ] as [Period, string][]
            ).map(([p, key]) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                aria-pressed={period === p}
                className={`h-8 px-2.5 rounded-lg text-xs font-bold transition-colors ${
                  period === p
                    ? 'bg-[#16A34A] text-white shadow-sm'
                    : 'border border-[var(--psa-border)] text-[var(--psa-sub)] hover:bg-[var(--psa-hover)]'
                }`}
              >
                {t(key)}
              </button>
            ))}
          </div>
        }
      >
        <p className="text-[11px] text-[var(--psa-muted)] -mt-2 mb-2">{t('cash.growthSub')}</p>
        {chartData.length === 0 ? (
          <EmptyState icon={<LineChartIcon size={22} />} title={t('cash.noEntries')} body={t('cash.growthSub')} />
        ) : (
          <>
            <div className="h-56 w-full" data-testid="cash-growth-chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -2, bottom: 0 }}>
                  <CartesianGrid stroke={gridStroke} vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={fmtTick}
                    tick={{ fontSize: 10, fill: tickFill }}
                    axisLine={false}
                    tickLine={false}
                    interval={chartData.length <= 10 ? 0 : period === '30' ? 4 : 'equidistantPreserveStart'}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: tickFill }}
                    axisLine={false}
                    tickLine={false}
                    width={60}
                    domain={yTicks.length ? [yTicks[0], yTicks[yTicks.length - 1]] : [0, 100]}
                    ticks={yTicks.length ? yTicks : undefined}
                    tickFormatter={(v: number) => Math.round(v).toLocaleString('en-IN')}
                  />
                  <RTooltip
                    formatter={(v: number, name: string) => [
                      (name === 'net' && v >= 0 ? '+' : '−') + fmtMoney(Math.abs(v)),
                      name === 'net' ? t('cash.legendNet') : t('cash.legendBal'),
                    ]}
                    labelFormatter={(date: string) => fmtDate(date)}
                    contentStyle={tooltipStyle}
                    cursor={{ fill: dark ? 'rgba(142,154,171,0.08)' : 'rgba(250,110,65,0.06)' }}
                  />
                  <Bar dataKey="net" radius={[3, 3, 0, 0]} maxBarSize={26}>
                    {chartData.map((p) => (
                      <Cell key={p.date} fill={p.net >= 0 ? '#16A34A' : '#DC2626'} />
                    ))}
                  </Bar>
                  <Line
                    type="monotone"
                    dataKey="endBalance"
                    stroke="#D97706"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3.5, fill: '#D97706' }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {/* legend */}
            <div className="flex flex-wrap items-center gap-4 mt-2 text-[11px] font-medium text-[var(--psa-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="w-2.5 h-2.5 rounded-sm bg-[#16A34A]" /> {t('cash.legendNet')} ↑
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="w-2.5 h-2.5 rounded-sm bg-[#DC2626]" /> {t('cash.legendNet')} ↓
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="w-4 h-0.5 rounded bg-[#D97706]" /> {t('cash.legendBal')}
              </span>
            </div>
          </>
        )}
      </AdminCard>

      {/* ledger + daily history (tabbed) */}
      <AdminCard
        title={tab === 'ledger' ? t('cash.ledger') : t('cash.dailyHistory')}
        action={
          <div className="flex items-center gap-1.5" role="tablist" aria-label={t('cash.title')}>
            {(
              [
                ['ledger', 'cash.tabLedger'],
                ['daily', 'cash.tabDaily'],
              ] as [CashTab, string][]
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
        bodyClass="!pt-0"
      >
        {tab === 'daily' ? (
          /* ── DAILY HISTORY — koto tarikhe koto taka chilo ── */
          histRows.length === 0 ? (
            <EmptyState icon={<Banknote size={22} />} title={t('cash.noEntries')} body={t('cash.dueHint')} />
          ) : (
            <div className="max-h-[56vh] overflow-y-auto ledger-scroll divide-y divide-[var(--psa-line)] -mx-1 px-1">
              {histRows.map((r) =>
                r.type === 'active' ? (
                  <div key={r.p.date} className="flex items-center gap-3 py-2.5">
                    <span
                      aria-hidden
                      className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
                        r.p.net >= 0 ? 'bg-[var(--psa-soft-green)] text-[#16A34A]' : 'bg-[var(--psa-soft-red)] text-[#DC2626]'
                      }`}
                    >
                      {r.p.net >= 0 ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}
                    </span>
                    <div className="min-w-0 grow">
                      <p className="text-sm font-semibold text-[var(--psa-ink)]">{fmtDate(r.p.date)}</p>
                      <p className="text-[11px] text-[var(--psa-faint)] tabular-nums">
                        <span className="text-[#16A34A] font-semibold">{t('cash.dayIn')} {fmtMoney(r.p.cashIn)}</span>
                        {' · '}
                        <span className="text-[#DC2626] font-semibold">{t('cash.dayOut')} {fmtMoney(r.p.cashOut)}</span>
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-bold tabular-nums ${r.p.net >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>
                        {r.p.net >= 0 ? '+' : '−'} {fmtMoney(Math.abs(r.p.net))}
                      </p>
                      <Badge tone="amber">
                        {t('cash.dayEnd')} {fmtMoney(r.p.endBalance)}
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
                      <p className="text-[11px] text-[var(--psa-faint)]">{t('cash.noTxn')}</p>
                    </div>
                    <Badge tone="slate">
                      {t('cash.dayEnd')} {fmtMoney(r.endBalance)}
                    </Badge>
                  </div>
                )
              )}
            </div>
          )
        ) : (
          /* ── ENTRY LEDGER (existing) ── */
          <>
            {book.entries.length === 0 ? (
              <EmptyState icon={<Banknote size={22} />} title={t('cash.noEntries')} body={t('cash.dueHint')} />
            ) : (
              <div className="max-h-[56vh] overflow-y-auto ledger-scroll divide-y divide-[var(--psa-line)] -mx-1 px-1">
                {book.entries.map((e) => {
                  const k = KIND[e.kind];
                  const Icon = k.icon;
                  const inflow = e.cashIn > 0;
                  return (
                    <div key={e.id} className="flex items-center gap-3 py-2.5">
                      <span
                        aria-hidden
                        className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
                        style={{ background: k.iconBg, color: inflow ? '#16A34A' : e.kind === 'expense' ? '#DC2626' : '#E8552C' }}
                      >
                        <Icon size={17} />
                      </span>
                      <div className="min-w-0 grow">
                        <p className="text-sm font-semibold text-[var(--psa-ink)] truncate">
                          {e.title}
                          <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-[var(--psa-faint)] align-middle">
                            {t(k.labelKey)}
                          </span>
                        </p>
                        <p className="text-[11px] text-[var(--psa-faint)] truncate">
                          {fmtDate(e.date)}
                          {e.kind === 'sale' && e.profit > 0 && (
                            <span className="text-[#16A34A] font-semibold"> · {t('cash.profit')} {fmtMoney(e.profit)}</span>
                          )}
                          {e.kind === 'sale' && e.due > 0 && (
                            <span className="text-[#DC2626] font-semibold"> · {t('cash.due')} {fmtMoney(e.due)}</span>
                          )}
                          {e.kind === 'expense' && e.sub && <span> · {e.sub}</span>}
                          {e.kind === 'invest' && e.sub && <span> · {e.sub}</span>}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-bold tabular-nums ${inflow ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>
                          {inflow ? '+' : '−'} {fmtMoney(inflow ? e.cashIn : e.cashOut)}
                        </p>
                        <Badge tone={inflow ? 'green' : 'red'}>{inflow ? 'IN' : 'OUT'}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </AdminCard>
    </div>
  );
}
