'use client';

/**
 * Admin Due Book — customer-wise dues (same grouping rules as the app's screen):
 * summary cards, expandable customer groups, two-tap mark paid, WhatsApp reminder.
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Users, BadgeIndianRupee, ReceiptText, MessageCircle, CheckCircle2 } from 'lucide-react';
import { getBillsOffline, markBillPaidOffline } from '@/lib/offline-service';
import { DEFAULT_USER_ID } from '@/lib/local-auth';
import { useAdminStore } from '@/store/adminStore';
import { ta, taf } from '@/lib/admin-i18n';
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
  TextInput,
  adminToast,
  fmtMoney,
  fmtDate,
} from './admin-ui';
import type { Bill } from '@/lib/types';

interface DueGroup {
  key: string;
  name: string;
  mobile: string;
  bills: Bill[];
  totalDue: number;
}

export default function AdminDueBook() {
  const lang = useAdminStore((s) => s.language);
  const t = (k: string) => ta(k, lang);
  const tf = (k: string, v: Record<string, string | number>) => taf(k, lang, v);
  const tick = useAdminDataTick();

  const [bills, setBills] = useState<Bill[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [payModal, setPayModal] = useState<{ bill: Bill; partial: boolean; amount: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await getBillsOffline(DEFAULT_USER_ID);
      if (!alive) return;
      setBills(rows.filter((b) => (b.dueAmount || 0) > 0.009));
    })();
    return () => {
      alive = false;
    };
  }, [tick]);

  const groups = useMemo<DueGroup[]>(() => {
    const map = new Map<string, DueGroup>();
    for (const b of bills) {
      const mobile = (b.customerMobile || '').trim();
      const name = (b.customerName || '').trim();
      const key = mobile || name || 'walk-in';
      const g = map.get(key) || {
        key,
        name: name || (mobile ? mobile : t('due.walkIn')),
        mobile,
        bills: [],
        totalDue: 0,
      };
      g.bills.push(b);
      g.totalDue += b.dueAmount || 0;
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.totalDue - a.totalDue);
  }, [bills, t]);

  const totalDue = groups.reduce((s, g) => s + g.totalDue, 0);

  const doMarkPaid = async () => {
    if (!payModal) return;
    setBusy(true);
    try {
      const amount = payModal.partial ? Number(payModal.amount) : undefined;
      await markBillPaidOffline(payModal.bill.id, DEFAULT_USER_ID, amount);
      adminToast(t('bills.paidDone'));
      setPayModal(null);
    } catch (err) {
      adminToast((err as Error)?.message || t('c.error'), 'err');
    } finally {
      setBusy(false);
    }
  };

  const remind = (g: DueGroup) => {
    const phone = g.mobile.replace(/\D/g, '');
    if (!phone) {
      adminToast(t('due.walkIn'), 'info');
      return;
    }
    const msg = encodeURIComponent(
      `${ta('due.remindMsg', lang)}\n\n${g.name} — ${fmtMoney(g.totalDue)} (${g.bills.length} ${ta('bills.billNo', lang)})`
    );
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
  };

  return (
    <div>
      <PageHeader title={t('due.title')} />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <StatCard icon={<BadgeIndianRupee size={18} />} label={t('due.totalDue')} value={fmtMoney(totalDue)} tone="red" />
        <StatCard icon={<Users size={18} />} label={t('due.customers')} value={groups.length} tone="orange" />
        <StatCard icon={<ReceiptText size={18} />} label={t('bills.billNo')} value={bills.length} tone="amber" />
      </div>

      <AdminCard bodyClass="!p-0">
        {groups.length === 0 ? (
          <EmptyState icon={<CheckCircle2 size={22} />} title={t('due.noDue')} />
        ) : (
          <div className="divide-y divide-[#F1F3F5] max-h-[68vh] overflow-y-auto">
            {groups.map((g) => (
              <div key={g.key}>
                <button
                  onClick={() => setExpanded(expanded === g.key ? null : g.key)}
                  className="w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 hover:bg-[#FFFBF9] transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-full bg-[#FEF2F2] text-[#DC2626] flex items-center justify-center shrink-0 text-sm font-bold">
                      {g.name.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#1F2937] truncate">{g.name}</p>
                      <p className="text-[11px] text-[#9CA3AF]">
                        {g.bills.length} {t('due.billsCount')}{g.mobile ? ` · ${g.mobile}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-bold text-[#DC2626] tabular-nums">{fmtMoney(g.totalDue)}</span>
                    <ChevronDown
                      size={16}
                      className={`text-[#9CA3AF] transition-transform ${expanded === g.key ? 'rotate-180' : ''}`}
                    />
                  </div>
                </button>

                {expanded === g.key && (
                  <div className="px-4 sm:px-5 pb-4 space-y-2">
                    {g.bills.map((b) => (
                      <div key={b.id} className="flex items-center justify-between gap-3 bg-[#F9FAFB] rounded-lg px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[#1F2937]">
                            {b.billNumber || '—'} · {fmtDate(b.date)}
                          </p>
                          <p className="text-[11px] text-[#9CA3AF] tabular-nums">
                            {t('bills.total')} {fmtMoney(b.total)} · {t('bills.paid')} {fmtMoney(b.paidAmount)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge tone="red">{fmtMoney(b.dueAmount)}</Badge>
                          <Btn size="sm" variant="green" onClick={() => setPayModal({ bill: b, partial: false, amount: '' })}>
                            {t('bills.markPaid')}
                          </Btn>
                        </div>
                      </div>
                    ))}
                    {g.mobile && (
                      <Btn size="sm" variant="outline" onClick={() => remind(g)}>
                        <MessageCircle size={14} /> {t('due.remind')}
                      </Btn>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      <Modal
        open={!!payModal}
        onClose={() => setPayModal(null)}
        title={t('bills.markPaid')}
        footer={
          <>
            <Btn variant="outline" onClick={() => setPayModal(null)}>
              {t('c.cancel')}
            </Btn>
            <Btn variant="green" onClick={doMarkPaid} disabled={busy}>
              {t('c.confirm')}
            </Btn>
          </>
        }
      >
        {payModal && (
          <div className="space-y-3.5">
            <p className="text-sm text-[#374151]">
              {payModal.bill.billNumber} · {payModal.bill.customerName || t('due.walkIn')} — <b>{fmtMoney(payModal.bill.dueAmount)}</b>
            </p>
            {!payModal.partial ? (
              <p className="text-xs text-[#6B7280] bg-[#F0FDF4] rounded-lg p-3">
                {tf('bills.markPaidFull', { amount: fmtMoney(payModal.bill.dueAmount) })}
              </p>
            ) : (
              <Field label={tf('bills.markPaidPartial', { amount: fmtMoney(payModal.bill.dueAmount) })}>
                <TextInput
                  type="number"
                  min="0"
                  value={payModal.amount}
                  onChange={(e) => setPayModal({ ...payModal, amount: e.target.value })}
                  autoFocus
                />
              </Field>
            )}
            <div className="flex gap-2">
              <Btn size="sm" variant={payModal.partial ? 'outline' : 'green'} onClick={() => setPayModal({ ...payModal, partial: false })}>
                {t('c.all')}
              </Btn>
              <Btn size="sm" variant={payModal.partial ? 'green' : 'outline'} onClick={() => setPayModal({ ...payModal, partial: true, amount: '' })}>
                {t('bills.partial')}
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
