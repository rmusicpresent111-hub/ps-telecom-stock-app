'use client';

/**
 * Admin Expenses — Vyapar-style expense register with add/edit/delete.
 */

import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Wallet, CalendarDays, ReceiptText } from 'lucide-react';
import {
  getExpensesOffline,
  createExpenseOffline,
  updateExpenseOffline,
  deleteExpenseOffline,
} from '@/lib/offline-service';
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
import type { Expense } from '@/lib/types';
import { localDateStr } from '@/lib/offline-service';

type ExpForm = { date: string; amount: string; category: string; description: string };

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

      <AdminCard bodyClass="!p-0">
        {expenses.length === 0 ? (
          <EmptyState icon={<Wallet size={22} />} title={t('exp.noExpenses')} />
        ) : (
          <div className="overflow-x-auto max-h-[62vh] overflow-y-auto">
            <table className="w-full min-w-[560px]">
              <thead className="bg-[#FAFAFB] sticky top-0 z-10">
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
                  <tr key={e.id} className="hover:bg-[#FFFBF9] transition-colors">
                    <Td className="text-[#6B7280] whitespace-nowrap">{fmtDate(e.date)}</Td>
                    <Td>
                      <Badge tone="orange">{e.category || '—'}</Badge>
                    </Td>
                    <Td className="text-[#374151] max-w-60 truncate">{e.description || '—'}</Td>
                    <Td className="text-right tabular-nums font-semibold text-[#DC2626]">− {fmtMoney(e.amount)}</Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(e)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6B7280] hover:bg-[#F3F4F6]"
                          title={t('c.edit')}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setDeleting(e)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-[#DC2626] hover:bg-[#FEF2F2]"
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
                      ? 'bg-[#FFF1EB] border-[#FA6E41] text-[#E8552C]'
                      : 'bg-white border-[#E1E4E8] text-[#6B7280] hover:border-[#FA6E41]/50'
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
        <p className="text-sm text-[#374151]">
          {fmtDate(deleting?.date)} — <b>{fmtMoney(deleting?.amount || 0)}</b>
        </p>
      </Modal>
    </div>
  );
}
