'use client';

/**
 * Admin Due Entry (বাকি এন্ট্রি) — custom customer credit ledger, v2.23.0.
 *
 * Standalone due records (independent from bill-based dues) with:
 *  • CUSTOMER photo + PRODUCT photo (auto-compressed data URLs, synced encrypted)
 *  • product name, amount, note, entry date
 *  • optional PAYMENT SCHEDULE (কিস্তি) — manual rows or an auto monthly split
 *  • collections: full / partial / per-installment, via recordDueEntryPaymentOffline
 *
 * Data rides the generic `dueEntries` D1 store — create/edit/delete/pay here
 * sync to the app's Due Book (বাকির খাতা → বাকি এন্ট্রি tab) on every device.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  WalletCards, Plus, Pencil, Trash2, ImageUp, Upload, Loader2, HandCoins,
  Check, ChevronDown, Users, BadgeIndianRupee, MessageCircle, Search,
  CalendarClock, Package, CircleAlert,
} from 'lucide-react';
import {
  getDueEntriesOffline,
  createDueEntryOffline,
  updateDueEntryOffline,
  deleteDueEntryOffline,
  recordDueEntryPaymentOffline,
  dueEntryOutstanding,
  localDateStr,
} from '@/lib/offline-service';
import { fileToResizedDataUrl } from '@/lib/image-utils';
import { DEFAULT_USER_ID } from '@/lib/local-auth';
import { useAdminStore } from '@/store/adminStore';
import { ta, taf } from '@/lib/admin-i18n';
import { useAdminDataTick } from './useAdminData';
import {
  AdminCard, Badge, Btn, EmptyState, Field, Modal, PageHeader, SelectInput,
  StatCard, TextArea, TextInput, adminToast, fmtMoney, fmtDate,
} from './admin-ui';
import type { DueEntry, DueScheduleItem } from '@/lib/types';

// ── helpers ─────────────────────────────────────────────────────

const EPS = 0.009;

type EntryStatus = 'paid' | 'partial' | 'pending';

function entryStatus(e: DueEntry): EntryStatus {
  if (dueEntryOutstanding(e) <= EPS) return 'paid';
  if ((Number(e.paidAmount) || 0) > EPS) return 'partial';
  return 'pending';
}

function nextDueItem(e: DueEntry): DueScheduleItem | null {
  const unpaid = (e.schedule || []).filter(it => it.amount - (it.paidAmount || 0) > EPS);
  if (unpaid.length === 0) return null;
  return unpaid.reduce((a, b) => ((a.dueDate || '9999') <= (b.dueDate || '9999') ? a : b));
}

function isItemOverdue(it: DueScheduleItem): boolean {
  return !!it.dueDate && it.dueDate < localDateStr() && it.amount - (it.paidAmount || 0) > EPS;
}

/** Same-day-of-month addMonths that never overflows (Jan 31 → Feb 28). */
function addMonthsSafe(d: Date, months: number): Date {
  const y = d.getFullYear();
  const mo = d.getMonth() + months;
  const day = Math.min(d.getDate(), new Date(y, mo + 1, 0).getDate());
  return new Date(y, mo, day);
}

// ── photo upload slot (MODULE level — stable identity, see AdminBillSettings) ──

function PhotoSlot({
  label, value, busy, t, which, onFile, onRemove,
}: {
  label: string;
  value: string;
  busy: boolean;
  t: (k: string) => string;
  which: 'customer' | 'product';
  onFile: (which: 'customer' | 'product', e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (which: 'customer' | 'product') => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-xs font-semibold text-[var(--psa-sub)]">{label}</span>
      </div>
      <div className="flex items-start gap-3">
        <div className="w-20 h-20 shrink-0 rounded-xl border border-[var(--psa-field-border)] bg-[var(--psa-hover)] flex items-center justify-center overflow-hidden relative">
          {value ? (
             
            <img src={value} alt={label} className="w-full h-full object-cover" />
          ) : which === 'customer' ? (
            <Users size={22} className="text-[var(--psa-faint)]" />
          ) : (
            <Package size={22} className="text-[var(--psa-faint)]" />
          )}
          {busy && (
            <span className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <Loader2 size={18} className="animate-spin text-white" />
            </span>
          )}
        </div>
        <div className="min-w-0 grow">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold cursor-pointer bg-[var(--psa-soft-orange)] text-[#E8552C] hover:bg-[var(--psa-soft-orange-h)] transition-colors"
            >
              <Upload size={13} /> {value ? t('bset.change') : t('bset.upload')}
            </button>
            {value && (
              <Btn size="sm" variant="outline" onClick={() => onRemove(which)}>
                <Trash2 size={13} /> {t('bset.remove')}
              </Btn>
            )}
          </div>
          <p className="text-[11px] text-[var(--psa-faint)] mt-1.5 leading-snug">{t('dentry.photoHint')}</p>
        </div>
      </div>
      {/* Visually hidden but NOT display:none — some browsers refuse the file
          dialog for display:none inputs (keeps working through the 20s tick). */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={(e) => onFile(which, e)}
        style={{
          position: 'absolute', width: 1, height: 1, opacity: 0,
          overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
        }}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}

// ── form state ──────────────────────────────────────────────────

interface ScheduleRow { key: string; id?: string; dueDate: string; amount: string }

interface FormState {
  customerName: string;
  customerMobile: string;
  customerPhoto: string;
  productName: string;
  productPhoto: string;
  amount: string;
  date: string;
  note: string;
  schedule: ScheduleRow[];
}

function emptyForm(): FormState {
  return {
    customerName: '', customerMobile: '', customerPhoto: '',
    productName: '', productPhoto: '', amount: '',
    date: localDateStr(), note: '', schedule: [],
  };
}

type StatusFilter = 'all' | 'pending' | 'partial' | 'paid';

export default function AdminDueEntry() {
  const lang = useAdminStore((s) => s.language);
  const t = (k: string) => ta(k, lang);
  const tick = useAdminDataTick();

  const [entries, setEntries] = useState<DueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DueEntry | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [splitCount, setSplitCount] = useState('');
  const [photoBusy, setPhotoBusy] = useState<'customer' | 'product' | null>(null);
  const [busy, setBusy] = useState(false);

  const [detail, setDetail] = useState<DueEntry | null>(null);
  const [deleting, setDeleting] = useState<DueEntry | null>(null);
  const [payModal, setPayModal] = useState<{ entry: DueEntry; partial: boolean; amount: string } | null>(null);
  const [payingItem, setPayingItem] = useState<string | null>(null);

  // guards against the 20s tick clobbering an in-flight photo upload
  const uploadingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await getDueEntriesOffline(DEFAULT_USER_ID);
      if (!alive) return;
      setEntries(rows);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [tick]);

  // keep open overlays in sync with the freshest row after each tick
  useEffect(() => {
    if (detail) setDetail(entries.find(e => e.id === detail.id) ?? detail);
     
  }, [entries]);

  const stats = useMemo(() => {
    let outstanding = 0;
    let collected = 0;
    let overdue = 0;
    const today = localDateStr();
    for (const e of entries) {
      outstanding += dueEntryOutstanding(e);
      collected += Number(e.paidAmount) || 0;
      if (dueEntryOutstanding(e) > EPS) {
        for (const it of e.schedule || []) {
          if (it.dueDate && it.dueDate < today && it.amount - (it.paidAmount || 0) > EPS) overdue++;
        }
      }
    }
    return {
      outstanding: Math.round(outstanding * 100) / 100,
      collected: Math.round(collected * 100) / 100,
      overdue,
    };
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(e => {
      if (statusFilter !== 'all' && entryStatus(e) !== statusFilter) return false;
      if (!q) return true;
      return (
        e.customerName.toLowerCase().includes(q) ||
        (e.customerMobile || '').includes(q) ||
        e.productName.toLowerCase().includes(q)
      );
    });
  }, [entries, query, statusFilter]);

  // ── form handlers ─────────────────────────────────────────────

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm());
    setSplitCount('');
    setFormOpen(true);
  };

  const openEdit = (e: DueEntry) => {
    setEditing(e);
    setForm({
      customerName: e.customerName,
      customerMobile: e.customerMobile || '',
      customerPhoto: e.customerPhotoDataUrl || '',
      productName: e.productName,
      productPhoto: e.productPhotoDataUrl || '',
      amount: String(e.amount || ''),
      date: e.date || localDateStr(),
      note: e.note || '',
      schedule: (e.schedule || []).map(it => ({
        key: it.id, id: it.id, dueDate: it.dueDate, amount: String(it.amount || ''),
      })),
    });
    setSplitCount('');
    setFormOpen(true);
  };

  const handlePhotoFile = async (which: 'customer' | 'product', e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file || uploadingRef.current) return;
    uploadingRef.current = true;
    setPhotoBusy(which);
    try {
      // Budgets keep the whole row well under the 200 KB encrypted-sync cap.
      const url = which === 'customer'
        ? await fileToResizedDataUrl(file, 512, 60 * 1024)
        : await fileToResizedDataUrl(file, 640, 80 * 1024);
      setForm(p => (p ? { ...p, [which === 'customer' ? 'customerPhoto' : 'productPhoto']: url } : p));
    } catch (err) {
      adminToast((err as Error)?.message || t('c.error'), 'err');
    } finally {
      uploadingRef.current = false;
      setPhotoBusy(null);
    }
  };

  const removePhoto = (which: 'customer' | 'product') => {
    setForm(p => (p ? { ...p, [which === 'customer' ? 'customerPhoto' : 'productPhoto']: '' } : p));
  };

  const applyAutoSplit = () => {
    // splitCount = MONTHLY AMOUNT (₹) — the label says মাসিক কিস্তি; the number
    // of installments is derived from it (total ÷ monthly). v2.23.1 bugfix:
    // the old code read the input as a raw row count, so typing the amount
    // 1000 against a ₹3000 due generated 1000 kisti rows.
    const per = Math.round((Number(splitCount) || 0) * 100) / 100;
    const total = Math.round((Number(form.amount) || 0) * 100) / 100;
    if (per <= 0 || total <= 0) {
      adminToast(t('dentry.scheduleHint'), 'info');
      return;
    }
    const n = Math.ceil((total - 0.005) / per);
    if (n > 60) {
      adminToast(taf('dentry.kistiCap', lang, { max: 60 }), 'err');
      return;
    }
    // even out rounding: all rows = monthly amount except the last one,
    // which absorbs the remainder so Σ rows == total exactly.
    const rowAmt = Math.min(per, Math.floor((total / n) * 100) / 100);
    const start = form.date ? new Date(form.date + 'T00:00:00') : new Date();
    const rows: ScheduleRow[] = [];
    let assigned = 0;
    for (let i = 0; i < n; i++) {
      const isLast = i === n - 1;
      const amt = isLast ? Math.round((total - assigned) * 100) / 100 : rowAmt;
      assigned = Math.round((assigned + amt) * 100) / 100;
      rows.push({
        key: `sp-${Date.now().toString(36)}-${i}`,
        dueDate: localDateStr(addMonthsSafe(start, i + 1)),
        amount: String(amt),
      });
    }
    setForm(p => (p ? { ...p, schedule: rows } : p));
  };

  const scheduleTotal = useMemo(
    () => Math.round(form.schedule.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100,
    [form.schedule]
  );
  const formAmount = Math.round((Number(form.amount) || 0) * 100) / 100;
  const scheduleDiff = Math.round((formAmount - scheduleTotal) * 100) / 100;

  const saveForm = async () => {
    if (!form.customerName.trim()) { adminToast(t('c.required'), 'err'); return; }
    if (!form.productName.trim()) { adminToast(t('c.required'), 'err'); return; }
    if (!(formAmount > 0)) { adminToast(t('c.required'), 'err'); return; }
    for (const r of form.schedule) {
      if (!(Number(r.amount) > 0) || !r.dueDate) { adminToast(t('c.required'), 'err'); return; }
    }
    if (scheduleDiff < 0) { adminToast(taf('dentry.overAssigned', lang, { amount: fmtMoney(Math.abs(scheduleDiff)) }), 'err'); return; }

    setBusy(true);
    try {
      const schedule = form.schedule.map(r => ({
        ...(r.id ? { id: r.id } : {}),
        dueDate: r.dueDate,
        amount: Number(r.amount),
      }));
      if (editing) {
        await updateDueEntryOffline(editing.id, {
          customerName: form.customerName,
          customerMobile: form.customerMobile,
          customerPhotoDataUrl: form.customerPhoto,
          productName: form.productName,
          productPhotoDataUrl: form.productPhoto,
          amount: formAmount,
          date: form.date,
          note: form.note,
          schedule,
        }, DEFAULT_USER_ID);
        adminToast(t('c.saved'));
      } else {
        await createDueEntryOffline({
          userId: DEFAULT_USER_ID,
          customerName: form.customerName,
          customerMobile: form.customerMobile,
          customerPhotoDataUrl: form.customerPhoto,
          productName: form.productName,
          productPhotoDataUrl: form.productPhoto,
          amount: formAmount,
          schedule,
          note: form.note,
          date: form.date,
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

  // ── payment / delete ─────────────────────────────────────────

  const doPay = async () => {
    if (!payModal) return;
    setBusy(true);
    try {
      if (payModal.partial) {
        const amt = Number(payModal.amount);
        if (!(amt > 0)) { adminToast(t('c.required'), 'err'); setBusy(false); return; }
        await recordDueEntryPaymentOffline(payModal.entry.id, DEFAULT_USER_ID, amt);
      } else {
        await recordDueEntryPaymentOffline(payModal.entry.id, DEFAULT_USER_ID);
      }
      adminToast(t('bills.paidDone'));
      setPayModal(null);
    } catch (err) {
      adminToast((err as Error)?.message || t('c.error'), 'err');
    } finally {
      setBusy(false);
    }
  };

  const payInstallment = async (entryId: string, itemId: string) => {
    setPayingItem(itemId);
    try {
      await recordDueEntryPaymentOffline(entryId, DEFAULT_USER_ID, undefined, { scheduleItemId: itemId });
      adminToast(t('dentry.installmentPaid'));
    } catch (err) {
      adminToast((err as Error)?.message || t('c.error'), 'err');
    } finally {
      setPayingItem(null);
    }
  };

  const doDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteDueEntryOffline(deleting.id, DEFAULT_USER_ID);
      adminToast(t('c.deleted'));
      setDeleting(null);
      setDetail(null);
    } catch (err) {
      adminToast((err as Error)?.message || t('c.error'), 'err');
    } finally {
      setBusy(false);
    }
  };

  const remind = (e: DueEntry) => {
    const phone = (e.customerMobile || '').replace(/\D/g, '');
    if (!phone) { adminToast(t('due.walkIn'), 'info'); return; }
    const msg = encodeURIComponent(
      `${ta('due.remindMsg', lang)}\n\n${e.customerName} — ${fmtMoney(dueEntryOutstanding(e))} (${e.productName})`
    );
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
  };

  const statusBadge = (e: DueEntry) => {
    const s = entryStatus(e);
    return s === 'paid'
      ? <Badge tone="green">{t('dentry.statusPaid')}</Badge>
      : s === 'partial'
        ? <Badge tone="amber">{t('dentry.statusPartial')}</Badge>
        : <Badge tone="red">{t('dentry.statusPending')}</Badge>;
  };

  // ── render ────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        title={t('nav.dueEntry')}
        sub={t('dentry.subtitle')}
        action={
          <Btn onClick={openAdd}>
            <Plus size={16} /> {t('dentry.add')}
          </Btn>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatCard icon={<BadgeIndianRupee size={18} />} label={t('dentry.outstanding')} value={fmtMoney(stats.outstanding)} tone="red" />
        <StatCard icon={<HandCoins size={18} />} label={t('dentry.collected')} value={fmtMoney(stats.collected)} tone="green" />
        <StatCard icon={<WalletCards size={18} />} label={t('dentry.entries')} value={entries.length} tone="orange" />
        <StatCard icon={<CalendarClock size={18} />} label={t('dentry.overdue')} value={stats.overdue} tone={stats.overdue > 0 ? 'amber' : 'slate'} />
      </div>

      <AdminCard bodyClass="!p-0">
        <div className="flex flex-col sm:flex-row gap-2 p-4 sm:p-5 pb-3">
          <div className="relative grow">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--psa-faint)]" />
            <TextInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('c.search')}
              className="!pl-9"
              aria-label={t('c.search')}
            />
          </div>
          <SelectInput
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="sm:w-44"
            aria-label="Filter"
          >
            <option value="all">{t('dentry.filterAll')}</option>
            <option value="pending">{t('dentry.filterPending')}</option>
            <option value="partial">{t('dentry.statusPartial')}</option>
            <option value="paid">{t('dentry.filterPaid')}</option>
          </SelectInput>
        </div>

        {loading ? (
          <div className="p-10 text-center"><span className="inline-block w-6 h-6 rounded-full border-2 border-[#FA6E41]/25 border-t-[#FA6E41] animate-spin" role="status" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<WalletCards size={22} />}
            title={entries.length === 0 ? t('dentry.noEntries') : t('c.noData')}
            body={entries.length === 0 ? t('dentry.noEntriesDesc') : undefined}
          />
        ) : (
          <div className="divide-y divide-[var(--psa-line)] max-h-[62vh] overflow-y-auto">
            {filtered.map((e) => {
              const outstanding = dueEntryOutstanding(e);
              const pct = e.amount > 0 ? Math.min(100, Math.round(((e.paidAmount || 0) / e.amount) * 100)) : 0;
              const next = nextDueItem(e);
              return (
                <div key={e.id} className="flex items-center gap-3 px-4 sm:px-5 py-3.5 hover:bg-[var(--psa-row-hover)] transition-colors">
                  <button
                    onClick={() => setDetail(e)}
                    className="flex items-center gap-3 min-w-0 grow text-left"
                    aria-label={t('dentry.details')}
                  >
                    <span className="w-11 h-11 rounded-xl overflow-hidden shrink-0 bg-[var(--psa-soft-orange)] flex items-center justify-center">
                      {e.customerPhotoDataUrl ? (
                         
                        <img src={e.customerPhotoDataUrl} alt={e.customerName} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-sm font-bold text-[#E8552C]">{e.customerName.charAt(0).toUpperCase()}</span>
                      )}
                    </span>
                    <span className="min-w-0 grow">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--psa-ink)] truncate">{e.customerName}</span>
                        {statusBadge(e)}
                      </span>
                      <span className="block text-[11px] text-[var(--psa-faint)] truncate">
                        {e.productName}{e.customerMobile ? ` · ${e.customerMobile}` : ''} · {fmtDate(e.date)}
                      </span>
                      <span className="flex items-center gap-2 mt-1">
                        <span className="h-1.5 w-24 sm:w-32 rounded-full bg-[var(--psa-hover)] overflow-hidden">
                          <span className="block h-full rounded-full bg-[#16A34A]" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="text-[10px] text-[var(--psa-faint)] tabular-nums">{pct}%</span>
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-bold text-[#DC2626] tabular-nums">{fmtMoney(outstanding)}</p>
                      <p className="text-[10px] text-[var(--psa-faint)] tabular-nums">
                        {next ? `${t('dentry.nextDue')}: ${fmtDate(next.dueDate)}` : t('dentry.noSchedule')}
                      </p>
                    </div>
                    {outstanding > EPS && (
                      <Btn size="sm" variant="green" onClick={() => setPayModal({ entry: e, partial: false, amount: '' })}>
                        <HandCoins size={14} /> {t('dentry.recordPayment')}
                      </Btn>
                    )}
                    <Btn size="sm" variant="ghost" onClick={() => openEdit(e)} aria-label={t('c.edit')}>
                      <Pencil size={15} />
                    </Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setDeleting(e)} aria-label={t('c.delete')} className="hover:!text-[#DC2626]">
                      <Trash2 size={15} />
                    </Btn>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </AdminCard>

      {/* ── add / edit form ── */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? t('dentry.edit') : t('dentry.add')}
        wide
        footer={
          <>
            <Btn variant="outline" onClick={() => setFormOpen(false)}>{t('c.cancel')}</Btn>
            <Btn onClick={saveForm} disabled={busy}>{busy ? t('c.loading') : t('c.save')}</Btn>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3.5">
            <Field label={t('dentry.customer')}>
              <TextInput value={form.customerName} onChange={(e) => setForm(p => p && { ...p, customerName: e.target.value })} placeholder={t('dentry.customer')} />
            </Field>
            <Field label={t('dentry.mobile')}>
              <TextInput value={form.customerMobile} onChange={(e) => setForm(p => p && { ...p, customerMobile: e.target.value })} inputMode="tel" placeholder="9xxxxxxxxx" />
            </Field>
          </div>

          <div className="grid sm:grid-cols-2 gap-3.5">
            <PhotoSlot which="customer" label={t('dentry.customerPhoto')} value={form.customerPhoto} busy={photoBusy === 'customer'} t={t} onFile={handlePhotoFile} onRemove={removePhoto} />
            <PhotoSlot which="product" label={t('dentry.productPhoto')} value={form.productPhoto} busy={photoBusy === 'product'} t={t} onFile={handlePhotoFile} onRemove={removePhoto} />
          </div>

          <div className="grid sm:grid-cols-2 gap-3.5">
            <Field label={t('dentry.product')}>
              <TextInput value={form.productName} onChange={(e) => setForm(p => p && { ...p, productName: e.target.value })} placeholder={t('dentry.product')} />
            </Field>
            <Field label={t('dentry.amount')}>
              <TextInput type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm(p => p && { ...p, amount: e.target.value })} inputMode="decimal" />
            </Field>
          </div>

          <Field label={t('dentry.date')}>
            <TextInput type="date" value={form.date} onChange={(e) => setForm(p => p && { ...p, date: e.target.value })} />
          </Field>

          {/* payment schedule */}
          <div className="rounded-xl border border-[var(--psa-border)] p-3.5">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-xs font-semibold text-[var(--psa-sub)]">{t('dentry.schedule')}</span>
              <span className={`text-[11px] font-semibold tabular-nums ${scheduleDiff < 0 ? 'text-[#DC2626]' : 'text-[var(--psa-muted)]'}`}>
                {scheduleDiff > 0.009
                  ? taf('dentry.unassigned', lang, { amount: fmtMoney(scheduleDiff) })
                  : scheduleDiff < -0.009
                    ? taf('dentry.overAssigned', lang, { amount: fmtMoney(Math.abs(scheduleDiff)) })
                    : ''}
              </span>
            </div>
            <p className="text-[11px] text-[var(--psa-faint)] mb-3">{t('dentry.scheduleHint')}</p>

            <div className="space-y-2">
              {form.schedule.map((r, ix) => (
                <div key={r.key} className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-[var(--psa-faint)] w-8 shrink-0">#{ix + 1}</span>
                  <TextInput
                    type="date"
                    value={r.dueDate}
                    onChange={(e) => setForm(p => p && { ...p, schedule: p.schedule.map(x => x.key === r.key ? { ...x, dueDate: e.target.value } : x) })}
                    className="!h-9 text-xs"
                    aria-label={`${t('dentry.dueOn')} ${ix + 1}`}
                  />
                  <TextInput
                    type="number"
                    min="0"
                    step="0.01"
                    value={r.amount}
                    onChange={(e) => setForm(p => p && { ...p, schedule: p.schedule.map(x => x.key === r.key ? { ...x, amount: e.target.value } : x) })}
                    className="!h-9 text-xs"
                    inputMode="decimal"
                    aria-label={`${t('dentry.kisti')} ${ix + 1}`}
                  />
                  <button
                    type="button"
                    onClick={() => setForm(p => p && { ...p, schedule: p.schedule.filter(x => x.key !== r.key) })}
                    className="w-8 h-9 shrink-0 rounded-lg flex items-center justify-center text-[var(--psa-muted)] hover:bg-[var(--psa-soft-red)] hover:text-[#DC2626] transition-colors"
                    aria-label={t('c.delete')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <Btn size="sm" variant="soft" onClick={() => setForm(p => p && {
                ...p,
                schedule: [...p.schedule, { key: `s-${Date.now().toString(36)}`, dueDate: localDateStr(addMonthsSafe(new Date(), p.schedule.length + 1)), amount: '' }],
              })}>
                <Plus size={14} /> {t('dentry.addInstallment')}
              </Btn>
              <span className="flex items-center gap-1.5">
                <TextInput
                  type="number"
                  min="1"
                  value={splitCount}
                  onChange={(e) => setSplitCount(e.target.value)}
                  className="!h-8 !w-20 text-xs"
                  placeholder="1000"
                  aria-label={t('dentry.autoSplit')}
                />
                <Btn size="sm" variant="outline" onClick={applyAutoSplit}>{t('dentry.autoSplitBtn')}</Btn>
                <span className="text-[11px] text-[var(--psa-faint)]">{t('dentry.autoSplit')}</span>
              </span>
            </div>
          </div>

          <Field label={t('dentry.note')}>
            <TextArea value={form.note} onChange={(e) => setForm(p => p && { ...p, note: e.target.value })} rows={2} />
          </Field>
        </div>
      </Modal>

      {/* ── record payment ── */}
      <Modal
        open={!!payModal}
        onClose={() => setPayModal(null)}
        title={t('dentry.recordPayment')}
        footer={
          <>
            <Btn variant="outline" onClick={() => setPayModal(null)}>{t('c.cancel')}</Btn>
            <Btn variant="green" onClick={doPay} disabled={busy}>{t('c.confirm')}</Btn>
          </>
        }
      >
        {payModal && (
          <div className="space-y-3.5">
            <p className="text-sm text-[var(--psa-sub)]">
              {payModal.entry.customerName} · {payModal.entry.productName} —{' '}
              <b className="text-[#DC2626]">{fmtMoney(dueEntryOutstanding(payModal.entry))}</b>
            </p>
            {!payModal.partial ? (
              <p className="text-xs text-[var(--psa-muted)] bg-[var(--psa-soft-green)] rounded-lg p-3">
                {taf('bills.markPaidFull', lang, { amount: fmtMoney(dueEntryOutstanding(payModal.entry)) })}
              </p>
            ) : (
              <Field label={taf('bills.markPaidPartial', lang, { amount: fmtMoney(dueEntryOutstanding(payModal.entry)) })}>
                <TextInput
                  type="number"
                  min="0"
                  value={payModal.amount}
                  onChange={(e) => setPayModal({ ...payModal, amount: e.target.value })}
                  inputMode="decimal"
                  autoFocus
                />
              </Field>
            )}
            <div className="flex gap-2">
              <Btn size="sm" variant={payModal.partial ? 'outline' : 'green'} onClick={() => setPayModal({ ...payModal, partial: false })}>
                {t('c.all')}
              </Btn>
              <Btn size="sm" variant={payModal.partial ? 'green' : 'outline'} onClick={() => setPayModal({ ...payModal, partial: true, amount: '' })}>
                {ta('bills.partial', lang)}
              </Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* ── details ── */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={t('dentry.details')}
        footer={
          detail && (
            <>
              {detail.customerMobile && (
                <Btn variant="outline" onClick={() => remind(detail)}>
                  <MessageCircle size={15} /> {t('due.remind')}
                </Btn>
              )}
              <Btn variant="outline" onClick={() => { setDetail(null); openEdit(detail); }}>
                <Pencil size={15} /> {t('c.edit')}
              </Btn>
              <Btn variant="danger" onClick={() => setDeleting(detail)}>
                <Trash2 size={15} /> {t('c.delete')}
              </Btn>
            </>
          )
        }
      >
        {detail && (() => {
          const outstanding = dueEntryOutstanding(detail);
          const pct = detail.amount > 0 ? Math.min(100, Math.round(((detail.paidAmount || 0) / detail.amount) * 100)) : 0;
          return (
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="w-24 h-24 rounded-xl overflow-hidden bg-[var(--psa-hover)] flex items-center justify-center shrink-0">
                  {detail.customerPhotoDataUrl ? (
                     
                    <img src={detail.customerPhotoDataUrl} alt={detail.customerName} className="w-full h-full object-cover" />
                  ) : (
                    <Users size={26} className="text-[var(--psa-faint)]" />
                  )}
                </div>
                <div className="w-24 h-24 rounded-xl overflow-hidden bg-[var(--psa-hover)] flex items-center justify-center shrink-0">
                  {detail.productPhotoDataUrl ? (
                     
                    <img src={detail.productPhotoDataUrl} alt={detail.productName} className="w-full h-full object-cover" />
                  ) : (
                    <Package size={26} className="text-[var(--psa-faint)]" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--psa-ink)] truncate">{detail.customerName}</p>
                  <p className="text-xs text-[var(--psa-muted)] truncate">{detail.productName}</p>
                  {detail.customerMobile && <p className="text-xs text-[var(--psa-faint)]">{detail.customerMobile}</p>}
                  <p className="text-[11px] text-[var(--psa-faint)] mt-1">{t('dentry.entryDate')}: {fmtDate(detail.date)}</p>
                  {statusBadge(detail)}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-[var(--psa-soft-red)] p-2.5">
                  <p className="text-[10px] font-semibold text-[var(--psa-muted)]">{t('dentry.outstanding')}</p>
                  {/* v2.35.0 audit: value was swapped with the TOTAL card below */}
                  <p className="text-sm font-bold text-[#DC2626] tabular-nums">{fmtMoney(outstanding)}</p>
                </div>
                <div className="rounded-lg bg-[var(--psa-soft-green)] p-2.5">
                  <p className="text-[10px] font-semibold text-[var(--psa-muted)]">{t('dentry.collectedOf')}</p>
                  <p className="text-sm font-bold text-[#16A34A] tabular-nums">{fmtMoney(detail.paidAmount || 0)}</p>
                </div>
                <div className="rounded-lg bg-[var(--psa-soft-amber)] p-2.5">
                  <p className="text-[10px] font-semibold text-[var(--psa-muted)]">{t('bills.total')}</p>
                  {/* v2.35.0 audit: value was swapped with the OUTSTANDING card above */}
                  <p className="text-sm font-bold text-[#D97706] tabular-nums">{fmtMoney(detail.amount)}</p>
                </div>
              </div>

              <div>
                <div className="h-2 rounded-full bg-[var(--psa-hover)] overflow-hidden">
                  <div className="h-full rounded-full bg-[#16A34A] transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-[11px] text-[var(--psa-faint)] mt-1 tabular-nums">{pct}% {t('dentry.collectedOf')}</p>
              </div>

              {detail.note && (
                <p className="text-xs text-[var(--psa-muted)] bg-[var(--psa-hover)] rounded-lg p-3">{detail.note}</p>
              )}

              <div>
                <p className="text-xs font-semibold text-[var(--psa-sub)] mb-2">{t('dentry.schedule')}</p>
                {(detail.schedule || []).length === 0 ? (
                  <p className="text-xs text-[var(--psa-faint)]">{t('dentry.noSchedule')}</p>
                ) : (
                  <div className="space-y-2">
                    {detail.schedule.map((it, ix) => {
                      const done = it.amount - (it.paidAmount || 0) <= EPS;
                      const part = !done && (it.paidAmount || 0) > EPS;
                      return (
                        <div key={it.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${done ? 'bg-[var(--psa-soft-green)] border-transparent' : isItemOverdue(it) ? 'bg-[var(--psa-soft-red)] border-transparent' : 'bg-[var(--psa-hover)] border-[var(--psa-border)]'}`}>
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${done ? 'bg-[#16A34A] text-white' : 'border border-[var(--psa-border)] text-[var(--psa-faint)]'}`}>
                            {done && <Check size={12} />}
                          </span>
                          <div className="min-w-0 grow">
                            <p className="text-xs font-semibold text-[var(--psa-ink)]">
                              {t('dentry.kisti')} {ix + 1} · {fmtDate(it.dueDate)}
                            </p>
                            <p className="text-[10px] text-[var(--psa-faint)] tabular-nums">
                              {part ? `${fmtMoney(it.paidAmount || 0)} / ` : ''}{fmtMoney(it.amount)}
                              {it.paidAt ? ` · ${t('dentry.paidOn')} ${fmtDate(it.paidAt)}` : ''}
                            </p>
                          </div>
                          {!done && outstanding > EPS && (
                            <Btn size="sm" variant="green" onClick={() => payInstallment(detail.id, it.id)} disabled={payingItem === it.id}>
                              {payingItem === it.id ? <Loader2 size={13} className="animate-spin" /> : <HandCoins size={13} />}
                              {t('dentry.collectKisti')}
                            </Btn>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {outstanding > EPS && (
                <Btn variant="green" className="w-full" onClick={() => setPayModal({ entry: detail, partial: false, amount: '' })}>
                  <HandCoins size={15} /> {t('dentry.recordPayment')} — {fmtMoney(outstanding)}
                </Btn>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* ── delete confirm ── */}
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('c.delete')}
        footer={
          <>
            <Btn variant="outline" onClick={() => setDeleting(null)}>{t('c.cancel')}</Btn>
            <Btn variant="danger" onClick={doDelete} disabled={busy}>{t('c.confirm')}</Btn>
          </>
        }
      >
        {deleting && (
          <p className="text-sm text-[var(--psa-sub)] flex items-start gap-2">
            <CircleAlert size={16} className="text-[#DC2626] shrink-0 mt-0.5" />
            {t('dentry.deleteConfirm')}
          </p>
        )}
      </Modal>
    </div>
  );
}
