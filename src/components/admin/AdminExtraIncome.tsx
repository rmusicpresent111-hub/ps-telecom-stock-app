'use client';

/**
 * Admin Extra Income — v2.39.0.
 *
 * The app side has had the Extra Income screen (source + amount + history,
 * added straight to profit) since v2.38.0, but the ADMIN panel had no way to
 * see or manage those entries (owner: "extra income dekhte pachhina admin
 * panel e"). This section mirrors ExtraIncomeScreen inside the Vyapar-style
 * console: stat cards, growth graph, list + day-by-day history tabs, add +
 * delete. Same data layer (getExtraIncomeOffline / createExtraIncomeOffline /
 * deleteExtraIncomeOffline), so every entry here is the same store the app's
 * profile screen and the dashboard profit fold read from.
 */

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, PiggyBank, CalendarDays, ReceiptText, LineChart as LineChartIcon, TrendingUp, Banknote, List, History as HistoryIcon } from 'lucide-react';
import {
  getExtraIncomeOffline,
  createExtraIncomeOffline,
  deleteExtraIncomeOffline,
} from '@/lib/offline-service';
import { buildCashDaily } from '@/lib/cash-daily';
import { DEFAULT_USER_ID } from '@/lib/local-auth';
import { useAdminStore } from '@/store/adminStore';
import { taf, ta } from '@/lib/admin-i18n';
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
import type { ExtraIncome } from '@/lib/types';
import { localDateStr } from '@/lib/offline-service';

type EiForm = { date: string; amount: string; source: string; note: string };
type EiTab = 'list' | 'history';

export default function AdminExtraIncome() {
  const lang = useAdminStore((s) => s.language);
  const t = (k: string) => ta(k, lang);
  const tick = useAdminDataTick();

  const [incomes, setIncomes] = useState<ExtraIncome[]>([]);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<EiForm>({ date: localDateStr(), amount: '', source: '', note: '' });
  const [deleting, setDeleting] = useState<ExtraIncome | null>(null);
  const [tab, setTab] = useState<EiTab>('list');
  const [period, setPeriod] = useState<Period>('30');

  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await getExtraIncomeOffline(DEFAULT_USER_ID);
      if (!alive) return;
      setIncomes(rows);
    })();
    return () => {
      alive = false;
    };
  }, [tick]);

  const todayPrefix = localDateStr();
  const todayTotal = useMemo(
    () => incomes.filter((e) => e.date === todayPrefix).reduce((s, e) => s + (e.amount || 0), 0),
    [incomes, todayPrefix]
  );
  const allTotal = useMemo(() => incomes.reduce((s, e) => s + (e.amount || 0), 0), [incomes]);

  // ── history: day-wise income + running cumulative (same kit as Expenses) ──
  const daily = useMemo(
    () =>
      buildCashDaily(incomes.map((e) => ({ date: e.date, cashIn: Number(e.amount) || 0, cashOut: 0 }))),
    [incomes]
  );
  const countByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of incomes) m.set(e.date, (m.get(e.date) || 0) + 1);
    return m;
  }, [incomes]);
  const chartData: ChartPoint[] = useMemo(
    () => windowPoints(daily, period).map((p) => ({ date: p.date, bar: p.net, line: p.endBalance })),
    [daily, period]
  );
  const histRows: TallyRow<(typeof daily)[number]>[] = useMemo(
    () => collapseFlat(daily, (p) => p.net > 0, (p) => p.endBalance),
    [daily]
  );

  const openAdd = () => {
    setForm({ date: localDateStr(), amount: '', source: '', note: '' });
    setFormOpen(true);
  };

  const save = async () => {
    const amount = Number(form.amount);
    if (!form.source.trim() || !Number.isFinite(amount) || amount <= 0) {
      adminToast(t('c.required'), 'err');
      return;
    }
    setBusy(true);
    try {
      await createExtraIncomeOffline({
        userId: DEFAULT_USER_ID,
        sourceName: form.source.trim(),
        amount,
        date: form.date || localDateStr(),
        note: form.note.trim(),
      });
      adminToast(t('c.added'));
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
      await deleteExtraIncomeOffline(deleting.id, DEFAULT_USER_ID);
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
        title={t('nav.extraincome')}
        action={
          <Btn onClick={openAdd}>
            <Plus size={16} /> {t('ei.add')}
          </Btn>
        }
      />
      <p className="text-[12px] font-semibold text-[#16A34A] -mt-1.5 mb-3 inline-flex items-center gap-1.5">
        <TrendingUp size={14} /> {t('ei.subtitle')}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <StatCard icon={<CalendarDays size={18} />} label={t('ei.today')} value={fmtMoney(todayTotal)} tone="green" />
        <StatCard icon={<PiggyBank size={18} />} label={t('ei.total')} value={fmtMoney(allTotal)} tone="amber" />
        <StatCard icon={<ReceiptText size={18} />} label={t('ei.count')} value={incomes.length} tone="slate" />
      </div>

      {/* growth graph — daily income bars (green) + running total line */}
      <AdminCard
        title={
          <span className="inline-flex items-center gap-2">
            <LineChartIcon size={16} className="text-[#16A34A]" /> {t('ei.growth')}
          </span>
        }
        action={<PeriodToggle value={period} onChange={setPeriod} labels={{ d7: t('cash.growth7'), d30: t('cash.growth30'), all: t('cash.growthAll') }} />}
      >
        <p className="text-[11px] text-[var(--psa-muted)] -mt-2 mb-2">{t('ei.growthSub')}</p>
        {chartData.length === 0 ? (
          <EmptyState icon={<LineChartIcon size={22} />} title={t('ei.empty')} body={t('ei.emptySub')} />
        ) : (
          <DailyTallyChart
            data={chartData}
            period={period}
            barFill={() => '#16A34A'}
            lineColor="#D97706"
            formatBar={(v) => '+ ' + fmtMoney(Math.abs(v))}
            barSeriesName={() => t('ei.legendDay')}
            legend={{ red: t('ei.legendDay'), line: t('exp.legendTotal') }}
            testId="ei-growth-chart"
          />
        )}
      </AdminCard>

      <AdminCard
        title={tab === 'history' ? t('ei.historyTitle') : undefined}
        bodyClass="!p-0"
      >
        {/* same prominent segmented tabs as AdminExpenses v2.38.0 */}
        <div className="px-4 sm:px-5 pt-4 pb-3" role="tablist" aria-label={t('nav.extraincome')}>
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[var(--psa-hover)] border border-[var(--psa-border)]">
            {(
              [
                ['list', 'ei.tabList', List],
                ['history', 'exp.tabHistory', HistoryIcon],
              ] as [EiTab, string, typeof List][]
            ).map(([v, key, Icon]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={tab === v}
                onClick={() => setTab(v)}
                className={`h-9 rounded-lg text-[13px] font-bold inline-flex items-center justify-center gap-1.5 transition-colors ${
                  tab === v
                    ? 'bg-[#16A34A] text-white shadow-sm'
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
              <EmptyState icon={<PiggyBank size={22} />} title={t('ei.empty')} body={t('ei.emptySub')} />
            </div>
          ) : (
            <div className="max-h-[62vh] overflow-y-auto ledger-scroll divide-y divide-[var(--psa-line)] px-4 sm:px-5">
              {histRows.map((r) =>
                r.type === 'active' ? (
                  <div key={r.p.date} className="flex items-center gap-3 py-2.5">
                    <span
                      aria-hidden
                      className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-[var(--psa-soft-green)] text-[#16A34A]"
                    >
                      <TrendingUp size={17} />
                    </span>
                    <div className="min-w-0 grow">
                      <p className="text-sm font-semibold text-[var(--psa-ink)]">{fmtDate(r.p.date)}</p>
                      {(countByDay.get(r.p.date) || 0) > 1 && (
                        <p className="text-[11px] text-[var(--psa-faint)]">{taf('ei.entries', lang, { n: countByDay.get(r.p.date) || 0 })}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold tabular-nums text-[#16A34A]">+ {fmtMoney(r.p.net)}</p>
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
        ) : incomes.length === 0 ? (
          <div className="p-4 sm:p-5">
            <EmptyState icon={<PiggyBank size={22} />} title={t('ei.empty')} body={t('ei.emptySub')} />
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[62vh] overflow-y-auto">
            <table className="w-full min-w-[560px]">
              <thead className="bg-[var(--psa-hover)] sticky top-0 z-10">
                <tr>
                  <Th>{t('exp.date')}</Th>
                  <Th>{t('ei.source')}</Th>
                  <Th>{t('ei.note')}</Th>
                  <Th className="text-right">{t('exp.amount')}</Th>
                  <Th className="text-right">{t('c.delete')}</Th>
                </tr>
              </thead>
              <tbody>
                {incomes.map((e) => (
                  <tr key={e.id} className="hover:bg-[var(--psa-row-hover)] transition-colors">
                    <Td className="text-[var(--psa-muted)] whitespace-nowrap">{fmtDate(e.date)}</Td>
                    <Td>
                      <Badge tone="green">{e.sourceName || '—'}</Badge>
                    </Td>
                    <Td className="text-[var(--psa-sub)] max-w-60 truncate">{e.note || '—'}</Td>
                    <Td className="text-right tabular-nums font-semibold text-[#16A34A]">+ {fmtMoney(e.amount)}</Td>
                    <Td>
                      <div className="flex items-center justify-end">
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
        title={t('ei.add')}
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
                autoFocus
              />
            </Field>
          </div>
          <Field label={t('ei.source')}>
            <TextInput
              value={form.source}
              onChange={(ev) => setForm({ ...form, source: ev.target.value })}
              placeholder={t('ei.sourcePh')}
            />
          </Field>
          <Field label={t('ei.note')}>
            <TextInput
              value={form.note}
              onChange={(ev) => setForm({ ...form, note: ev.target.value })}
              placeholder={t('ei.notePh')}
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
          {t('ei.deleteAsk')}
        </p>
        <p className="text-sm text-[var(--psa-ink)] mt-2">
          {fmtDate(deleting?.date)} — <b>{deleting?.sourceName}</b> — <b className="text-[#16A34A]">+ {fmtMoney(deleting?.amount || 0)}</b>
        </p>
      </Modal>
    </div>
  );
}
