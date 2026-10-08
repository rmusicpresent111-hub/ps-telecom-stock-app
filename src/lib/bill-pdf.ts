/**
 * Bill PDF generation (jsPDF) + sharing helpers.
 *
 * The e-bill is generated 100% on-device. Sharing strategy:
 *  1. Web Share API WITH the actual PDF file → user picks WhatsApp + the customer
 *     chat, and the PDF travels natively attached with the pre-filled message.
 *  2. Fallback: download the PDF + open wa.me chat with a formatted bill summary,
 *     so the user just attaches the downloaded file.
 *
 * PDF design: premium "gold on midnight" certificate style — serif shop
 * monogram + name, proprietor line, gold gradient bands, ornamental page
 * frame, subtle watermark, diamond footer divider.
 */

import { jsPDF } from 'jspdf';
import { Bill } from './types';

type RGB = [number, number, number];

const GOLD: RGB = [212, 168, 83];
const GOLD_LIGHT: RGB = [238, 210, 140];
const GOLD_DEEP: RGB = [158, 116, 46];
const DARK: RGB = [22, 26, 38];
const DARK2: RGB = [32, 38, 54];
const GREEN: RGB = [16, 140, 90];
const RED: RGB = [214, 58, 58];
const GRAY: RGB = [110, 116, 130];
const IVORY: RGB = [250, 247, 240];
const WATERMARK: RGB = [246, 241, 230];

const PROPRIETOR_FALLBACK = 'Avijit Maity & Brother';

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

/**
 * Validate an Indian mobile number: strips non-digits, then a leading country
 * code (91) or trunk prefix (0); the remaining 10 digits must start with 6-9.
 */
export function isValidIndianMobile(mobile: string): boolean {
  let digits = (mobile || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits);
}

/** Indian-format number to words, e.g. 1250.50 → "One Thousand Two Hundred Fifty Rupees and 50 Paise" */
export function amountInWords(amount: number): string {
  const safe = Number.isFinite(amount) && amount >= 0 ? amount : 0;
  let rupees = Math.floor(safe);
  let paise = Math.round((safe - rupees) * 100);
  // Rounding can push paise to exactly 100 (e.g. 10.999) → carry into rupees.
  if (paise >= 100) {
    rupees += 1;
    paise = 0;
  }
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

/** First letters of up to 2 words — monogram initials, e.g. "PS TELECOM" → "PS". */
export function shopInitials(name: string): string {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'PS';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return ((words[0][0] || '') + (words[1][0] || '')).toUpperCase();
}

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

/** Paints a vertical gold gradient band by stacking thin interpolated strips. */
function goldGradient(doc: jsPDF, x: number, y: number, w: number, h: number): void {
  const steps = Math.max(10, Math.min(64, Math.round(h)));
  const stepH = h / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    doc.setFillColor(
      lerp(GOLD_LIGHT[0], GOLD_DEEP[0], t),
      lerp(GOLD_LIGHT[1], GOLD_DEEP[1], t),
      lerp(GOLD_LIGHT[2], GOLD_DEEP[2], t),
    );
    doc.rect(x, y + stepH * i, w, stepH + 0.4, 'F');
  }
}

/** Small gold diamond ornament (two triangles) centered at (cx, cy). */
function diamond(doc: jsPDF, cx: number, cy: number, r: number): void {
  doc.setFillColor(...GOLD);
  doc.triangle(cx - r, cy, cx, cy - r, cx, cy, 'F');
  doc.triangle(cx, cy - r, cx + r, cy, cx, cy, 'F');
  doc.triangle(cx - r, cy, cx, cy + r, cx, cy, 'F');
  doc.triangle(cx, cy + r, cx + r, cy, cx, cy, 'F');
}

// ============ PDF ============

export interface GeneratedPdf {
  blob: Blob;
  fileName: string;
}

export interface BillPdfImages {
  signatureDataUrl?: string;
  qrCodeDataUrl?: string;
  upiId?: string;
  thankYouNote?: string;
  termsText?: string;
  proprietorName?: string;
}

/**
 * Draws a premium A5 invoice PDF for the bill.
 * shopSnapshot (frozen at bill time) drives the header; signature/QR come
 * from current billing settings.
 */
export async function generateBillPdf(
  bill: Bill,
  images: BillPdfImages = {},
): Promise<GeneratedPdf> {
  const doc = new jsPDF({ unit: 'pt', format: 'a5', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();   // 419.5 pt
  const H = doc.internal.pageSize.getHeight();  // 595.3 pt
  const M = 26; // margin

  const shop = bill.shopSnapshot || { name: 'PS TELECOM', address: '', phone: '', gstNumber: '' };
  const shopName = shop.name || 'PS TELECOM';
  const proprietor = shop.proprietorName ?? images.proprietorName ?? PROPRIETOR_FALLBACK;

  // ---- Page frame (double gold certificate border) ----
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(1.1);
  doc.rect(8, 8, W - 16, H - 16, 'S');
  doc.setDrawColor(...GOLD_LIGHT);
  doc.setLineWidth(0.4);
  doc.rect(12, 12, W - 24, H - 24, 'S');

  // ---- Corner ornaments ----
  const corner = (cx: number, cy: number, sx: number, sy: number) => {
    doc.setFillColor(...GOLD);
    doc.circle(cx, cy, 1.6, 'F');
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.7);
    doc.line(cx + sx * 5, cy, cx + sx * 14, cy);
    doc.line(cx, cy + sy * 5, cx, cy + sy * 14);
  };
  corner(18, 18, 1, 1);
  corner(W - 18, 18, -1, 1);
  corner(18, H - 18, 1, -1);
  corner(W - 18, H - 18, -1, -1);

  // ---- Watermark (behind everything on the body) ----
  doc.setFont('times', 'bold');
  doc.setFontSize(42);
  doc.setTextColor(...WATERMARK);
  doc.text(shopName, W / 2, H * 0.58, { align: 'center', angle: 28 });

  // ---- Header band ----
  const HEAD_H = 116;
  doc.setFillColor(...DARK);
  doc.rect(0, 0, W, HEAD_H, 'F');
  // subtle darker vignette strip
  doc.setFillColor(...DARK2);
  doc.rect(0, 0, W, 22, 'F');
  goldGradient(doc, 0, HEAD_H, W, 4);
  doc.setFillColor(...GOLD_DEEP);
  doc.rect(0, HEAD_H + 4, W, 0.8, 'F');

  // Monogram medallion
  const mcx = M + 17, mcy = 32, mr = 16;
  doc.setFillColor(...GOLD);
  doc.circle(mcx, mcy, mr, 'F');
  doc.setDrawColor(...GOLD_LIGHT);
  doc.setLineWidth(0.9);
  doc.circle(mcx, mcy, mr - 2.4, 'S');
  doc.setTextColor(...DARK);
  doc.setFont('times', 'bold');
  doc.setFontSize(13);
  doc.text(shopInitials(shopName), mcx, mcy + 4.5, { align: 'center' });

  // Shop name — serif, letter-spaced, auto-shrink to fit
  const nameX = M + 44;
  const nameMaxW = W - nameX - M - 84;
  let nameSize = 19;
  doc.setFont('times', 'bold');
  doc.setTextColor(255, 255, 255);
  do {
    doc.setFontSize(nameSize);
    doc.setCharSpace(1.1);
    if (doc.getTextWidth(shopName) <= nameMaxW) break;
    doc.setCharSpace(0);
    nameSize -= 0.5;
  } while (nameSize > 11);
  doc.text(shopName, nameX, 36);
  doc.setCharSpace(0);

  // Proprietor line
  let headerY = 50;
  if (proprietor) {
    doc.setFont('times', 'italic');
    doc.setFontSize(8.8);
    doc.setTextColor(238, 208, 140);
    doc.text(`Proprietor: ${proprietor}`, nameX, headerY);
    headerY += 12;
  }

  // Address / contact
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(214, 216, 226);
  if (shop.address) {
    const addressLines = doc.splitTextToSize(shop.address, W - nameX - M - 84) as string[];
    doc.text(addressLines, nameX, headerY);
    headerY += addressLines.length * 9.5;
  }
  const contactBits: string[] = [];
  if (shop.phone) contactBits.push(`Ph: ${shop.phone}`);
  if (shop.gstNumber) contactBits.push(`GSTIN: ${shop.gstNumber}`);
  if (contactBits.length) doc.text(contactBits.join('  |  '), nameX, headerY);

  // INVOICE plate (right, gold gradient with engraved border)
  const plateW = 78, plateH = 20, plateX = W - M - plateW, plateY = 16;
  goldGradient(doc, plateX, plateY, plateW, plateH);
  doc.setDrawColor(...DARK);
  doc.setLineWidth(0.9);
  doc.rect(plateX + 2, plateY + 2, plateW - 4, plateH - 4, 'S');
  doc.setTextColor(...DARK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.6);
  doc.text(bill.gstEnabled ? 'TAX INVOICE' : 'INVOICE', plateX + plateW / 2, plateY + 13.5, { align: 'center' });

  // Bill meta (right column)
  doc.setTextColor(226, 228, 238);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.4);
  doc.text(`Bill No: ${bill.billNumber}`, W - M, 52, { align: 'right' });
  doc.text(`Date: ${formatDate(bill.date)}`, W - M, 63.5, { align: 'right' });

  // ---- Bill To (with gold accent bar) ----
  let y = 142;
  doc.setFillColor(...GOLD);
  doc.roundedRect(M, y - 14, 2.6, 44, 1.2, 1.2, 'F');
  doc.setDrawColor(226, 219, 200);
  doc.setLineWidth(0.7);
  doc.roundedRect(M + 6, y - 14, W - M * 2 - 6, 44, 6, 6, 'S');
  doc.setTextColor(...GRAY);
  doc.setFontSize(7.4);
  doc.setFont('helvetica', 'bold');
  doc.setCharSpace(1);
  doc.text('BILL TO', M + 16, y - 1);
  doc.setCharSpace(0);
  doc.setTextColor(...DARK);
  doc.setFont('times', 'bold');
  doc.setFontSize(12);
  doc.text(bill.customerName || 'Walk-in Customer', M + 16, y + 14);
  if (bill.customerMobile) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(84, 88, 100);
    doc.text(`Mob: ${bill.customerMobile}`, W - M - 14, y + 14, { align: 'right' });
  }

  y += 50;

  // ---- Items table ----
  const colItem = M + 10;
  const colQty = W * 0.52;
  const colRate = W * 0.66;
  const colAmount = W - M - 12;
  const tableTop = y;

  doc.setFillColor(...DARK);
  doc.rect(M, tableTop, W - M * 2, 23, 'F');
  doc.setFillColor(...GOLD);
  doc.rect(M, tableTop + 23, W - M * 2, 1.4, 'F');
  doc.setTextColor(...GOLD_LIGHT);
  doc.setFontSize(8.2);
  doc.setFont('helvetica', 'bold');
  doc.setCharSpace(0.6);
  doc.text('ITEM', colItem, tableTop + 15.5);
  doc.text('QTY', colQty, tableTop + 15.5, { align: 'center' });
  doc.text('RATE', colRate, tableTop + 15.5, { align: 'right' });
  doc.text('AMOUNT', colAmount, tableTop + 15.5, { align: 'right' });
  doc.setCharSpace(0);

  let rowY = tableTop + 24.4;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...DARK);
  for (const item of bill.items) {
    const nameLines = doc.splitTextToSize(item.name, colQty - colItem - 14) as string[];
    const rowHeight = Math.max(24, nameLines.length * 11 + 10);

    if (bill.items.indexOf(item) % 2 === 1) {
      doc.setFillColor(...IVORY);
      doc.rect(M, rowY, W - M * 2, rowHeight, 'F');
    }

    doc.setFontSize(9.4);
    doc.text(nameLines, colItem, rowY + 15);
    doc.text(String(item.quantity), colQty, rowY + 15, { align: 'center' });
    doc.text(`Rs. ${formatMoney(item.unitPrice)}`, colRate, rowY + 15, { align: 'right' });
    doc.setFont('times', 'bold');
    doc.setFontSize(10);
    doc.text(`Rs. ${formatMoney(item.total)}`, colAmount, rowY + 15, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.4);

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
  const line = (label: string, value: string, opts?: { bold?: boolean; color?: RGB }) => {
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

  // Grand total — engraved gold plate
  y += 2;
  const bandH = 28;
  goldGradient(doc, totalsX, y, W - M - totalsX, bandH);
  doc.setDrawColor(...DARK);
  doc.setLineWidth(0.9);
  doc.rect(totalsX + 2, y + 2, W - M - totalsX - 4, bandH - 4, 'S');
  doc.setTextColor(...DARK);
  doc.setFont('times', 'bold');
  doc.setFontSize(11);
  doc.text('GRAND TOTAL', totalsLabelX, y + 18.5);
  doc.setFontSize(13.5);
  doc.text(`Rs. ${formatMoney(bill.total)}`, totalsValueX, y + 18.5, { align: 'right' });
  y += bandH + 8;

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
  doc.setFont('times', 'bolditalic');
  doc.setFontSize(8.4);
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
  const bottomZone = H - 104;
  if (y < bottomZone - 8) y = bottomZone;

  if (images.qrCodeDataUrl) {
    try {
      const qrSize = 62;
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...GOLD);
      doc.setLineWidth(0.8);
      doc.roundedRect(M - 2, y - 2, qrSize + 4, qrSize + 4, 4, 4, 'FD');
      doc.addImage(images.qrCodeDataUrl, 'PNG', M, y, qrSize, qrSize);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...GRAY);
      doc.text(images.upiId ? `Scan to pay  |  UPI: ${images.upiId}` : 'Scan to pay', M + qrSize / 2, y + qrSize + 12, { align: 'center' });
    } catch {
      // invalid image data — skip QR silently
    }
  }

  // Signature block
  if (images.signatureDataUrl) {
    try {
      doc.addImage(images.signatureDataUrl, 'PNG', W - M - 92, y - 14, 92, 32);
    } catch {
      // invalid image data — skip signature silently
    }
  }
  doc.setDrawColor(140, 144, 156);
  doc.setLineWidth(0.6);
  doc.line(W - M - 102, y + 26, W - M, y + 26);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text(`For ${shopName}`, W - M, y + 12, { align: 'right' });
  if (proprietor) {
    doc.setFont('times', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...DARK);
    doc.text(proprietor, W - M, y + 38, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(...GRAY);
    doc.text('Proprietor', W - M, y + 47, { align: 'right' });
  }

  // ---- Footer: ornament divider + thank you + terms ----
  const divY = H - 44;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.6);
  doc.line(M + 4, divY, W / 2 - 9, divY);
  doc.line(W / 2 + 9, divY, W - M - 4, divY);
  diamond(doc, W / 2, divY, 3);

  doc.setFont('times', 'bolditalic');
  doc.setFontSize(10);
  doc.setTextColor(...DARK);
  const thanks = images.thankYouNote || 'Thank you for your business!';
  doc.text(thanks, W / 2, H - 31, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.6);
  doc.setTextColor(150, 154, 166);
  let footer = `Generated on ${new Date().toLocaleString('en-GB')} — PS TELECOM App`;
  if (images.termsText) {
    footer = `${images.termsText}  |  ${footer}`;
  }
  doc.text(doc.splitTextToSize(footer, W - M * 2 - 20) as string[], W / 2, H - 19.5, { align: 'center' });

  const blob = doc.output('blob');
  const fileName = `${shopName.replace(/[^a-zA-Z0-9]+/g, '-')}-${bill.billNumber}.pdf`;
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

/** True when the app runs inside an iframe (e.g. an embedded preview panel) —
 * sharing files from a framed page is blocked unless the frame is explicitly
 * allowed, so we tell the user to open the app in its own tab instead. */
export function isEmbeddedFrame(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin access threw → definitely framed
  }
}

/**
 * Sync native-app detection. @capacitor/core registers a global
 * `window.Capacitor` in BOTH the APK WebView and the web build (it's loaded
 * by capacitor-init), so the tell is `isNativePlatform()`: false in normal
 * browsers, true inside the APK. Deciding this WITHOUT awaiting anything
 * matters — waiting would burn the tap's transient user activation and
 * mobile browsers would reject navigator.share with NotAllowedError → the
 * PDF silently never reaches WhatsApp.
 */
function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

/**
 * Blob → base64 (no data-url prefix) — needed by Capacitor Filesystem.writeFile.
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read the PDF file'));
    reader.readAsDataURL(blob);
  });
}

export type FileShareResult =
  | 'shared'      // the real PDF file was handed to the OS share sheet
  | 'cancelled'   // user closed the share sheet without sending
  | 'unsupported' // this browser cannot share files (share sheet unavailable)
  | 'blocked';    // share rejected (NotAllowedError / SecurityError / …)

/**
 * Hand the ACTUAL PDF file to the OS share sheet, choosing the right
 * transport without ever delaying the first share attempt:
 *
 *  1. Mobile/desktop browser — `navigator.share({ files })` is the FIRST
 *     thing that runs, before ANY await, so the call happens while the
 *     user's tap activation is still fresh. This is what makes the PDF
 *     actually attach in WhatsApp on phones.
 *  2. Capacitor APK — Android WebView has no navigator.share; we write the
 *     PDF to the app cache and hand the real file to the Android share
 *     sheet via @capacitor/share.
 */
export async function sharePdfFile(blob: Blob, fileName: string, text: string): Promise<FileShareResult> {
  const file = new File([blob], fileName, { type: 'application/pdf' });
  const nav = navigator as Navigator;

  // ---- 1. Browser: Web Share API Level 2 (files) — called instantly ----
  if (!isNativeApp() && typeof nav.share === 'function') {
    try {
      await nav.share({ files: [file], title: fileName, text });
      return 'shared';
    } catch (err) {
      const name = (err as Error)?.name || '';
      if (name === 'AbortError') return 'cancelled'; // user closed the sheet
      // TypeError/NotSupportedError → this browser cannot share FILES
      if (name === 'TypeError' || name === 'NotSupportedError') return 'unsupported';
      return 'blocked'; // NotAllowedError / SecurityError (e.g. framed page)
    }
  }

  // ---- 2. Native APK (WebView: no navigator.share) ----
  if (isNativeApp()) {
    try {
      const [{ Directory, Filesystem }, { Share }] = await Promise.all([
        import('@capacitor/filesystem'),
        import('@capacitor/share'),
      ]);
      const base64Data = await blobToBase64(blob);
      const written = await Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: Directory.Cache,
        recursive: true,
      });
      await Share.share({
        title: fileName,
        text,
        files: [written.uri],
        dialogTitle: 'Send bill via…',
      });
      return 'shared';
    } catch (err) {
      const msg = String((err as Error)?.message || '').toLowerCase();
      if (msg.includes('cancel')) return 'cancelled';
      return 'blocked';
    }
  }

  return 'unsupported';
}

/** Build the WhatsApp text summary for a bill. */
export function buildBillMessage(bill: Bill, opts?: { withPdfNote?: boolean }): string {
  const shop = bill.shopSnapshot || { name: 'PS TELECOM', address: '', phone: '', gstNumber: '' };
  const shopName = shop.name || 'PS TELECOM';
  const proprietor = shop.proprietorName ?? PROPRIETOR_FALLBACK;
  const lines: string[] = [];

  lines.push(`*${shopName}*`);
  if (proprietor) lines.push(`_${proprietor}_`);
  if (shop.address) lines.push(shop.address.replace(/\n+/g, ', '));
  const contact: string[] = [];
  if (shop.phone) contact.push(`Ph: ${shop.phone}`);
  if (shop.gstNumber) contact.push(`GSTIN: ${shop.gstNumber}`);
  if (contact.length) lines.push(contact.join(' | '));

  lines.push('━━━━━━━━━━━━━━━━━━');
  // NOTE: no astral-plane (4-byte UTF-8) emoji here — some network proxies
  // mangle them into U+FFFD. BMP symbols (━ • — ₹ ⚠) travel safely.
  lines.push(`*${bill.gstEnabled ? 'TAX INVOICE' : 'INVOICE'}*`);
  lines.push(`Bill No: ${bill.billNumber}`);
  lines.push(`Date: ${formatDate(bill.date)}`);
  lines.push(`Customer: ${bill.customerName || 'Walk-in Customer'}${bill.customerMobile ? ` (${bill.customerMobile})` : ''}`);
  lines.push('━━━━━━━━━━━━━━━━━━');
  for (const item of bill.items) {
    lines.push(`• ${item.name} — ${item.quantity} × ₹${formatMoney(item.unitPrice)} = *₹${formatMoney(item.total)}*`);
  }
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push(`Subtotal: ₹${formatMoney(bill.subtotal)}`);
  if (bill.discountAmount > 0) {
    const pct = bill.discountType === 'percent' ? ` (${bill.discountValue}%)` : '';
    lines.push(`Discount${pct}: -₹${formatMoney(bill.discountAmount)}`);
  }
  if (bill.gstEnabled && bill.gstAmount > 0) lines.push(`GST (${bill.gstRate}%): ₹${formatMoney(bill.gstAmount)}`);
  lines.push(`*GRAND TOTAL: ₹${formatMoney(bill.total)}*`);
  if (bill.paidAmount > 0) lines.push(`Paid: ₹${formatMoney(bill.paidAmount)}`);
  if (bill.dueAmount > 0) lines.push(`⚠ Balance Due: ₹${formatMoney(bill.dueAmount)}`);
  const pmLabel: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', due: 'Due (Credit)' };
  lines.push(`Payment: ${pmLabel[bill.paymentMethod] || bill.paymentMethod}`);
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('Thank you for shopping with us!');
  if (opts?.withPdfNote) lines.push('— PDF bill attached —');
  return lines.join('\n');
}

/** wa.me deep link that opens the customer's chat with the bill summary pre-filled. */
export function whatsappUrl(mobile: string, message: string): string {
  const normalized = normalizeMobile(mobile);
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

/**
 * Open the customer's WhatsApp chat. window.open can be blocked as a popup
 * when it runs after async work — fall back to navigating this tab directly
 * so the chat ALWAYS opens.
 */
export function openWhatsappChat(mobile: string, message: string): void {
  const url = whatsappUrl(mobile, message);
  const win = window.open(url, '_blank');
  if (!win) window.location.href = url;
}

export type WhatsappSendResult =
  | 'shared'          // PDF handed to the OS share sheet → user picks WhatsApp
  | 'cancelled'       // user closed the share sheet
  | 'iframe-blocked'  // blocked because the app runs inside an iframe (preview)
  | 'fallback'        // PDF downloaded + wa.me chat opened → attach the file manually
  | 'no-mobile';      // PDF downloaded, but customer has no WhatsApp number

/**
 * Fallback when the file share is impossible: download the PDF and open the
 * customer's WhatsApp chat with the bill summary, so the user only has to
 * attach the downloaded file with the 📎 button.
 */
export async function fallbackDownloadAndChat(
  bill: Bill,
  pdf: GeneratedPdf,
): Promise<'fallback' | 'no-mobile'> {
  downloadBlob(pdf.blob, pdf.fileName);
  if (bill.customerMobile) {
    openWhatsappChat(bill.customerMobile, buildBillMessage(bill));
    return 'fallback';
  }
  return 'no-mobile';
}

/**
 * One-tap WhatsApp flow WITH the PDF attached:
 *  1. Mobile browser (HTTPS): Web Share API Level 2 — the share sheet opens
 *     carrying the REAL PDF file + pre-filled bill message; the user taps
 *     WhatsApp, picks the customer chat, and the PDF travels attached.
 *  2. Native APK: Android share sheet carrying the real PDF file.
 *  3. Fallback (desktop / files unsupported / share blocked): downloads the
 *     PDF and opens the customer's wa.me chat with the bill summary so the
 *     user attaches the downloaded file manually.
 */
export async function sendBillViaWhatsapp(
  bill: Bill,
  pdf: GeneratedPdf,
  opts?: { pdfNote?: boolean },
): Promise<WhatsappSendResult> {
  const message = buildBillMessage(bill, { withPdfNote: opts?.pdfNote !== false });
  const res = await sharePdfFile(pdf.blob, pdf.fileName, message);
  if (res === 'shared' || res === 'cancelled') return res;
  if (res === 'blocked' && isEmbeddedFrame()) return 'iframe-blocked';
  return fallbackDownloadAndChat(bill, pdf);
}
