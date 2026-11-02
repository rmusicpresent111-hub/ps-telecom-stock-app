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
 * PDF design: ROYAL BLUE & WHITE invoice (v2.24.0) — matches the printed
 * admin A4 bill: navy header band with the invoice-number box docked on one
 * side, light-blue title strip, Bill-To + payment-status panels, navy-headed
 * items grid with a navy GRAND TOTAL plate, amount-in-words band, QR +
 * signature row, and a dedicated Terms & Conditions block that preserves
 * the shop's OWN line-by-line formatting (every newline typed in Settings
 * reaches the PDF as-is).
 */

import { jsPDF } from 'jspdf';
import { registerPlugin } from '@capacitor/core';
import { Bill } from './types';

type RGB = [number, number, number];

// ============ palette (ROYAL BLUE & WHITE — matches the printed invoice) ============

const WHITE: RGB = [255, 255, 255];
const NAVY: RGB = [30, 58, 138];         // #1E3A8A — header band / table head / grand total / footer
const NAVY_DARK: RGB = [23, 48, 110];    // #17306E — invoice-number box
const NAVY_INK: RGB = [15, 31, 69];      // #0F1F45 — strongest text
const HEADTXT: RGB = [157, 180, 228];    // #9DB4E4 — captions on navy
const PALE: RGB = [220, 230, 248];       // #DCE6F8 — address lines on navy
const BLUE_LIGHT: RGB = [220, 233, 249]; // #DCE9F9 — title strip / qty band
const BLUE_SOFT: RGB = [239, 245, 252];  // #EFF5FC — words band / adjustment rows
const BLUE_BORDER: RGB = [195, 212, 236];// #C3D4EC — light borders
const BLUE_TEXT: RGB = [91, 116, 173];   // #5B74AD — captions on white
const INK: RGB = [62, 81, 112];          // #3E5170 — body text
const MUTE: RGB = [130, 150, 188];       // #8296BC
const GREEN: RGB = [30, 142, 62];
const GREEN_BG: RGB = [233, 246, 238];
const GREEN_BR: RGB = [191, 223, 201];
const AMBER: RGB = [180, 83, 9];
const AMBER_BG: RGB = [255, 247, 230];
const AMBER_BR: RGB = [242, 220, 176];
const RED: RGB = [198, 40, 40];
const RED_BG: RGB = [253, 237, 237];
const RED_BR: RGB = [243, 196, 196];

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
  const M = 20; // side margin
  const CW = W - M * 2;

  const shop = bill.shopSnapshot || { name: 'PS TELECOM', address: '', phone: '', gstNumber: '' };
  const shopName = shop.name || 'PS TELECOM';
  const proprietor = shop.proprietorName ?? images.proprietorName ?? PROPRIETOR_FALLBACK;

  const line = (x1: number, y1: number, x2: number, y2: number, w: number, c: RGB) => {
    doc.setDrawColor(...c);
    doc.setLineWidth(w);
    doc.line(x1, y1, x2, y2);
  };
  /** rounded/filled/stroked box helper */
  const box = (x: number, yy: number, w: number, h: number, fill?: RGB, stroke?: RGB, r = 0) => {
    if (fill) doc.setFillColor(...fill);
    if (stroke) {
      doc.setDrawColor(...stroke);
      doc.setLineWidth(0.9);
    }
    if (fill && stroke) doc.roundedRect(x, yy, w, h, r, r, 'FD');
    else if (fill) doc.roundedRect(x, yy, w, h, r, r, 'F');
    else if (stroke) doc.roundedRect(x, yy, w, h, r, r, 'S');
  };
  const txt = (
    s: string | string[],
    x: number,
    yy: number,
    o: { align?: 'left' | 'center' | 'right'; font?: 'helvetica' | 'times' | 'courier'; style?: 'normal' | 'bold' | 'italic' | 'bolditalic'; size?: number; color?: RGB; cs?: number } = {}
  ) => {
    doc.setFont(o.font ?? 'helvetica', o.style ?? 'normal');
    doc.setFontSize(o.size ?? 7);
    doc.setTextColor(...(o.color ?? INK));
    doc.setCharSpace(o.cs ?? 0);
    doc.text(s, x, yy, { align: o.align ?? 'left' });
    doc.setCharSpace(0);
  };
  const cap = (s: string, x: number, yy: number, color: RGB = BLUE_TEXT) =>
    txt(s.toUpperCase(), x, yy, { size: 5.7, style: 'bold', color, cs: 1.1 });

  // ================= ROYAL BLUE HEADER =================
  // thin royal edge across the very top of the sheet
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 5, 'F');

  // header band — shop identity LEFT, invoice meta box docked on ONE side
  box(10, 12, W - 20, 68, NAVY, undefined, 4);
  let y = 33;
  txt(shopName, 22, y, { size: 15.5, style: 'bold', color: WHITE, cs: 0.6 });
  y += 9;
  if (proprietor) {
    txt(proprietor.toUpperCase(), 22, y, { size: 6.2, style: 'bold', color: PALE, cs: 1 });
    y += 8;
  }
  if (shop.address) {
    const addrLines = doc.splitTextToSize(shop.address, W - 170) as string[];
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.2);
    doc.setTextColor(...PALE);
    doc.text(addrLines, 22, y);
    y += addrLines.length * 7.6 + 1.5;
  }
  const contactBits: string[] = [];
  if (shop.phone) contactBits.push(`Phone: ${shop.phone}`);
  if (shop.gstNumber) contactBits.push(`GSTIN: ${shop.gstNumber}`);
  if (contactBits.length) {
    txt(contactBits.join('   |   '), 22, Math.min(y, 73), { size: 6.8, style: 'bold', color: WHITE });
  }

  // invoice meta — the bill number lives HERE, in a darker box on one side
  const mx = W - 132;
  box(mx, 19, 122, 54, NAVY_DARK, undefined, 3);
  cap('Invoice No.', mx + 8, 29, HEADTXT);
  txt(bill.billNumber, mx + 8, 39, { size: 9.5, style: 'bold', color: WHITE, cs: 0.3 });
  cap('Date', mx + 8, 48, HEADTXT);
  txt(formatDate(bill.date), mx + 8, 55, { size: 7.2, style: 'bold', color: WHITE });
  cap('Payment Mode', mx + 8, 64, HEADTXT);
  const pmLabel: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', due: 'Credit (Due)' };
  txt((pmLabel[bill.paymentMethod] || bill.paymentMethod || 'Cash').toUpperCase(), mx + 8, 71, { size: 7.2, style: 'bold', color: WHITE });

  // ================= TITLE STRIP =================
  const stripY = 86;
  box(10, stripY, W - 20, 17, BLUE_LIGHT, undefined, 2);
  txt(bill.gstEnabled ? 'TAX INVOICE' : 'INVOICE', 20, stripY + 11.5, { size: 9, style: 'bold', color: NAVY_INK, cs: 2.2 });
  txt('CUSTOMER COPY', W - 20, stripY + 11, { size: 5.8, style: 'bold', color: BLUE_TEXT, cs: 1.4, align: 'right' });

  // ================= BILL TO + PAYMENT STATUS =================
  const pY = stripY + 23;
  const pbsW = 236;
  // bill-to panel — white, navy left accent
  box(M, pY, pbsW, 44, undefined, BLUE_BORDER, 2);
  doc.setFillColor(...NAVY);
  doc.rect(M, pY, 2.5, 44, 'F');
  cap('Bill To', M + 9, pY + 10);
  txt(bill.customerName || 'Walk-in Customer', M + 9, pY + 20, { size: 9, style: 'bold', color: NAVY_INK });
  let py = pY + 29;
  if (bill.customerMobile) {
    txt(`Phone: ${bill.customerMobile}`, M + 9, py, { size: 6.6, color: INK });
    py += 7.5;
  }
  if ((bill.customerAddress || '').trim()) {
    const addrLines = doc.splitTextToSize(bill.customerAddress!.trim(), pbsW - 18) as string[];
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.6);
    doc.setTextColor(...INK);
    doc.text(addrLines, M + 9, py);
    py += addrLines.length * 7.5;
  }
  if (shop.gstNumber) {
    txt(`Place of Supply Code: ${shop.gstNumber.slice(0, 2)}`, M + 9, py, { size: 6.6, color: INK });
    py += 7.5;
  }
  if (bill.note) {
    const noteLines = doc.splitTextToSize(`Note: ${bill.note}`, pbsW - 18) as string[];
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.2);
    doc.setTextColor(...INK);
    doc.text(noteLines, M + 9, py);
  }

  // payment status panel — green PAID / amber PARTIAL / red DUE
  const sX = M + pbsW + 8;
  const sW = W - M - sX;
  const paid = Number(bill.paidAmount) || 0;
  const dueAmt = Number(bill.dueAmount) || 0;
  const stPaid = dueAmt <= 0.009;
  const stPartial = !stPaid && paid > 0.009;
  const sFill = stPaid ? GREEN_BG : stPartial ? AMBER_BG : RED_BG;
  const sBar = stPaid ? GREEN : stPartial ? AMBER : RED;
  const sBr = stPaid ? GREEN_BR : stPartial ? AMBER_BR : RED_BR;
  box(sX, pY, sW, 44, sFill, sBr, 2);
  doc.setFillColor(...sBar);
  doc.rect(sX, pY, 2.5, 44, 'F');
  cap('Payment Status', sX + 9, pY + 10, sBar);
  txt(stPaid ? 'PAID' : stPartial ? 'PARTIALLY PAID' : 'PAYMENT DUE', sX + 9, pY + 19, { size: 7.2, style: 'bold', color: sBar, cs: 0.5 });
  txt(`Paid: Rs. ${formatMoney(paid)}`, sX + 9, pY + 28.5, { size: 6.3, color: INK });
  txt(`Balance Due: Rs. ${formatMoney(dueAmt)}`, sX + 9, pY + 36, { size: 6.3, style: 'bold', color: sBar });

  y = pY + 52;

  // ================= ITEMS TABLE — royal header, light grid =================
  const tblLeft = M;
  const tblW = CW;
  const cNo = 20;
  const cQty = 34;
  const cRate = 48;
  const cPer = 26;
  const cAmt = 62;
  const cItem = tblW - cNo - cQty - cRate - cPer - cAmt;
  const xNo = tblLeft;
  const xItem = xNo + cNo;
  const xQty = xItem + cItem;
  const xRate = xQty + cQty;
  const xPer = xRate + cRate;
  const xAmt = xPer + cPer;
  const tblRight = tblLeft + tblW;

  const tblTop = y;
  const headH = 15;
  doc.setFillColor(...NAVY);
  doc.rect(tblLeft, tblTop, tblW, headH, 'F');
  txt('SL.', xNo + cNo / 2, tblTop + 10, { size: 6.2, style: 'bold', color: WHITE, align: 'center', cs: 0.4 });
  txt('DESCRIPTION OF GOODS', xItem + 5, tblTop + 10, { size: 6.2, style: 'bold', color: WHITE, cs: 0.4 });
  txt('QTY', xQty + cQty / 2, tblTop + 10, { size: 6.2, style: 'bold', color: WHITE, align: 'center', cs: 0.4 });
  txt('RATE', xRate + cRate - 5, tblTop + 10, { size: 6.2, style: 'bold', color: WHITE, align: 'right', cs: 0.4 });
  txt('PER', xPer + cPer / 2, tblTop + 10, { size: 6.2, style: 'bold', color: WHITE, align: 'center', cs: 0.4 });
  txt('AMOUNT', xAmt + cAmt - 5, tblTop + 10, { size: 6.2, style: 'bold', color: WHITE, align: 'right', cs: 0.4 });

  let rowY = tblTop + headH;
  const items = bill.items.length ? bill.items : [{ productId: '', name: '—', quantity: 0, unitPrice: 0, total: 0 }];
  const AMBER_INK: RGB = [180, 83, 9]; // category line — matches the admin A4 sheet
  items.forEach((item, idx) => {
    const nameLines = doc.splitTextToSize(item.name, cItem - 10) as string[];
    const sns = (item.serialNumbers || []).filter(Boolean);
    const catName = (item.categoryName || '').trim();
    const rowH = Math.max(16, nameLines.length * 9 + 7 + (catName ? 7 : 0) + (sns.length ? 7 : 0));

    txt(String(idx + 1), xNo + cNo / 2, rowY + 11.5, { size: 7, color: INK, align: 'center' });
    txt(nameLines, xItem + 5, rowY + 11.5, { size: 7.6, color: NAVY_INK });
    let subY = rowY + 11.5 + nameLines.length * 9;
    if (catName) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.4);
      doc.setTextColor(...AMBER_INK);
      doc.text(`Category: ${catName}`, xItem + 5, subY);
      subY += 7;
    }
    if (sns.length) {
      const snTxt = doc.splitTextToSize(`S/N: ${sns.join(', ')}`, cItem - 10) as string[];
      doc.setFont('courier', 'normal');
      doc.setFontSize(5.4);
      doc.setTextColor(...MUTE);
      doc.text(snTxt, xItem + 5, subY);
    }
    txt(String(item.quantity), xQty + cQty / 2, rowY + 11.5, { size: 7, color: INK, align: 'center' });
    txt(formatMoney(item.unitPrice), xRate + cRate - 5, rowY + 11.5, { size: 7, color: INK, align: 'right' });
    txt('Nos.', xPer + cPer / 2, rowY + 11.5, { size: 6.2, color: MUTE, align: 'center' });
    txt(formatMoney(item.total), xAmt + cAmt - 5, rowY + 11.5, { size: 7.4, style: 'bold', color: NAVY_INK, align: 'right' });

    rowY += rowH;
    line(tblLeft, rowY, tblRight, rowY, 0.5, BLUE_BORDER);
  });

  // adjustment rows — light blue, inside the grid above the grand plate
  const tRow = (label: string, value: string, color: RGB = INK) => {
    doc.setFillColor(...BLUE_SOFT);
    doc.rect(tblLeft, rowY, tblW, 13, 'F');
    txt(label, xAmt - 6, rowY + 9, { size: 6.3, style: 'bold', color, align: 'right' });
    txt(value, xAmt + cAmt - 5, rowY + 9, { size: 6.8, style: 'bold', color: NAVY_INK, align: 'right' });
    rowY += 13;
    line(tblLeft, rowY, tblRight, rowY, 0.5, BLUE_BORDER);
  };
  const disc = bill.discountAmount || 0;
  const gstAmt = bill.gstAmount || 0;
  const gstOn = bill.gstEnabled && gstAmt > 0;
  const inclusiveGst = bill.gstMode === 'inclusive' && gstOn;
  if (disc > 0.009) {
    tRow(`Less: Discount${bill.discountType === 'percent' ? ` (${bill.discountValue}%)` : ''}`, `- ${formatMoney(disc)}`, GREEN);
  }
  if (inclusiveGst && bill.taxableValue != null) {
    tRow('Taxable Value', formatMoney(bill.taxableValue));
  }
  if (gstOn) {
    if (bill.cgstAmount != null && bill.sgstAmount != null) {
      const half = Math.round((bill.gstRate / 2) * 100) / 100;
      tRow(`OUTPUT CGST @ ${half}%`, formatMoney(bill.cgstAmount));
      tRow(`OUTPUT SGST @ ${half}%`, formatMoney(bill.sgstAmount));
    } else {
      tRow(`OUTPUT GST @ ${bill.gstRate}%`, formatMoney(gstAmt));
    }
  }

  // bottom split row — quantity band LEFT, navy GRAND TOTAL plate RIGHT
  const qtyTotal = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
  const splitH = 18;
  const splitMid = tblLeft + cNo + cItem + cQty;
  doc.setFillColor(...BLUE_LIGHT);
  doc.rect(tblLeft, rowY, splitMid - tblLeft, splitH, 'F');
  doc.setFillColor(...NAVY);
  doc.rect(splitMid, rowY, tblRight - splitMid, splitH, 'F');
  txt(`Total quantity  ${qtyTotal} Nos.`, (tblLeft + splitMid) / 2, rowY + 12, { size: 7.2, style: 'bold', color: NAVY_INK, align: 'center' });
  txt(`GRAND TOTAL  Rs. ${formatMoney(bill.total)}`, splitMid + (tblRight - splitMid) / 2, rowY + 12, { size: 8, style: 'bold', color: WHITE, align: 'center', cs: 0.4 });
  rowY += splitH;

  // outer frame + column separators over the whole table
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(1.1);
  doc.rect(tblLeft, tblTop, tblW, rowY - tblTop, 'S');
  line(xItem, tblTop, xItem, rowY, 0.5, BLUE_BORDER);
  line(xQty, tblTop, xQty, rowY, 0.5, BLUE_BORDER);
  line(xRate, tblTop, xRate, rowY, 0.5, BLUE_BORDER);
  line(xPer, tblTop, xPer, rowY, 0.5, BLUE_BORDER);
  line(splitMid, rowY - splitH, splitMid, rowY, 1.1, NAVY);

  // ================= AMOUNT IN WORDS band =================
  y = rowY + 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.8);
  doc.setTextColor(...NAVY_INK);
  doc.setCharSpace(1);
  doc.text('AMOUNT IN WORDS', tblLeft + 8, y + 10);
  doc.setCharSpace(0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(...INK);
  const wordsLines = doc.splitTextToSize(amountInWords(bill.total), tblW - 96) as string[];
  doc.text(wordsLines, tblLeft + 88, y + 10);
  const wordsH = 15 + (wordsLines.length - 1) * 8;
  box(tblLeft, y, tblW, wordsH, undefined, BLUE_BORDER, 2);
  y += wordsH + 7;

  // due callout — red receivable band (reference-style)
  if (dueAmt > 0.009) {
    const dueStr = `Amount of Rs. ${formatMoney(dueAmt)} (${amountInWords(dueAmt)}) receivable from party.`;
    const dl = doc.splitTextToSize(dueStr, tblW - 18) as string[];
    const dh = 12 + dl.length * 8.2;
    box(tblLeft, y, tblW, dh, RED_BG, RED_BR, 2);
    doc.setFillColor(...RED);
    doc.rect(tblLeft, y, 2.5, dh, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.3);
    doc.setTextColor(...RED);
    doc.text(dl, tblLeft + 9, y + 9.5);
    y += dh + 6;
  }

  // ================= TERMS & CONDITIONS (user format preserved) =================
  // The user's OWN line-by-line layout survives intact: every newline /
  // blank line / numbering typed in Settings lands on the PDF as-is
  // (auto-shrunk only when space runs out). Royal-blue bordered box.
  const QR_PIN = H - 100; // QR/signature row stays pinned just above the footer
  if (images.termsText && images.termsText.trim()) {
    const rawLines = images.termsText.replace(/\r\n?/g, '\n').split('\n');
    // drop leading/trailing blank lines the user never intended to see
    while (rawLines.length && !rawLines[0].trim()) rawLines.shift();
    while (rawLines.length && !rawLines[rawLines.length - 1].trim()) rawLines.pop();

    if (rawLines.length) {
      const TC_HEADER = 15;
      const heightOf = (fs: number, lines: string[], extra: number) => {
        const lead = fs * 1.32;
        return TC_HEADER + extra + lines.reduce((s, l) => s + (l.trim() ? lead : lead * 0.45), 0);
      };
      const avail = Math.max(QR_PIN - 10 - y, 22);
      let fs = 6.6;
      while (heightOf(fs, rawLines, 0) > avail && fs > 4.6) fs -= 0.2;
      const lead = fs * 1.32;
      let shown = rawLines;
      let truncated = false;
      // reserve one extra line slot for the ellipsis when we must cut
      while (shown.length > 1 && heightOf(fs, shown, lead) > avail) {
        shown = shown.slice(0, -1);
        truncated = true;
      }
      const tcH = heightOf(fs, shown, truncated ? lead : 0) + 5;
      box(tblLeft, y, tblW, tcH, undefined, NAVY, 2);

      txt('TERMS & CONDITIONS', tblLeft + 8, y + 11, { size: 6.2, style: 'bold', color: NAVY_INK, cs: 1 });
      let ty = y + TC_HEADER + 2;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(fs);
      doc.setTextColor(...INK);
      for (const l of shown) {
        if (l.trim()) {
          const wrapped = doc.splitTextToSize(l, tblW - 16) as string[];
          doc.text(wrapped, tblLeft + 8, ty);
          ty += wrapped.length * lead;
        } else {
          ty += lead * 0.45;
        }
      }
      if (truncated) doc.text('…', tblLeft + 8, ty);
      y += tcH + 6;
    }
  }

  // ================= QR + BANK + SIGNATURE ROW (pinned near page bottom) =================
  const qrY = Math.max(y + 4, QR_PIN);
  if (images.qrCodeDataUrl) {
    try {
      const qrSize = 44;
      box(tblLeft, qrY - 5, qrSize + 10, qrSize + 10, WHITE, BLUE_BORDER, 2);
      doc.addImage(images.qrCodeDataUrl, 'PNG', tblLeft + 5, qrY, qrSize, qrSize);
      // UPI caption sits BESIDE the QR (keeps the bottom band compact)
      txt('Scan to Pay', tblLeft + qrSize + 17, qrY + 16, { size: 5.8, style: 'bold', color: BLUE_TEXT, cs: 0.6 });
      if (images.upiId) txt(`UPI ID: ${images.upiId}`, tblLeft + qrSize + 17, qrY + 25, { size: 5.8, color: INK });
      if (proprietor) txt(`A/c Holder: ${proprietor}`, tblLeft + qrSize + 17, qrY + 34, { size: 5.8, color: INK });
    } catch {
      // invalid image data — skip QR silently
    }
  } else if (proprietor) {
    txt(`A/c Holder: ${proprietor}`, tblLeft, qrY + 10, { size: 6.4, style: 'bold', color: NAVY_INK });
  }

  // signature block (right)
  txt(`FOR ${shopName.toUpperCase()}`, W - M, qrY + 2, { size: 7.2, style: 'bold', color: NAVY_INK, align: 'right', cs: 0.5 });
  if (images.signatureDataUrl) {
    try {
      doc.addImage(images.signatureDataUrl, 'PNG', W - M - 80, qrY + 5, 80, 24);
    } catch {
      // invalid image data — skip signature silently
    }
  }
  line(W - M - 88, qrY + 34, W - M, qrY + 34, 0.8, NAVY_INK);
  txt('Authorised Signatory', W - M - 44, qrY + 41, { size: 5.8, color: INK, align: 'center' });

  // ================= THANK-YOU + ROYAL FOOTER (pinned) =================
  if (images.thankYouNote) {
    txt(images.thankYouNote, W / 2, H - 32, { size: 6.4, font: 'times', style: 'bolditalic', color: NAVY_INK, align: 'center' });
  }
  txt(`Generated on ${new Date().toLocaleString('en-GB')} — PS TELECOM App`, W / 2, H - 27, { size: 5.4, color: MUTE, align: 'center' });

  // royal navy footer bar — colour to the paper edge
  doc.setFillColor(...NAVY);
  doc.rect(0, H - 22, W, 22, 'F');
  const footLeft = `${shopName}${shop.phone ? `   |   ${shop.phone}` : ''}`;
  txt(footLeft, 20, H - 8, { size: 6.6, style: 'bold', color: WHITE, cs: 0.4 });
  txt(bill.billNumber, W - 20, H - 8, { size: 6.6, style: 'bold', color: WHITE, align: 'right', cs: 0.4 });

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
  } catch (err) {
    // plugin not present (old android/ project) or write failed → generic path
    console.warn('[bill-pdf] direct WhatsApp send unavailable:', (err as Error)?.message || err);
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
    const catTag = item.categoryName ? ` [${item.categoryName}]` : '';
    lines.push(`• ${item.name}${catTag} — ${item.quantity} × ₹${formatMoney(item.unitPrice)} = *₹${formatMoney(item.total)}*`);
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
