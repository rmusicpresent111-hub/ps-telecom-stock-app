'use client';

/**
 * BillReceipt — the on-screen receipt preview, rendered in one of 5 templates
 * (src/lib/bill-templates.ts). The template is chosen from BillingSettings
 * .billTemplate (additive, sync-safe field) and can be switched right on the
 * bill screen or in Bill Settings.
 *
 *  royal-gold    — the ORIGINAL v2.25 premium receipt, moved here untouched
 *  royal-blue    — matches the WhatsApp/A4 PDF (navy + white)
 *  classic-white — white paper, black serif ink, double rule (traditional)
 *  modern-dark   — minimal mono layout with a single emerald accent
 *  thermal-58    — 1:1 preview of the real ESC/POS Bluetooth output
 *                  (src/lib/thermal-print.ts generates the same content)
 */

import { motion } from 'framer-motion';
import { Bill, BillingSettings, Language } from '@/lib/types';
import { t } from '@/lib/i18n';
import { shopInitials, formatMoney, formatDate } from '@/lib/bill-pdf';
import { BillTemplateId } from '@/lib/types';

interface Props {
  bill: Bill;
  settings: BillingSettings | null;
  language: Language;
  template: BillTemplateId;
}

export default function BillReceipt({ bill, settings, language, template }: Props) {
  switch (template) {
    case 'royal-blue':
      return <RoyalBlueReceipt bill={bill} settings={settings} language={language} />;
    case 'classic-white':
      return <ClassicWhiteReceipt bill={bill} settings={settings} language={language} />;
    case 'modern-dark':
      return <ModernDarkReceipt bill={bill} settings={settings} language={language} />;
    case 'thermal-58':
      return <ThermalReceipt bill={bill} settings={settings} language={language} />;
    case 'royal-gold':
    default:
      return <RoyalGoldReceipt bill={bill} settings={settings} language={language} />;
  }
}

type InnerProps = Omit<Props, 'template'>;

/* ================================================================ */
/* 1) ROYAL GOLD — the original receipt (unchanged design)          */
/* ================================================================ */

function RoyalGoldReceipt({ bill, settings, language }: InnerProps) {
  return (
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
            <span className="min-w-0">
              <span className="block text-xs text-white/85">{item.name}</span>
              {item.categoryName && (
                <span className="block text-[9px] font-semibold text-amber-400/80 mt-0.5">{item.categoryName}</span>
              )}
            </span>
            <span className="text-[11px] text-white/50 text-right">{item.quantity} × {formatMoney(item.unitPrice)}</span>
            <span className="text-xs font-semibold text-white/90 text-right w-16">₹{formatMoney(item.total)}</span>
          </div>
        ))}
      </div>

      {/* totals */}
      <div className="px-5 py-3 space-y-1.5">
        <GoldTotalRow label={t('subtotal', language)} value={`₹${formatMoney(bill.subtotal)}`} />
        {bill.discountAmount > 0 && (
          <GoldTotalRow label={`${t('discount', language)}${bill.discountType === 'percent' ? ` (${bill.discountValue}%)` : ''}`} value={`-₹${formatMoney(bill.discountAmount)}`} accent="text-green-400" />
        )}
        {bill.gstEnabled && bill.gstAmount > 0 && (
          <GoldTotalRow label={`${t('gst', language)} (${bill.gstRate}%)`} value={`₹${formatMoney(bill.gstAmount)}`} />
        )}
        <div className="bg-gradient-to-r from-[#EDD494] via-[#D4A853] to-[#A67C34] rounded-lg px-3 py-2.5 flex justify-between items-center mt-2 shadow-md">
          <span className="text-xs font-bold font-serif tracking-wide text-[#221a08]">{t('grandTotal', language)}</span>
          <span className="text-lg font-bold font-serif text-[#221a08]">₹{formatMoney(bill.total)}</span>
        </div>
        {bill.dueAmount > 0 && (
          <GoldTotalRow label={t('dueAmount', language)} value={`₹${formatMoney(bill.dueAmount)}`} accent="text-red-400 font-semibold" />
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
  );
}

function GoldTotalRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-white/50">{label}</span>
      <span className={`text-xs ${accent || 'text-white/85'}`}>{value}</span>
    </div>
  );
}

/* ================================================================ */
/* 2) ROYAL BLUE — mirrors the WhatsApp A4 PDF design               */
/* ================================================================ */

function RoyalBlueReceipt({ bill, settings, language }: InnerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl overflow-hidden shadow-2xl mb-4 bg-white ring-1 ring-[#1E3A8A]/30 shadow-[0_12px_60px_-20px_rgba(30,58,138,0.55)]"
    >
      {/* navy header band */}
      <div className="bg-gradient-to-b from-[#1E3A8A] to-[#17306E] px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 shrink-0 rounded-md bg-white flex items-center justify-center text-[#1E3A8A] font-bold text-xs shadow">
                {shopInitials(bill.shopSnapshot?.name || settings?.shopName || 'PS TELECOM')}
              </span>
              <p className="text-white font-bold text-lg leading-tight truncate">{bill.shopSnapshot?.name || settings?.shopName || 'PS TELECOM'}</p>
            </div>
            {bill.shopSnapshot?.address && <p className="text-[10px] text-[#DCE6F8] mt-1 whitespace-pre-line leading-snug">{bill.shopSnapshot.address}</p>}
            <p className="text-[10px] text-[#9DB4E4] mt-0.5">
              {bill.shopSnapshot?.phone && <span>Ph: {bill.shopSnapshot.phone}</span>}
              {bill.shopSnapshot?.gstNumber && <span>{bill.shopSnapshot?.phone ? '  |  ' : ''}GSTIN: {bill.shopSnapshot.gstNumber}</span>}
            </p>
          </div>
          <div className="text-right shrink-0 bg-[#17306E] border border-[#9DB4E4]/40 rounded-lg px-3 py-2">
            <p className="text-[8px] text-[#9DB4E4] font-semibold tracking-wider">{bill.gstEnabled ? 'TAX INVOICE' : 'INVOICE'}</p>
            <p className="text-xs font-bold text-white mt-0.5">{bill.billNumber}</p>
            <p className="text-[10px] text-[#DCE6F8]">{formatDate(bill.date)}</p>
          </div>
        </div>
      </div>

      {/* light-blue title strip */}
      <div className="bg-[#DCE9F9] px-5 py-1.5 flex items-center justify-between">
        <span className="text-[10px] font-bold text-[#1E3A8A] tracking-[0.14em] uppercase">{t('eBill', language)}</span>
        <span className="text-[10px] text-[#1E3A8A]/70">{t(bill.paymentMethod, language)}{bill.dueAmount > 0 ? ' • ' + t('dueAmount', language) + ' ₹' + formatMoney(bill.dueAmount) : ''}</span>
      </div>

      {/* bill-to */}
      <div className="px-5 py-3">
        <div className="rounded-lg border border-[#1E3A8A]/15 bg-[#F4F7FD] px-3.5 py-2.5">
          <p className="text-[8px] font-bold text-[#1E3A8A]/70 tracking-[0.16em]">BILL TO</p>
          <div className="flex justify-between items-center mt-0.5">
            <p className="text-sm font-bold text-[#0F1F45]">{bill.customerName || '—'}</p>
            {bill.customerMobile && <p className="text-xs text-[#0F1F45]/60">Mob: {bill.customerMobile}</p>}
          </div>
        </div>
      </div>

      {/* items grid */}
      <div className="px-5">
        <div className="grid grid-cols-[1fr_44px_72px] gap-x-3 bg-[#1E3A8A] text-white text-[9px] font-bold uppercase tracking-wide rounded-t-md px-3 py-2">
          <span>{t('item', language)}</span>
          <span className="text-right">{t('quantity', language)}</span>
          <span className="text-right">{t('revenue', language)}</span>
        </div>
        {bill.items.map((item, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_44px_72px] gap-x-3 px-3 py-2.5 border-x border-b border-[#1E3A8A]/12 bg-white">
            <span className="min-w-0">
              <span className="block text-xs text-[#0F1F45] font-medium">{item.name}</span>
              <span className="block text-[9px] text-[#0F1F45]/50 mt-0.5">@ ₹{formatMoney(item.unitPrice)}{item.categoryName ? ` • ${item.categoryName}` : ''}</span>
            </span>
            <span className="text-xs text-[#0F1F45]/70 text-right">{item.quantity}</span>
            <span className="text-xs font-bold text-[#0F1F45] text-right">₹{formatMoney(item.total)}</span>
          </div>
        ))}
      </div>

      {/* totals */}
      <div className="px-5 py-3.5 space-y-1">
        <BlueRow label={t('subtotal', language)} value={`₹${formatMoney(bill.subtotal)}`} />
        {bill.discountAmount > 0 && (
          <BlueRow label={`${t('discount', language)}${bill.discountType === 'percent' ? ` (${bill.discountValue}%)` : ''}`} value={`- ₹${formatMoney(bill.discountAmount)}`} accent="text-green-700" />
        )}
        {bill.gstEnabled && bill.gstAmount > 0 && (
          <BlueRow label={`${t('gst', language)} (${bill.gstRate}%)`} value={`₹${formatMoney(bill.gstAmount)}`} />
        )}
        <div className="bg-[#1E3A8A] rounded-md px-3.5 py-2.5 flex justify-between items-center mt-2">
          <span className="text-[11px] font-bold text-[#9DB4E4] tracking-wide uppercase">{t('grandTotal', language)}</span>
          <span className="text-lg font-bold text-white">₹{formatMoney(bill.total)}</span>
        </div>
        {bill.dueAmount > 0 && (
          <BlueRow label={t('dueAmount', language)} value={`₹${formatMoney(bill.dueAmount)}`} accent="text-red-600 font-semibold" />
        )}
        {bill.paidAmount > 0 && (
          <BlueRow label={t('paidAmount', language)} value={`₹${formatMoney(bill.paidAmount)}`} accent="text-green-700" />
        )}
      </div>

      {/* terms */}
      {settings?.termsText && (
        <div className="mx-5 mb-3 rounded-md bg-[#F4F7FD] border border-[#1E3A8A]/10 px-3.5 py-2.5">
          <p className="text-[8px] font-bold text-[#1E3A8A]/70 tracking-[0.16em] uppercase">Terms &amp; Conditions</p>
          <p className="text-[9px] text-[#0F1F45]/70 whitespace-pre-line leading-relaxed mt-1">{settings.termsText}</p>
        </div>
      )}

      {/* qr + signature */}
      <div className="px-5 pb-4 flex items-end justify-between">
        {settings?.qrCodeDataUrl ? (
          <div>
            <img src={settings.qrCodeDataUrl} alt="Payment QR" className="w-16 h-16 object-contain bg-white rounded-md ring-1 ring-[#1E3A8A]/25 p-0.5" />
            {settings.upiId && <p className="text-[8px] text-[#0F1F45]/50 mt-1">{settings.upiId}</p>}
          </div>
        ) : <span />}
        <div className="text-right">
          {settings?.signatureDataUrl && <img src={settings.signatureDataUrl} alt="Signature" className="h-8 object-contain ml-auto mb-0.5" />}
          <p className="text-[9px] text-[#0F1F45]/60 border-t border-[#1E3A8A]/30 pt-1">For {bill.shopSnapshot?.name || 'PS TELECOM'}</p>
          {(bill.shopSnapshot?.proprietorName ?? settings?.proprietorName) && (
            <p className="text-[11px] font-bold text-[#0F1F45] mt-0.5">{bill.shopSnapshot?.proprietorName ?? settings?.proprietorName}</p>
          )}
        </div>
      </div>

      <div className="bg-[#1E3A8A] py-2 text-center">
        <p className="text-[10px] text-[#DCE9F9]">{settings?.thankYouNote || 'Thank you for your business!'}</p>
      </div>
    </motion.div>
  );
}

function BlueRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex justify-between items-center px-0.5">
      <span className="text-xs text-[#0F1F45]/60">{label}</span>
      <span className={`text-xs font-medium ${accent || 'text-[#0F1F45]'}`}>{value}</span>
    </div>
  );
}

/* ================================================================ */
/* 3) CLASSIC WHITE — traditional black-on-white paper bill          */
/* ================================================================ */

function ClassicWhiteReceipt({ bill, settings, language }: InnerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl overflow-hidden shadow-2xl mb-4 bg-white ring-1 ring-black/15 shadow-[0_14px_50px_-18px_rgba(0,0,0,0.5)]"
    >
      <div className="p-1.5 bg-white">
        <div className="border-2 border-[#1c1c1c] p-1">
          <div className="border border-[#1c1c1c]/70 px-4 pt-4 pb-4">
            {/* header */}
            <div className="text-center">
              <p className="font-serif text-xl font-bold tracking-[0.12em] text-[#1c1c1c] uppercase">{bill.shopSnapshot?.name || settings?.shopName || 'PS TELECOM'}</p>
              {bill.shopSnapshot?.address && <p className="text-[10px] text-[#1c1c1c]/75 mt-1 whitespace-pre-line leading-snug">{bill.shopSnapshot.address}</p>}
              <p className="text-[10px] text-[#1c1c1c]/75 mt-0.5">
                {bill.shopSnapshot?.phone && <span>Ph: {bill.shopSnapshot.phone}</span>}
                {bill.shopSnapshot?.gstNumber && <span>{bill.shopSnapshot?.phone ? ' • ' : ''}GSTIN: {bill.shopSnapshot.gstNumber}</span>}
              </p>
              <div className="flex items-center justify-center gap-3 mt-2.5">
                <span className="h-px flex-1 bg-[#1c1c1c]/50" />
                <p className="text-[11px] font-bold tracking-[0.22em] text-[#1c1c1c] uppercase border border-[#1c1c1c] px-3 py-0.5">{bill.gstEnabled ? 'Tax Invoice' : 'Invoice'}</p>
                <span className="h-px flex-1 bg-[#1c1c1c]/50" />
              </div>
            </div>

            {/* meta */}
            <div className="flex justify-between text-[11px] text-[#1c1c1c] mt-3.5 pb-2 border-b border-[#1c1c1c]">
              <span>Bill No: <b>{bill.billNumber}</b></span>
              <span>Date: <b>{formatDate(bill.date)}</b></span>
            </div>
            <div className="flex justify-between text-[11px] text-[#1c1c1c] py-2 border-b border-[#1c1c1c]">
              <span>Customer: <b>{bill.customerName || '—'}</b></span>
              {bill.customerMobile && <span>Mob: {bill.customerMobile}</span>}
            </div>

            {/* items */}
            <table className="w-full text-[11px] text-[#1c1c1c] border-collapse mt-0">
              <thead>
                <tr className="border-b border-[#1c1c1c]">
                  <th className="text-left py-1.5 font-bold w-6">#</th>
                  <th className="text-left py-1.5 font-bold">{t('item', language)}</th>
                  <th className="text-right py-1.5 font-bold w-14">{t('quantity', language)}</th>
                  <th className="text-right py-1.5 font-bold w-16">Rate</th>
                  <th className="text-right py-1.5 font-bold w-20">{t('revenue', language)}</th>
                </tr>
              </thead>
              <tbody>
                {bill.items.map((item, idx) => (
                  <tr key={idx} className="border-b border-dotted border-[#1c1c1c]/40">
                    <td className="py-1.5 text-[#1c1c1c]/60">{idx + 1}.</td>
                    <td className="py-1.5">
                      {item.name}
                      {item.serialNumbers && item.serialNumbers.length > 0 && (
                        <span className="block text-[9px] text-[#1c1c1c]/55">SN: {item.serialNumbers.join(', ')}</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right">{item.quantity}</td>
                    <td className="py-1.5 text-right">₹{formatMoney(item.unitPrice)}</td>
                    <td className="py-1.5 text-right font-semibold">₹{formatMoney(item.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* totals */}
            <div className="mt-3 space-y-1 text-[11px] text-[#1c1c1c]">
              <ClassicalRow label={t('subtotal', language)} value={`₹${formatMoney(bill.subtotal)}`} />
              {bill.discountAmount > 0 && (
                <ClassicalRow label={`${t('discount', language)}${bill.discountType === 'percent' ? ` (${bill.discountValue}%)` : ''}`} value={`- ₹${formatMoney(bill.discountAmount)}`} />
              )}
              {bill.gstEnabled && bill.gstAmount > 0 && (
                <ClassicalRow label={`${t('gst', language)} (${bill.gstRate}%)`} value={`₹${formatMoney(bill.gstAmount)}`} />
              )}
              <div className="flex justify-between items-center border-y-2 border-[#1c1c1c] py-2 mt-2">
                <span className="text-xs font-bold tracking-[0.14em] uppercase">{t('grandTotal', language)}</span>
                <span className="text-lg font-bold">₹{formatMoney(bill.total)}</span>
              </div>
              {bill.paidAmount > 0 && <ClassicalRow label={t('paidAmount', language)} value={`₹${formatMoney(bill.paidAmount)}`} />}
              {bill.dueAmount > 0 && <ClassicalRow label={t('dueAmount', language)} value={`₹${formatMoney(bill.dueAmount)}`} bold />}
              <div className="flex justify-between pt-1 text-[#1c1c1c]/75">
                <span>{t('paymentMethod', language)}</span>
                <span>{t(bill.paymentMethod, language)}</span>
              </div>
              {bill.note && <p className="text-[10px] italic text-[#1c1c1c]/70 pt-1">{t('note', language)}: {bill.note}</p>}
            </div>

            {/* signature */}
            <div className="flex justify-between items-end mt-6 pt-1">
              <div className="text-[9px] text-[#1c1c1c]/60 max-w-[55%]">
                {settings?.termsText && <p className="whitespace-pre-line leading-relaxed">{settings.termsText}</p>}
              </div>
              <div className="text-right">
                {settings?.signatureDataUrl && <img src={settings.signatureDataUrl} alt="Signature" className="h-8 object-contain ml-auto mb-0.5" />}
                <p className="text-[10px] text-[#1c1c1c] border-t border-[#1c1c1c] pt-1 min-w-[120px]">Authorised Signatory</p>
              </div>
            </div>

            <p className="text-center text-[10px] italic text-[#1c1c1c]/70 mt-4 pt-2 border-t border-[#1c1c1c]/30">{settings?.thankYouNote || 'Thank you for your business!'}</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ClassicalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-[#1c1c1c]/75">{label}</span>
      <span className={bold ? 'font-bold text-red-700' : ''}>{value}</span>
    </div>
  );
}

/* ================================================================ */
/* 4) MODERN DARK — minimal mono receipt with emerald accent        */
/* ================================================================ */

function ModernDarkReceipt({ bill, settings, language }: InnerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl overflow-hidden shadow-2xl mb-4 bg-[#0b0f14] ring-1 ring-emerald-500/20 shadow-[0_12px_50px_-18px_rgba(16,185,129,0.35)]"
    >
      <div className="h-1 bg-emerald-400" />
      <div className="px-5 pt-5 pb-4">
        {/* header */}
        <div className="flex justify-between items-start">
          <div className="min-w-0">
            <p className="font-mono text-base font-bold text-white/95 tracking-widest uppercase truncate">{bill.shopSnapshot?.name || settings?.shopName || 'PS TELECOM'}</p>
            {bill.shopSnapshot?.address && <p className="font-mono text-[9px] text-white/40 mt-1 whitespace-pre-line leading-relaxed">{bill.shopSnapshot.address}</p>}
            <p className="font-mono text-[9px] text-white/40 mt-0.5">
              {bill.shopSnapshot?.phone && <span>{bill.shopSnapshot.phone}</span>}
              {bill.shopSnapshot?.gstNumber && <span>{bill.shopSnapshot?.phone ? ' · ' : ''}GST {bill.shopSnapshot.gstNumber}</span>}
            </p>
          </div>
          <span className="shrink-0 font-mono text-[8px] tracking-[0.2em] text-emerald-300 border border-emerald-400/30 rounded px-1.5 py-0.5 uppercase">{bill.gstEnabled ? 'TAX INV' : 'INV'}</span>
        </div>

        {/* meta strip */}
        <div className="grid grid-cols-3 gap-2 mt-4 py-2.5 border-y border-white/10 font-mono text-[9px]">
          <div>
            <p className="text-white/35 uppercase tracking-wider">No.</p>
            <p className="text-white/85 mt-0.5">{bill.billNumber}</p>
          </div>
          <div>
            <p className="text-white/35 uppercase tracking-wider">Date</p>
            <p className="text-white/85 mt-0.5">{formatDate(bill.date)}</p>
          </div>
          <div>
            <p className="text-white/35 uppercase tracking-wider">{t('paymentMethod', language)}</p>
            <p className="text-white/85 mt-0.5">{t(bill.paymentMethod, language)}</p>
          </div>
        </div>

        {/* customer */}
        <div className="mt-3.5">
          <p className="font-mono text-[8px] text-white/30 uppercase tracking-[0.18em]">Billed to</p>
          <div className="flex justify-between items-baseline mt-0.5">
            <p className="font-mono text-sm text-white/90">{bill.customerName || '—'}</p>
            {bill.customerMobile && <p className="font-mono text-[10px] text-white/45">{bill.customerMobile}</p>}
          </div>
        </div>

        {/* items */}
        <div className="mt-4 space-y-3">
          {bill.items.map((item, idx) => (
            <div key={idx}>
              <div className="flex justify-between items-baseline gap-2">
                <p className="font-mono text-xs text-white/85 truncate">{item.name}</p>
                <p className="font-mono text-xs text-white/90 shrink-0">₹{formatMoney(item.total)}</p>
              </div>
              <div className="flex justify-between font-mono text-[9px] text-white/35 mt-0.5">
                <span>{item.categoryName || ' '}</span>
                <span>{item.quantity} × ₹{formatMoney(item.unitPrice)}</span>
              </div>
            </div>
          ))}
        </div>

        {/* totals */}
        <div className="mt-4 pt-3 border-t border-white/10 space-y-1.5 font-mono">
          <DarkRow label={t('subtotal', language)} value={`₹${formatMoney(bill.subtotal)}`} />
          {bill.discountAmount > 0 && (
            <DarkRow label={`${t('discount', language)}${bill.discountType === 'percent' ? ` (${bill.discountValue}%)` : ''}`} value={`-₹${formatMoney(bill.discountAmount)}`} accent="text-emerald-300" />
          )}
          {bill.gstEnabled && bill.gstAmount > 0 && (
            <DarkRow label={`${t('gst', language)} ${bill.gstRate}%`} value={`₹${formatMoney(bill.gstAmount)}`} />
          )}
          <div className="flex justify-between items-baseline pt-2">
            <span className="font-mono text-[10px] text-white/50 uppercase tracking-[0.18em]">{t('grandTotal', language)}</span>
            <span className="font-mono text-2xl font-bold text-emerald-300">₹{formatMoney(bill.total)}</span>
          </div>
          {bill.paidAmount > 0 && <DarkRow label={t('paidAmount', language)} value={`₹${formatMoney(bill.paidAmount)}`} accent="text-white/80" />}
          {bill.dueAmount > 0 && <DarkRow label={t('dueAmount', language)} value={`₹${formatMoney(bill.dueAmount)}`} accent="text-red-400" />}
        </div>

        {bill.note && <p className="font-mono text-[9px] text-white/35 mt-3">{t('note', language)}: {bill.note}</p>}

        {/* footer */}
        <div className="flex justify-between items-end mt-6">
          {settings?.qrCodeDataUrl ? (
            <img src={settings.qrCodeDataUrl} alt="Payment QR" className="w-14 h-14 object-contain bg-white rounded p-0.5" />
          ) : <span />}
          <div className="text-right font-mono">
            {settings?.signatureDataUrl && <img src={settings.signatureDataUrl} alt="Signature" className="h-7 object-contain ml-auto mb-1 opacity-90" />}
            <p className="text-[9px] text-white/40">{bill.shopSnapshot?.proprietorName ?? settings?.proprietorName}</p>
          </div>
        </div>
        <p className="font-mono text-center text-[9px] text-white/35 mt-4 pt-3 border-t border-white/5">{settings?.thankYouNote || 'Thank you for your business!'}</p>
      </div>
    </motion.div>
  );
}

function DarkRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[10px] text-white/40 uppercase tracking-wider">{label}</span>
      <span className={`text-[11px] ${accent || 'text-white/75'}`}>{value}</span>
    </div>
  );
}

/* ================================================================ */
/* 5) THERMAL — 1:1 preview of the ESC/POS Bluetooth output         */
/* ================================================================ */

function ThermalReceipt({ bill, settings }: InnerProps) {
  // Mirror the ESC/POS twoCol layout: if "CUST: <name>" + mobile no longer fit
  // on one 32-column line, the real printer stacks the mobile right-aligned on
  // the next line — so the preview does exactly that instead of clipping.
  const custLabel = `CUST: ${bill.customerName || '-'}`;
  const custMobile = bill.customerMobile || '';
  const custMobileFits = custMobile.length > 0 && custLabel.length + custMobile.length <= 32;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl overflow-hidden shadow-2xl mb-4 bg-white ring-1 ring-black/10 shadow-[0_12px_46px_-16px_rgba(0,0,0,0.45)]"
    >
      {/* zig-zag tear top */}
      <div
        className="h-2.5 bg-white"
        style={{
          backgroundImage: 'linear-gradient(135deg, transparent 50%, rgba(0,0,0,0.08) 50%), linear-gradient(-135deg, transparent 50%, rgba(0,0,0,0.08) 50%)',
          backgroundSize: '10px 10px',
          backgroundRepeat: 'repeat-x',
        }}
      />
      <div className="px-4 py-3 font-mono text-[11px] leading-[1.5] text-black max-w-[320px]">
        {/* shop header */}
        <p className="text-center font-bold text-[13px] tracking-wide uppercase">{bill.shopSnapshot?.name || settings?.shopName || 'PS TELECOM'}</p>
        {bill.shopSnapshot?.address && <p className="text-center whitespace-pre-line">{bill.shopSnapshot.address}</p>}
        {bill.shopSnapshot?.phone && <p className="text-center">Ph: {bill.shopSnapshot.phone}</p>}
        {bill.shopSnapshot?.gstNumber && <p className="text-center">GSTIN: {bill.shopSnapshot.gstNumber}</p>}
        <ThermalDash />

        {/* meta */}
        <div className="flex justify-between"><span>BILL: {bill.billNumber}</span><span>{thermalDate(bill.date)}</span></div>
        <div className="flex justify-between"><span>{thermalClip(custLabel, 32)}</span>{custMobileFits && <span>{custMobile}</span>}</div>
        {!custMobileFits && custMobile && <div className="text-right">{custMobile}</div>}
        <ThermalDash />

        {/* items */}
        {bill.items.map((item, idx) => (
          <div key={idx} className="mb-1.5">
            <p className="font-semibold">{item.name}{item.categoryName ? ` (${item.categoryName})` : ''}</p>
            <div className="flex justify-between">
              <span>{item.quantity} x {formatMoney(item.unitPrice)}</span>
              <span className="font-semibold">{formatMoney(item.total)}</span>
            </div>
          </div>
        ))}
        <ThermalDash />

        {/* totals */}
        <div className="flex justify-between"><span>SUBTOTAL</span><span>{formatMoney(bill.subtotal)}</span></div>
        {bill.discountAmount > 0 && (
          <div className="flex justify-between"><span>DISCOUNT{bill.discountType === 'percent' ? ` (${bill.discountValue}%)` : ''}</span><span>-{formatMoney(bill.discountAmount)}</span></div>
        )}
        {bill.gstEnabled && bill.gstAmount > 0 && (
          <div className="flex justify-between"><span>GST {bill.gstRate}%</span><span>{formatMoney(bill.gstAmount)}</span></div>
        )}
        <div className="flex justify-between text-[14px] font-bold mt-0.5"><span>TOTAL</span><span>Rs.{formatMoney(bill.total)}</span></div>
        {bill.paidAmount > 0 && <div className="flex justify-between"><span>PAID ({bill.paymentMethod.toUpperCase()})</span><span>{formatMoney(bill.paidAmount)}</span></div>}
        {bill.dueAmount > 0 && <div className="flex justify-between font-bold"><span>DUE</span><span>Rs.{formatMoney(bill.dueAmount)}</span></div>}
        <ThermalDash />

        {/* footer */}
        {settings?.upiId && <p className="text-center">UPI: {settings.upiId}</p>}
        {bill.note && <p className="text-center">Note: {bill.note}</p>}
        <p className="text-center mt-1">{settings?.thankYouNote || 'Thank you for your business!'}</p>
        <p className="text-center tracking-[0.4em] mt-1.5">* * *</p>
      </div>
      {/* zig-zag tear bottom */}
      <div
        className="h-2.5 bg-white"
        style={{
          backgroundImage: 'linear-gradient(45deg, transparent 50%, rgba(0,0,0,0.08) 50%), linear-gradient(-45deg, transparent 50%, rgba(0,0,0,0.08) 50%)',
          backgroundSize: '10px 10px',
          backgroundRepeat: 'repeat-x',
        }}
      />
    </motion.div>
  );
}

function ThermalDash() {
  return <div className="my-1.5 border-t border-dashed border-black/60" />;
}

/** Mirrors the ESC/POS sanitiser + twoCol clipper: ASCII-safe 32-column line. */
function thermalClip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/** Mirrors the ESC/POS billDate — DD-MM-YYYY. */
function thermalDate(date: string): string {
  const [y, m, d] = date.split('-');
  return d && m && y ? `${d}-${m}-${y}` : date;
}
