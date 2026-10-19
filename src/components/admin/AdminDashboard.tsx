'use client';

/**
 * Admin Dashboard — Vyapar-style overview:
 * stat cards, 7-day sales chart, category stock, low-stock alerts, recent bills.
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
  Zap,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { getDashboardOffline } from '@/lib/offline-service';
import { DEFAULT_USER_ID } from '@/lib/local-auth';
import { useAdminStore } from '@/store/adminStore';
import { ta } from '@/lib/admin-i18n';
import { useAdminDataTick } from './useAdminData';
import { AdminCard, StatCard, Badge, Btn, fmtMoney, EmptyState, ADMIN_COLORS } from './admin-ui';
import type { Bill } from '@/lib/types';

type Dashboard = Awaited<ReturnType<typeof getDashboardOffline>>;

export default function AdminDashboard({
  goSection,
  onQuickSell,
}: {
  goSection: (s: 'products' | 'bills' | 'due') => void;
  onQuickSell: () => void;
}) {
  const lang = useAdminStore((s) => s.language);
  const dark = useAdminStore((s) => s.theme === 'dark');
  const t = (k: string) => ta(k, lang);
  const tick = useAdminDataTick();

  const [data, setData] = useState<Dashboard | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [d, b] = await Promise.all([
        getDashboardOffline(DEFAULT_USER_ID),
        import('@/lib/offline-service').then((m) => m.getBillsOffline(DEFAULT_USER_ID)),
      ]);
      if (!alive) return;
      setData(d);
      setBills(b);
    })();
    return () => {
      alive = false;
    };
  }, [tick]);

  if (!data) {
    return (
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 animate-pulse">
        {Array.from({ length: 8 }).map((_, i) => (
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
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
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
          tone="green"
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
        {/* 7-day sales chart */}
        <AdminCard title={t('dash.saleOverview')} className="lg:col-span-2">
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={saleOverview} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: dark ? '#8E9AAB' : '#6B7280' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: dark ? '#8E9AAB' : '#6B7280' }} axisLine={false} tickLine={false} width={54} />
                <RTooltip
                  formatter={(v: number) => [fmtMoney(v), t('dash.todaySale')]}
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
                    <Cell key={i} fill={i === saleOverview.length - 1 ? ADMIN_COLORS.orange : dark ? '#6B2A12' : '#FFD3C2'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </AdminCard>

        {/* stock by category */}
        <AdminCard title={t('dash.stockByCategory')}>
          {stockOverview.length === 0 ? (
            <EmptyState icon={<Boxes size={22} />} title={t('c.noData')} />
          ) : (
            <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
              {stockOverview.map((s) => (
                <div key={s.category}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-[var(--psa-sub)] truncate">{s.category}</span>
                    <span className="text-[var(--psa-muted)] tabular-nums shrink-0 ml-2">{fmtMoney(s.value)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--psa-soft-slate)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#FA6E41]"
                      style={{ width: `${Math.max(4, (s.value / maxCatValue) * 100)}%` }}
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
