'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import {
  getBillingSettingsOffline, createBillOffline, getBillByIdOffline, deleteBillOffline,
} from '@/lib/offline-service';
import {
  generateBillPdf, downloadBlob, sendBillViaWhatsapp, shopInitials, formatMoney, formatDate,
  isValidIndianMobile,
  type GeneratedPdf,
} from '@/lib/bill-pdf';
import { toastWhatsappResult } from '@/lib/share-toasts';
import { BillingSettings, Bill, PaymentMethod } from '@/lib/types';
import { ArrowLeft, FileText, Loader2, Trash2, Download, Share2, MessageCircle, ExternalLink, BadgeIndianRupee } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

type Mode = 'create' | 'view' | 'success';

export default function InvoiceScreen() {
  const user = useAppStore(s => s.user);
  const language = useAppStore(s => s.language);
  const goBack = useAppStore(s => s.goBack);
  const pendingBillData = useAppStore(s => s.pendingBillData);
  const setPendingBillData = useAppStore(s => s.setPendingBillData);
  const selectedBillId = useAppStore(s => s.selectedBillId);
  const setSelectedBillId = useAppStore(s => s.setSelectedBillId);
  const navigateToTab = useAppStore(s => s.navigateToTab);
  const setHistoryView = useAppStore(s => s.setHistoryView);

  const [mode, setMode] = useState<Mode>('create');
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [bill, setBill] = useState<Bill | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // create-mode form
  const [customerName, setCustomerName] = useState('');
  const [customerMobile, setCustomerMobile] = useState('');
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [discountValue, setDiscountValue] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paidAmount, setPaidAmount] = useState('');
  const [note, setNote] = useState('');
  const initializedDiscount = useRef(false);

  // Load settings / existing bill
  useEffect(() => {
    let cancelled = false;
    // goBack only if this screen is still the active one — the user may have
    // navigated away while the async load was in flight (AnimatePresence exit
    // window), and an extra goBack() would pop one level too far.
    const goBackIfStillHere = () => {
      if (!cancelled && useAppStore.getState().currentScreen === 'invoice') goBack();
    };
    (async () => {
      if (!user?.id) return;
      setLoading(true);
      try {
        const s = await getBillingSettingsOffline(user.id);
        if (cancelled) return;
        setSettings(s);

        if (selectedBillId) {
          const existing = await getBillByIdOffline(selectedBillId, user.id);
          if (cancelled) return;
          if (existing) {
            setBill(existing);
            setMode('view');
          } else {
            toast.error(t('error', language));
            goBackIfStillHere();
          }
          setSelectedBillId(null);
        } else if (pendingBillData) {
          setMode('create');
        } else {
          // nothing to show — leave
          goBackIfStillHere();
        }
      } catch {
        goBackIfStillHere();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
     
  }, [user?.id]);

  // Apply defaults once settings arrive
  useEffect(() => {
    if (!settings || initializedDiscount.current) return;
    initializedDiscount.current = true;
    if (settings.defaultDiscountPercent > 0) {
      setDiscountType('percent');
      setDiscountValue(String(settings.defaultDiscountPercent));
    }
  }, [settings]);

  // ---- Pre-generate the PDF the moment the bill screen shows ----
  // Tapping "Send on WhatsApp" can then call navigator.share() INSTANTLY,
  // while the tap's transient user activation is still fresh. If the share
  // call happens after slow async work (PDF generation + imports), mobile
  // browsers reject it with NotAllowedError and the PDF silently never
  // reaches WhatsApp — that was the bug.
  const pdfCacheRef = useRef<{ billId: string; pdf: GeneratedPdf } | null>(null);
  useEffect(() => {
    pdfCacheRef.current = null;
    if (!bill || (mode !== 'success' && mode !== 'view')) return;
    let cancelled = false;
    (async () => {
      try {
        const pdf = await generateBillPdf(bill, {
          signatureDataUrl: settings?.signatureDataUrl,
          qrCodeDataUrl: settings?.qrCodeDataUrl,
          upiId: settings?.upiId,
          thankYouNote: settings?.thankYouNote,
          termsText: settings?.termsText,
          proprietorName: settings?.proprietorName,
        });
        if (!cancelled) pdfCacheRef.current = { billId: bill.id, pdf };
      } catch {
        // PDF generation problems surface when the user taps an action
      }
    })();
    return () => { cancelled = true; };
  }, [bill, settings]);

  // ---- AUTO-SEND: bill travels to the customer's number by itself ----
  // (the effect itself lives below, after getPdf is declared)
  const autoSentRef = useRef<Set<string>>(new Set());

  // ---- Live totals for create mode (mirror createBillOffline math) ----
  const totals = useMemo(() => {
    const qty = pendingBillData?.quantity ?? 0;
    const unitPrice = pendingBillData?.unitPrice ?? 0;
    const subtotal = Math.round(qty * unitPrice * 100) / 100;
    let discountAmount = 0;
    const dv = Math.max(0, Number(discountValue) || 0);
    if (discountType === 'percent') {
      discountAmount = Math.round(((subtotal * Math.min(dv, 100)) / 100) * 100) / 100;
    } else {
      discountAmount = Math.round(Math.min(dv, subtotal) * 100) / 100;
    }
    const gstEnabled = !!settings?.gstEnabled && !!settings?.gstNumber.trim() && (settings?.gstRate ?? 0) > 0;
    const gstAmount = gstEnabled ? Math.round((((subtotal - discountAmount) * (settings?.gstRate ?? 0)) / 100) * 100) / 100 : 0;
    const total = Math.round((subtotal - discountAmount + gstAmount) * 100) / 100;
    let paid = paymentMethod === 'due' ? 0 : (paidAmount === '' ? total : Math.max(0, Number(paidAmount) || 0));
    paid = Math.min(paid, total);
    const due = Math.round((total - paid) * 100) / 100;
    return { subtotal, discountAmount, gstEnabled, gstAmount, total, paid, due };
  }, [pendingBillData, discountValue, discountType, settings, paymentMethod, paidAmount]);

  const handleGenerate = useCallback(async () => {
    if (!user?.id || !pendingBillData || !settings) return;
    // A mistyped mobile number would send the purchase invoice (PDF) to a
    // STRANGER's WhatsApp — block invalid numbers before saving.
    if (customerMobile.trim() && !isValidIndianMobile(customerMobile)) {
      toast.error(
        language === 'bn'
          ? 'সঠিক ১০ সংখ্যার WhatsApp মোবাইল নম্বর দিন'
          : language === 'hi'
            ? 'सही 10 अंकों का WhatsApp मोबाइल नंबर दें'
            : 'Enter a valid 10-digit WhatsApp mobile number'
      );
      return;
    }
    setSaving(true);
    try {
      const { bill: created } = await createBillOffline({
        userId: user.id,
        transactionId: pendingBillData.transactionId,
        productId: pendingBillData.productId,
        productName: pendingBillData.productName,
        quantity: pendingBillData.quantity,
        unitPrice: pendingBillData.unitPrice,
        customerName,
        customerMobile,
        discountType,
        discountValue: Number(discountValue) || 0,
        paymentMethod,
        paidAmount: paidAmount === '' ? undefined : Number(paidAmount) || 0,
        note,
      });
      setBill(created);
      setMode('success');
      setPendingBillData(null);
      toast.success(t('billSaved', language));
    } catch (error) {
      toast.error((error as Error).message || t('error', language));
    } finally {
      setSaving(false);
    }
  }, [user?.id, pendingBillData, settings, customerName, customerMobile, discountType, discountValue, paymentMethod, paidAmount, note, setPendingBillData, language]);

  const makePdf = useCallback(async (targetBill: Bill): Promise<GeneratedPdf | null> => {
    setGenerating(true);
    try {
      return await generateBillPdf(targetBill, {
        signatureDataUrl: settings?.signatureDataUrl,
        qrCodeDataUrl: settings?.qrCodeDataUrl,
        upiId: settings?.upiId,
        thankYouNote: settings?.thankYouNote,
        termsText: settings?.termsText,
        proprietorName: settings?.proprietorName,
      });
    } catch (error) {
      toast.error((error as Error).message || t('error', language));
      return null;
    } finally {
      setGenerating(false);
    }
  }, [settings, language]);

  /** Cached PDF (instant share) or generate on demand. */
  const getPdf = useCallback(async (targetBill: Bill): Promise<GeneratedPdf | null> => {
    const cached = pdfCacheRef.current;
    if (cached && cached.billId === targetBill.id) return cached.pdf;
    return makePdf(targetBill);
  }, [makePdf]);

  const handleWhatsApp = useCallback(async (targetBill: Bill) => {
    const pdf = await getPdf(targetBill);
    if (!pdf) return;
    // Preferred: native share sheet WITH the PDF file attached → user picks
    // WhatsApp + the customer chat. Fallback: download + wa.me text chat.
    const result = await sendBillViaWhatsapp(targetBill, pdf);
    toastWhatsappResult(result, language);
  }, [getPdf, language]);

  // ---- AUTO-SEND: bill travels to the customer's number by itself ----
  // As soon as the bill is saved (success mode) and the PDF is ready, the
  // share sheet opens carrying the REAL PDF file + the bill summary. One tap
  // on WhatsApp (and the customer chat) delivers it. Native APK: the Android
  // share sheet with the attached PDF. Web fallback: PDF downloads + the
  // customer's wa.me chat opens. Skipped when no mobile number was given —
  // the manual buttons below always remain as backup.
  useEffect(() => {
    if (!bill || mode !== 'success' || !bill.customerMobile) return;
    if (autoSentRef.current.has(bill.id)) return;
    let cancelled = false;
    (async () => {
      const pdf = await getPdf(bill);
      if (cancelled || !pdf) return;
      autoSentRef.current.add(bill.id);
      try {
        const result = await sendBillViaWhatsapp(bill, pdf);
        toastWhatsappResult(result, language);
      } catch {
        // Silent — the manual share buttons remain available on this screen.
      }
    })();
    return () => { cancelled = true; };
  }, [bill, mode, getPdf, language]);

  const handleShare = useCallback(async (targetBill: Bill) => {
    const pdf = await getPdf(targetBill);
    if (!pdf) return;
    const result = await sendBillViaWhatsapp(targetBill, pdf, { pdfNote: false });
    toastWhatsappResult(result, language);
  }, [getPdf, language]);

  const handleDownload = useCallback(async (targetBill: Bill) => {
    const pdf = await makePdf(targetBill);
    if (!pdf) return;
    downloadBlob(pdf.blob, pdf.fileName);
    toast.success(t('downloadPdf', language) + ' ✓');
  }, [makePdf, language]);

  const handleViewPdf = useCallback(async (targetBill: Bill) => {
    const pdf = await makePdf(targetBill);
    if (!pdf) return;
    const url = URL.createObjectURL(pdf.blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }, [makePdf]);

  const handleDelete = useCallback(async () => {
    if (!user?.id || !bill) return;
    try {
      await deleteBillOffline(bill.id, user.id);
      toast.success(t('billDeleted', language));
      setHistoryView('bills');
      navigateToTab('history');
    } catch {
      toast.error(t('error', language));
    }
  }, [user?.id, bill, language, navigateToTab, setHistoryView]);

  const handleDone = useCallback(() => {
    setHistoryView('bills');
    navigateToTab('history');
  }, [navigateToTab, setHistoryView]);

  if (loading) {
    return (
      <div className="animated-bg min-h-screen pb-24">
        <div className="max-w-md mx-auto px-4 pt-4">
          <InvoiceHeader goBack={goBack} title={t('eBill', language)} />
          <div className="text-center py-12 text-white/40">{t('loading', language)}</div>
        </div>
      </div>
    );
  }

  // ============ CREATE MODE ============
  if (mode === 'create' && pendingBillData) {
    const p = pendingBillData;
    return (
      <div className="animated-bg min-h-screen pb-32">
        <div className="max-w-md mx-auto px-4 pt-4">
          <InvoiceHeader goBack={goBack} title={t('createEBill', language)} />

          {/* Item summary card */}
          <div className="glass-card-strong p-5 mb-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-white/50 mb-1">{t('item', language)}</p>
                <p className="text-base font-bold text-white/90">{p.productName}</p>
              </div>
              <span className="text-[10px] px-2 py-1 rounded-full bg-amber-500/20 text-amber-300 font-semibold">{t('eBill', language)}</span>
            </div>
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/10">
              <span className="text-xs text-white/50">{t('quantity', language)}: <span className="text-white/90 font-medium">{p.quantity}</span></span>
              <span className="text-xs text-white/50">{t('price', language)}: <span className="text-white/90 font-medium">₹{formatMoney(p.unitPrice)}</span></span>
              <span className="text-sm font-bold text-emerald-400">₹{formatMoney(p.totalAmount)}</span>
            </div>
          </div>

          {/* Customer details */}
          <div className="glass-card-strong p-5 space-y-4 mb-4">
            <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">{t('customerName', language)}</p>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder={t('customerName', language)}
              className="glass-input w-full px-4 py-3 text-sm"
            />
            <input
              type="tel"
              value={customerMobile}
              onChange={(e) => setCustomerMobile(e.target.value.replace(/[^\d+]/g, ''))}
              placeholder={t('customerPhone', language) + ' (WhatsApp)'}
              className="glass-input w-full px-4 py-3 text-sm"
            />
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('note', language)}
              className="glass-input w-full px-4 py-3 text-sm"
            />
          </div>

          {/* Discount + payment */}
          <div className="glass-card-strong p-5 space-y-4 mb-4">
            <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">{t('discount', language)}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setDiscountType('amount')}
                className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${discountType === 'amount' ? 'neon-btn-solid' : 'glass-card text-white/60'}`}
              >
                ₹ {t('discount', language)}
              </button>
              <button
                onClick={() => setDiscountType('percent')}
                className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${discountType === 'percent' ? 'neon-btn-solid' : 'glass-card text-white/60'}`}
              >
                % {t('discount', language)}
              </button>
            </div>
            <input
              type="number"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              placeholder={discountType === 'percent' ? '0%' : '₹0'}
              className="glass-input w-full px-4 py-3 text-sm"
            />

            <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide pt-2">{t('paymentMethod', language)}</p>
            <div className="grid grid-cols-4 gap-2">
              {(['cash', 'upi', 'card', 'due'] as PaymentMethod[]).map((pm) => (
                <button
                  key={pm}
                  onClick={() => { setPaymentMethod(pm); if (pm === 'due') setPaidAmount('0'); }}
                  className={`py-2.5 text-xs font-semibold rounded-xl transition-all ${paymentMethod === pm ? 'neon-btn-solid' : 'glass-card text-white/60'}`}
                >
                  {t(pm, language)}
                </button>
              ))}
            </div>
            {paymentMethod !== 'due' && (
              <input
                type="number"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                placeholder={`${t('paidAmount', language)} (₹${formatMoney(totals.total)})`}
                className="glass-input w-full px-4 py-3 text-sm"
              />
            )}
          </div>

          {/* Totals preview */}
          <div className="glass-card-strong p-5 space-y-2.5">
            <TotalRow label={t('subtotal', language)} value={`₹${formatMoney(totals.subtotal)}`} />
            {totals.discountAmount > 0 && (
              <TotalRow label={`${t('discount', language)}${discountType === 'percent' ? ` (${discountValue}%)` : ''}`} value={`-₹${formatMoney(totals.discountAmount)}`} accent="text-green-400" />
            )}
            {totals.gstEnabled && totals.gstAmount > 0 && (
              <TotalRow label={`${t('gst', language)} (${settings?.gstRate}%)`} value={`₹${formatMoney(totals.gstAmount)}`} />
            )}
            <div className="border-t border-white/10 pt-3 flex justify-between items-center">
              <span className="text-sm font-semibold">{t('grandTotal', language)}</span>
              <span className="text-xl font-bold text-amber-300">₹{formatMoney(totals.total)}</span>
            </div>
            {totals.due > 0 && (
              <TotalRow label={t('dueAmount', language)} value={`₹${formatMoney(totals.due)}`} accent="text-red-400 font-semibold" />
            )}
            {settings?.shopName && (
              <p className="text-[10px] text-white/30 pt-1">↳ {settings.shopName}{settings.gstEnabled && settings.gstNumber ? ` • GSTIN: ${settings.gstNumber}` : ''}</p>
            )}
          </div>
        </div>

        {/* Sticky generate button */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
          <div className="max-w-md mx-auto">
            <button
              onClick={handleGenerate}
              disabled={saving}
              className="neon-btn-solid w-full py-3.5 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader2 size={18} className="animate-spin" /> : <BadgeIndianRupee size={18} />}
              {saving ? t('loading', language) : t('generateBill', language)}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============ SUCCESS / VIEW MODE ============
  if (bill && (mode === 'success' || mode === 'view')) {
    return (
      <div className="animated-bg min-h-screen pb-32">
        <div className="max-w-md mx-auto px-4 pt-4">
          <InvoiceHeader goBack={goBack} title={mode === 'success' ? t('billSaved', language) : t('viewBill', language)} />

          {/* Premium receipt-style preview */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl overflow-hidden shadow-2xl mb-4 relative bg-[#0f1219] ring-1 ring-[#D4A853]/45 shadow-[0_12px_60px_-15px_rgba(212,168,83,0.45)]"
          >
            {/* watermark */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden" aria-hidden="true">
              <span className="font-serif font-bold text-6xl text-white/[0.035] -rotate-[22deg] whitespace-nowrap tracking-widest select-none">
                {bill.shopSnapshot?.name || settings?.shopName || 'PS TELECOM'}
              </span>
            </div>

            <div className="h-1.5 bg-gradient-to-r from-amber-200 via-[#D4A853] to-amber-700" />

            {/* header */}
            <div className="bg-gradient-to-b from-[#1e2434] to-[#141927] px-5 py-4 relative">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 shrink-0 rounded-full bg-gradient-to-br from-amber-200 via-[#D4A853] to-amber-700 flex items-center justify-center shadow-lg shadow-amber-900/40 ring-2 ring-amber-200/30">
                  <span className="font-serif font-bold text-[#1a1408] text-sm tracking-wide">
                    {shopInitials(bill.shopSnapshot?.name || settings?.shopName || 'PS TELECOM')}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-serif text-[21px] leading-tight font-bold tracking-[0.1em] bg-gradient-to-r from-amber-100 via-[#EBCB7F] to-amber-300 bg-clip-text text-transparent truncate">
                    {bill.shopSnapshot?.name || settings?.shopName || 'PS TELECOM'}
                  </p>
                  {(bill.shopSnapshot?.proprietorName ?? settings?.proprietorName) && (
                    <p className="font-serif italic text-[10px] text-amber-200/70 mt-0.5">
                      Proprietor: {bill.shopSnapshot?.proprietorName ?? settings?.proprietorName}
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[9px] font-bold bg-gradient-to-r from-amber-300 to-[#C89B4B] text-[#1a1408] px-2 py-0.5 rounded-sm shadow">{bill.gstEnabled ? 'TAX INVOICE' : 'INVOICE'}</span>
                  <p className="text-[10px] text-white/60 mt-1.5">{bill.billNumber}</p>
                  <p className="text-[10px] text-white/60">{formatDate(bill.date)}</p>
                </div>
              </div>
              <div className="mt-2 text-[10px] text-white/45 leading-snug">
                {bill.shopSnapshot?.address && <p className="whitespace-pre-line">{bill.shopSnapshot.address}</p>}
                {(bill.shopSnapshot?.phone || bill.shopSnapshot?.gstNumber) && (
                  <p className="mt-0.5">
                    {bill.shopSnapshot?.phone && <span>Ph: {bill.shopSnapshot.phone}</span>}
                    {bill.shopSnapshot?.phone && bill.shopSnapshot?.gstNumber && <span>{'  |  '}</span>}
                    {bill.shopSnapshot?.gstNumber && <span>GSTIN: {bill.shopSnapshot.gstNumber}</span>}
                  </p>
                )}
              </div>
            </div>
            <div className="h-px bg-gradient-to-r from-transparent via-[#D4A853]/70 to-transparent" />

            {/* customer */}
            <div className="px-5 py-3">
              <p className="text-[9px] text-[#D4A853]/80 font-semibold tracking-[0.12em]">BILL TO</p>
              <div className="flex justify-between items-center mt-0.5">
                <p className="text-sm font-serif font-semibold text-white/90">{bill.customerName}</p>
                {bill.customerMobile && <p className="text-xs text-white/60">Mob: {bill.customerMobile}</p>}
              </div>
            </div>
            <div className="mx-5 h-px bg-white/5" />

            {/* items */}
            <div className="px-5 py-2">
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-[9px] text-white/40 font-semibold py-2 border-b border-white/10 uppercase">
                <span>{t('item', language)}</span>
                <span className="text-right">{t('quantity', language)}/₹</span>
                <span className="text-right w-16">{t('revenue', language)}</span>
              </div>
              {bill.items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_auto_auto] gap-x-4 items-center py-2.5 border-b border-white/5">
                  <span className="text-xs text-white/85">{item.name}</span>
                  <span className="text-[11px] text-white/50 text-right">{item.quantity} × {formatMoney(item.unitPrice)}</span>
                  <span className="text-xs font-semibold text-white/90 text-right w-16">₹{formatMoney(item.total)}</span>
                </div>
              ))}
            </div>

            {/* totals */}
            <div className="px-5 py-3 space-y-1.5">
              <TotalRow label={t('subtotal', language)} value={`₹${formatMoney(bill.subtotal)}`} />
              {bill.discountAmount > 0 && (
                <TotalRow label={`${t('discount', language)}${bill.discountType === 'percent' ? ` (${bill.discountValue}%)` : ''}`} value={`-₹${formatMoney(bill.discountAmount)}`} accent="text-green-400" />
              )}
              {bill.gstEnabled && bill.gstAmount > 0 && (
                <TotalRow label={`${t('gst', language)} (${bill.gstRate}%)`} value={`₹${formatMoney(bill.gstAmount)}`} />
              )}
              <div className="bg-gradient-to-r from-[#EDD494] via-[#D4A853] to-[#A67C34] rounded-lg px-3 py-2.5 flex justify-between items-center mt-2 shadow-md">
                <span className="text-xs font-bold font-serif tracking-wide text-[#221a08]">{t('grandTotal', language)}</span>
                <span className="text-lg font-bold font-serif text-[#221a08]">₹{formatMoney(bill.total)}</span>
              </div>
              {bill.dueAmount > 0 && (
                <TotalRow label={t('dueAmount', language)} value={`₹${formatMoney(bill.dueAmount)}`} accent="text-red-400 font-semibold" />
              )}
              <div className="flex justify-between text-[11px] text-white/50 pt-1">
                <span>{t('paymentMethod', language)}</span>
                <span>{t(bill.paymentMethod, language)}</span>
              </div>
              {bill.note && <p className="text-[10px] text-white/40 italic pt-1">{t('note', language)}: {bill.note}</p>}
            </div>

            {/* qr + signature */}
            <div className="px-5 pb-4 pt-1 flex items-end justify-between">
              {settings?.qrCodeDataUrl ? (
                <div className="text-center">
                  { }
                  <img src={settings.qrCodeDataUrl} alt="Payment QR" className="w-16 h-16 object-contain bg-white rounded-lg p-0.5 ring-1 ring-[#D4A853]/50" />
                  {settings.upiId && <p className="text-[8px] text-white/40 mt-1">{settings.upiId}</p>}
                </div>
              ) : <span />}
              <div className="text-right">
                {settings?.signatureDataUrl && (
                   
                  <img src={settings.signatureDataUrl} alt="Signature" className="h-8 object-contain ml-auto mb-0.5" />
                )}
                <p className="text-[9px] text-white/50 border-t border-[#D4A853]/40 pt-1">For {bill.shopSnapshot?.name || 'PS TELECOM'}</p>
                {(bill.shopSnapshot?.proprietorName ?? settings?.proprietorName) && (
                  <>
                    <p className="font-serif text-[11px] font-bold text-amber-100/90 mt-0.5">{bill.shopSnapshot?.proprietorName ?? settings?.proprietorName}</p>
                    <p className="text-[8px] text-white/40">Proprietor</p>
                  </>
                )}
              </div>
            </div>
            <p className="text-center font-serif italic text-[11px] text-amber-200/80 pb-3 font-medium relative">{settings?.thankYouNote || 'Thank you for your business!'}</p>
            <div className="h-1.5 bg-gradient-to-r from-amber-700 via-[#D4A853] to-amber-200" />
          </motion.div>

          {/* Share actions */}
          <div className="space-y-2.5">
            <button
              onClick={() => handleWhatsApp(bill)}
              disabled={generating}
              className="w-full py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 text-white"
              style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}
            >
              {generating ? <Loader2 size={18} className="animate-spin" /> : <MessageCircle size={18} />}
              {t('whatsappSend', language)}{bill.customerMobile ? ` — ${bill.customerMobile}` : ''}
            </button>
            <div className="grid grid-cols-3 gap-2.5">
              <button onClick={() => handleShare(bill)} disabled={generating} className="glass-card py-3 rounded-xl text-xs font-semibold flex flex-col items-center gap-1.5 disabled:opacity-50">
                <Share2 size={16} className="text-emerald-400" />{t('sharePdf', language)}
              </button>
              <button onClick={() => handleViewPdf(bill)} disabled={generating} className="glass-card py-3 rounded-xl text-xs font-semibold flex flex-col items-center gap-1.5 disabled:opacity-50">
                <ExternalLink size={16} className="text-amber-300" />{t('viewPdf', language)}
              </button>
              <button onClick={() => handleDownload(bill)} disabled={generating} className="glass-card py-3 rounded-xl text-xs font-semibold flex flex-col items-center gap-1.5 disabled:opacity-50">
                {generating ? <Loader2 size={16} className="animate-spin text-white/50" /> : <Download size={16} className="text-emerald-400" />}{t('downloadPdf', language)}
              </button>
            </div>
          </div>

          {mode === 'success' ? (
            <button onClick={handleDone} className="neon-btn w-full py-3 mt-4 text-sm font-semibold">
              {t('history', language)} →
            </button>
          ) : (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full py-3 mt-4 text-sm font-semibold rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-center gap-2"
            >
              <Trash2 size={16} /> {t('deleteBill', language)}
            </button>
          )}
        </div>

        {/* Delete confirm */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDeleteConfirm(false)}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-card-strong p-6 mx-4 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-2 text-red-400">{t('deleteBill', language)}</h3>
              <p className="text-sm text-white/60 mb-6">{t('thisActionCannot', language)}</p>
              <div className="flex gap-3">
                <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 neon-btn py-2 text-sm font-semibold">{t('cancel', language)}</button>
                <button onClick={handleDelete} className="flex-1 py-2 text-sm font-semibold rounded-xl bg-red-500/20 border border-red-500/30 text-red-400">{t('delete', language)}</button>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        <InvoiceHeader goBack={goBack} title={t('eBill', language)} />
        <div className="text-center py-12 text-white/40"><FileText size={28} className="mx-auto mb-3 opacity-40" />{t('noData', language)}</div>
      </div>
    </div>
  );
}

function InvoiceHeader({ goBack, title }: { goBack: () => void; title: string }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <button onClick={goBack} className="p-2 rounded-full glass-card" aria-label="Back">
        <ArrowLeft size={20} className="text-emerald-400" />
      </button>
      <h1 className="text-lg font-bold text-emerald-400">{title}</h1>
      <div className="w-10" />
    </div>
  );
}

function TotalRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-white/50">{label}</span>
      <span className={`text-xs ${accent || 'text-white/85'}`}>{value}</span>
    </div>
  );
}
