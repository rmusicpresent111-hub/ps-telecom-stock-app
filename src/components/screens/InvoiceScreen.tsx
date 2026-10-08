'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import {
  getBillingSettingsOffline, createBillOffline, getBillByIdOffline, deleteBillOffline,
} from '@/lib/offline-service';
import {
  generateBillPdf, downloadBlob, sharePdfFile, buildBillMessage, whatsappUrl,
  formatMoney, formatDate, type GeneratedPdf,
} from '@/lib/bill-pdf';
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
            goBack();
          }
          setSelectedBillId(null);
        } else if (pendingBillData) {
          setMode('create');
        } else {
          // nothing to show — leave
          goBack();
        }
      } catch {
        if (!cancelled) goBack();
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
      });
    } catch (error) {
      toast.error((error as Error).message || t('error', language));
      return null;
    } finally {
      setGenerating(false);
    }
  }, [settings, language]);

  const handleWhatsApp = useCallback(async (targetBill: Bill) => {
    const pdf = await makePdf(targetBill);
    if (!pdf) return;
    downloadBlob(pdf.blob, pdf.fileName);
    if (targetBill.customerMobile) {
      window.open(whatsappUrl(targetBill.customerMobile, buildBillMessage(targetBill)), '_blank');
      toast.success(t('shareWhatsappHint', language));
    } else {
      toast.error(t('customerPhone', language) + ' ' + t('error', language));
    }
  }, [makePdf, language]);

  const handleShare = useCallback(async (targetBill: Bill) => {
    const pdf = await makePdf(targetBill);
    if (!pdf) return;
    const shared = await sharePdfFile(pdf.blob, pdf.fileName, buildBillMessage(targetBill));
    if (!shared) {
      downloadBlob(pdf.blob, pdf.fileName);
      if (targetBill.customerMobile) {
        window.open(whatsappUrl(targetBill.customerMobile, buildBillMessage(targetBill)), '_blank');
        toast.success(t('shareWhatsappHint', language));
      } else {
        toast.success(t('downloadPdf', language));
      }
    }
  }, [makePdf, language]);

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

          {/* Receipt-style preview */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl overflow-hidden shadow-2xl mb-4 bg-[#12151f] border border-[#D4A853]/30"
          >
            {/* header */}
            <div className="bg-[#181c28] px-5 py-4 border-b-2 border-[#D4A853]">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-lg font-bold text-white">{bill.shopSnapshot?.name || settings?.shopName || 'PS TELECOM'}</p>
                  {bill.shopSnapshot?.address && <p className="text-[10px] text-white/50 mt-0.5 whitespace-pre-line">{bill.shopSnapshot.address}</p>}
                  <div className="flex gap-2 mt-0.5 text-[10px] text-white/50">
                    {bill.shopSnapshot?.phone && <span>Ph: {bill.shopSnapshot.phone}</span>}
                    {bill.shopSnapshot?.gstNumber && <span>GSTIN: {bill.shopSnapshot.gstNumber}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[9px] font-bold bg-[#D4A853] text-black px-2 py-0.5 rounded">{bill.gstEnabled ? 'TAX INVOICE' : 'INVOICE'}</span>
                  <p className="text-[10px] text-white/60 mt-1.5">{bill.billNumber}</p>
                  <p className="text-[10px] text-white/60">{formatDate(bill.date)}</p>
                </div>
              </div>
            </div>

            {/* customer */}
            <div className="px-5 py-3 border-b border-white/10">
              <p className="text-[9px] text-white/40 font-semibold tracking-wide">BILL TO</p>
              <div className="flex justify-between items-center mt-0.5">
                <p className="text-sm font-semibold text-white/90">{bill.customerName}</p>
                {bill.customerMobile && <p className="text-xs text-white/60">Mob: {bill.customerMobile}</p>}
              </div>
            </div>

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
              <div className="bg-[#D4A853]/15 border border-[#D4A853]/40 rounded-lg px-3 py-2 flex justify-between items-center mt-2">
                <span className="text-xs font-bold text-[#D4A853]">{t('grandTotal', language)}</span>
                <span className="text-lg font-bold text-[#D4A853]">₹{formatMoney(bill.total)}</span>
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

            {/* qr + thanks */}
            <div className="px-5 pb-4 pt-1 flex items-end justify-between">
              {settings?.qrCodeDataUrl ? (
                <div className="text-center">
                  { }
                  <img src={settings.qrCodeDataUrl} alt="Payment QR" className="w-16 h-16 object-contain bg-white rounded-lg p-0.5" />
                  {settings.upiId && <p className="text-[8px] text-white/40 mt-1">{settings.upiId}</p>}
                </div>
              ) : <span />}
              <div className="text-right">
                {settings?.signatureDataUrl && (
                   
                  <img src={settings.signatureDataUrl} alt="Signature" className="h-8 object-contain ml-auto mb-0.5" />
                )}
                <p className="text-[9px] text-white/50 border-t border-white/20 pt-1">For {bill.shopSnapshot?.name || 'PS TELECOM'}</p>
              </div>
            </div>
            <p className="text-center text-[10px] text-white/60 pb-3 font-medium">{settings?.thankYouNote || 'Thank you for your business!'}</p>
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDeleteConfirm(false)}>
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
