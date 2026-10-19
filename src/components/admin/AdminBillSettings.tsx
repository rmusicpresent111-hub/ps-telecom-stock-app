'use client';

/**
 * Admin Bill Settings — everything that appears on the printed A4 bill:
 * shop name, owner, phone, address, GSTIN + GST %, bill prefix, UPI,
 * signature upload, payment QR upload, thank-you note and T&C.
 *
 * Writes through the SAME billingSettings store the mobile app uses,
 * so settings saved here sync to the APK via the encrypted D1 cycle.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Store,
  Percent,
  ReceiptText,
  PenLine,
  QrCode,
  ScrollText,
  Save,
  Eye,
  Upload,
  Trash2,
  ImageUp,
  Loader2,
} from 'lucide-react';
import {
  getBillingSettingsOffline,
  saveBillingSettingsOffline,
  getBillsOffline,
  localDateStr,
} from '@/lib/offline-service';
import { DEFAULT_USER_ID } from '@/lib/local-auth';
import { fileToResizedDataUrl } from '@/lib/image-utils';
import { useAdminStore } from '@/store/adminStore';
import { ta } from '@/lib/admin-i18n';
import type { Bill, BillingSettings } from '@/lib/types';
import { useAdminDataTick } from './useAdminData';
import { buildBillReceiptHtml, printHtml } from './print';
import A4Preview from './A4Preview';
import {
  AdminCard,
  Badge,
  Btn,
  Field,
  Modal,
  PageHeader,
  Spinner,
  TextArea,
  TextInput,
  Toggle,
  adminToast,
} from './admin-ui';

/** A representative sample bill used when the shop has no real bills yet. */
function sampleBill(form: BillingSettings): Bill {
  const subtotal = 500;
  const discountAmount = 0;
  const gstEnabled = !!form.gstEnabled && form.gstNumber.trim().length > 0 && form.gstRate > 0;
  const gstRate = gstEnabled ? form.gstRate : 0;
  const gstAmount = gstEnabled ? Math.round(((subtotal - discountAmount) * gstRate) / 100 * 100) / 100 : 0;
  const total = Math.round((subtotal - discountAmount + gstAmount) * 100) / 100;
  const now = new Date();
  const ym = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
  return {
    id: 'sample-bill',
    userId: 'sample',
    billNumber: `${(form.billPrefix || 'PS').trim() || 'PS'}-${ym}-0001`,
    customerName: 'Walk-in Customer',
    customerMobile: '9876543210',
    items: [{ productId: 'sample', name: 'Sample Product', quantity: 2, unitPrice: 250, total: subtotal }],
    subtotal,
    discountValue: 0,
    discountType: 'amount',
    discountAmount,
    gstEnabled,
    gstRate,
    gstAmount,
    total,
    paymentMethod: 'cash',
    paidAmount: total,
    dueAmount: 0,
    note: '',
    transactionId: '',
    shopSnapshot: {
      name: form.shopName,
      proprietorName: form.proprietorName,
      address: form.shopAddress,
      phone: form.shopPhone,
      gstNumber: form.gstNumber,
    },
    date: localDateStr(),
    createdAt: '',
    updatedAt: '',
  };
}

/**
 * Upload slot for signature / payment QR.
 *
 * Deliberately defined at MODULE level (NOT inside the page component):
 * a component created inside the render body gets a new identity on every
 * re-render, so React would fully remount the <input type="file">. If a
 * re-render happens while the OS file dialog is open (the 20s data tick or
 * a window-focus refresh), the input the dialog is bound to gets detached
 * and the picked file's change event is silently LOST — the user picks an
 * image and nothing happens. A stable module-level component keeps the
 * input mounted for the lifetime of the page.
 */
function ImageSlot({
  label,
  hint,
  value,
  busy,
  accept = 'image/*',
  t,
  onPick,
  onFile,
  onRemove,
}: {
  label: string;
  hint: string;
  value: string;
  busy: boolean;
  accept?: string;
  t: (k: string) => string;
  onPick: () => void;
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-xs font-semibold text-[var(--psa-sub)]">{label}</span>
      </div>
      <div className="flex items-start gap-3">
        <div className="w-28 h-16 shrink-0 rounded-lg border border-[var(--psa-field-border)] bg-white flex items-center justify-center overflow-hidden relative">
          {value ? (
            <img src={value} alt={label} className="max-w-full max-h-full object-contain" />
          ) : (
            <ImageUp size={18} className="text-[var(--psa-faint)]" />
          )}
          {busy && (
            <span className="absolute inset-0 bg-white/70 flex items-center justify-center">
              <Loader2 size={18} className="animate-spin text-[#FA6E41]" />
            </span>
          )}
        </div>
        <div className="min-w-0 grow">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                onPick();
                inputRef.current?.click();
              }}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold cursor-pointer bg-[var(--psa-soft-orange)] text-[#E8552C] hover:bg-[var(--psa-soft-orange-h)] transition-colors"
            >
              <Upload size={13} /> {value ? t('bset.change') : t('bset.upload')}
            </button>
            {value && (
              <Btn size="sm" variant="outline" onClick={onRemove}>
                <Trash2 size={13} /> {t('bset.remove')}
              </Btn>
            )}
          </div>
          <p className="text-[11px] text-[var(--psa-faint)] mt-1.5 leading-snug">{hint}</p>
        </div>
      </div>
      {/* Visually hidden but NOT display:none — some browsers refuse to open
          the file dialog for display:none inputs. Kept OUTSIDE the flex row
          so it never shifts the layout. */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={onFile}
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          opacity: 0,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
        }}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}

export default function AdminBillSettings() {
  const lang = useAdminStore((s) => s.language);
  const t = (k: string) => ta(k, lang);
  const tick = useAdminDataTick();

  const [form, setForm] = useState<BillingSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [latestBill, setLatestBill] = useState<Bill | null>(null);
  const [uploading, setUploading] = useState<'signatureDataUrl' | 'qrCodeDataUrl' | null>(null);

  // Guards against the reload/refresh cycle clobbering live user edits and
  // in-flight image uploads (refs are read synchronously, even from async code).
  const editSeqRef = useRef(0); // bumped on every local edit — stale loads are discarded
  const pickingRef = useRef(false); // OS file dialog open — pause auto-reload
  const uploadingRef = useRef(false); // resize/save in progress — pause auto-reload
  const pickTimerRef = useRef<number | null>(null);

  const load = async () => {
    const seq = editSeqRef.current; // snapshot at fetch start
    try {
      const s = await getBillingSettingsOffline(DEFAULT_USER_ID);
      // The user edited (or is uploading) while we fetched — our result is
      // stale, applying it would wipe their work.
      if (seq !== editSeqRef.current || pickingRef.current || uploadingRef.current) return;
      setForm((prev) => {
        if (!prev) return s;
        // Skip the state write when nothing actually changed — an object
        // identity change re-renders the page every 20s for no reason.
        return JSON.stringify(prev) === JSON.stringify(s) ? prev : s;
      });
    } catch {
      /* private mode — leave the form empty */
    }
  };

  // initial load + follow sync pulls while the shop owner is not mid-edit
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!dirty) void load();
  }, [tick, dirty]);

  // latest real bill for a meaningful preview
  useEffect(() => {
    if (!previewOpen) return;
    let alive = true;
    getBillsOffline(DEFAULT_USER_ID)
      .then((rows) => {
        if (!alive) return;
        const sorted = [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        setLatestBill(sorted[0] || null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [previewOpen]);

  const set = <K extends keyof BillingSettings>(k: K, v: BillingSettings[K]) => {
    editSeqRef.current++; // any in-flight load() is now stale — do not apply it
    setForm((p) => (p ? { ...p, [k]: v } : p));
    setDirty(true);
  };

  /** Called right BEFORE the OS file dialog opens — freezes auto-reload so a
   *  20s tick / focus refresh can never re-render (and detach the input) while
   *  the user is browsing their gallery/files for the signature or QR image. */
  const beginPick = () => {
    pickingRef.current = true;
    if (pickTimerRef.current) clearTimeout(pickTimerRef.current);
    // Safety: if the dialog is cancelled no change event fires — unblock reloads
    pickTimerRef.current = window.setTimeout(() => {
      pickingRef.current = false;
    }, 60_000);
  };

  const save = async () => {
    if (!form || busy) return;
    setBusy(true);
    try {
      await saveBillingSettingsOffline(DEFAULT_USER_ID, {
        shopName: form.shopName,
        proprietorName: form.proprietorName,
        shopAddress: form.shopAddress,
        shopPhone: form.shopPhone,
        gstNumber: form.gstNumber,
        gstEnabled: form.gstEnabled,
        gstRate: Number(form.gstRate) || 0,
        defaultDiscountPercent: Number(form.defaultDiscountPercent) || 0,
        billPrefix: form.billPrefix,
        upiId: form.upiId,
        signatureDataUrl: form.signatureDataUrl,
        qrCodeDataUrl: form.qrCodeDataUrl,
        thankYouNote: form.thankYouNote,
        termsText: form.termsText,
      });
      setDirty(false);
      adminToast(t('bset.savedNote'));
    } catch (err) {
      adminToast((err as Error)?.message || t('c.error'), 'err');
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
    key: 'signatureDataUrl' | 'qrCodeDataUrl'
  ) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file later
    pickingRef.current = false; // dialog closed
    if (pickTimerRef.current) {
      clearTimeout(pickTimerRef.current);
      pickTimerRef.current = null;
    }
    if (!file) return;
    uploadingRef.current = true;
    setUploading(key);
    try {
      const url =
        key === 'signatureDataUrl'
          ? await fileToResizedDataUrl(file, 500, 120 * 1024)
          : await fileToResizedDataUrl(file, 600, 250 * 1024);
      editSeqRef.current++; // our write wins over any in-flight load()
      setForm((p) => (p ? { ...p, [key]: url } : p));
      setDirty(true);
      adminToast(t('c.saved'));
    } catch (err) {
      const msg = (err as Error)?.message || '';
      adminToast(/image/i.test(msg) ? t('bset.imgErr') : msg || t('c.error'), 'err');
    } finally {
      uploadingRef.current = false;
      setUploading(null);
    }
  };

  const previewHtml = useMemo(() => {
    if (!form) return '';
    const bill = latestBill || sampleBill(form);
    return buildBillReceiptHtml(bill, lang, form);
  }, [form, latestBill, lang, previewOpen]);

  if (!form) {
    return (
      <div className="py-16 flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('bset.title')}
        sub={t('bset.sub')}
        action={
          <>
            <Btn variant="outline" onClick={() => setPreviewOpen(true)}>
              <Eye size={16} /> <span className="hidden sm:inline">{t('bset.preview')}</span>
            </Btn>
            <Btn onClick={() => void save()} disabled={busy}>
              <Save size={16} /> {busy ? t('bset.saving') : t('bset.save')}
            </Btn>
          </>
        }
      />

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {/* shop details */}
        <AdminCard
          title={
            <span className="flex items-center gap-2">
              <Store size={16} className="text-[#FA6E41]" /> {t('bset.shopInfo')}
            </span>
          }
        >
          <div className="space-y-3.5">
            <Field label={t('bset.shopName')}>
              <TextInput value={form.shopName} onChange={(e) => set('shopName', e.target.value)} />
            </Field>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label={t('bset.proprietor')}>
                <TextInput
                  value={form.proprietorName}
                  onChange={(e) => set('proprietorName', e.target.value)}
                />
              </Field>
              <Field label={t('bset.phone')}>
                <TextInput
                  value={form.shopPhone}
                  onChange={(e) => set('shopPhone', e.target.value)}
                  inputMode="tel"
                />
              </Field>
            </div>
            <Field label={t('bset.address')}>
              <TextArea
                rows={2}
                value={form.shopAddress}
                onChange={(e) => set('shopAddress', e.target.value)}
              />
            </Field>
          </div>
        </AdminCard>

        {/* GST / tax */}
        <AdminCard
          title={
            <span className="flex items-center gap-2">
              <Percent size={16} className="text-[#FA6E41]" /> {t('bset.taxSection')}
            </span>
          }
        >
          <div className="space-y-3.5">
            <div className="flex items-center justify-between gap-3">
              <Toggle
                checked={form.gstEnabled}
                onChange={(v) => set('gstEnabled', v)}
                label={t('bset.gstToggle')}
              />
              {form.gstEnabled && form.gstNumber.trim() && form.gstRate > 0 && (
                <Badge tone="green">GST {form.gstRate}%</Badge>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label={t('bset.gstin')}>
                <TextInput
                  value={form.gstNumber}
                  onChange={(e) => set('gstNumber', e.target.value.toUpperCase())}
                  placeholder="19ABCDE1234F1Z5"
                />
              </Field>
              <Field label={t('bset.gstRate')}>
                <TextInput
                  type="number"
                  min="0"
                  max="100"
                  value={form.gstRate}
                  onChange={(e) => set('gstRate', Number(e.target.value))}
                />
              </Field>
            </div>
            <Field label={t('bset.discount')}>
              <TextInput
                type="number"
                min="0"
                max="100"
                value={form.defaultDiscountPercent}
                onChange={(e) => set('defaultDiscountPercent', Number(e.target.value))}
              />
            </Field>
            <p className="text-[11px] text-[var(--psa-faint)] bg-[var(--psa-hover)] rounded-lg p-2.5 leading-snug">
              {t('bset.gstHint')}
            </p>
          </div>
        </AdminCard>

        {/* bill number & print */}
        <AdminCard
          title={
            <span className="flex items-center gap-2">
              <ReceiptText size={16} className="text-[#FA6E41]" /> {t('bset.billPrint')}
            </span>
          }
        >
          <div className="space-y-3.5">
            <Field label={t('bset.prefix')} hint={t('bset.prefixHint')}>
              <TextInput
                value={form.billPrefix}
                onChange={(e) => set('billPrefix', e.target.value.toUpperCase())}
              />
            </Field>
            <Field label={t('bset.upi')}>
              <TextInput
                value={form.upiId}
                onChange={(e) => set('upiId', e.target.value)}
                placeholder="pstelecom@upi"
              />
            </Field>
            <Field label={t('bset.thankyou')}>
              <TextInput
                value={form.thankYouNote}
                onChange={(e) => set('thankYouNote', e.target.value)}
              />
            </Field>
          </div>
        </AdminCard>

        {/* signature + QR */}
        <AdminCard
          title={
            <span className="flex items-center gap-2">
              <PenLine size={16} className="text-[#FA6E41]" /> {t('bset.signature')}
            </span>
          }
        >
          <div className="space-y-4">
            <ImageSlot
              label={t('bset.signature')}
              hint={t('bset.sigHint')}
              value={form.signatureDataUrl}
              busy={uploading === 'signatureDataUrl'}
              t={t}
              onPick={beginPick}
              onFile={(e) => void handleFile(e, 'signatureDataUrl')}
              onRemove={() => set('signatureDataUrl', '')}
            />
            <div className="border-t border-[var(--psa-line)] pt-4">
              <div className="flex items-center gap-2 mb-2">
                <QrCode size={14} className="text-[var(--psa-muted)]" />
                <span className="text-xs font-semibold text-[var(--psa-sub)]">{t('bset.qr')}</span>
              </div>
              <ImageSlot
                label={t('bset.qr')}
                hint={t('bset.qrHint')}
                value={form.qrCodeDataUrl}
                busy={uploading === 'qrCodeDataUrl'}
                t={t}
                onPick={beginPick}
                onFile={(e) => void handleFile(e, 'qrCodeDataUrl')}
                onRemove={() => set('qrCodeDataUrl', '')}
              />
            </div>
          </div>
        </AdminCard>

        {/* T&C */}
        <AdminCard
          title={
            <span className="flex items-center gap-2">
              <ScrollText size={16} className="text-[#FA6E41]" /> {t('bset.terms')}
            </span>
          }
          className="lg:col-span-2"
        >
          <Field label={t('bset.terms')} hint={t('bset.termsHint')}>
            <TextArea
              rows={4}
              value={form.termsText}
              onChange={(e) => set('termsText', e.target.value)}
              placeholder={'1. Goods once sold will not be taken back\n2. Warranty as per manufacturer only\n3. Subject to local jurisdiction'}
            />
          </Field>
        </AdminCard>
      </div>

      {/* bottom save — thumb-reachable on mobile */}
      <div className="mt-4 flex justify-end">
        <Btn onClick={() => void save()} disabled={busy}>
          <Save size={16} /> {busy ? t('bset.saving') : t('bset.save')}
        </Btn>
      </div>

      {/* A4 preview */}
      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={t('bset.previewTitle')}
        wide
        footer={
          <>
            <Btn variant="outline" onClick={() => setPreviewOpen(false)}>
              {t('c.close')}
            </Btn>
            <Btn onClick={() => printHtml(previewHtml)}>
              <ReceiptText size={15} /> {t('bills.print')}
            </Btn>
          </>
        }
      >
        <div className="mb-2.5">
          <Badge tone="orange">{latestBill ? t('bset.usingLatest') : t('bset.sampleNote')}</Badge>
        </div>
        {previewHtml && <A4Preview html={previewHtml} ariaLabel={t('bset.previewTitle')} />}
      </Modal>
    </div>
  );
}
