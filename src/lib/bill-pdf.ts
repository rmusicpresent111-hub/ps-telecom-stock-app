/**
 * Bill PDF generation (jsPDF) + sharing helpers.
 *
 * The e-bill is generated 100% on-device. Sharing strategy:
 *  0. APK + customer mobile → opens THE CUSTOMER's WhatsApp chat directly
 *     with the real PDF attached (native WhatsappSender plugin, jid intent).
 *  1. Web Share API WITH the actual PDF file → user picks WhatsApp + chat.
 *  2. Fallback: download the PDF + open wa.me chat with a formatted bill
 *     summary, so the user just attaches the downloaded file.
 *
 * PDF design: classic GENUINE INVOICE — clean white letterhead, centered
 * shop identity, bordered two-cell Bill-To/Bill-No box, full-grid items
 * table, black Grand-Total plate, QR + signature row, and a dedicated
 * Terms & Conditions block that preserves the shop's OWN line-by-line
 * formatting (every newline typed in Settings reaches the PDF as-is).
 */

import { jsPDF } from 'jspdf';
import { registerPlugin } from '@capacitor/core';
import { Bill } from './types';

type RGB = [number, number, number];

// ============ palette (classic print, no decoration) ============

const BLACK: RGB = [24, 24, 24];
const INK: RGB = [45, 45, 45];
const BODY: RGB = [70, 70, 70];
const MUTE: RGB = [110, 110, 110];
const LINE: RGB = [120, 120, 120];
const SOFT: RGB = [205, 205, 205];
const HEADFILL: RGB = [238, 238, 238];
const GREEN: RGB = [16, 130, 82];
const RED: RGB = [198, 40, 40];

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
 * Draws a classic genuine-invoice A5 page. Everything flows top→bottom with
 * real rules/borders like a printed bill; the only pinned element is the
 * tiny "Generated on…" footer line. The shop's Terms & Conditions are drawn
 * line-by-line EXACTLY as typed in Settings (newlines preserved, auto-fit).
 */
export async function generateBillPdf(
  bill: Bill,
  images: BillPdfImages = {},
): Promise<GeneratedPdf> {
  const doc = new jsPDF({ unit: 'pt', format: 'a5', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();   // 419.5 pt
  const H = doc.internal.pageSize.getHeight();  // 595.3 pt
  const M = 28; // margin

  const shop = bill.shopSnapshot || { name: 'PS TELECOM', address: '', phone: '', gstNumber: '' };
  const shopName = shop.name || 'PS TELECOM';
  const proprietor = shop.proprietorName ?? images.proprietorName ?? PROPRIETOR_FALLBACK;

  const line = (x1: number, y1: number, x2: number, y2: number, w: number, c: RGB) => {
    doc.setDrawColor(...c);
    doc.setLineWidth(w);
    doc.line(x1, y1, x2, y2);
  };
  const gridRect = (x: number, y: number, w: number, h: number, fill?: RGB) => {
    if (fill) {
      doc.setFillColor(...fill);
      doc.rect(x, y, w, h, 'F');
    }
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.8);
    doc.rect(x, y, w, h, 'S');
  };

  // ================= LETTERHEAD (centered shop identity) =================
  let y = 40;

  doc.setFont('times', 'bold');
  doc.setTextColor(...BLACK);
  let nameSize = 17.5;
  doc.setCharSpace(0.7);
  while (doc.getTextWidth(shopName) > W - M * 2 && nameSize > 11) {
    nameSize -= 0.5;
    doc.setFontSize(nameSize);
  }
  doc.setFontSize(nameSize);
  doc.text(shopName, W / 2, y, { align: 'center' });
  doc.setCharSpace(0);

  if (proprietor) {
    y += 12.5;
    doc.setFont('times', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(...BODY);
    doc.text(`Proprietor: ${proprietor}`, W / 2, y, { align: 'center' });
  }

  if (shop.address) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.9);
    doc.setTextColor(...BODY);
    const addrLines = doc.splitTextToSize(shop.address, W - M * 2) as string[];
    y += addrLines.length * 9.4 + 2;
    doc.text(addrLines, W / 2, y, { align: 'center' });
  }

  const contactBits: string[] = [];
  if (shop.phone) contactBits.push(`Ph: ${shop.phone}`);
  if (shop.gstNumber) contactBits.push(`GSTIN: ${shop.gstNumber}`);
  if (contactBits.length) {
    y += 10.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.9);
    doc.setTextColor(...BODY);
    doc.text(contactBits.join('   |   '), W / 2, y, { align: 'center' });
  }

  // classic double rule under the letterhead
  y += 6;
  line(M, y, W - M, y, 1.5, BLACK);
  line(M, y + 3, W - M, y + 3, 0.5, LINE);

  // ================= INVOICE TITLE =================
  y += 17;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(...BLACK);
  doc.setCharSpace(1.6);
  doc.text(bill.gstEnabled ? 'TAX INVOICE' : 'INVOICE', W / 2, y, { align: 'center' });
  doc.setCharSpace(0);

  // ================= BILL-TO + BILL META (bordered two-cell box) =================
  y += 7;
  const boxTop = y;
  const boxH = 46;
  const boxW = W - M * 2;
  const splitX = M + boxW * 0.62;
  gridRect(M, boxTop, boxW, boxH);
  line(splitX, boxTop, splitX, boxTop + boxH, 0.8, INK);

  // left cell — customer
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.setTextColor(...MUTE);
  doc.setCharSpace(1);
  doc.text('BILL TO', M + 10, boxTop + 12);
  doc.setCharSpace(0);
  doc.setFont('times', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(...BLACK);
  const custName = doc.splitTextToSize(bill.customerName || 'Walk-in Customer', splitX - M - 20) as string[];
  doc.text(custName, M + 10, boxTop + 26);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.4);
  doc.setTextColor(...BODY);
  doc.text(bill.customerMobile ? `Mob: ${bill.customerMobile}` : ' ', M + 10, boxTop + 38.5);

  // right cell — bill number / date (plain right-aligned, classic print)
  const metaX = W - M - 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.8);
  doc.setTextColor(...BLACK);
  doc.text(`Bill No: ${bill.billNumber}`, metaX, boxTop + 16, { align: 'right' });
  doc.text(`Date: ${formatDate(bill.date)}`, metaX, boxTop + 31, { align: 'right' });

  y = boxTop + boxH + 12;

  // ================= ITEMS TABLE (full grid) =================
  const tblLeft = M;
  const tblW = W - M * 2;
  const cNo = 24;
  const cQty = 46;
  const cRate = 66;
  const cAmt = 76;
  const cItem = tblW - cNo - cQty - cRate - cAmt;
  const xNo = tblLeft;
  const xItem = xNo + cNo;
  const xQty = xItem + cItem;
  const xRate = xQty + cQty;
  const xAmt = xRate + cRate;
  const tblRight = tblLeft + tblW;

  const tblTop = y;
  const headH = 20;

  // header row
  gridRect(tblLeft, tblTop, tblW, headH, HEADFILL);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.6);
  doc.setTextColor(...BLACK);
  doc.setCharSpace(0.5);
  doc.text('#', xNo + cNo / 2, tblTop + 13.5, { align: 'center' });
  doc.text('ITEM', xItem + 5, tblTop + 13.5);
  doc.text('QTY', xQty + cQty / 2, tblTop + 13.5, { align: 'center' });
  doc.text('RATE', xRate + cRate - 5, tblTop + 13.5, { align: 'right' });
  doc.text('AMOUNT', xAmt + cAmt - 5, tblTop + 13.5, { align: 'right' });
  doc.setCharSpace(0);

  let rowY = tblTop + headH;
  const items = bill.items.length ? bill.items : [{ productId: '', name: '—', quantity: 0, unitPrice: 0, total: 0 }];
  items.forEach((item, idx) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.8);
    const nameLines = doc.splitTextToSize(item.name, cItem - 10) as string[];
    const rowH = Math.max(19, nameLines.length * 10.6 + 8);

    // row text
    doc.setTextColor(...INK);
    doc.text(String(idx + 1), xNo + cNo / 2, rowY + 13, { align: 'center' });
    doc.text(nameLines, xItem + 5, rowY + 13);
    doc.text(String(item.quantity), xQty + cQty / 2, rowY + 13, { align: 'center' });
    doc.text(`Rs. ${formatMoney(item.unitPrice)}`, xRate + cRate - 5, rowY + 13, { align: 'right' });
    doc.setFont('times', 'bold');
    doc.setFontSize(9.6);
    doc.text(`Rs. ${formatMoney(item.total)}`, xAmt + cAmt - 5, rowY + 13, { align: 'right' });

    rowY += rowH;
    line(tblLeft, rowY, tblRight, rowY, 0.6, SOFT);
  });

  // outer frame + column separators over the whole table
  gridRect(tblLeft, tblTop, tblW, rowY - tblTop);
  line(xItem, tblTop, xItem, rowY, 0.6, SOFT);
  line(xQty, tblTop, xQty, rowY, 0.6, SOFT);
  line(xRate, tblTop, xRate, rowY, 0.6, SOFT);
  line(xAmt, tblTop, xAmt, rowY, 0.6, SOFT);

  // ================= AMOUNT IN WORDS =================
  y = rowY + 12;
  doc.setFont('times', 'bolditalic');
  doc.setFontSize(8);
  doc.setTextColor(...BODY);
  const wordsLines = doc.splitTextToSize(`In Words: ${amountInWords(bill.total)}`, tblW) as string[];
  doc.text(wordsLines, tblLeft, y);
  y += wordsLines.length * 9 + 1.5;

  // ================= TOTALS =================
  const tLabelX = W * 0.42;
  const tValueX = tblRight - 10;
  const totalRow = (label: string, value: string, opts?: { bold?: boolean; color?: RGB; size?: number }) => {
    doc.setFont('helvetica', opts?.bold ? 'bold' : 'normal');
    doc.setFontSize(opts?.size ?? 8.8);
    doc.setTextColor(...(opts?.color ?? BODY));
    doc.text(label, tLabelX, y);
    doc.text(value, tValueX, y, { align: 'right' });
    y += opts?.bold ? 14 : 12;
  };

  totalRow('Subtotal', `Rs. ${formatMoney(bill.subtotal)}`);
  if (bill.discountAmount > 0) {
    const pct = bill.discountType === 'percent' ? ` (${bill.discountValue}%)` : '';
    totalRow(`Discount${pct}`, `- Rs. ${formatMoney(bill.discountAmount)}`, { color: GREEN });
  }
  if (bill.gstEnabled && bill.gstAmount > 0) {
    totalRow(`GST (${bill.gstRate}%)`, `Rs. ${formatMoney(bill.gstAmount)}`);
  }

  // GRAND TOTAL — solid black plate, white text (the classic bill signature)
  y += 2;
  const plateH = 24;
  doc.setFillColor(...BLACK);
  doc.rect(tLabelX, y, tblRight - tLabelX, plateH, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(255, 255, 255);
  doc.setCharSpace(0.8);
  doc.text('GRAND TOTAL', tLabelX + 10, y + 17);
  doc.setCharSpace(0);
  doc.setFontSize(12.5);
  doc.text(`Rs. ${formatMoney(bill.total)}`, tValueX - 10, y + 16.5, { align: 'right' });
  y += plateH + 7;

  const pmLabel: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', due: 'Due (Credit)' };
  if (bill.paidAmount > 0 || bill.dueAmount > 0) {
    totalRow('Paid', `Rs. ${formatMoney(bill.paidAmount)}`, { color: GREEN });
    if (bill.dueAmount > 0) {
      totalRow('Balance Due', `Rs. ${formatMoney(bill.dueAmount)}`, { color: RED, bold: true, size: 9.4 });
    }
  }
  totalRow('Payment Method', pmLabel[bill.paymentMethod] || bill.paymentMethod);

  if (bill.note) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...BODY);
    const noteLines = doc.splitTextToSize(`Note: ${bill.note}`, tblW) as string[];
    doc.text(noteLines, tblLeft, y + 2);
    y += noteLines.length * 9.5 + 2;
  }

  // ================= TERMS & CONDITIONS (user format preserved) =================
  // Real bills print the terms in the free band between the totals and the
  // signature block — exactly what we do here. The user's OWN line-by-line
  // layout survives intact: every newline / blank line / numbering typed in
  // Settings lands on the PDF as-is (auto-shrunk only when space runs out).
  const QR_PIN = H - 104; // QR/signature row stays pinned just above the footer
  if (images.termsText && images.termsText.trim()) {
    const rawLines = images.termsText.replace(/\r\n?/g, '\n').split('\n');
    // drop leading/trailing blank lines the user never intended to see
    while (rawLines.length && !rawLines[0].trim()) rawLines.shift();
    while (rawLines.length && !rawLines[rawLines.length - 1].trim()) rawLines.pop();

    if (rawLines.length) {
      const TC_HEADER = 16;
      const heightOf = (fs: number, lines: string[], extra: number) => {
        const lead = fs * 1.32;
        return TC_HEADER + extra + lines.reduce((s, l) => s + (l.trim() ? lead : lead * 0.45), 0);
      };
      const avail = Math.max(QR_PIN - 8 - y, 24);
      let fs = 7.2;
      while (heightOf(fs, rawLines, 0) > avail && fs > 5.2) fs -= 0.2;
      const lead = fs * 1.32;
      let shown = rawLines;
      let truncated = false;
      // reserve one extra line slot for the ellipsis when we must cut
      while (shown.length > 1 && heightOf(fs, shown, lead) > avail) {
        shown = shown.slice(0, -1);
        truncated = true;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.setTextColor(...BLACK);
      doc.setCharSpace(0.9);
      doc.text('TERMS & CONDITIONS', tblLeft, y);
      doc.setCharSpace(0);
      line(tblLeft, y + 3, tblLeft + 92, y + 3, 0.6, LINE);
      y += TC_HEADER;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(fs);
      doc.setTextColor(...BODY);
      for (const l of shown) {
        if (l.trim()) {
          const wrapped = doc.splitTextToSize(l, tblW) as string[];
          doc.text(wrapped, tblLeft, y);
          y += wrapped.length * lead;
        } else {
          y += lead * 0.45;
        }
      }
      if (truncated) doc.text('…', tblLeft, y);
    }
  }

  // ================= QR + SIGNATURE ROW (pinned near page bottom) =================
  const qrY = Math.max(y + 4, QR_PIN);
  if (images.qrCodeDataUrl) {
    try {
      const qrSize = 52;
      doc.addImage(images.qrCodeDataUrl, 'PNG', tblLeft, qrY, qrSize, qrSize);
      // UPI caption sits BESIDE the QR (keeps the bottom band compact)
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...MUTE);
      doc.text('Scan to pay', tblLeft + qrSize + 10, qrY + qrSize / 2 - 4);
      if (images.upiId) doc.text(`UPI: ${images.upiId}`, tblLeft + qrSize + 10, qrY + qrSize / 2 + 6);
    } catch {
      // invalid image data — skip QR silently
    }
  }

  // signature block (right)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.4);
  doc.setTextColor(...BODY);
  doc.text(`For ${shopName}`, W - M, qrY + 2, { align: 'right' });
  if (images.signatureDataUrl) {
    try {
      doc.addImage(images.signatureDataUrl, 'PNG', W - M - 88, qrY + 3, 88, 28);
    } catch {
      // invalid image data — skip signature silently
    }
  }
  line(W - M - 96, qrY + 36, W - M, qrY + 36, 0.7, LINE);
  if (proprietor) {
    doc.setFont('times', 'bold');
    doc.setFontSize(9.4);
    doc.setTextColor(...BLACK);
    doc.text(proprietor, W - M, qrY + 45, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.9);
    doc.setTextColor(...MUTE);
    doc.text('Proprietor', W - M, qrY + 54, { align: 'right' });
  }

  // ================= THANK-YOU + FOOTER (pinned) =================
  const thanks = images.thankYouNote || 'Thank you for your business!';
  doc.setFont('times', 'bolditalic');
  doc.setFontSize(9);
  doc.setTextColor(...BLACK);
  doc.text(thanks, W / 2 - 20, H - 44, { align: 'center' });

  line(M, H - 30, W - M, H - 30, 0.5, SOFT);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.4);
  doc.setTextColor(...MUTE);
  doc.text(`Generated on ${new Date().toLocaleString('en-GB')} — PS TELECOM App`, W / 2, H - 18, { align: 'center' });

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

// ---- Native direct-send plugin (installed into the APK by build-apk.js) ----

interface WhatsappSenderPlugin {
  send(options: { phone: string; fileUri?: string; text?: string }): Promise<{ sent: boolean; error?: string }>;
}
const WhatsappSender = registerPlugin<WhatsappSenderPlugin>('WhatsappSender');

export type DirectWhatsappResult = 'opened' | 'no-whatsapp' | 'failed';

/**
 * APK ONLY: open THE CUSTOMER's WhatsApp chat with the real PDF attached —
 * the Android WhatsApp intent API (EXTRA_STREAM + `jid` extra) removes the
 * "pick a contact" step entirely. Returns 'opened' when WhatsApp came up
 * carrying the file; the user just presses Send.
 */
async function directWhatsappSend(
  mobile: string,
  blob: Blob,
  fileName: string,
  text: string,
): Promise<DirectWhatsappResult> {
  try {
    const [{ Directory, Filesystem }] = await Promise.all([import('@capacitor/filesystem')]);
    const base64Data = await blobToBase64(blob);
    const written = await Filesystem.writeFile({
      path: fileName,
      data: base64Data,
      directory: Directory.Cache,
      recursive: true,
    });
    const res = await WhatsappSender.send({
      phone: normalizeMobile(mobile),
      fileUri: written.uri,
      text,
    });
    if (res?.sent) return 'opened';
    if (res?.error === 'no-whatsapp') return 'no-whatsapp';
    return 'failed';
  } catch {
    // plugin not present (old android/ project) or write failed → generic path
    return 'failed';
  }
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
  | 'direct'          // APK: customer's own WhatsApp chat opened WITH the PDF attached
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
 * One-tap WhatsApp flow WITH the PDF attached, aimed at the BILL's number:
 *
 *  0. Native APK + a customer mobile number → the customer's OWN WhatsApp
 *     chat opens carrying the real PDF (jid intent). No contact picking.
 *  1. Mobile browser (HTTPS): Web Share API Level 2 — the share sheet opens
 *     carrying the REAL PDF file + pre-filled bill message; the user taps
 *     WhatsApp, picks the customer chat, and the PDF travels attached.
 *  2. Native APK fallback: Android share sheet carrying the real PDF file.
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

  // ---- 0. APK: straight into the bill's customer WhatsApp chat ----
  if (isNativeApp() && bill.customerMobile) {
    const direct = await directWhatsappSend(bill.customerMobile, pdf.blob, pdf.fileName, message);
    if (direct === 'opened') return 'direct';
    // 'no-whatsapp' / 'failed' → keep going with the normal share sheet
  }

  const res = await sharePdfFile(pdf.blob, pdf.fileName, message);
  if (res === 'shared' || res === 'cancelled') return res;
  if (res === 'blocked' && isEmbeddedFrame()) return 'iframe-blocked';
  return fallbackDownloadAndChat(bill, pdf);
}
