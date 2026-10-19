'use client';

/**
 * Admin Reports — sales vs profit chart, period totals, top products.
 * Profit uses the FIFO cost snapshot recorded on each transaction.
 */

import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, PiggyBank, Wallet, Award } from 'lucide-react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  getTransactionsOffline,
  getExpensesOffline,
  localDateStr,
  isSaleType,
} from '@/lib/offline-service';
import { DEFAULT_USER_ID } from '@/lib/local-auth';
import { useAdminStore } from '@/store/adminStore';
import { ta } from '@/lib/admin-i18n';
import { useAdminDataTick } from './useAdminData';
import {
  AdminCard,
  Btn,
  EmptyState,
  Field,
  PageHeader,
  SelectInput,
  StatCard,
  TextInput,
  fmtMoney,
  ADMIN_COLORS,
} from './admin-ui';
import type { Transaction } from '@/lib/types';

type Period = 'today' | 'week' | 'month' | 'custom';

function rangeFor(period: Period, customFrom: string, customTo: string): { from: string; to: string } {
  const today = localDateStr();
  if (period === 'today') return { from: today, to: today };
  if (period === 'week') {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return { from: localDateStr(d), to: today };
  }
  if (period === 'month') {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return { from: localDateStr(d), to: today };
  }
  return customFrom <= customTo ? { from: customFrom, to: customTo } : { from: customTo, to: customFrom };
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

export default function AdminReports() {
  const lang = useAdminStore((s) => s.language);
  const dark = useAdminStore((s) => s.theme === 'dark');
  const t = (k: string) => ta(k, lang);
  const tick = useAdminDataTick();

  const [period, setPeriod] = useState<Period>('week');
  const [customFrom, setCustomFrom] = useState(localDateStr(new Date(Date.now() - 29 * 86400000)));
  const [customTo, setCustomTo] = useState(localDateStr());
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [expenseTotal, setExpenseTotal] = useState(0);

  const range = rangeFor(period, customFrom, customTo);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [ts, ex] = await Promise.all([
        getTransactionsOffline(DEFAULT_USER_ID, { from: range.from, to: range.to }),
        getExpensesOffline(DEFAULT_USER_ID, { from: range.from, to: range.to }),
      ]);
      if (!alive) return;
      setTxns(ts);
      setExpenseTotal(ex.summary.totalExpense);
    })();
    return () => {
      alive = false;
    };
  }, [tick, range.from, range.to]);

  const report = useMemo(() => {
    const sales = txns.filter((x) => isSaleType(x.type));
    let totalSales = 0;
    let totalProfit = 0;
    const dayMap = new Map<string, { day: string; sales: number; profit: number }>();
    const prodMap = new Map<string, { name: string; qty: number; revenue: number }>();

    for (const x of sales) {
      const cost = (x.quantity || 0) * (x.product?.purchasePrice ?? 0);
      const profit = (x.totalAmount || 0) - cost;
      totalSales += x.totalAmount || 0;
      totalProfit += profit;

      const d = dayMap.get(x.date) || { day: dayLabel(x.date), sales: 0, profit: 0 };
      d.sales += x.totalAmount || 0;
      d.profit += profit;
      dayMap.set(x.date, d);

      const key = x.productId;
      const p = prodMap.get(key) || { name: x.product?.name || '—', qty: 0, revenue: 0 };
      p.qty += x.quantity || 0;
      p.revenue += x.totalAmount || 0;
      prodMap.set(key, p);
    }

    // sort days chronologically (keys are YYYY-MM-DD so string sort works)
    const byDay = [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
    const topProducts = [...prodMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
    const maxRevenue = Math.max(1, ...topProducts.map((p) => p.revenue));

    return { totalSales, totalProfit, byDay, topProducts, maxRevenue };
  }, [txns]);

  const chartData = useMemo(() => {
    // compact the x-axis when the range is long
    if (report.byDay.length <= 15) return report.byDay;
    return report.byDay.filter((_, i) => i % 2 === 0 || i === report.byDay.length - 1);
  }, [report.byDay]);

  return (
    <div>
      <PageHeader title={t('rep.title')} />

      {/* period selector */}
      <AdminCard className="mb-4">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="grow">
            <Field label={t('rep.period')}>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {(['today', 'week', 'month', 'custom'] as Period[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPeriod(p)}
                    className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                      period === p
                        ? 'bg-[var(--psa-soft-orange)] border-[#FA6E41] text-[#E8552C]'
                        : 'bg-[var(--psa-card)] border-[var(--psa-field-border)] text-[var(--psa-muted)] hover:border-[#FA6E41]/50'
                    }`}
                  >
                    {t(p === 'today' ? 'rep.today' : p === 'week' ? 'rep.week' : p === 'month' ? 'rep.month' : 'rep.custom')}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          {period === 'custom' && (
            <>
              <Field label={t('rep.from')}>
                <TextInput type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </Field>
              <Field label={t('rep.to')}>
                <TextInput type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </Field>
            </>
          )}
        </div>
        <p className="text-xs text-[var(--psa-faint)] mt-2">
          {range.from} → {range.to}
        </p>
      </AdminCard>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <StatCard icon={<TrendingUp size={18} />} label={t('rep.totalSales')} value={fmtMoney(report.totalSales)} tone="orange" />
        <StatCard icon={<PiggyBank size={18} />} label={t('rep.totalProfit')} value={fmtMoney(report.totalProfit)} tone="green" />
        <StatCard icon={<Wallet size={18} />} label={t('rep.expenseTotal')} value={fmtMoney(expenseTotal)} tone="red" />
        <StatCard
          icon={<Award size={18} />}
          label={t('rep.netProfit')}
          value={fmtMoney(report.totalProfit - expenseTotal)}
          tone={report.totalProfit - expenseTotal >= 0 ? 'green' : 'red'}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <AdminCard title={t('rep.salesProfit')} className="lg:col-span-2">
          {report.byDay.length === 0 ? (
            <EmptyState icon={<TrendingUp size={22} />} title={t('rep.noData')} />
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: dark ? '#8E9AAB' : '#6B7280' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: dark ? '#8E9AAB' : '#6B7280' }} axisLine={false} tickLine={false} width={58} />
                  <RTooltip
                    formatter={(v: number, name: string) => [
                      fmtMoney(v),
                      name === 'sales' ? t('rep.totalSales') : t('rep.totalProfit'),
                    ]}
                    contentStyle={{
                      borderRadius: 10,
                      border: '1px solid var(--psa-border)',
                      background: 'var(--psa-card)',
                      color: 'var(--psa-ink)',
                      fontSize: 12,
                    }}
                  />
                  <Legend
                    formatter={(v: string) => (
                      <span className="text-xs text-[var(--psa-muted)]">{v === 'sales' ? t('rep.totalSales') : t('rep.totalProfit')}</span>
                    )}
                  />
                  <Bar dataKey="sales" fill={ADMIN_COLORS.orange} radius={[5, 5, 0, 0]} maxBarSize={26} />
                  <Line type="monotone" dataKey="profit" stroke={ADMIN_COLORS.green} strokeWidth={2.2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </AdminCard>

        <AdminCard title={t('rep.topProducts')}>
          {report.topProducts.length === 0 ? (
            <EmptyState icon={<Award size={22} />} title={t('rep.noData')} />
          ) : (
            <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
              {report.topProducts.map((p, i) => (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1 gap-2">
                    <span className="font-medium text-[var(--psa-sub)] truncate">
                      {i + 1}. {p.name}
                    </span>
                    <span className="text-[var(--psa-muted)] tabular-nums shrink-0">{fmtMoney(p.revenue)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--psa-soft-slate)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#FA6E41]"
                      style={{ width: `${Math.max(4, (p.revenue / report.maxRevenue) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-[var(--psa-faint)] mt-0.5">
                    {p.qty} {t('rep.sold')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      </div>
    </div>
  );
}
