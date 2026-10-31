'use client';

/**
 * Admin Cash — the Cash Book (v2.20.0).
 *
 * One merged ledger of every rupee that moves cash:
 *  - বিক্রয় (sales): collected sale money — sell amount with its profit —
 *    deposited into cash (bill paidAmount / bill-less sale transactions)
 *  - Others Invest: extra cash brought into the business (+)
 *  - Expenses: cash taken out (−)
 * Dues are NOT cash until collected; collecting a due raises the bill's
 * paidAmount, so the cash balance follows reality automatically.
 */

import { useEffect, useState } from 'react';
import {
  Banknote,
  TrendingUp,
  PiggyBank,
  Coins,
  ArrowDownLeft,
  ArrowUpRight,
  ReceiptText,
  Info,
} from 'lucide-react';
import type { CashBook, CashLedgerEntry } from '@/lib/offline-service';
import { DEFAULT_USER_ID } from '@/lib/local-auth';
import { useAdminStore } from '@/store/adminStore';
import { ta } from '@/lib/admin-i18n';
import { useAdminDataTick } from './useAdminData';
import { loadCached } from './adminCache';
import { AdminCard, StatCard, Badge, fmtMoney, fmtDate, EmptyState } from './admin-ui';

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

export default function AdminCash() {
  const lang = useAdminStore((s) => s.language);
  const t = (k: string) => ta(k, lang);
  const tick = useAdminDataTick();

  const [book, setBook] = useState<CashBook | null>(null);

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

      {/* ledger */}
      <AdminCard
        title={t('cash.ledger')}
        action={
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--psa-faint)]">
            <Info size={12} /> {t('cash.dueHint')}
          </span>
        }
        bodyClass="!pt-0"
      >
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
      </AdminCard>
    </div>
  );
}
