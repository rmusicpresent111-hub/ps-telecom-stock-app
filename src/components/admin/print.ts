/**
 * Admin print helpers — generates printer-friendly HTML documents and
 * prints them through a hidden iframe (browser "Save as PDF" gives the PDF).
 *
 * Print documents are ALWAYS light (paper) and carry their own inline CSS,
 * so admin dark mode never leaks into printouts. Bangla/Hindi render natively
 * because the browser's own font stack is used (no jsPDF glyph problem).
 *
 * Task 46: full A4 invoice layout — shop header (name / phone / address /
 * GSTIN from Bill Settings), logo monogram, Bill-To box, items table,
 * discount / GST / grand-total plate, amount in words, payment QR + UPI,
 * uploaded signature image, thank-you note and Terms & Conditions.
 *
 * Task 75: premium multi-colour FULL-PAGE A4 restyle — dark brand header
 * with the invoice-number card docked on ONE side, colour accent strips,
 * zebra items grid, dark grand-total plate, watermark and footer strip.
 */

import type { AdminLang } from '@/lib/admin-i18n';
import { ta, taf } from '@/lib/admin-i18n';
import type { Bill, BillingSettings } from '@/lib/types';
import { getBillingSettingsOffline } from '@/lib/offline-service';
import { DEFAULT_USER_ID } from '@/lib/local-auth';

// ── small local formatters (standalone — no React imports) ─────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function money(n: number | undefined | null): string {
  const v = Number(n || 0);
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function fmtDate(dateStr: string | undefined): string {
  if (!dateStr) return '—';
  const d = dateStr.length > 10 ? new Date(dateStr) : new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * v2.36.0 audit: signature/QR land in an <img src="..."> attribute inside the
 * print document (same-origin iframe / A4 preview srcDoc). A settings value
 * like `x" onerror="…` must never break out of the attribute — only accept
 * real data:image/* URLs, escape the attribute, drop everything else.
 */
function safeImgDataUrl(v: unknown): string {
  const raw = typeof v === 'string' ? v.trim() : '';
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(raw)) return '';
  return esc(raw);
}

/** Multiline text → escaped HTML with <br> line breaks. */
function escMultiline(s: unknown): string {
  return esc(s).replace(/\r?\n/g, '<br>');
}

// ── shop header resolution (live settings → bill snapshot) ─────

interface ShopHeader {
  name: string;
  proprietor: string;
  address: string;
  phone: string;
  gst: string;
  signature: string;
  qr: string;
  upi: string;
  terms: string;
  thankyou: string;
  bankName: string;
  bankBranch: string;
  bankAccountNo: string;
  bankIfsc: string;
}

function resolveShop(bill: Bill, settings?: BillingSettings | null): ShopHeader {
  const s = settings || null;
  const pick = (live: string | undefined, snap: string | undefined): string =>
    (live ?? '').trim() || (snap ?? '').trim();
  return {
    name: pick(s?.shopName, bill.shopSnapshot?.name) || 'PS TELECOM',
    proprietor: pick(s?.proprietorName, bill.shopSnapshot?.proprietorName),
    address: pick(s?.shopAddress, bill.shopSnapshot?.address),
    phone: pick(s?.shopPhone, bill.shopSnapshot?.phone),
    gst: pick(s?.gstNumber, bill.shopSnapshot?.gstNumber),
    signature: (s?.signatureDataUrl ?? '').trim(),
    qr: (s?.qrCodeDataUrl ?? '').trim(),
    upi: (s?.upiId ?? '').trim(),
    terms: (s?.termsText ?? '').trim(),
    thankyou: (s?.thankYouNote ?? '').trim(),
    bankName: (s?.bankName ?? '').trim(),
    bankBranch: (s?.bankBranch ?? '').trim(),
    bankAccountNo: (s?.bankAccountNo ?? '').trim(),
    bankIfsc: (s?.bankIfsc ?? '').trim(),
  };
}

/** Two-letter monogram tile (PS TELECOM → PS) — print-safe shop logo. */
function monogramHtml(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] || 'PS';
  // an all-caps 2–3 letter first word (PS, SK, RG…) IS the monogram itself
  const ini = /^[A-Z]{2,3}$/.test(first)
    ? first
    : ((first[0] || 'P') + (parts[1]?.[0] || 'S')).toUpperCase();
  return `<div class="mono" aria-hidden="true">${esc(ini)}</div>`;
}

/** Contact line: phone · GSTIN */
function contactBits(shop: ShopHeader): string {
  return [shop.phone ? `☎ ${shop.phone}` : '', shop.gst ? `GSTIN: ${shop.gst}` : '']
    .filter(Boolean)
    .join('  ·  ');
}

// ── print engine ────────────────────────────────────────────────

export function printHtml(html: string): void {
  if (typeof window === 'undefined') return;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  const fire = () => {
    try {
      win.focus();
      win.print();
    } catch {
      /* print dialog blocked — the iframe is still removed below */
    }
    window.setTimeout(() => iframe.remove(), 60_000);
  };
  // give the document a beat to lay out tables/fonts/images before the dialog opens
  window.setTimeout(fire, 300);
}

// ── PDF download engine — a REAL .pdf file, no print dialog ─────
//
// The browser print dialog ("Save as PDF") is manual, and window.print()
// does nothing inside the Android WebView — so reports can also be DOWNLOADED
// as a PDF file directly. The report HTML (same build the printer uses) is
// rendered on an off-screen stage with its stylesheet SCOPED to the stage
// (the app document is never touched), rasterized with html2canvas — Bangla
// and Hindi render correctly through the app's own fonts — and split into
// A4 pages by jsPDF.

/** Prefix every selector of a flat CSS sheet with a scope selector;
 *  `body`/`html` selectors become the scope element itself. */
function scopeCss(css: string, scope: string): string {
  return css.replace(/(^|\})([^{}@]+)\{/g, (_m, brace: string, sel: string) => {
    const scoped = sel
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s === 'body' || s === 'html' ? scope : `${scope} ${s}`))
      .join(', ');
    return `${brace} ${scoped}{`;
  });
}

/** Render a standalone report document (as produced by pageShell) and download
 *  it as a paginated A4 PDF file. Throws when rendering fails so the caller
 *  can toast the error. */
export async function downloadHtmlAsPdf(html: string, filename: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const stage = document.createElement('div');
  stage.id = 'ps-pdf-stage';
  stage.setAttribute('aria-hidden', 'true');
  stage.style.cssText =
    'position:fixed;left:-10000px;top:0;width:794px;background:#fff;z-index:-1;';

  const style = document.createElement('style');
  style.textContent = scopeCss(doc.querySelector('style')?.textContent || '', '#ps-pdf-stage');
  stage.appendChild(style);

  const content = document.createElement('div');
  content.innerHTML = doc.body.innerHTML;
  stage.appendChild(content);
  document.body.appendChild(stage);

  try {
    try {
      await document.fonts.ready; // Bangla/Hindi webfonts must be painted before rasterizing
    } catch {
      /* font API unavailable — the 120 ms settle wait below still covers most cases */
    }
    await new Promise((r) => setTimeout(r, 120)); // let images / layout settle

    const canvas = await html2canvas(stage, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    });

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;
    const data = canvas.toDataURL('image/jpeg', 0.92);

    let offset = 0;
    let page = 0;
    while (offset < imgH - 1) {
      if (page > 0) pdf.addPage();
      pdf.addImage(data, 'JPEG', 0, -offset, imgW, imgH, undefined, 'FAST');
      offset += pageH;
      page += 1;
    }
    pdf.save(filename);
  } finally {
    stage.remove();
  }
}

const PRINT_CSS = `
@page { size: A4; margin: 10mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin:0; background:#fff; font-family:'Noto Sans Bengali','Hind Siliguri',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; color:#111827; font-size:12.5px; line-height:1.45; }
.doc { max-width:190mm; margin:0 auto; }

/* header */
.head { display:flex; justify-content:space-between; align-items:flex-start; gap:14px; border-bottom:3px solid #FA6E41; padding-bottom:10px; }
.brandline { display:flex; align-items:center; gap:10px; min-width:0; }
.mono { width:46px; height:46px; border-radius:10px; background:linear-gradient(135deg,#FA6E41,#E8552C); color:#fff; font-weight:800; font-size:16px; display:flex; align-items:center; justify-content:center; letter-spacing:.5px; flex:0 0 auto; }
.brand { font-size:20px; font-weight:800; margin:0; line-height:1.2; letter-spacing:.2px; }
.proprietor { color:#374151; font-size:11px; font-weight:700; margin:1px 0 0; }
.shopline { color:#6B7280; font-size:10.5px; margin:1px 0 0; }
.doc-title { font-size:15px; font-weight:800; color:#E8552C; text-transform:uppercase; letter-spacing:.08em; margin:0; }
.meta { text-align:right; font-size:11px; color:#374151; margin-top:3px; }
.meta b { font-weight:800; }
.gstin-chip { display:inline-block; border:1px solid #F3D8CB; background:#FFF7F3; color:#9A3412; border-radius:6px; padding:1px 8px; font-size:10px; font-weight:800; margin-top:5px; letter-spacing:.04em; }

/* bill-to / payment boxes */
.party { display:flex; justify-content:space-between; gap:12px; margin:12px 0 2px; flex-wrap:wrap; }
.pbox { border:1px solid #E8EAED; border-radius:10px; padding:8px 12px; background:#FAFBFC; flex:1 1 210px; max-width:330px; }
.pbox .name { font-weight:800; font-size:13px; margin:2px 0 0; }
.pbox .line { color:#4B5563; font-size:11px; margin:1px 0 0; }
.chip-status { display:inline-block; border-radius:999px; padding:2px 10px; font-size:10px; font-weight:800; letter-spacing:.05em; }
.st-paid { background:#F0FDF4; color:#15803D; border:1px solid #BBF7D0; }
.st-partial { background:#FFFBEB; color:#B45309; border:1px solid #FDE68A; }
.st-due { background:#FEF2F2; color:#B91C1C; border:1px solid #FECACA; }

/* tables */
table { width:100%; border-collapse:collapse; margin-top:8px; }
th { background:#FFF1EB; color:#9A3412; text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; padding:7px 8px; border:1px solid #F3D8CB; }
th.r, td.r { text-align:right; }
td { padding:6px 8px; border:1px solid #E8EAED; vertical-align:top; }
tbody tr:nth-child(even) td { background:#FAFBFC; }
.tot td { font-weight:700; background:#FFF7F3; }
/* per-unit serials under the item name (mobile products) */
.sn { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:10px; color:#6B7280; margin-top:2px; letter-spacing:.02em; }

/* totals stack */
.totals { margin-top:10px; margin-left:auto; width:68%; min-width:250px; }
.trow { display:flex; justify-content:space-between; gap:10px; padding:4px 10px; font-size:11.5px; color:#374151; border-bottom:1px dashed #E8EAED; }
.trow b { font-weight:700; }
.trow.grand { background:#111827; color:#fff; font-weight:800; font-size:13.5px; border-radius:7px; border-bottom:0; padding:8px 10px; margin-top:5px; }

/* words, payment, note */
.words { margin-top:10px; font-size:11px; color:#374151; background:#FFF7F3; border:1px dashed #F3D8CB; border-radius:8px; padding:6px 10px; }
.pay { display:flex; align-items:center; gap:12px; margin-top:10px; flex-wrap:wrap; }
.pay img { width:80px; height:80px; object-fit:contain; border:1px solid #E8EAED; border-radius:8px; padding:3px; background:#fff; }
.pay .upi { font-size:11px; color:#374151; font-weight:600; }
.note-box { margin-top:10px; background:#F9FAFB; border:1px solid #E8EAED; border-radius:8px; padding:8px 10px; font-size:11px; color:#4B5563; }

/* signature + terms + footer */
.sig-row { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; margin-top:26px; }
.thanks { color:#6B7280; font-size:11px; max-width:55%; font-weight:600; }
.sig-block { text-align:center; min-width:170px; }
.sig-block img { max-width:170px; max-height:56px; object-fit:contain; display:block; margin:0 auto 2px; }
.sig-line { border-top:1.5px solid #374151; padding-top:4px; font-weight:700; color:#374151; font-size:11px; }
.sig-for { font-size:10.5px; color:#6B7280; margin:0 0 26px; font-weight:700; }
.terms { margin-top:14px; border:1px solid #E8EAED; border-radius:8px; padding:8px 12px; font-size:10.5px; color:#4B5563; }
.terms .t { font-weight:800; text-transform:uppercase; font-size:9.5px; color:#6B7280; letter-spacing:.05em; }
.terms ul { margin:4px 0 0; padding-left:16px; }
.terms li { margin:1px 0; }
.foot { margin-top:16px; border-top:1px solid #E8EAED; padding-top:6px; display:flex; justify-content:space-between; color:#9CA3AF; font-size:9.5px; gap:12px; }

/* report widgets (kept from v2.9.1) */
.sec { font-size:13px; font-weight:800; margin:16px 0 0; }
.summary-box { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
.chip { border:1px solid #E8EAED; border-radius:10px; padding:8px 12px; min-width:130px; }
.chip .k { color:#6B7280; font-size:10px; text-transform:uppercase; font-weight:700; }
.chip .v { font-weight:800; font-size:14px; }
`;

function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>${body}</body></html>`;
}


// ── document 1: single-bill FULL-PAGE A4 invoice — blue corporate GST bill ──
//
// Task 93 (v2.42.0): owner rejected the v2.41 cream/gold artwork and supplied
// a NEW reference (upload/file_000000004ab88211bbc466c1e85adc73.png —
// "SUNRISE ENTERPRISE" blue corporate GST tax invoice). Element-by-element
// recreation on white paper:
//   • thin blue outer page border + bordered header box: blue shopping-bag
//     logo tile | vertical divider | GSTIN line, big blue shop name, blue
//     proprietor line, 📍 address + 📞 Contact No rows, "Original Duplicate
//     Bill" pinned top-right
//   • Bill To / Ship To tabs (blue pill overlapping a light-blue rounded
//     box, label : value rows) on the left; right stack = Bill No. / Tax
//     Date / Payment Mode / Reverse Charge box + Buyer's Order No. /
//     Supplier's Ref. / Vehicle Number / Delivery Date / Transport Details /
//     Terms Of Delivery box (no data → blank value, like the reference)
//   • items grid: solid blue two-row header (GST spans Rate | Amt), columns
//     Sl. | Goods & Service Description | HSN | Quantity | Rate | Taxable
//     Value | GST Rate | GST Amt | Total; per-item GST carved out of
//     inclusive prices / added on exclusive ones; blank filler rows pad the
//     grid to 9 rows like the reference sheet
//   • Our Bank Details tab box (Bank/Branch/Account/IFSC/UPI — additive
//     BillingSettings.bank* fields) + inner white "Invoice Total (InWords) :
//     Rupees … Only" panel
//   • totals plate: Sub Total (taxable | GST | pre-round) triple row +
//     Discount (when any) + CGST / SGST / IGST / Freight-Packing / Round Off
//     + navy TOTAL AMOUNT band
//   • bottom: Declaration tab + numbered list | payment QR (uploaded or
//     placeholder) | For, SHOP + signature + Authorised Signatory
//   • navy footer band: "Thank You For Doing Business With Us!"
// Pure CSS/SVG (inline SVG with xmlns — print iframe and html2canvas safe).

/** Plain 2-decimals, NO thousand grouping (reference shows 11988.00). */
function amt2(n: number | undefined | null): string {
  return (Number(n) || 0).toFixed(2);
}

/** 2-decimals with trailing zeros stripped (32618.00 → 32618, 0.50 → 0.5). */
function amtTrim(n: number | undefined | null): string {
  const s = (Number(n) || 0).toFixed(2);
  return s.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

/** dd-mm-yy tax date (reference "10-01-25"). */
function fmtTaxDate(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const d = dateStr.length > 10 ? new Date(dateStr) : new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return dateStr;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${String(d.getFullYear()).slice(-2)}`;
}

/** Tally quantity: trim trailing zeros (1 → "1", 0.5 → "0.5"). */
function tallyQty(n: number): string {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)));
}

// ── amount in words (Indian crore / lakh / thousand system) ──

const W_ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const W_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function words2(n: number): string {
  if (n < 20) return W_ONES[n] || '';
  const t = Math.floor(n / 10);
  const o = n % 10;
  return W_TENS[t] + (o ? ' ' + W_ONES[o] : '');
}

function words3(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const head = h ? W_ONES[h] + ' Hundred' + (rest ? ' ' : '') : '';
  return head + (rest ? words2(rest) : '');
}

/** 1234567 → "Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven". */
function indianWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thou = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (crore) parts.push(indianWords(crore) + ' Crore');
  if (lakh) parts.push(words2(lakh) + ' Lakh');
  if (thou) parts.push(words2(thou) + ' Thousand');
  if (rest) parts.push(words3(rest));
  return parts.join(' ');
}

/** 38076 → "Rupees Thirty-Eight Thousand Seventy-Six Only". */
function amountInWords(v: number): string {
  const rup = Math.floor(Math.abs(v));
  const paise = Math.round((Math.abs(v) - rup) * 100);
  let s = 'Rupees ' + indianWords(rup);
  if (paise > 0) s += ' and ' + indianWords(paise) + ' Paise';
  return s + ' Only';
}

// ── inline SVG art (fixed size + xmlns → print & html2canvas safe) ──

/** Blue shopping-bag logo tile (reference header-left). */
function bagLogoSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true">
  <rect x="1.5" y="1.5" width="61" height="61" rx="14" fill="#2E75C5"/>
  <path d="M20.5 27h23l-2.6 21.4a4.2 4.2 0 0 1-4.2 3.6h-9.4a4.2 4.2 0 0 1-4.2-3.6Z" fill="#FFFFFF"/>
  <path d="M25.5 27v-5.4a6.5 6.5 0 0 1 13 0V27" fill="none" stroke="#FFFFFF" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M25.5 37.5q6.5 5.4 13 0" fill="none" stroke="#2E75C5" stroke-width="3" stroke-linecap="round"/>
</svg>`;
}

/** Small blue location-pin glyph (header address row). */
const I_PIN = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="#1D5BA6"><path d="M12 2a7.3 7.3 0 0 0-7.3 7.3c0 5.4 6.4 12 7.3 12.7.9-.7 7.3-7.3 7.3-12.7A7.3 7.3 0 0 0 12 2zm0 10a2.8 2.8 0 1 1 0-5.6 2.8 2.8 0 0 1 0 5.6z"/></svg>`;

/** Small blue phone glyph (header contact row). */
const I_PHONE = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="#1D5BA6"><path d="M6.6 2.8 9 5.2a1.7 1.7 0 0 1 .2 2.2L8 9.1a13.8 13.8 0 0 0 6.9 6.9l1.7-1.2a1.7 1.7 0 0 1 2.2.2l2.4 2.4a1.7 1.7 0 0 1-.1 2.5l-1.6 1.4c-1.4 1.2-3.5 1.3-5.1.3A26.3 26.3 0 0 1 3.4 9.6c-1-1.6-.9-3.7.3-5.1l1.4-1.6a1.7 1.7 0 0 1 1.5-.1z"/></svg>`;

/** Script-style signature placeholder (uploaded signature replaces it). */
function sigScribbleSvg(): string {
  return `<svg class="scrib" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 52" aria-hidden="true"><path d="M8 40 C16 16 30 8 36 16 C41 23 30 30 25 23 C20 15 36 6 50 10 M48 30 C56 20 68 16 72 22 C76 28 66 32 62 26 C58 19 72 10 86 13 C98 16 96 26 106 22 C114 18 122 20 130 16" fill="none" stroke="#1A2C56" stroke-width="2.4" stroke-linecap="round"/></svg>`;
}

/** Decorative QR-look placeholder (real uploaded QR replaces it). */
function qrPlaceholderSvg(): string {
  const n = 21;
  const cell = 100 / n;
  const rnd = (i: number, j: number) => {
    const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const inFinder = (i: number, j: number) =>
    (i < 7 && j < 7) || (i < 7 && j >= n - 7) || (i >= n - 7 && j < 7);
  let cells = '';
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (inFinder(i, j) || rnd(i, j) <= 0.5) continue;
      cells += `<rect x="${(j * cell).toFixed(1)}" y="${(i * cell).toFixed(1)}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}"/>`;
    }
  }
  const finder = (x: number, y: number) =>
    `<rect x="${(x + cell / 2).toFixed(1)}" y="${(y + cell / 2).toFixed(1)}" width="${(cell * 6).toFixed(1)}" height="${(cell * 6).toFixed(1)}" fill="none" stroke="#101418" stroke-width="${cell.toFixed(1)}"/>` +
    `<rect x="${(x + cell * 2).toFixed(1)}" y="${(y + cell * 2).toFixed(1)}" width="${(cell * 3).toFixed(1)}" height="${(cell * 3).toFixed(1)}" fill="#101418"/>`;
  return `<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="#FFFFFF"/><g fill="#101418">${cells}</g>${finder(0, 0)}${finder(100 - cell * 7, 0)}${finder(0, 100 - cell * 7)}</svg>`;
}

const BILL_CSS = `
@page { size: A4; margin: 0; }
* { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
html, body { margin:0; padding:0; }
body { background:#fff; color:#17376B; font-family:Arial,'Noto Sans Bengali','Hind Siliguri','Helvetica Neue',Helvetica,'Liberation Sans',sans-serif; font-size:12px; line-height:1.35; }

/* full-page A4 sheet — white paper, thin blue outer border */
.sheet { width:210mm; max-width:100%; min-height:296.6mm; margin:0 auto; background:#fff; border:0.4mm solid #2E75C5; display:flex; flex-direction:column; }
.inner { flex:1 1 auto; padding:4.5mm 5mm 2mm; }

/* header — bag logo | divider | GSTIN · name · proprietor · 📍 · 📞 | dup */
.head { position:relative; display:flex; align-items:center; gap:4mm; border:0.35mm solid #2E75C5; border-radius:1.6mm; padding:3.6mm 5mm 3.6mm 4mm; }
.bag { flex:0 0 16.5mm; width:16.5mm; height:16.5mm; }
.bag svg { width:100%; height:100%; display:block; }
.vsep { align-self:stretch; border-left:0.5mm solid #2E75C5; }
.hinfo { flex:1 1 auto; min-width:0; padding-left:1mm; padding-right:32mm; }
.h-gstin { font-size:13px; font-weight:800; color:#17376B; letter-spacing:.2px; }
.h-name { font-size:26px; font-weight:900; color:#1D5BA6; letter-spacing:.3px; line-height:1.14; margin-top:.3mm; }
.h-sub { font-size:13px; font-weight:800; color:#1D5BA6; margin-top:.4mm; }
.h-addr { display:flex; align-items:flex-start; gap:1.8mm; font-size:11.8px; font-weight:600; color:#17376B; margin-top:1.7mm; }
.h-addr svg { flex:0 0 auto; margin-top:.3mm; }
.dup { position:absolute; top:3.2mm; right:4.6mm; font-size:12.5px; font-weight:800; color:#17376B; }

/* pill tabs + light-blue boxes */
.pbox { position:relative; border:0.35mm solid #2E75C5; background:#EAF3FB; border-radius:2mm; padding:3mm 4mm 2.4mm; margin-top:5.6mm; }
.pill { position:absolute; top:-3.1mm; left:-0.35mm; background:#2E75C5; color:#FFFFFF; font-size:12.5px; font-weight:800; letter-spacing:.2px; padding:1.3mm 6.5mm 1.3mm 4.5mm; border-radius:2.4mm; white-space:nowrap; }
.prow { display:flex; align-items:baseline; font-size:12px; color:#17376B; padding:.5mm 0; }
.prow .k { flex:0 0 21mm; font-weight:800; }
.prow .c { flex:0 0 4.5mm; }
.prow .v { flex:1 1 auto; min-width:0; font-weight:600; overflow-wrap:anywhere; }

.mid { display:flex; gap:4mm; align-items:stretch; }
.colL { flex:1 1 54%; min-width:0; }
.colR { flex:1 1 46%; min-width:0; display:flex; flex-direction:column; gap:4mm; padding-top:5.6mm; }
.ibox { border:0.35mm solid #2E75C5; background:#EAF3FB; border-radius:2mm; padding:2.4mm 4mm; }
.ibox .prow .k { flex:0 0 33mm; }
.colR .ibox { flex:1 1 auto; }

/* items grid — blue two-row header (GST spans Rate | Amt) */
.tblwrap { margin-top:5.6mm; border:0.4mm solid #2E75C5; border-radius:1.2mm; overflow:hidden; }
table.items { width:100%; border-collapse:collapse; }
.items th { background:#2E75C5; color:#FFFFFF; font-size:11.5px; font-weight:800; text-align:center; padding:1.8mm 1.2mm; border:0.25mm solid #5B93D4; line-height:1.25; }
.items thead tr.subrow th { font-size:10.8px; padding:1.2mm; }
.items td { border:0.25mm solid #A9C9E8; padding:2.2mm 1.2mm; font-size:11.5px; font-weight:600; color:#17376B; text-align:center; vertical-align:middle; }
.items td.name { text-align:left; padding-left:2.4mm; }
.items thead { display:table-header-group; }
.items tr { page-break-inside:avoid; }
.items td.empty { height:7.4mm; }
.cat { font-size:9px; font-weight:700; color:#4A78B8; margin-top:.4mm; }
.sn { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:9px; color:#4A78B8; margin-top:.4mm; }

/* bank details + totals plate */
.bot { display:flex; gap:4mm; align-items:flex-start; margin-top:5.6mm; }
.botL { flex:1 1 54%; min-width:0; }
.botR { flex:1 1 46%; min-width:0; }
.inwords { margin-top:2mm; background:#FFFFFF; border:0.3mm solid #7FAEDC; border-radius:1.6mm; padding:1.8mm 3mm; }
.inwords .lbl { font-weight:800; color:#17376B; font-size:11.5px; }
.inwords .val { color:#1D5BA6; font-weight:800; font-size:12.5px; margin-top:.6mm; }

.totbox { border:0.35mm solid #2E75C5; background:#EAF3FB; border-radius:2mm; padding:1.6mm 3mm 2mm; }
.trow { display:flex; align-items:baseline; font-size:12px; color:#17376B; padding:1.3mm 1mm; }
.trow .lbl { flex:1 1 auto; text-align:right; font-weight:700; min-width:0; }
.trow .c { flex:0 0 4.5mm; text-align:center; }
.trow .val { flex:0 0 26mm; text-align:right; font-weight:700; }
.trow.sub3 .lbl { flex:0 0 auto; text-align:left; }
.trow.sub3 .v1 { flex:0 0 17mm; text-align:right; font-weight:800; }
.trow.sub3 .v2 { flex:0 0 22mm; text-align:right; font-weight:800; }
.trow.sub3 .v3 { flex:0 0 26mm; text-align:right; font-weight:800; }
.trow.grand { background:#1B4A7C; border-radius:1.8mm; color:#FFFFFF; font-weight:800; font-size:12.8px; padding:2.2mm 2.4mm; margin-top:.8mm; }
.trow.grand .lbl { color:#FFFFFF; }
.trow.grand .c { color:#FFFFFF; }
.trow.grand .val { color:#FFFFFF; font-size:13.5px; }

/* bottom — declaration | QR | signature */
.botm { display:flex; gap:5mm; align-items:stretch; margin-top:6mm; }
.decl { flex:1 1 50%; min-width:0; }
.decl .pill { position:static; display:inline-block; margin-bottom:2.4mm; }
.decl ol { margin:0; padding-left:5mm; font-size:10.6px; color:#17376B; }
.decl li { margin:.6mm 0; line-height:1.3; }
.qrwrap { flex:0 0 23mm; display:flex; align-items:center; justify-content:center; padding-top:4mm; }
.qrwrap img, .qrwrap svg.qr { width:21mm; height:21mm; display:block; }
.sigc { flex:1 1 36%; min-width:0; text-align:center; padding-top:1mm; }
.sigc .for { font-size:13px; font-weight:800; color:#17376B; }
.sigc img { max-width:42mm; max-height:12mm; object-fit:contain; display:block; margin:1.8mm auto .8mm; }
.sigc svg.scrib { width:34mm; height:11mm; display:block; margin:1.8mm auto .8mm; }
.sigc .cap { display:inline-block; border-top:0.35mm solid #17376B; padding-top:1.4mm; min-width:40mm; font-size:11.8px; font-weight:800; color:#17376B; }

/* navy footer band */
.footband { margin-top:auto; background:#1D4E77; min-height:12.5mm; display:flex; align-items:center; justify-content:center; gap:5mm; padding:2mm 4mm; }
.footband .ln { flex:0 0 30mm; border-top:0.45mm solid rgba(255,255,255,.9); }
.footband .tx { font-family:Georgia,'Times New Roman',serif; font-style:italic; font-weight:700; font-size:16px; color:#FFFFFF; letter-spacing:.2px; white-space:nowrap; }
`;

function billShell(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${BILL_CSS}</style></head><body>${body}</body></html>`;
}

export function buildBillReceiptHtml(bill: Bill, _lang: AdminLang, settings?: BillingSettings | null): string {
  const shop = resolveShop(bill, settings);

  const gstOn = (bill.gstAmount || 0) > 0;
  const inclusiveGst = bill.gstMode === 'inclusive' && gstOn;
  const hasSplit = gstOn && bill.cgstAmount != null;

  const disc = bill.discountAmount || 0;
  const gstAmt = bill.gstAmount || 0;
  const due = bill.dueAmount || 0;
  const paid = Number(bill.paidAmount) || 0;

  const methodLabel =
    bill.paymentMethod === 'cash'
      ? 'Cash'
      : bill.paymentMethod === 'upi'
        ? 'UPI'
        : bill.paymentMethod === 'card'
          ? 'Card'
          : 'Credit (Due)';

  const rateNum = Number(bill.gstRate) || 0;
  const rate = gstOn ? rateNum / 100 : 0;
  const rateTxt = `${Number.isInteger(rateNum) ? rateNum : Number(rateNum.toFixed(2))}%`;

  // taxable base the GST sits on (inclusive bills carry their own value)
  const taxableBase = inclusiveGst ? bill.taxableValue ?? 0 : (bill.subtotal || 0) - disc;
  // pre-round total = taxable + GST (reference Sub-Total row's 3rd figure)
  const expectedTotal = (bill.subtotal || 0) - disc + (gstOn && !inclusiveGst ? gstAmt : 0);
  const roundOff = Math.round(((bill.total || 0) - expectedTotal) * 100) / 100;

  // per-item GST columns — inclusive: carve out of the price; exclusive: add on top
  const calc = (total: number): { tx: number; gst: number | null; tot: number } => {
    if (!gstOn) return { tx: total, gst: null, tot: total };
    if (inclusiveGst) {
      const tx = total / (1 + rate);
      return { tx, gst: total - tx, tot: total };
    }
    return { tx: total, gst: total * rate, tot: total + total * rate };
  };

  const itemRows = (bill.items || [])
    .map((it, i) => {
      const sns = (it.serialNumbers || []).filter(Boolean);
      const hsn = (it.hsnCode || '').trim() || '—';
      const c = calc(it.total || 0);
      return (
        `<tr><td>${i + 1}</td><td class="name">${esc(it.name)}${
          it.categoryName ? `<div class="cat">${esc(it.categoryName)}</div>` : ''
        }${
          sns.length ? `<div class="sn">S/N: ${sns.map((s) => esc(s)).join(', ')}</div>` : ''
        }</td><td>${esc(hsn)}</td><td>${tallyQty(it.quantity)}</td><td>${amt2(it.unitPrice)}</td><td>${amt2(c.tx)}</td><td>${gstOn ? esc(rateTxt) : '-'}</td><td>${c.gst == null ? '-' : amt2(c.gst)}</td><td>${amt2(c.tot)}</td></tr>`
      );
    })
    .join('');

  // blank filler rows keep the grid as tall as the reference sheet
  const MIN_ROWS = 12;
  const fillers = Math.max(0, MIN_ROWS - (bill.items || []).length);
  const fillerRows = Array.from({ length: fillers }, () => `<tr>${'<td class="empty"></td>'.repeat(9)}</tr>`).join('');

  const dash = '-';
  const cgstV = gstOn ? (hasSplit ? bill.cgstAmount ?? null : gstAmt / 2) : null;
  const sgstV = gstOn ? (hasSplit ? bill.sgstAmount ?? null : gstAmt / 2) : null;
  const val = (v: number | null) => (v == null ? dash : amt2(v));

  const totRows = `
    <div class="trow sub3"><span class="lbl">Sub Total</span><span class="c">:</span><span class="v1">${amtTrim(taxableBase)}</span><span class="v2">${gstOn ? amt2(gstAmt) : dash}</span><span class="v3">${amt2(expectedTotal)}</span></div>
    ${disc > 0.009 ? `<div class="trow"><span class="lbl">Discount</span><span class="c">:</span><span class="val">-${amt2(disc)}</span></div>` : ''}
    <div class="trow"><span class="lbl">CGST Amt</span><span class="c">:</span><span class="val">${val(cgstV)}</span></div>
    <div class="trow"><span class="lbl">SGST Amt</span><span class="c">:</span><span class="val">${val(sgstV)}</span></div>
    <div class="trow"><span class="lbl">IGST Amt</span><span class="c">:</span><span class="val">${dash}</span></div>
    <div class="trow"><span class="lbl">Freight/ Packing Charge</span><span class="c">:</span><span class="val">${dash}</span></div>
    <div class="trow"><span class="lbl">Round Off</span><span class="c">:</span><span class="val">${roundOff !== 0 ? `${roundOff > 0 ? '' : '-'}${amt2(Math.abs(roundOff))}` : dash}</span></div>
    <div class="trow grand"><span class="lbl">Total Amount</span><span class="c">:</span><span class="val">${amt2(bill.total)}</span></div>`;

  const partyRow = (k: string, v: string) =>
    `<div class="prow"><span class="k">${esc(k)}</span><span class="c">:</span><span class="v">${esc(v)}</span></div>`;

  const btoRows = [
    partyRow('Name', bill.customerName || 'Cash Sale'),
    partyRow('Address', bill.customerAddress || ''),
    bill.customerMobile ? partyRow('Mobile', bill.customerMobile) : '',
  ].join('');

  const ordNo = (bill.transactionId || '').trim();
  const ibox1 = [
    partyRow('Bill No.', bill.billNumber || '—'),
    partyRow('Tax Date', fmtTaxDate(bill.date)),
    partyRow('Payment Mode', methodLabel),
    partyRow('Reverse Charge', 'No'),
  ].join('');
  const ibox2 = [
    partyRow("Buyer's Order No.", ordNo),
    partyRow("Supplier's Ref.", ''),
    partyRow('Vehicle Number', ''),
    partyRow('Delivery Date', ''),
    partyRow('Transport Details', ''),
    partyRow('Terms Of Delivery', ''),
  ].join('');

  const bankRows = [
    shop.bankName ? partyRow('Bank Name', shop.bankName) : '',
    shop.bankBranch ? partyRow('Branch', shop.bankBranch) : '',
    shop.bankAccountNo ? partyRow('Account No.', shop.bankAccountNo) : '',
    shop.bankIfsc ? partyRow('IFSC Code', shop.bankIfsc) : '',
    shop.upi ? partyRow('UPI ID', shop.upi) : '',
  ].join('');

  // declaration lines — settings terms, else the reference's 4 defaults
  const declLines = (shop.terms ? shop.terms.split(/\r?\n+/) : [])
    .map((s) => s.trim().replace(/^\d+[.)]\s*/, ''))
    .filter(Boolean);
  const DECL_DEFAULTS = [
    'Subject to local jurisdiction.',
    'Interest @ 18% p.a. will be charged if the payment is not made within due date.',
    'Our risk & responsibility ceases after delivery of goods.',
    'E. & O.E.',
  ];
  const declItems = declLines.length ? declLines : DECL_DEFAULTS;

  // legacy default thankyou note → the reference footer text
  const footTxt =
    !shop.thankyou || shop.thankyou === 'Thank you for your business!'
      ? 'Thank You For Doing Business With Us!'
      : shop.thankyou;

  const qr = safeImgDataUrl(shop.qr);
  const sig = safeImgDataUrl(shop.signature);

  const body = `
<div class="sheet">
  <div class="inner">
    <div class="head">
      <div class="bag">${bagLogoSvg()}</div>
      <div class="vsep"></div>
      <div class="hinfo">
        ${shop.gst ? `<div class="h-gstin">GSTIN : ${esc(shop.gst)}</div>` : ''}
        <div class="h-name">${esc(shop.name)}</div>
        ${shop.proprietor ? `<div class="h-sub">${esc(shop.proprietor)}</div>` : ''}
        ${shop.address ? `<div class="h-addr">${I_PIN}<span>${esc(shop.address)}</span></div>` : ''}
        ${shop.phone ? `<div class="h-addr">${I_PHONE}<span>Contact No : ${esc(shop.phone)}</span></div>` : ''}
      </div>
      <div class="dup">Original Duplicate Bill</div>
    </div>

    <div class="mid">
      <div class="colL">
        <div class="pbox"><span class="pill">Bill To</span>${btoRows}</div>
        <div class="pbox"><span class="pill">Ship To</span>${btoRows}</div>
      </div>
      <div class="colR">
        <div class="ibox">${ibox1}</div>
        <div class="ibox">${ibox2}</div>
      </div>
    </div>

    <div class="tblwrap">
      <table class="items">
        <thead>
          <tr>
            <th rowspan="2" style="width:5%">Sl.</th>
            <th rowspan="2" style="width:26%">Goods &amp; Service Description</th>
            <th rowspan="2" style="width:8%">HSN</th>
            <th rowspan="2" style="width:10%">Quantity</th>
            <th rowspan="2" style="width:10%">Rate</th>
            <th rowspan="2" style="width:12%">Taxable Value</th>
            <th colspan="2" style="width:19%">GST</th>
            <th rowspan="2" style="width:10%">Total</th>
          </tr>
          <tr class="subrow"><th>Rate</th><th>Amt</th></tr>
        </thead>
        <tbody>
          ${itemRows}
          ${fillerRows}
        </tbody>
      </table>
    </div>

    <div class="bot">
      <div class="botL">
        <div class="pbox"><span class="pill">Our Bank Details</span>${bankRows}
          <div class="inwords"><span class="lbl">Invoice Total (InWords) :</span><div class="val">${esc(amountInWords(bill.total || 0))}</div></div>
        </div>
      </div>
      <div class="botR">
        <div class="totbox">${totRows}
        </div>
      </div>
    </div>

    <div class="botm">
      <div class="decl">
        <span class="pill">Declaration :</span>
        <ol>${declItems.map((d) => `<li>${esc(d)}</li>`).join('')}</ol>
      </div>
      <div class="qrwrap">${qr ? `<img src="${qr}" alt="QR">` : qrPlaceholderSvg()}</div>
      <div class="sigc">
        <div class="for">For, ${esc(shop.name)}</div>
        ${sig ? `<img src="${sig}" alt="signature">` : sigScribbleSvg()}
        <div class="cap">Authorised Signatory</div>
      </div>
    </div>
  </div>

  <div class="footband"><span class="ln"></span><span class="tx">${esc(footTxt)}</span><span class="ln"></span></div>
</div>`;

  return billShell(`${shop.name} — ${bill.billNumber}`, body);
}

// ── document 2: sold-products report (all bills in a period) ───

export function buildSoldProductsReportHtml(
  bills: Bill[],
  opts: { from?: string; to?: string; lang: AdminLang; settings?: BillingSettings | null }
): string {
  const lang = opts.lang;
  const t = (k: string) => ta(k, lang);
  const shop = resolveShop(bills[0] || ({ shopSnapshot: {} } as unknown as Bill), opts.settings);

  const periodLabel =
    opts.from && opts.to
      ? opts.from === opts.to
        ? fmtDate(opts.from)
        : `${fmtDate(opts.from)} → ${fmtDate(opts.to)}`
      : t('bills.allTime');

  // sorted chronological rows (bill → item)
  const rows = bills
    .slice()
    .sort((a, b) =>
      a.date === b.date ? String(a.createdAt).localeCompare(String(b.createdAt)) : a.date.localeCompare(b.date)
    )
    .flatMap((b) =>
      (b.items || []).map((it) => ({
        date: b.date,
        billNo: b.billNumber,
        customer: b.customerName,
        name: it.name,
        qty: it.quantity,
        rate: it.unitPrice,
        total: it.total,
      }))
    );

  const prodMap = new Map<string, { qty: number; amount: number }>();
  let totalQty = 0;
  let totalAmount = 0;
  let paid = 0;
  let due = 0;
  for (const b of bills) {
    paid += b.paidAmount || 0;
    due += b.dueAmount || 0;
  }
  for (const r of rows) {
    totalQty += r.qty;
    totalAmount += r.total;
    const e = prodMap.get(r.name) || { qty: 0, amount: 0 };
    e.qty += r.qty;
    e.amount += r.total;
    prodMap.set(r.name, e);
  }
  const topProducts = [...prodMap.entries()].sort((a, b) => b[1].amount - a[1].amount);

  const detailRows = rows.length
    ? rows
        .map(
          (r, i) =>
            `<tr><td>${i + 1}</td><td>${fmtDate(r.date)}</td><td>${esc(r.billNo || '—')}</td><td>${esc(
              r.customer || '—'
            )}</td><td>${esc(r.name)}</td><td class="r">${r.qty}</td><td class="r">${money(r.rate)}</td><td class="r">${money(
              r.total
            )}</td></tr>`
        )
        .join('')
    : '';

  const summaryRows = topProducts
    .map(
      ([name, e], i) =>
        `<tr><td>${i + 1}</td><td>${esc(name)}</td><td class="r">${e.qty}</td><td class="r">${money(e.amount)}</td></tr>`
    )
    .join('');

  const shopSub = [
    shop.proprietor ? `<p class="proprietor">${esc(shop.proprietor)}</p>` : '',
    shop.address ? `<p class="shopline">${escMultiline(shop.address)}</p>` : '',
    contactBits(shop) ? `<p class="shopline">${esc(contactBits(shop))}</p>` : '',
  ].join('');

  const termsItems = shop.terms
    .split(/\r?\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const termsBlock = termsItems.length
    ? `<div class="terms"><p class="t">${esc(t('print.termsTitle'))}</p><ul>${termsItems
        .map((x) => `<li>${esc(x)}</li>`)
        .join('')}</ul></div>`
    : '';

  const body = `
<div class="doc">
<div class="head">
  <div class="brandline">
    ${monogramHtml(shop.name)}
    <div class="min-w-0">
      <p class="brand">${esc(shop.name)}</p>
      ${shopSub}
    </div>
  </div>
  <div style="text-align:right; flex:0 0 auto">
    <h2 class="doc-title">${esc(t('bills.soldReport'))}</h2>
    <p class="sub" style="color:#6B7280;font-size:11px;margin:3px 0 0">${esc(t('rep.period'))}: ${esc(periodLabel)}</p>
  </div>
</div>

<div class="summary-box">
  <div class="chip"><div class="k">${esc(t('bills.billNo'))}</div><div class="v">${bills.length}</div></div>
  <div class="chip"><div class="k">${esc(t('bills.qtySold'))}</div><div class="v">${totalQty}</div></div>
  <div class="chip"><div class="k">${esc(t('rep.totalSales'))}</div><div class="v">${money(totalAmount)}</div></div>
  <div class="chip"><div class="k">${esc(t('print.totalPaid'))}</div><div class="v">${money(paid)}</div></div>
  <div class="chip"><div class="k">${esc(t('print.totalDue'))}</div><div class="v">${money(due)}</div></div>
</div>

${summaryRows ? `<p class="sec">${esc(t('print.productSummary'))}</p>
<table><thead><tr><th style="width:34px">#</th><th>${esc(t('prod.name'))}</th><th class="r">${esc(
    t('bills.qtySold')
  )}</th><th class="r">${esc(t('bills.total'))}</th></tr></thead>
<tbody>${summaryRows}</tbody></table>` : ''}

${detailRows ? `<p class="sec">${esc(t('print.detailList'))}</p>
<table><thead><tr><th style="width:34px">#</th><th>${esc(t('exp.date'))}</th><th>${esc(t('bills.billNo'))}</th><th>${esc(
    t('bills.customer')
  )}</th><th>${esc(t('prod.name'))}</th><th class="r">${esc(t('prod.qty'))}</th><th class="r">${esc(
    t('prod.rate')
  )}</th><th class="r">${esc(t('bills.total'))}</th></tr></thead>
<tbody>${detailRows}
<tr class="tot"><td colspan="5">${esc(t('bills.grandTotal'))}</td><td class="r">${totalQty}</td><td class="r"></td><td class="r">${money(
    totalAmount
  )}</td></tr>
</tbody></table>` : (!summaryRows ? `<p class="sec">${esc(t('bills.noBillsPrint'))}</p>` : '')}

<div class="sig-row">
  <p class="thanks">${esc(shop.thankyou || t('print.thankyou'))}</p>
  <div class="sig-block">
    ${shop.name ? `<p class="sig-for"${shop.signature ? ' style="margin-bottom:2px"' : ''}>${esc(
      taf('print.sigFor', lang, { shop: shop.name })
    )}</p>` : ''}
    ${(() => { const sg = safeImgDataUrl(shop.signature); return sg ? `<img src="${sg}" alt="signature">` : ''; })()}
    <div class="sig-line">${esc(t('print.authorised'))}</div>
  </div>
</div>

${termsBlock}

<div class="foot">
  <span>${esc(t('print.generated'))}: ${new Date().toLocaleString('en-IN')}</span>
  <span>${esc(shop.name)}${shop.phone ? ` · ${esc(shop.phone)}` : ''}</span>
</div>
</div>`;

  return pageShell(`${shop.name} — ${t('bills.soldReport')}`, body);
}

// ── document 3: generic business report (reports page tabs) ────

export interface ReportColumn {
  label: string;
  right?: boolean;
  width?: string;
}

export interface ReportTable {
  sectionTitle?: string;
  columns: ReportColumn[];
  /** Pre-escaped HTML cell values, aligned with columns. */
  rows: string[][];
  /** Optional bold grand-total row. */
  totalRow?: string[];
}

export interface GenericReportOpts {
  title: string;
  periodLabel?: string;
  lang: AdminLang;
  /** Summary chips (label → value) shown in the summary box. */
  chips?: { k: string; v: string }[];
  tables: ReportTable[];
  note?: string;
  settings?: BillingSettings | null;
  /** Download-file name (without extension) used when the report is fetched as a PDF file. */
  pdfName?: string;
}

/** Escape helper for report cell values (callers build their own cell HTML). */
export function escHtml(s: unknown): string {
  return esc(s);
}

export function buildGenericReportHtml(opts: GenericReportOpts): string {
  const lang = opts.lang;
  const t = (k: string) => ta(k, lang);
  const shop = resolveShop({ shopSnapshot: {} } as unknown as Bill, opts.settings);

  const shopSub = [
    shop.proprietor ? `<p class="proprietor">${esc(shop.proprietor)}</p>` : '',
    shop.address ? `<p class="shopline">${escMultiline(shop.address)}</p>` : '',
    contactBits(shop) ? `<p class="shopline">${esc(contactBits(shop))}</p>` : '',
  ].join('');

  const chipsHtml = (opts.chips || []).length
    ? `<div class="summary-box">${(opts.chips || [])
        .map((c) => `<div class="chip"><div class="k">${esc(c.k)}</div><div class="v">${esc(c.v)}</div></div>`)
        .join('')}</div>`
    : '';

  const tablesHtml = opts.tables
    .map((tb) => {
      const head = `<tr>${tb.columns
        .map(
          (c) =>
            `<th${c.width ? ` style="width:${esc(c.width)}"` : ''}${c.right ? ' class="r"' : ''}>${esc(c.label)}</th>`
        )
        .join('')}</tr>`;
      const body = tb.rows
        .map(
          (cells) =>
            `<tr>${cells
              .map((cell, i) => `<td${tb.columns[i]?.right ? ' class="r"' : ''}>${cell}</td>`)
              .join('')}</tr>`
        )
        .join('');
      const total = tb.totalRow
        ? `<tr class="tot">${tb.totalRow
            .map((cell, i) => `<td${tb.columns[i]?.right ? ' class="r"' : ''}>${cell}</td>`)
            .join('')}</tr>`
        : '';
      const bodyBlock = body
        ? `<table><thead>${head}</thead><tbody>${body}${total}</tbody></table>`
        : `<p class="sec" style="color:#6B7280">${esc(t('rep.noData'))}</p>`;
      return `${tb.sectionTitle ? `<p class="sec">${esc(tb.sectionTitle)}</p>` : ''}${bodyBlock}`;
    })
    .join('\n');

  const body = `
<div class="doc">
<div class="head">
  <div class="brandline">
    ${monogramHtml(shop.name)}
    <div class="min-w-0">
      <p class="brand">${esc(shop.name)}</p>
      ${shopSub}
    </div>
  </div>
  <div style="text-align:right; flex:0 0 auto">
    <h2 class="doc-title">${esc(opts.title)}</h2>
    ${opts.periodLabel ? `<p class="sub" style="color:#6B7280;font-size:11px;margin:3px 0 0">${esc(t('rep.period'))}: ${esc(opts.periodLabel)}</p>` : ''}
  </div>
</div>

${chipsHtml}
${tablesHtml}
${opts.note ? `<p style="font-size:10.5px;color:#6B7280;margin:10px 0 0">${esc(opts.note)}</p>` : ''}

<div class="sig-row">
  <p class="thanks">${esc(shop.thankyou || t('print.thankyou'))}</p>
  <div class="sig-block">
    ${shop.name ? `<p class="sig-for"${shop.signature ? ' style="margin-bottom:2px"' : ''}>${esc(
      taf('print.sigFor', lang, { shop: shop.name })
    )}</p>` : ''}
    ${(() => { const sg = safeImgDataUrl(shop.signature); return sg ? `<img src="${sg}" alt="signature">` : ''; })()}
    <div class="sig-line">${esc(t('print.authorised'))}</div>
  </div>
</div>

<div class="foot">
  <span>${esc(t('print.generated'))}: ${new Date().toLocaleString('en-IN')}</span>
  <span>${esc(shop.name)}${shop.phone ? ` · ${esc(shop.phone)}` : ''}</span>
</div>
</div>`;

  return pageShell(`${shop.name} — ${opts.title}`, body);
}

/** One-call generic report printer (loads Bill Settings for the shop header).
 *  mode='print' → hidden-iframe browser print dialog (manual "Save as PDF");
 *  mode='pdf'   → direct .pdf FILE download (works in the Android WebView too). */
export async function printGenericReport(
  opts: Omit<GenericReportOpts, 'settings'>,
  mode: 'print' | 'pdf' = 'print'
): Promise<void> {
  let settings: BillingSettings | null = null;
  try {
    settings = await getBillingSettingsOffline(DEFAULT_USER_ID);
  } catch {
    /* fall back to the default header */
  }
  const html = buildGenericReportHtml({ ...opts, settings });
  if (mode === 'pdf') {
    await downloadHtmlAsPdf(html, `${opts.pdfName || 'ps-report'}.pdf`);
    return;
  }
  printHtml(html);
}

// ── one-call printers (load Bill Settings, then print) ─────────

/** Print the A4 invoice for one bill, using the CURRENT bill settings header. */
export async function printBillReceipt(bill: Bill, lang: AdminLang): Promise<void> {
  let settings: BillingSettings | null = null;
  try {
    settings = await getBillingSettingsOffline(DEFAULT_USER_ID);
  } catch {
    /* settings unavailable — fall back to the bill's own snapshot */
  }
  printHtml(buildBillReceiptHtml(bill, lang, settings));
}

/** Print the sold-products report for the given bills (A4, with shop header + signature). */
export async function printSoldProductsReport(
  bills: Bill[],
  opts: { from?: string; to?: string; lang: AdminLang }
): Promise<void> {
  let settings: BillingSettings | null = null;
  try {
    settings = await getBillingSettingsOffline(DEFAULT_USER_ID);
  } catch {
    /* fall back to bill snapshots */
  }
  printHtml(buildSoldProductsReportHtml(bills, { ...opts, settings }));
}
