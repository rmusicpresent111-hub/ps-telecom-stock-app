/**
 * Bill PDF generation (jsPDF) + sharing helpers.
 *
 * The e-bill is generated 100% on-device. Sharing strategy:
 *  1. Web Share API with the actual PDF file → user picks WhatsApp + contact (mobile).
 *  2. Fallback: download the PDF + open wa.me chat with a formatted bill summary,
 *     so the user just attaches the downloaded file.
 */

import { jsPDF } from 'jspdf';
import { Bill } from './types';

const GOLD: [number, number, number] = [212, 168, 83];
const DARK: [number, number, number] = [24, 28, 40];
const GREEN: [number, number, number] = [16, 140, 90];
const RED: [number, number, number] = [220, 60, 60];
const GRAY: [number, number, number] = [110, 116, 130];

// ============ HELPERS ============

export function formatMoney(n: number): string {
  const num = Number(n) || 0;
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Normalize a mobile number for wa.me: digits only, ensure country code.
 * 10-digit Indian numbers get 91 prefixed.
 */
export function normalizeMobile(mobile: string): string {
  let digits = (mobile || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits;
}

/** Indian-format number to words, e.g. 1250.50 → "One Thousand Two Hundred Fifty Rupees and 50 Paise" */
export function amountInWords(amount: number): string {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  const rupeeWords = rupees === 0 ? 'Zero' : numberToWordsIndian(rupees);
  let out = `${rupeeWords} Rupees`;
  if (paise > 0) out += ` and ${numberToWordsIndian(paise)} Paise`;
  return `${out} Only`;
}

function numberToWordsIndian(n: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const twoDigits = (num: number): string => {
    if (num < 20) return ones[num];
    return `${tens[Math.floor(num / 10)]}${num % 10 ? ` ${ones[num % 10]}` : ''}`;
  };
  const threeDigits = (num: number): string => {
    const hundreds = Math.floor(num / 100);
    const rest = num % 100;
    return `${hundreds ? `${ones[hundreds]} Hundred${rest ? ' ' : ''}` : ''}${rest ? twoDigits(rest) : ''}`;
  };

  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${numberToWordsIndian(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  return parts.join(' ');
}

// ============ PDF ============

export interface GeneratedPdf {
  blob: Blob;
  fileName: string;
}

/**
 * Draws a beautiful A5 invoice PDF for the bill.
 * shopName/address/phone come from the bill's shopSnapshot (frozen at bill time).
 * signature/qr data URLs come from current billing settings.
 */
export async function generateBillPdf(
  bill: Bill,
  images: { signatureDataUrl?: string; qrCodeDataUrl?: string; upiId?: string; thankYouNote?: string; termsText?: string }
): Promise<GeneratedPdf> {
  const doc = new jsPDF({ unit: 'pt', format: 'a5', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();   // 419.5 pt
  const H = doc.internal.pageSize.getHeight();  // 595.3 pt
  const M = 28; // margin

  const shop = bill.shopSnapshot || { name: 'PS TELECOM', address: '', phone: '', gstNumber: '' };

  // ---- Header band ----
  doc.setFillColor(...DARK);
  doc.rect(0, 0, W, 86, 'F');
  doc.setFillColor(...GOLD);
  doc.rect(0, 86, W, 3, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(shop.name || 'PS TELECOM', M, 36);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(220, 220, 228);
  let headerY = 50;
  if (shop.address) {
    const addressLines = doc.splitTextToSize(shop.address, W - M * 2 - 110);
    doc.text(addressLines, M, headerY);
    headerY += addressLines.length * 11;
  }
  const contactBits: string[] = [];
  if (shop.phone) contactBits.push(`Phone: ${shop.phone}`);
  if (shop.gstNumber) contactBits.push(`GSTIN: ${shop.gstNumber}`);
  if (contactBits.length) {
    doc.text(contactBits.join('  |  '), M, headerY);
  }

  // TAX INVOICE label box
  doc.setFillColor(...GOLD);
  doc.roundedRect(W - M - 74, 22, 74, 20, 4, 4, 'F');
  doc.setTextColor(...DARK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(bill.gstEnabled ? 'TAX INVOICE' : 'INVOICE', W - M - 37, 35, { align: 'center' });

  // Bill meta (right column)
  doc.setTextColor(230, 230, 238);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Bill No: ${bill.billNumber}`, W - M, 56, { align: 'right' });
  doc.text(`Date: ${formatDate(bill.date)}`, W - M, 68, { align: 'right' });

  // ---- Bill To ----
  let y = 112;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.8);
  doc.roundedRect(M, y - 14, W - M * 2, 44, 6, 6, 'S');
  doc.setTextColor(...GRAY);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.text('BILL TO', M + 12, y - 1);
  doc.setTextColor(...DARK);
  doc.setFontSize(11);
  doc.text(bill.customerName || 'Walk-in Customer', M + 12, y + 13);
  if (bill.customerMobile) {
    doc.setFontSize(9);
    doc.setTextColor(80, 84, 96);
    doc.text(`Mob: ${bill.customerMobile}`, W - M - 12, y + 13, { align: 'right' });
  }

  y += 48;

  // ---- Items table ----
  const colItem = M + 10;
  const colQty = W * 0.52;
  const colRate = W * 0.66;
  const colAmount = W - M - 12;
  const tableTop = y;

  // table header
  doc.setFillColor(...DARK);
  doc.rect(M, tableTop, W - M * 2, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text('ITEM', colItem, tableTop + 15);
  doc.text('QTY', colQty, tableTop + 15, { align: 'center' });
  doc.text('RATE', colRate, tableTop + 15, { align: 'right' });
  doc.text('AMOUNT', colAmount, tableTop + 15, { align: 'right' });

  let rowY = tableTop + 22;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...DARK);
  for (const item of bill.items) {
    const nameLines = doc.splitTextToSize(item.name, colQty - colItem - 14) as string[];
    const rowHeight = Math.max(24, nameLines.length * 11 + 10);

    // zebra stripe
    if ((bill.items.indexOf(item)) % 2 === 1) {
      doc.setFillColor(248, 246, 240);
      doc.rect(M, rowY, W - M * 2, rowHeight, 'F');
    }

    doc.setFontSize(9.5);
    doc.text(nameLines, colItem, rowY + 15);
    doc.text(String(item.quantity), colQty, rowY + 15, { align: 'center' });
    doc.text(`Rs. ${formatMoney(item.unitPrice)}`, colRate, rowY + 15, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(`Rs. ${formatMoney(item.total)}`, colAmount, rowY + 15, { align: 'right' });
    doc.setFont('helvetica', 'normal');

    rowY += rowHeight;
    doc.setDrawColor(228, 224, 214);
    doc.setLineWidth(0.5);
    doc.line(M, rowY, W - M, rowY);
  }

  // ---- Totals ----
  y = rowY + 14;
  const totalsX = W * 0.5;
  const totalsLabelX = totalsX + 12;
  const totalsValueX = W - M - 12;
  const line = (label: string, value: string, opts?: { bold?: boolean; color?: [number, number, number] }) => {
    doc.setFont('helvetica', opts?.bold ? 'bold' : 'normal');
    doc.setFontSize(opts?.bold ? 10.5 : 9);
    if (opts?.color) doc.setTextColor(...opts.color); else doc.setTextColor(70, 74, 86);
    doc.text(label, totalsLabelX, y);
    doc.text(value, totalsValueX, y, { align: 'right' });
    y += opts?.bold ? 18 : 15;
  };

  line('Subtotal', `Rs. ${formatMoney(bill.subtotal)}`);
  if (bill.discountAmount > 0) {
    const pct = bill.discountType === 'percent' ? ` (${bill.discountValue}%)` : '';
    line(`Discount${pct}`, `- Rs. ${formatMoney(bill.discountAmount)}`, { color: GREEN });
  }
  if (bill.gstEnabled && bill.gstAmount > 0) {
    line(`GST (${bill.gstRate}%)`, `Rs. ${formatMoney(bill.gstAmount)}`);
  }

  // Grand total band
  y += 2;
  doc.setFillColor(...GOLD);
  doc.roundedRect(totalsX, y - 3, W - M - totalsX, 26, 5, 5, 'F');
  doc.setTextColor(...DARK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('GRAND TOTAL', totalsLabelX, y + 14);
  doc.setFontSize(12.5);
  doc.text(`Rs. ${formatMoney(bill.total)}`, totalsValueX, y + 14, { align: 'right' });
  y += 34;

  if (bill.paidAmount > 0 || bill.dueAmount > 0) {
    line('Paid', `Rs. ${formatMoney(bill.paidAmount)}`, { color: GREEN });
    if (bill.dueAmount > 0) {
      line('Balance Due', `Rs. ${formatMoney(bill.dueAmount)}`, { color: RED, bold: true });
    }
  }
  const pmLabel: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', due: 'Due (Credit)' };
  line('Payment Method', pmLabel[bill.paymentMethod] || bill.paymentMethod);

  // Amount in words (left column, next to totals)
  const wordsY = tableTop + 22 + Math.max(bill.items.length * 26, 30) + 12;
  doc.setFont('helvetica', 'bolditalic');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  const wordsLines = doc.splitTextToSize(`In Words: ${amountInWords(bill.total)}`, W * 0.46) as string[];
  doc.text(wordsLines, M + 2, Math.min(wordsY, rowY + 24));

  if (bill.note) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(90, 94, 106);
    const noteLines = doc.splitTextToSize(`Note: ${bill.note}`, W - M * 2) as string[];
    doc.text(noteLines, M, y + 6);
    y += noteLines.length * 11 + 8;
  }

  // ---- QR + Signature row (pinned near bottom) ----
  const bottomZone = H - 96;
  if (y < bottomZone - 8) y = bottomZone;

  if (images.qrCodeDataUrl) {
    try {
      const qrSize = 62;
      doc.addImage(images.qrCodeDataUrl, 'PNG', M, y, qrSize, qrSize);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...GRAY);
      doc.text(images.upiId ? `Scan to pay  |  UPI: ${images.upiId}` : 'Scan to pay', M + qrSize / 2, y + qrSize + 10, { align: 'center' });
    } catch {
      // invalid image data — skip QR silently
    }
  }

  if (images.signatureDataUrl) {
    try {
      doc.addImage(images.signatureDataUrl, 'PNG', W - M - 90, y - 12, 90, 34);
    } catch {
      // invalid image data — skip signature silently
    }
  }
  doc.setDrawColor(140, 144, 156);
  doc.setLineWidth(0.6);
  doc.line(W - M - 100, y + 28, W - M, y + 28);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text(`For ${shop.name || 'PS TELECOM'}`, W - M, y + 39, { align: 'right' });

  // ---- Thank you + footer ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...DARK);
  const thanks = images.thankYouNote || 'Thank you for your business!';
  doc.text(thanks, W / 2, H - 34, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(150, 154, 166);
  let footer = `Generated on ${new Date().toLocaleString('en-GB')} — PS TELECOM App`;
  if (images.termsText) {
    footer = `${images.termsText}  |  ${footer}`;
  }
  doc.text(doc.splitTextToSize(footer, W - M * 2) as string[], W / 2, H - 20, { align: 'center' });

  const blob = doc.output('blob');
  const fileName = `${(bill.shopSnapshot?.name || 'bill').replace(/[^a-zA-Z0-9]+/g, '-')}-${bill.billNumber}.pdf`;
  return { blob, fileName };
}

// ============ SHARE ============

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Try the native share sheet with the PDF file (mobile → WhatsApp etc.).
 * Returns true when sharing was actually handed to the OS.
 */
export async function sharePdfFile(blob: Blob, fileName: string, text: string): Promise<boolean> {
  const file = new File([blob], fileName, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: fileName, text });
      return true;
    } catch (err) {
      // user cancelled — treat as handled, not an error
      if ((err as Error)?.name === 'AbortError') return true;
      return false;
    }
  }
  return false;
}

/** Build the WhatsApp text summary for a bill. */
export function buildBillMessage(bill: Bill): string {
  const shop = bill.shopSnapshot || { name: 'PS TELECOM', address: '', phone: '', gstNumber: '' };
  const lines: string[] = [];
  lines.push(`*${shop.name || 'PS TELECOM'}*`);
  lines.push(`Bill No: ${bill.billNumber}`);
  lines.push(`Date: ${formatDate(bill.date)}`);
  lines.push('------------------------------');
  lines.push(`Customer: ${bill.customerName || 'Walk-in Customer'}`);
  for (const item of bill.items) {
    lines.push(`${item.name} x${item.quantity} = Rs. ${formatMoney(item.total)}`);
  }
  if (bill.discountAmount > 0) lines.push(`Discount: -Rs. ${formatMoney(bill.discountAmount)}`);
  if (bill.gstEnabled && bill.gstAmount > 0) lines.push(`GST (${bill.gstRate}%): Rs. ${formatMoney(bill.gstAmount)}`);
  lines.push(`*TOTAL: Rs. ${formatMoney(bill.total)}*`);
  if (bill.dueAmount > 0) lines.push(`Balance Due: Rs. ${formatMoney(bill.dueAmount)}`);
  const pmLabel: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', due: 'Due' };
  lines.push(`Payment: ${pmLabel[bill.paymentMethod] || bill.paymentMethod}`);
  lines.push('------------------------------');
  lines.push('Thank you for shopping with us!');
  return lines.join('\n');
}

/** wa.me deep link that opens the customer's chat with the bill summary pre-filled. */
export function whatsappUrl(mobile: string, message: string): string {
  const normalized = normalizeMobile(mobile);
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

/**
 * One-tap WhatsApp flow:
 *  1. downloads the PDF (so the user can attach it), then
 *  2. opens the customer's WhatsApp chat with the bill summary.
 */
export async function sendBillViaWhatsapp(bill: Bill, pdf: GeneratedPdf, images: Parameters<typeof generateBillPdf>[1]): Promise<void> {
  downloadBlob(pdf.blob, pdf.fileName);
  const url = whatsappUrl(bill.customerMobile, buildBillMessage(bill));
  window.open(url, '_blank');
}
