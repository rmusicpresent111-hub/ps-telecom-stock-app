'use client';

/**
 * Admin Expenses — Vyapar-style expense register with add/edit/delete.
 */

import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Wallet, CalendarDays, ReceiptText, LineChart as LineChartIcon, Banknote, TrendingDown, List, History as HistoryIcon } from 'lucide-react';
import {
  getExpensesOffline,
  createExpenseOffline,
  updateExpenseOffline,
  deleteExpenseOffline,
} from '@/lib/offline-service';
import { buildCashDaily } from '@/lib/cash-daily';
import { DEFAULT_USER_ID, getLocalUser } from '@/lib/local-auth';
import { useAdminStore } from '@/store/adminStore';
import { ta } from '@/lib/admin-i18n';
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
  Td,
  TextInput,
  Th,
  adminToast,
  fmtMoney,
  fmtDate,
} from './admin-ui';
import { PeriodToggle, windowPoints, DailyTallyChart, collapseFlat, type Period, type ChartPoint, type TallyRow } from './AdminHistoryKit';
import type { Expense } from '@/lib/types';
import { localDateStr } from '@/lib/offline-service';

type ExpForm = { date: string; amount: string; category: string; description: string };
type ExpTab = 'list' | 'history';

const CATEGORY_KEYS = ['exp.cat.rent', 'exp.cat.bill', 'exp.cat.salary', 'exp.cat.transport', 'exp.cat.other'];

const CAT_LABELS: Record<string, { bn: string; en: string; hi: string }> = {
  'exp.cat.rent': { bn: 'দোকান ভাড়া', en: 'Shop rent', hi: 'दुकान किराया' },
  'exp.cat.bill': { bn: 'বিদ্যুৎ/ফোন বিল', en: 'Electricity/Phone bill', hi: 'बिजली/फोन बिल' },
  'exp.cat.salary': { bn: 'বেতন', en: 'Salary', hi: 'वेतन' },
  'exp.cat.transport': { bn: 'পরিবহন', en: 'Transport', hi: 'परिवहन' },
  'exp.cat.other': { bn: 'অন্যান্য', en: 'Other', hi: 'अन्य' },
};

function catLabel(key: string, lang: 'bn' | 'en' | 'hi'): string {
  const l = CAT_LABELS[key];
  return l ? l[lang] : key;
}

export default function AdminExpenses() {
  const lang = useAdminStore((s) => s.language);
  const t = (k: string) => ta(k, lang);
  const tick = useAdminDataTick();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [shopName, setShopName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState<ExpForm>({ date: localDateStr(), amount: '', category: 'exp.cat.other', description: '' });
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [tab, setTab] = useState<ExpTab>('list');
  const [period, setPeriod] = useState<Period>('30');

  useEffect(() => {
    let alive = true;
    (async () => {
      const [rows, user] = await Promise.all([
        getExpensesOffline(DEFAULT_USER_ID),
        getLocalUser(DEFAULT_USER_ID),
      ]);
      if (!alive) return;
      setExpenses(rows.expenses);
      if (user?.shopName) setShopName(user.shopName);
    })();
    return () => {
      alive = false;
    };
  }, [tick]);

  const monthTotal = useMemo(() => {
    const prefix = localDateStr().slice(0, 7);
    return expenses.filter((e) => e.date.startsWith(prefix)).reduce((s, e) => s + (e.amount || 0), 0);
  }, [expenses]);

  // ── history: day-wise expense + running cumulative (v2.27) ──
  const daily = useMemo(
    () =>
      buildCashDaily(expenses.map((e) => ({ date: e.date, cashIn: Number(e.amount) || 0, cashOut: 0 }))),
    [expenses]
  );
  const countByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of expenses) m.set(e.date, (m.get(e.date) || 0) + 1);
    return m;
  }, [expenses]);
  const chartData: ChartPoint[] = useMemo(
    () => windowPoints(daily, period).map((p) => ({ date: p.date, bar: p.net, line: p.endBalance })),
    [daily, period]
  );
  const histRows: TallyRow<(typeof daily)[number]>[] = useMemo(
    () => collapseFlat(daily, (p) => p.net > 0, (p) => p.endBalance),
    [daily]
  );

  const openAdd = () => {
    setEditing(null);
    setForm({ date: localDateStr(), amount: '', category: 'exp.cat.other', description: '' });
    setFormOpen(true);
  };

  const openEdit = (e: Expense) => {
    setEditing(e);
    const known = CATEGORY_KEYS.find((k) => catLabel(k, 'en').toLowerCase() === (e.category || '').toLowerCase());
    setForm({
      date: e.date,
      amount: String(e.amount),
      category: known || 'exp.cat.other',
      description: e.description || '',
    });
    setFormOpen(true);
  };

  const save = async () => {
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      adminToast(t('c.required'), 'err');
      return;
    }
    setBusy(true);
    try {
      const category = catLabel(form.category, 'en');
      if (editing) {
        await updateExpenseOffline(editing.id, { amount, category, description: form.description.trim() }, DEFAULT_USER_ID);
        adminToast(t('c.saved'));
      } else {
        await createExpenseOffline({
          userId: DEFAULT_USER_ID,
          date: form.date || localDateStr(),
          amount,
          category,
          description: form.description.trim(),
        });
        adminToast(t('c.added'));
      }
      setFormOpen(false);
    } catch (err) {
      adminToast((err as Error)?.message || t('c.error'), 'err');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteExpenseOffline(deleting.id, DEFAULT_USER_ID);
      adminToast(t('c.deleted'));
      setDeleting(null);
    } catch (err) {
      adminToast((err as Error)?.message || t('c.error'), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('exp.title')}
        action={
          <Btn onClick={openAdd}>
            <Plus size={16} /> {t('exp.add')}
          </Btn>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <StatCard icon={<CalendarDays size={18} />} label={t('exp.thisMonth')} value={fmtMoney(monthTotal)} tone="red" />
        <StatCard icon={<Wallet size={18} />} label={t('exp.total')} value={fmtMoney(expenses.reduce((s, e) => s + (e.amount || 0), 0))} tone="amber" />
        <StatCard icon={<ReceiptText size={18} />} label={t('bills.billNo')} value={expenses.length} tone="slate" />
      </div>

      {/* growth graph — daily expense bars + running total line */}
      <AdminCard
        title={
          <span className="inline-flex items-center gap-2">
            <LineChartIcon size={16} className="text-[#DC2626]" /> {t('exp.growth')}
          </span>
        }
        action={<PeriodToggle value={period} onChange={setPeriod} labels={{ d7: t('cash.growth7'), d30: t('cash.growth30'), all: t('cash.growthAll') }} />}
      >
        <p className="text-[11px] text-[var(--psa-muted)] -mt-2 mb-2">{t('exp.growthSub')}</p>
        {chartData.length === 0 ? (
          <EmptyState icon={<LineChartIcon size={22} />} title={t('exp.noExpenses')} body={t('exp.growthSub')} />
        ) : (
          <DailyTallyChart
            data={chartData}
            period={period}
            barFill={() => '#DC2626'}
            lineColor="#D97706"
            formatBar={(v) => '− ' + fmtMoney(Math.abs(v))}
            barSeriesName={() => t('exp.legendDay')}
            legend={{ red: t('exp.legendDay'), line: t('exp.legendTotal') }}
            testId="exp-growth-chart"
          />
        )}
      </AdminCard>

      <AdminCard
        title={tab === 'history' ? t('exp.historyTitle') : undefined}
        bodyClass="!p-0"
      >
        {/* v2.38.0: prominent segmented tabs — the old floating pills in the
            card header were too easy to miss (owner: "history thakchena"). */}
        <div className="px-4 sm:px-5 pt-4 pb-3" role="tablist" aria-label={t('exp.title')}>
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[var(--psa-hover)] border border-[var(--psa-border)]">
            {(
              [
                ['list', 'exp.tabList', List],
                ['history', 'exp.tabHistory', HistoryIcon],
              ] as [ExpTab, string, typeof List][]
            ).map(([v, key, Icon]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={tab === v}
                onClick={() => setTab(v)}
                className={`h-9 rounded-lg text-[13px] font-bold inline-flex items-center justify-center gap-1.5 transition-colors ${
                  tab === v
                    ? 'bg-[#FA6E41] text-white shadow-sm'
                    : 'text-[var(--psa-sub)] hover:bg-[var(--psa-hover2)]'
                }`}
              >
                <Icon size={15} /> {t(key)}
              </button>
            ))}
          </div>
        </div>
        {tab === 'history' ? (
          histRows.length === 0 ? (
            <div className="p-4 sm:p-5">
              <EmptyState icon={<Wallet size={22} />} title={t('exp.noExpenses')} body={t('exp.growthSub')} />
            </div>
          ) : (
            <div className="max-h-[62vh] overflow-y-auto ledger-scroll divide-y divide-[var(--psa-line)] px-4 sm:px-5">
              {histRows.map((r) =>
                r.type === 'active' ? (
                  <div key={r.p.date} className="flex items-center gap-3 py-2.5">
                    <span
                      aria-hidden
                      className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-[var(--psa-soft-red)] text-[#DC2626]"
                    >
                      <TrendingDown size={17} />
                    </span>
                    <div className="min-w-0 grow">
                      <p className="text-sm font-semibold text-[var(--psa-ink)]">{fmtDate(r.p.date)}</p>
                      {(countByDay.get(r.p.date) || 0) > 1 && (
                        <p className="text-[11px] text-[var(--psa-faint)]">
                          {t('exp.count').replace('{n}', String(countByDay.get(r.p.date)))}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold tabular-nums text-[#DC2626]">− {fmtMoney(r.p.net)}</p>
                      <Badge tone="amber">
                        {t('exp.dayEndTotal')} {fmtMoney(r.p.endBalance)}
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
                      <p className="text-[11px] text-[var(--psa-faint)]">{t('exp.noTxn')}</p>
                    </div>
                    <Badge tone="slate">
                      {t('exp.dayEndTotal')} {fmtMoney(r.lineValue)}
                    </Badge>
                  </div>
                )
              )}
            </div>
          )
        ) : expenses.length === 0 ? (
          <div className="p-4 sm:p-5">
            <EmptyState icon={<Wallet size={22} />} title={t('exp.noExpenses')} />
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[62vh] overflow-y-auto">
            <table className="w-full min-w-[560px]">
              <thead className="bg-[var(--psa-hover)] sticky top-0 z-10">
                <tr>
                  <Th>{t('exp.date')}</Th>
                  <Th>{t('exp.category')}</Th>
                  <Th>{t('exp.description')}</Th>
                  <Th className="text-right">{t('exp.amount')}</Th>
                  <Th className="text-right">{t('c.edit')}</Th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id} className="hover:bg-[var(--psa-row-hover)] transition-colors">
                    <Td className="text-[var(--psa-muted)] whitespace-nowrap">{fmtDate(e.date)}</Td>
                    <Td>
                      <Badge tone="orange">{e.category || '—'}</Badge>
                    </Td>
                    <Td className="text-[var(--psa-sub)] max-w-60 truncate">{e.description || '—'}</Td>
                    <Td className="text-right tabular-nums font-semibold text-[#DC2626]">− {fmtMoney(e.amount)}</Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(e)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--psa-muted)] hover:bg-[var(--psa-hover2)]"
                          title={t('c.edit')}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setDeleting(e)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-[#DC2626] hover:bg-[var(--psa-soft-red)]"
                          title={t('c.delete')}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? t('c.edit') : t('exp.add')}
        footer={
          <>
            <Btn variant="outline" onClick={() => setFormOpen(false)}>
              {t('c.cancel')}
            </Btn>
            <Btn onClick={save} disabled={busy}>
              {t('c.save')}
            </Btn>
          </>
        }
      >
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('exp.date')}>
              <TextInput type="date" value={form.date} onChange={(ev) => setForm({ ...form, date: ev.target.value })} />
            </Field>
            <Field label={t('exp.amount')}>
              <TextInput
                type="number"
                min="0"
                value={form.amount}
                onChange={(ev) => setForm({ ...form, amount: ev.target.value })}
                autoFocus={!editing}
              />
            </Field>
          </div>
          <Field label={t('exp.category')}>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setForm({ ...form, category: k })}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    form.category === k
                      ? 'bg-[var(--psa-soft-orange)] border-[#FA6E41] text-[#E8552C]'
                      : 'bg-[var(--psa-card)] border-[var(--psa-field-border)] text-[var(--psa-muted)] hover:border-[#FA6E41]/50'
                  }`}
                >
                  {catLabel(k, lang)}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t('exp.description')}>
            <TextInput
              value={form.description}
              onChange={(ev) => setForm({ ...form, description: ev.target.value })}
              placeholder={shopName ? `${shopName} — …` : '…'}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('c.delete')}
        footer={
          <>
            <Btn variant="outline" onClick={() => setDeleting(null)}>
              {t('c.cancel')}
            </Btn>
            <Btn variant="danger" onClick={doDelete} disabled={busy}>
              {t('c.delete')}
            </Btn>
          </>
        }
      >
        <p className="text-sm text-[var(--psa-sub)]">
          {fmtDate(deleting?.date)} — <b>{fmtMoney(deleting?.amount || 0)}</b>
        </p>
      </Modal>
    </div>
  );
}
