'use client';

/**
 * Admin Dashboard — Vyapar-style overview:
 * stat cards (incl. Cash in Hand), colorful 7-day sales chart with a profit
 * line, colorful category stock bars, low-stock alerts, recent bills.
 *
 * v2.20.0: charts are COLORFUL (per-day / per-category palette + profit line)
 * and a Cash-in-Hand card links straight to the new Cash Book section.
 */

import { useEffect, useState } from 'react';
import {
  Boxes,
  TrendingUp,
  Wallet,
  AlertTriangle,
  PackageX,
  ArrowRight,
  ShoppingCart,
  PiggyBank,
  Banknote,
  Zap,
} from 'lucide-react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { getDashboardOffline, getCashBookOffline } from '@/lib/offline-service';
import type { CashBook } from '@/lib/offline-service';
import { DEFAULT_USER_ID } from '@/lib/local-auth';
import { useAdminStore } from '@/store/adminStore';
import { ta } from '@/lib/admin-i18n';
import { useAdminDataTick } from './useAdminData';
import { loadCached } from './adminCache';
import { AdminCard, StatCard, Badge, Btn, fmtMoney, EmptyState } from './admin-ui';
import type { Bill } from '@/lib/types';

type Dashboard = Awaited<ReturnType<typeof getDashboardOffline>>;

/** Vibrant (blue-free) palette — one color per chart column/category. */
const CHART_COLORS = ['#FA6E41', '#F59E0B', '#EAB308', '#22C55E', '#14B8A6', '#A855F7', '#EC4899'] as const;

export default function AdminDashboard({
  goSection,
  onQuickSell,
}: {
  goSection: (s: 'products' | 'bills' | 'due' | 'cash' | 'invest') => void;
  onQuickSell: () => void;
}) {
  const lang = useAdminStore((s) => s.language);
  const dark = useAdminStore((s) => s.theme === 'dark');
  const t = (k: string) => ta(k, lang);
  const tick = useAdminDataTick();

  const [data, setData] = useState<Dashboard | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [cash, setCash] = useState<CashBook | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const svc = await import('@/lib/offline-service');
      const [d, b, c] = await Promise.all([
        loadCached('admin:dashboard', () => svc.getDashboardOffline(DEFAULT_USER_ID)),
        svc.getBillsOffline(DEFAULT_USER_ID),
        loadCached('admin:cashbook', () => svc.getCashBookOffline(DEFAULT_USER_ID)),
      ]);
      if (!alive) return;
      setData(d);
      setBills(b);
      setCash(c);
    })();
    return () => {
      alive = false;
    };
  }, [tick]);

  if (!data) {
    return (
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 animate-pulse">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-20 bg-[var(--psa-card)] rounded-xl border border-[var(--psa-border)]" />
        ))}
      </div>
    );
  }

  const { stats, saleOverview, stockOverview, lowStockProducts, todayProfit } = data;
  const maxCatValue = Math.max(1, ...stockOverview.map((s) => s.value));
  const recentBills = [...bills].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);

  return (
    <div className="space-y-4">
      {/* quick actions row */}
      <div className="flex items-center justify-end">
        <Btn onClick={onQuickSell}>
          <Zap size={16} /> {t('shell.quickSell')}
        </Btn>
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <StatCard
          icon={<Banknote size={20} />}
          label={t('dash.cashInHand')}
          value={fmtMoney(cash?.balance ?? 0)}
          tone="green"
          sub={cash ? `+${fmtMoney(cash.todayIn)} / −${fmtMoney(cash.todayOut)}` : undefined}
          onClick={() => goSection('cash')}
        />
        <StatCard
          icon={<Boxes size={20} />}
          label={t('dash.stockValue')}
          value={fmtMoney(stats.stockValue)}
          tone="orange"
          sub={`${stats.totalItems} ${t('dash.totalItems').toLowerCase()}`}
          onClick={() => goSection('products')}
        />
        <StatCard
          icon={<TrendingUp size={20} />}
          label={t('dash.todaySale')}
          value={fmtMoney(saleOverview[6]?.sales || 0)}
          tone="amber"
          sub={`${stats.todayTransactions} ${t('nav.bills').toLowerCase()}`}
        />
        <StatCard
          icon={<PiggyBank size={20} />}
          label={t('dash.todayProfit')}
          value={fmtMoney(todayProfit)}
          tone="green"
        />
        <StatCard
          icon={<Wallet size={20} />}
          label={t('dash.toCollect')}
          value={fmtMoney(stats.totalDue)}
          tone="red"
          sub={`${stats.dueBills} ${t('dash.items')}`}
          onClick={() => goSection('due')}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* 7-day sales chart — colorful bars + profit line */}
        <AdminCard title={t('dash.saleOverview')} className="lg:col-span-2">
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={saleOverview} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: dark ? '#8E9AAB' : '#6B7280' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: dark ? '#8E9AAB' : '#6B7280' }} axisLine={false} tickLine={false} width={54} />
                <RTooltip
                  formatter={(v: number, name: string) => [
                    fmtMoney(v),
                    name === 'profit' ? t('dash.todayProfit') : t('dash.todaySale'),
                  ]}
                  contentStyle={{
                    borderRadius: 10,
                    border: '1px solid var(--psa-border)',
                    background: 'var(--psa-card)',
                    color: 'var(--psa-ink)',
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="sales" radius={[6, 6, 0, 0]} maxBarSize={38}>
                  {saleOverview.map((entry, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
                <Line
                  type="monotone"
                  dataKey="profit"
                  stroke="#EC4899"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#EC4899', strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </AdminCard>

        {/* stock by category — colorful per-category bars */}
        <AdminCard title={t('dash.stockByCategory')}>
          {stockOverview.length === 0 ? (
            <EmptyState icon={<Boxes size={22} />} title={t('c.noData')} />
          ) : (
            <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
              {stockOverview.map((s, i) => (
                <div key={s.category}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-[var(--psa-sub)] truncate">{s.category}</span>
                    <span className="text-[var(--psa-muted)] tabular-nums shrink-0 ml-2">{fmtMoney(s.value)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--psa-soft-slate)] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{
                        width: `${Math.max(4, (s.value / maxCatValue) * 100)}%`,
                        background: `linear-gradient(90deg, ${CHART_COLORS[i % CHART_COLORS.length]}, ${CHART_COLORS[(i + 2) % CHART_COLORS.length]})`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* low stock */}
        <AdminCard
          title={
            <span className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-[#D97706]" />
              {t('dash.lowStockAlert')}
            </span>
          }
          action={
            <button onClick={() => goSection('products')} className="text-xs font-semibold text-[#E8552C] hover:underline flex items-center gap-0.5">
              {t('dash.viewAll')} <ArrowRight size={12} />
            </button>
          }
        >
          {lowStockProducts.length === 0 ? (
            <EmptyState icon={<PackageX size={22} />} title={t('dash.noLowStock')} />
          ) : (
            <div className="divide-y divide-[var(--psa-line)] max-h-64 overflow-y-auto">
              {lowStockProducts.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2.5 gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--psa-ink)] truncate">{p.name}</p>
                    <p className="text-[11px] text-[var(--psa-faint)]">
                      {t('prod.lowThreshold')}: {p.lowStockThreshold}
                    </p>
                  </div>
                  <Badge tone={p.quantity <= 0 ? 'red' : 'amber'}>
                    {p.quantity <= 0 ? t('prod.out') : `${p.quantity} ${t('prod.qty')}`}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </AdminCard>

        {/* recent bills */}
        <AdminCard
          title={
            <span className="flex items-center gap-2">
              <ShoppingCart size={16} className="text-[#E8552C]" />
              {t('dash.recentBills')}
            </span>
          }
          action={
            <button onClick={() => goSection('bills')} className="text-xs font-semibold text-[#E8552C] hover:underline flex items-center gap-0.5">
              {t('dash.viewAll')} <ArrowRight size={12} />
            </button>
          }
        >
          {recentBills.length === 0 ? (
            <EmptyState icon={<ShoppingCart size={22} />} title={t('bills.noBills')} />
          ) : (
            <div className="divide-y divide-[var(--psa-line)] max-h-64 overflow-y-auto">
              {recentBills.map((b) => (
                <div key={b.id} className="flex items-center justify-between py-2.5 gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--psa-ink)] truncate">
                      {b.billNumber || '—'} · {b.customerName || t('due.walkIn')}
                    </p>
                    <p className="text-[11px] text-[var(--psa-faint)]">{b.date}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold tabular-nums text-[var(--psa-ink)]">{fmtMoney(b.total)}</p>
                    {(b.dueAmount || 0) > 0 ? (
                      <Badge tone="red">
                        {t('bills.due')} {fmtMoney(b.dueAmount)}
                      </Badge>
                    ) : (
                      <Badge tone="green">{t('bills.paid')}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      </div>
    </div>
  );
}
