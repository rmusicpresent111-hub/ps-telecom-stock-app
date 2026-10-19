'use client';

/**
 * Admin Staff Payments — record money paid to staff (salary / advance /
 * bonus / other), with per-staff totals, search and a printable report.
 * Rows live in the `staffPayments` IndexedDB store and sync to D1 exactly
 * like expenses, so they survive across devices.
 */

import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, UserCog, IndianRupee, Users, Printer } from 'lucide-react';
import {
  getStaffPaymentsOffline,
  createStaffPaymentOffline,
  updateStaffPaymentOffline,
  deleteStaffPaymentOffline,
  localDateStr,
} from '@/lib/offline-service';
import { DEFAULT_USER_ID } from '@/lib/local-auth';
import { useAdminStore } from '@/store/adminStore';
import { ta } from '@/lib/admin-i18n';
import { useAdminDataTick } from './useAdminData';
import { printGenericReport, escHtml } from './print';
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
import type { StaffPayment, StaffPaymentKind } from '@/lib/types';

type KindKey = 'staff.kind.salary' | 'staff.kind.advance' | 'staff.kind.bonus' | 'staff.kind.other';

const KIND_KEYS: KindKey[] = ['staff.kind.salary', 'staff.kind.advance', 'staff.kind.bonus', 'staff.kind.other'];

const KIND_LABELS: Record<KindKey, { bn: string; en: string; hi: string }> = {
  'staff.kind.salary': { bn: 'বেতন', en: 'Salary', hi: 'वेतन' },
  'staff.kind.advance': { bn: 'অগ্রিম', en: 'Advance', hi: 'अग्निम' },
  'staff.kind.bonus': { bn: 'বোনাস', en: 'Bonus', hi: 'बोनस' },
  'staff.kind.other': { bn: 'অন্যান্য', en: 'Other', hi: 'अन्य' },
};

const KIND_TO_STORAGE: Record<KindKey, StaffPaymentKind> = {
  'staff.kind.salary': 'salary',
  'staff.kind.advance': 'advance',
  'staff.kind.bonus': 'bonus',
  'staff.kind.other': 'other',
};

function kindFromStorage(kind: string): KindKey {
  const found = (Object.keys(KIND_TO_STORAGE) as KindKey[]).find((k) => KIND_TO_STORAGE[k] === kind);
  return found || 'staff.kind.other';
}

type RangeKey = 'thisMonth' | 'lastMonth' | 'all';

function rangeDates(key: RangeKey): { from?: string; to?: string } {
  const today = localDateStr();
  const ym = today.slice(0, 7);
  if (key === 'thisMonth') return { from: `${ym}-01`, to: today };
  if (key === 'lastMonth') {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    const ym2 = localDateStr(d).slice(0, 7);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return { from: `${ym2}-01`, to: `${ym2}-${String(lastDay).padStart(2, '0')}` };
  }
  return {};
}

type SpForm = { date: string; staffName: string; staffPhone: string; kind: KindKey; amount: string; note: string };

export default function AdminStaffPayments() {
  const lang = useAdminStore((s) => s.language);
  const t = (k: string) => ta(k, lang);
  const tick = useAdminDataTick();

  const [rows, setRows] = useState<StaffPayment[]>([]);
  const [byStaff, setByStaff] = useState<{ name: string; total: number; count: number }[]>([]);
  const [range, setRange] = useState<RangeKey>('thisMonth');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StaffPayment | null>(null);
  const [deleting, setDeleting] = useState<StaffPayment | null>(null);
  const [form, setForm] = useState<SpForm>({
    date: localDateStr(),
    staffName: '',
    staffPhone: '',
    kind: 'staff.kind.salary',
    amount: '',
    note: '',
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      const { from, to } = rangeDates(range);
      const res = await getStaffPaymentsOffline(DEFAULT_USER_ID, { from, to });
      if (!alive) return;
      setRows(res.staffPayments);
      setByStaff(res.summary.byStaff);
    })();
    return () => {
      alive = false;
    };
  }, [tick, range]);

  // staff name suggestions from ALL-TIME rows (not just the visible range)
  const [allNames, setAllNames] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    getStaffPaymentsOffline(DEFAULT_USER_ID)
      .then((res) => {
        if (!alive) return;
        setAllNames(res.summary.byStaff.map((s) => s.name));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [tick]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (p) => p.staffName.toLowerCase().includes(q) || (p.staffPhone || '').includes(q)
    );
  }, [rows, search]);

  const total = useMemo(() => filtered.reduce((s, p) => s + (p.amount || 0), 0), [filtered]);
  const staffCount = useMemo(() => new Set(rows.map((p) => p.staffName)).size, [rows]);

  const openAdd = () => {
    setEditing(null);
    setForm({ date: localDateStr(), staffName: '', staffPhone: '', kind: 'staff.kind.salary', amount: '', note: '' });
    setFormOpen(true);
  };

  const openEdit = (p: StaffPayment) => {
    setEditing(p);
    setForm({
      date: p.date,
      staffName: p.staffName,
      staffPhone: p.staffPhone || '',
      kind: kindFromStorage(p.kind),
      amount: String(p.amount),
      note: p.note || '',
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.staffName.trim()) {
      adminToast(t('staff.nameRequired'), 'err');
      return;
    }
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      adminToast(t('c.required'), 'err');
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await updateStaffPaymentOffline(
          editing.id,
          {
            date: form.date || localDateStr(),
            staffName: form.staffName.trim(),
            staffPhone: form.staffPhone.trim(),
            kind: KIND_TO_STORAGE[form.kind],
            amount,
            note: form.note.trim(),
          },
          DEFAULT_USER_ID
        );
        adminToast(t('c.saved'));
      } else {
        await createStaffPaymentOffline({
          userId: DEFAULT_USER_ID,
          date: form.date || localDateStr(),
          staffName: form.staffName.trim(),
          staffPhone: form.staffPhone.trim(),
          kind: KIND_TO_STORAGE[form.kind],
          amount,
          note: form.note.trim(),
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
      await deleteStaffPaymentOffline(deleting.id, DEFAULT_USER_ID);
      adminToast(t('c.deleted'));
      setDeleting(null);
    } catch (err) {
      adminToast((err as Error)?.message || t('c.error'), 'err');
    } finally {
      setBusy(false);
    }
  };

  const printReport = () => {
    const { from, to } = rangeDates(range);
    const periodLabel =
      range === 'all'
        ? t('bills.allTime')
        : `${fmtDate(from || '')} → ${fmtDate(to || '')}`;
    void printGenericReport({
      title: t('staff.reportTitle'),
      periodLabel,
      lang,
      chips: [
        { k: t('staff.total'), v: fmtMoney(total) },
        { k: t('staff.count'), v: String(filtered.length) },
        { k: t('staff.staffCount'), v: String(staffCount) },
      ],
      tables: [
        {
          sectionTitle: t('staff.byStaff'),
          columns: [
            { label: '#', width: '34px' },
            { label: t('staff.name') },
            { label: t('staff.paidCount'), right: true },
            { label: t('staff.total'), right: true },
          ],
          rows: byStaff.map((s, i) => [String(i + 1), escHtml(s.name), String(s.count), fmtMoney(s.total)]),
        },
        {
          sectionTitle: t('staff.detailList'),
          columns: [
            { label: '#', width: '34px' },
            { label: t('exp.date') },
            { label: t('staff.name') },
            { label: t('staff.kind') },
            { label: t('staff.phone') },
            { label: t('exp.description') },
            { label: t('exp.amount'), right: true },
          ],
          rows: filtered.map((p, i) => [
            String(i + 1),
            fmtDate(p.date),
            escHtml(p.staffName),
            escHtml(t(kindFromStorage(p.kind))),
            escHtml(p.staffPhone || '—'),
            escHtml(p.note || '—'),
            fmtMoney(p.amount),
          ]),
          totalRow: [t('bills.grandTotal'), '', '', '', '', '', fmtMoney(total)],
        },
      ],
    });
  };

  return (
    <div>
      <PageHeader
        title={t('staff.title')}
        sub={t('staff.sub')}
        action={
          <>
            <Btn variant="outline" onClick={printReport} disabled={filtered.length === 0}>
              <Printer size={16} /> <span className="hidden sm:inline">{t('bills.print')}</span>
            </Btn>
            <Btn onClick={openAdd}>
              <Plus size={16} /> {t('staff.add')}
            </Btn>
          </>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <StatCard icon={<IndianRupee size={18} />} label={t('staff.total')} value={fmtMoney(total)} tone="red" />
        <StatCard icon={<UserCog size={18} />} label={t('staff.staffCount')} value={String(staffCount)} tone="slate" />
        <StatCard icon={<Users size={18} />} label={t('staff.paidCount')} value={String(filtered.length)} tone="amber" />
      </div>

      <AdminCard className="mb-4" bodyClass="!p-3">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="flex flex-wrap gap-1.5">
            {(['thisMonth', 'lastMonth', 'all'] as RangeKey[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                  range === r
                    ? 'bg-[var(--psa-soft-orange)] border-[#FA6E41] text-[#E8552C]'
                    : 'bg-[var(--psa-card)] border-[var(--psa-field-border)] text-[var(--psa-muted)] hover:border-[#FA6E41]/50'
                }`}
              >
                {t(r === 'thisMonth' ? 'staff.thisMonth' : r === 'lastMonth' ? 'staff.lastMonth' : 'staff.allTime')}
              </button>
            ))}
          </div>
          <div className="grow sm:max-w-xs">
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('staff.searchStaff')}
            />
          </div>
        </div>
      </AdminCard>

      <div className="grid lg:grid-cols-3 gap-4 items-start [&>*]:min-w-0">
        <AdminCard title={t('staff.list')} className="lg:col-span-2" bodyClass="!p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={<UserCog size={22} />} title={t('staff.none')} />
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[58vh] overflow-y-auto">
              <table className="w-full min-w-[620px]">
                <thead className="bg-[var(--psa-hover)] sticky top-0 z-10">
                  <tr>
                    <Th>{t('exp.date')}</Th>
                    <Th>{t('staff.name')}</Th>
                    <Th>{t('staff.kind')}</Th>
                    <Th>{t('staff.phone')}</Th>
                    <Th>{t('exp.description')}</Th>
                    <Th className="text-right">{t('exp.amount')}</Th>
                    <Th className="text-right">{t('c.edit')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id} className="hover:bg-[var(--psa-row-hover)] transition-colors">
                      <Td className="text-[var(--psa-muted)] whitespace-nowrap">{fmtDate(p.date)}</Td>
                      <Td className="font-semibold text-[var(--psa-sub)]">{p.staffName}</Td>
                      <Td>
                        <Badge tone={p.kind === 'salary' ? 'orange' : p.kind === 'advance' ? 'amber' : 'slate'}>
                          {t(kindFromStorage(p.kind))}
                        </Badge>
                      </Td>
                      <Td className="text-[var(--psa-muted)]">{p.staffPhone || '—'}</Td>
                      <Td className="text-[var(--psa-muted)] max-w-40 truncate">{p.note || '—'}</Td>
                      <Td className="text-right tabular-nums font-semibold text-[#DC2626]">− {fmtMoney(p.amount)}</Td>
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(p)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--psa-muted)] hover:bg-[var(--psa-hover2)]"
                            title={t('c.edit')}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => setDeleting(p)}
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

        <AdminCard title={t('staff.byStaff')}>
          {byStaff.length === 0 ? (
            <EmptyState icon={<Users size={22} />} title={t('staff.none')} />
          ) : (
            <div className="space-y-2.5 max-h-[58vh] overflow-y-auto pr-1">
              {byStaff.map((s) => (
                <div key={s.name} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--psa-field-border)] px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--psa-sub)] truncate">{s.name}</p>
                    <p className="text-[11px] text-[var(--psa-faint)]">
                      {s.count} {t('staff.payments')}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-[#DC2626] tabular-nums shrink-0">{fmtMoney(s.total)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2 border-t border-[var(--psa-line)] pt-2.5 px-1">
                <span className="text-xs font-bold text-[var(--psa-muted)]">{t('bills.grandTotal')}</span>
                <span className="text-sm font-black text-[#DC2626] tabular-nums">{fmtMoney(total)}</span>
              </div>
            </div>
          )}
        </AdminCard>
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? t('staff.edit') : t('staff.add')}
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
              <TextInput type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label={t('exp.amount')}>
              <TextInput
                type="number"
                min="0"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                autoFocus={!editing}
              />
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t('staff.name')}>
              <TextInput
                value={form.staffName}
                onChange={(e) => setForm({ ...form, staffName: e.target.value })}
                list="staff-name-suggestions"
                placeholder={t('staff.namePlaceholder')}
              />
              <datalist id="staff-name-suggestions">
                {allNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </Field>
            <Field label={t('staff.phone')}>
              <TextInput
                value={form.staffPhone}
                onChange={(e) => setForm({ ...form, staffPhone: e.target.value })}
                inputMode="tel"
                placeholder="98xxxxxxxx"
              />
            </Field>
          </div>
          <Field label={t('staff.kind')}>
            <div className="flex flex-wrap gap-1.5">
              {KIND_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setForm({ ...form, kind: k })}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    form.kind === k
                      ? 'bg-[var(--psa-soft-orange)] border-[#FA6E41] text-[#E8552C]'
                      : 'bg-[var(--psa-card)] border-[var(--psa-field-border)] text-[var(--psa-muted)] hover:border-[#FA6E41]/50'
                  }`}
                >
                  {KIND_LABELS[k][lang]}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t('exp.description')}>
            <TextInput
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder={t('staff.notePlaceholder')}
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
          {deleting?.staffName} — {fmtDate(deleting?.date)} · <b>{fmtMoney(deleting?.amount || 0)}</b>
        </p>
      </Modal>
    </div>
  );
}
