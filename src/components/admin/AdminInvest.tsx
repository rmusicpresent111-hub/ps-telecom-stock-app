'use client';

/**
 * Admin Others Invest (v2.20.0) — record cash invested into the business for
 * any other purpose (new stock, shop work, extra capital…). Every entry is
 * cash-IN and flows straight into the Cash Book.
 */

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, PiggyBank, CalendarDays, Sprout } from 'lucide-react';
import {
  getInvestmentsOffline,
  createInvestmentOffline,
  deleteInvestmentOffline,
} from '@/lib/offline-service';
import { DEFAULT_USER_ID } from '@/lib/local-auth';
import { useAdminStore } from '@/store/adminStore';
import { ta } from '@/lib/admin-i18n';
import { useAdminDataTick } from './useAdminData';
import { loadCached } from './adminCache';
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
import type { Investment } from '@/lib/types';
import { localDateStr } from '@/lib/offline-service';

type InvForm = { date: string; amount: string; purpose: string };

export default function AdminInvest() {
  const lang = useAdminStore((s) => s.language);
  const t = (k: string) => ta(k, lang);
  const tick = useAdminDataTick();

  const [items, setItems] = useState<Investment[]>([]);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<InvForm>({ date: localDateStr(), amount: '', purpose: '' });
  const [deleting, setDeleting] = useState<Investment | null>(null);

  useEffect(() => {
    let alive = true;
    void import('@/lib/offline-service').then((m) =>
      loadCached('admin:investments', () => m.getInvestmentsOffline(DEFAULT_USER_ID))
        .then((rows) => {
          if (alive) setItems(rows);
        })
        .catch(() => undefined)
    );
    return () => {
      alive = false;
    };
  }, [tick]);

  const monthTotal = useMemo(() => {
    const prefix = localDateStr().slice(0, 7);
    return items.filter((i) => i.date.startsWith(prefix)).reduce((s, i) => s + (i.amount || 0), 0);
  }, [items]);

  const openAdd = () => {
    setForm({ date: localDateStr(), amount: '', purpose: '' });
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
      await createInvestmentOffline({
        userId: DEFAULT_USER_ID,
        date: form.date || localDateStr(),
        amount,
        purpose: form.purpose.trim(),
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
      await deleteInvestmentOffline(deleting.id, DEFAULT_USER_ID);
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
        title={t('inv.title')}
        sub={t('inv.sub')}
        action={
          <Btn onClick={openAdd}>
            <Plus size={16} /> {t('inv.add')}
          </Btn>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <StatCard icon={<CalendarDays size={18} />} label={t('inv.thisMonth')} value={fmtMoney(monthTotal)} tone="orange" />
        <StatCard icon={<PiggyBank size={18} />} label={t('inv.total')} value={fmtMoney(items.reduce((s, i) => s + (i.amount || 0), 0))} tone="green" />
        <StatCard icon={<Sprout size={18} />} label={t('dash.items')} value={items.length} tone="slate" />
      </div>

      <AdminCard bodyClass="!p-0">
        {items.length === 0 ? (
          <EmptyState icon={<PiggyBank size={22} />} title={t('inv.noInvest')} body={t('inv.sub')} />
        ) : (
          <div className="overflow-x-auto max-h-[62vh] overflow-y-auto">
            <table className="w-full min-w-[480px]">
              <thead className="bg-[var(--psa-hover)] sticky top-0 z-10">
                <tr>
                  <Th>{t('exp.date')}</Th>
                  <Th>{t('inv.purpose')}</Th>
                  <Th className="text-right">{t('exp.amount')}</Th>
                  <Th className="text-right">{t('c.edit')}</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="hover:bg-[var(--psa-row-hover)] transition-colors">
                    <Td className="text-[var(--psa-muted)] whitespace-nowrap">{fmtDate(i.date)}</Td>
                    <Td>
                      <Badge tone="orange">{i.purpose || '—'}</Badge>
                    </Td>
                    <Td className="text-right tabular-nums font-semibold text-[#16A34A]">+ {fmtMoney(i.amount)}</Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setDeleting(i)}
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
        title={t('inv.add')}
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
          <Field label={t('inv.purpose')}>
            <TextInput
              value={form.purpose}
              onChange={(ev) => setForm({ ...form, purpose: ev.target.value })}
              placeholder={t('inv.purposePh')}
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
          {t('inv.confirmDelete')} — <b>{fmtMoney(deleting?.amount || 0)}</b>
        </p>
      </Modal>
    </div>
  );
}
