'use client';

/**
 * Admin Bills — sales register table with search, date filter,
 * bill detail dialog, mark-paid (full/partial) and delete.
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, Trash2, Eye, BadgeIndianRupee, ReceiptText, Printer } from 'lucide-react';
import {
  getBillsOffline,
  markBillPaidOffline,
  deleteBillOffline,
  localDateStr,
} from '@/lib/offline-service';
import { DEFAULT_USER_ID } from '@/lib/local-auth';
import { useAdminStore } from '@/store/adminStore';
import { ta, taf } from '@/lib/admin-i18n';
import { useAdminDataTick } from './useAdminData';
import { buildBillReceiptHtml, buildSoldProductsReportHtml, printHtml } from './print';
import {
  AdminCard,
  Badge,
  Btn,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  SelectInput,
  StatCard,
  Td,
  TextInput,
  Th,
  adminToast,
  fmtMoney,
  fmtDate,
} from './admin-ui';
import type { Bill } from '@/lib/types';

type DateFilter = '' | 'today' | '7' | '30' | 'custom';

function rangeForFilter(f: DateFilter, cf: string, ct: string): { from?: string; to?: string } {
  const today = localDateStr();
  if (f === 'today') return { from: today, to: today };
  if (f === '7') {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return { from: localDateStr(d), to: today };
  }
  if (f === '30') {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return { from: localDateStr(d), to: today };
  }
  if (f === 'custom') return cf <= ct ? { from: cf, to: ct } : { from: ct, to: cf };
  return {};
}

export default function AdminBills() {
  const lang = useAdminStore((s) => s.language);
  const t = (k: string) => ta(k, lang);
  const tf = (k: string, v: Record<string, string | number>) => taf(k, lang, v);
  const tick = useAdminDataTick();

  const [bills, setBills] = useState<Bill[]>([]);
  const [search, setSearch] = useState('');
  const [dueFilter, setDueFilter] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('');
  const [customFrom, setCustomFrom] = useState(localDateStr(new Date(Date.now() - 29 * 86400000)));
  const [customTo, setCustomTo] = useState(localDateStr());
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Bill | null>(null);
  const [payModal, setPayModal] = useState<{ bill: Bill; partial: boolean; amount: string } | null>(null);
  const [deleting, setDeleting] = useState<Bill | null>(null);

  const range = rangeForFilter(dateFilter, customFrom, customTo);

  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await getBillsOffline(DEFAULT_USER_ID, {
        search: search.trim() || undefined,
        from: range.from,
        to: range.to,
      });
      if (!alive) return;
      setBills(rows);
    })();
    return () => {
      alive = false;
    };
  }, [tick, search, range.from, range.to]);

  const shown = useMemo(
    () => (dueFilter === 'due' ? bills.filter((b) => (b.dueAmount || 0) > 0.009) : bills),
    [bills, dueFilter]
  );

  const totals = useMemo(() => {
    const sales = bills.reduce((s, b) => s + (b.total || 0), 0);
    const due = bills.reduce((s, b) => s + (b.dueAmount || 0), 0);
    return { sales, due, count: bills.length };
  }, [bills]);

  const methodBadge = (m: string) => {
    const map: Record<string, 'green' | 'orange' | 'amber' | 'red'> = {
      cash: 'green',
      upi: 'orange',
      card: 'amber',
      due: 'red',
    };
    const label = m === 'cash' ? t('c.cash') : m === 'upi' ? 'UPI' : m === 'card' ? t('c.card') : t('c.due');
    return <Badge tone={map[m] || 'slate'}>{label}</Badge>;
  };

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

  const doDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteBillOffline(deleting.id, DEFAULT_USER_ID);
      adminToast(t('c.deleted'));
      setDeleting(null);
    } catch (err) {
      adminToast((err as Error)?.message || t('c.error'), 'err');
    } finally {
      setBusy(false);
    }
  };

  /** Print / PDF — every sold product in the currently filtered register. */
  const printSold = () => {
    if (shown.length === 0) {
      adminToast(t('bills.noBillsPrint'), 'err');
      return;
    }
    printHtml(buildSoldProductsReportHtml(shown, { from: range.from, to: range.to, lang }));
  };

  return (
    <div>
      <PageHeader
        title={t('bills.title')}
        action={
          <Btn variant="outline" onClick={printSold}>
            <Printer size={16} /> {t('bills.print')}
          </Btn>
        }
      />

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard icon={<ReceiptText size={18} />} label={t('bills.billNo')} value={totals.count} tone="orange" />
        <StatCard icon={<BadgeIndianRupee size={18} />} label={t('rep.totalSales')} value={fmtMoney(totals.sales)} tone="green" />
        <StatCard icon={<BadgeIndianRupee size={18} />} label={t('bills.due')} value={fmtMoney(totals.due)} tone="red" />
      </div>

      <AdminCard bodyClass="!p-0">
        <div className="flex flex-col sm:flex-row gap-2 p-4 border-b border-[var(--psa-border)]">
          <div className="relative grow">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--psa-faint)]" />
            <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('bills.search')} className="!pl-9" />
          </div>
          <SelectInput value={dateFilter} onChange={(e) => setDateFilter(e.target.value as DateFilter)} className="sm:w-36">
            <option value="">{t('bills.allTime')}</option>
            <option value="today">{t('rep.today')}</option>
            <option value="7">{t('rep.week')}</option>
            <option value="30">{t('rep.month')}</option>
            <option value="custom">{t('rep.custom')}</option>
          </SelectInput>
          {dateFilter === 'custom' && (
            <>
              <TextInput type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="sm:w-36" />
              <TextInput type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="sm:w-36" />
            </>
          )}
          <SelectInput value={dueFilter} onChange={(e) => setDueFilter(e.target.value)} className="sm:w-44">
            <option value="">{t('bills.allTime')}</option>
            <option value="due">{t('bills.due')} — {t('c.all')}</option>
          </SelectInput>
        </div>

        {shown.length === 0 ? (
          <EmptyState icon={<ReceiptText size={22} />} title={t('bills.noBills')} />
        ) : (
          <div className="overflow-x-auto max-h-[62vh] overflow-y-auto">
            <table className="w-full min-w-[720px]">
              <thead className="bg-[var(--psa-hover)] sticky top-0 z-10">
                <tr>
                  <Th>{t('bills.billNo')}</Th>
                  <Th>{t('exp.date')}</Th>
                  <Th>{t('bills.customer')}</Th>
                  <Th className="text-right">{t('bills.total')}</Th>
                  <Th className="text-right">{t('bills.paid')}</Th>
                  <Th className="text-right">{t('bills.due')}</Th>
                  <Th>{t('bills.method')}</Th>
                  <Th className="text-right">{t('c.edit')}</Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => (
                  <tr key={b.id} className="hover:bg-[var(--psa-row-hover)] transition-colors">
                    <Td className="font-semibold">{b.billNumber || '—'}</Td>
                    <Td className="text-[var(--psa-muted)] whitespace-nowrap">{fmtDate(b.date)}</Td>
                    <Td>
                      <div className="font-medium truncate max-w-40">{b.customerName || t('due.walkIn')}</div>
                      {b.customerMobile && <div className="text-[11px] text-[var(--psa-faint)]">{b.customerMobile}</div>}
                    </Td>
                    <Td className="text-right tabular-nums font-semibold">{fmtMoney(b.total)}</Td>
                    <Td className="text-right tabular-nums text-[#16A34A]">{fmtMoney(b.paidAmount)}</Td>
                    <Td className="text-right tabular-nums">
                      {(b.dueAmount || 0) > 0.009 ? (
                        <span className="text-[#DC2626] font-semibold">{fmtMoney(b.dueAmount)}</span>
                      ) : (
                        <span className="text-[var(--psa-faint)]">—</span>
                      )}
                    </Td>
                    <Td>{methodBadge(b.paymentMethod)}</Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setDetail(b)}
                          title={t('bills.items')}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--psa-muted)] hover:bg-[var(--psa-hover2)]"
                        >
                          <Eye size={15} />
                        </button>
                        {(b.dueAmount || 0) > 0.009 && (
                          <button
                            onClick={() => setPayModal({ bill: b, partial: false, amount: '' })}
                            title={t('bills.markPaid')}
                            className="h-8 px-2.5 rounded-lg flex items-center gap-1 text-xs font-semibold text-[#16A34A] hover:bg-[var(--psa-soft-green)]"
                          >
                            <BadgeIndianRupee size={13} /> {t('bills.markPaid')}
                          </button>
                        )}
                        <button
                          onClick={() => setDeleting(b)}
                          title={t('c.delete')}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-[#DC2626] hover:bg-[var(--psa-soft-red)]"
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

      {/* bill detail */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={`${detail?.billNumber || ''} · ${detail?.customerName || t('due.walkIn')}`}
        wide
        footer={
          detail && (
            <>
              <Btn variant="outline" onClick={() => setDetail(null)}>
                {t('c.close')}
              </Btn>
              <Btn onClick={() => printHtml(buildBillReceiptHtml(detail, lang))}>
                <Printer size={15} /> {t('qsell.printReceipt')}
              </Btn>
            </>
          )
        }
      >
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-[11px] text-[var(--psa-faint)] font-semibold uppercase">{t('exp.date')}</p>
                <p className="font-medium">{fmtDate(detail.date)}</p>
              </div>
              <div>
                <p className="text-[11px] text-[var(--psa-faint)] font-semibold uppercase">{t('bills.method')}</p>
                <p className="font-medium">{methodBadge(detail.paymentMethod)}</p>
              </div>
              <div>
                <p className="text-[11px] text-[var(--psa-faint)] font-semibold uppercase">{t('bills.paid')}</p>
                <p className="font-medium text-[#16A34A] tabular-nums">{fmtMoney(detail.paidAmount)}</p>
              </div>
              <div>
                <p className="text-[11px] text-[var(--psa-faint)] font-semibold uppercase">{t('bills.due')}</p>
                <p className="font-medium text-[#DC2626] tabular-nums">{fmtMoney(detail.dueAmount)}</p>
              </div>
            </div>

            <div className="border border-[var(--psa-border)] rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[var(--psa-hover)]">
                  <tr>
                    <Th>{t('bills.items')}</Th>
                    <Th className="text-right">{t('prod.qty')}</Th>
                    <Th className="text-right">{t('prod.rate')}</Th>
                    <Th className="text-right">{t('bills.total')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((it, i) => (
                    <tr key={i}>
                      <Td>{it.name}</Td>
                      <Td className="text-right tabular-nums">{it.quantity}</Td>
                      <Td className="text-right tabular-nums">{fmtMoney(it.unitPrice)}</Td>
                      <Td className="text-right tabular-nums font-semibold">{fmtMoney(it.total)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="text-sm space-y-1.5">
              <div className="flex justify-between text-[var(--psa-muted)]">
                <span>{t('bills.subtotal')}</span>
                <span className="tabular-nums">{fmtMoney(detail.subtotal)}</span>
              </div>
              {(detail.discountAmount || 0) > 0 && (
                <div className="flex justify-between text-[var(--psa-muted)]">
                  <span>{t('bills.discount')}</span>
                  <span className="tabular-nums">− {fmtMoney(detail.discountAmount)}</span>
                </div>
              )}
              {(detail.gstAmount || 0) > 0 && (
                <div className="flex justify-between text-[var(--psa-muted)]">
                  <span>{t('bills.gst')} ({detail.gstRate}%)</span>
                  <span className="tabular-nums">+ {fmtMoney(detail.gstAmount)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base border-t border-[var(--psa-border)] pt-2">
                <span>{t('bills.total')}</span>
                <span className="tabular-nums text-[#E8552C]">{fmtMoney(detail.total)}</span>
              </div>
            </div>

            {detail.note && (
              <div className="bg-[var(--psa-hover)] rounded-lg p-3 text-xs text-[var(--psa-muted)]">
                <b>{t('bills.note')}:</b> {detail.note}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* mark paid */}
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
            <p className="text-sm text-[var(--psa-sub)]">
              {payModal.bill.billNumber} · {payModal.bill.customerName || t('due.walkIn')} —{' '}
              <b>{fmtMoney(payModal.bill.dueAmount)}</b>
            </p>
            {!payModal.partial ? (
              <p className="text-xs text-[var(--psa-muted)] bg-[var(--psa-soft-green)] rounded-lg p-3">
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
              <Btn
                size="sm"
                variant={payModal.partial ? 'outline' : 'green'}
                onClick={() => setPayModal({ ...payModal, partial: false })}
              >
                {t('c.all')}
              </Btn>
              <Btn
                size="sm"
                variant={payModal.partial ? 'green' : 'outline'}
                onClick={() => setPayModal({ ...payModal, partial: true, amount: '' })}
              >
                {t('bills.partial')}
              </Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* delete confirm */}
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('bills.confirmDelete')}
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
          <b>{deleting?.billNumber}</b> · {deleting?.customerName || t('due.walkIn')} — {fmtMoney(deleting?.total || 0)}
        </p>
      </Modal>
    </div>
  );
}
