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
import { halfRate } from '@/lib/gst';
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

/** Multiline text → escaped HTML with <br> line breaks. */
function escMultiline(s: unknown): string {
  return esc(s).replace(/\r?\n/g, '<br>');
}

// ── amount in words (Indian numbering) ─────────────────────────

const W_ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const W_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function wTwo(n: number): string {
  if (n < 20) return W_ONES[n] || '';
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return (W_TENS[tens] || '') + (ones ? ' ' + W_ONES[ones] : '');
}

function wInt(n: number): string {
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = Math.floor(n / 100);
  n %= 100;
  const out: string[] = [];
  if (crore) out.push(wInt(crore) + ' Crore');
  if (lakh) out.push(wTwo(lakh) + ' Lakh');
  if (thousand) out.push(wTwo(thousand) + ' Thousand');
  if (hundred) out.push((W_ONES[hundred] || '') + ' Hundred');
  if (n) out.push((out.length ? 'and ' : '') + wTwo(n));
  return out.join(' ');
}

/** "Rupees Twelve Lakh Three Hundred and Forty Five and Paise Fifty Only" */
function amountInWords(amount: number): string {
  const abs = Math.abs(Number(amount) || 0);
  const rupees = Math.floor(abs);
  const paise = Math.round((abs - rupees) * 100);
  let s = 'Rupees ' + wInt(rupees);
  if (paise > 0) s += ' and ' + wTwo(paise) + ' Paise';
  return s + ' Only';
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

// ── document 1: single-bill FULL-PAGE A4 invoice — premium multi-colour ──
//
// Task 75: premium restyle of the bill printout:
//   • true full-page A4 sheet — edge-to-edge colour bands top & bottom
//   • dark charcoal header: logo monogram + shop identity on the LEFT,
//     INVOICE No. / Dated / Payment on a white card docked on ONE side
//   • amber→orange accent strip + coloured TAX INVOICE ribbon
//   • Bill-To panel with a live payment-status chip (PAID / PARTIAL / DUE)
//   • dark-headed items grid with zebra rows + filler rows so the sheet
//     always looks complete; totals stay inside the grid (column-aligned)
//   • OUTPUT CGST/SGST rows, GRAND TOTAL on a dark plate + gold double rule
//   • amount in words, due-receivable callout, bank + QR, terms,
//     declaration, watermark, signature block and a dark footer strip

const GST_STATE_CODES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura',
  '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman & Nicobar Islands', '36': 'Telangana',
  '37': 'Andhra Pradesh', '38': 'Ladakh',
};

/** Tally money: plain Indian-grouped 2-decimals, NO ₹ symbol (e.g. 12,600.00). */
function tallyAmt(n: number | undefined | null): string {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Tally quantity: trim trailing zeros (1 → "1", 0.5 → "0.5"). */
function tallyQty(n: number): string {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)));
}

/** Tally dated format: 31-Oct-2025 */
function tallyDate(dateStr: string | undefined): string {
  if (!dateStr) return '—';
  const d = dateStr.length > 10 ? new Date(dateStr) : new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

/** "West Bengal , Code : 19" parsed from the shop GSTIN prefix. */
function stateFromGstin(gst: string): string | null {
  const m = (gst || '').trim().match(/^(\d{2})/);
  if (!m) return null;
  const name = GST_STATE_CODES[m[1]];
  return name ? `${name} , Code : ${m[1]}` : `State Code : ${m[1]}`;
}

const BILL_CSS = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin:0; padding:0; }
body { background:#fff; color:#111827; font-family:Arial,'Noto Sans Bengali','Hind Siliguri','Helvetica Neue',Helvetica,'Liberation Sans',sans-serif; font-size:10.5px; line-height:1.4; }

/* full-page A4 sheet — colour runs edge to edge */
.sheet { width:210mm; max-width:100%; min-height:296.6mm; margin:0 auto; background:#fff; position:relative; overflow:hidden; display:flex; flex-direction:column; }

/* thin royal edge at the very top of the sheet */
.topline { height:2.2mm; background:#1E3A8A; }

/* royal blue header — shop identity LEFT, invoice meta box docked RIGHT */
.hdr { background:#1E3A8A; color:#fff; margin:4mm 8mm 0; border-radius:2.5mm; padding:5mm 6mm; display:flex; justify-content:space-between; align-items:stretch; gap:6mm; }
.hbrand { min-width:0; flex:1 1 auto; }
.co-name { font-size:21px; font-weight:bold; letter-spacing:.8px; line-height:1.15; }
.co-sub { font-size:9px; color:#C7D8F5; font-weight:bold; letter-spacing:1.1px; text-transform:uppercase; margin-top:1.2px; }
.co-line { font-size:9px; color:#DCE6F8; margin-top:1.6px; line-height:1.5; }
.co-contact { font-size:9.5px; font-weight:bold; color:#fff; margin-top:2.2px; }
.co-contact .sep { color:#8FA9DD; padding:0 2mm; font-weight:normal; }

/* invoice meta — the bill number lives HERE, in a darker box on one side */
.invmeta { background:#17306E; border:1px solid rgba(255,255,255,.16); border-radius:2mm; padding:3.2mm 4.5mm; flex:0 0 47mm; color:#fff; }
.invmeta .k { font-size:7.5px; font-weight:bold; color:#9DB4E4; letter-spacing:1.3px; text-transform:uppercase; margin-top:2mm; }
.invmeta .k:first-child { margin-top:0; }
.invmeta .no { font-size:13px; font-weight:bold; letter-spacing:.4px; margin:.6mm 0 1.2mm; white-space:nowrap; }
.invmeta .v { font-size:10px; font-weight:bold; margin-top:.6mm; }

/* light blue title strip — INVOICE (left) · CUSTOMER COPY (right) */
.titlebar { display:flex; justify-content:space-between; align-items:center; background:#DCE9F9; margin:3.5mm 8mm 0; border-radius:1.6mm; padding:2.6mm 4.5mm; }
.titlebar .ttl { font-size:12.5px; font-weight:bold; color:#16306B; letter-spacing:3.5px; }
.titlebar .copy { font-size:8.5px; font-weight:bold; color:#5B74AD; letter-spacing:1.6px; }

/* bill-to panel + payment status panel */
.party { display:flex; gap:5mm; padding:4mm 8mm 0; }
.cap { font-size:7.8px; font-weight:bold; letter-spacing:1.4px; color:#5B74AD; text-transform:uppercase; margin-bottom:1.5px; }
.bto { flex:1 1 auto; min-width:0; border:1px solid #C3D4EC; border-left:2.6px solid #1E3A8A; border-radius:1.6mm; padding:2.8mm 3.5mm; background:#FBFDFF; }
.pname { font-size:13px; font-weight:bold; color:#0F1F45; }
.pline { font-size:9.3px; color:#3E5170; margin-top:1.2px; }
.pstat { flex:0 0 64mm; border-radius:1.6mm; padding:2.8mm 3.5mm; border:1px solid #BFDFC9; border-left:2.6px solid #1E8E3E; background:#E9F6EE; }
.pstat .cap { color:#1E8E3E; }
.pstat .st { font-size:11.5px; font-weight:bold; color:#1E8E3E; margin:.6mm 0 1mm; }
.pstat.partial { border-color:#F2DCB0; border-left-color:#D97706; background:#FFF7E6; }
.pstat.partial .cap, .pstat.partial .st { color:#B45309; }
.pstat.due { border-color:#F3C4C4; border-left-color:#C62828; background:#FDEDED; }
.pstat.due .cap, .pstat.due .st { color:#C62828; }
.payline { font-size:9.3px; color:#3E5170; margin-top:1px; }
.payline b { color:#0F1F45; }

/* items grid — royal header, light grid lines */
.tblwrap { padding:4mm 8mm 0; }
table.items { width:100%; border-collapse:collapse; border:1.4px solid #1E3A8A; }
.items th { background:#1E3A8A; color:#fff; font-size:8.8px; font-weight:bold; text-align:center; padding:2.6mm 2mm; letter-spacing:.8px; border:1px solid #2A4CA0; line-height:1.3; }
.items td { border:1px solid #D5E1F4; padding:2.3mm 2.5mm; font-size:10px; vertical-align:top; }
.items td.c, .items th.c { text-align:center; }
.items td.r { text-align:right; }
.items thead { display:table-header-group; }
.items tr { page-break-inside:avoid; }
.items tbody.rows tr:nth-child(even) td { background:#F4F8FD; }
.sn { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:8.5px; color:#6B7FA6; margin-top:1px; }
.cat { font-size:8.5px; font-weight:bold; color:#B45309; margin-top:1px; letter-spacing:.03em; }
.on { font-size:8.3px; color:#8296BC; white-space:nowrap; }
/* totals inside the grid — light blue rows, then the navy grand plate */
.items tbody.tots tr.tv td { background:#EFF5FC; font-weight:bold; color:#24355C; }
.items tbody.tots tr.split td.tqty { background:#DCE9F9; color:#16306B; text-align:center; font-weight:bold; font-size:10.5px; border:1px solid #B9CCEA; border-top:1.4px solid #1E3A8A; }
.items tbody.tots tr.split td.gtcell { background:#1E3A8A; color:#fff; text-align:center; font-weight:bold; font-size:11px; letter-spacing:1px; border:1px solid #1E3A8A; }
.items tbody.tots tr.split td.gtcell .amt { font-size:12.5px; letter-spacing:.4px; }

/* amount in words band + due callout */
.words { margin:3.5mm 8mm 0; background:#EFF5FC; border:1px solid #C3D4EC; border-radius:1.6mm; padding:2.4mm 3.5mm; font-size:10px; color:#24355C; }
.words b { color:#16306B; letter-spacing:.8px; }
.duebox { margin:3mm 8mm 0; background:#FDEDED; border:1px solid #F3C4C4; border-left:2.6px solid #C62828; border-radius:1.6mm; padding:2.4mm 3.5mm; font-size:9.8px; color:#C62828; font-weight:bold; }

/* bank / QR / signature row */
.mid { display:flex; gap:5mm; padding:4.5mm 8mm 0; align-items:stretch; }
.bank { flex:1 1 auto; min-width:0; font-size:9.3px; color:#24355C; }
.bank .cap2 { font-size:8.2px; font-weight:bold; letter-spacing:1.1px; color:#16306B; text-transform:uppercase; margin-bottom:1.5px; }
.bank div { margin-top:1.2px; }
.qrbox { flex:0 0 30mm; text-align:center; }
.qrbox img { width:24mm; height:24mm; object-fit:contain; border:1px solid #C3D4EC; border-radius:1.5mm; padding:1.2mm; background:#fff; }
.qrcap { font-size:7.8px; color:#5B74AD; font-weight:bold; margin-top:1mm; }
.sig { flex:0 0 62mm; display:flex; flex-direction:column; justify-content:space-between; align-items:flex-end; text-align:right; min-height:24mm; }
.sigfor { font-size:10px; font-weight:bold; color:#16306B; letter-spacing:.6px; }
.sigimg img { max-width:46mm; max-height:14mm; object-fit:contain; }
.sigline { border-top:1.4px solid #24355C; margin-top:1.6mm; padding-top:1.4mm; font-size:9px; color:#24355C; width:56mm; text-align:center; }

/* terms — bordered box, two Bengali columns like the reference */
.terms { margin:4mm 8mm 0; border:1.4px solid #1E3A8A; border-radius:1.6mm; padding:3mm 4mm; font-size:8.6px; color:#3E5170; line-height:1.5; column-count:2; column-gap:6mm; column-rule:1px solid #D5E1F5; }
.terms .ttitle { font-size:8.6px; font-weight:bold; color:#16306B; letter-spacing:1px; text-transform:uppercase; margin-bottom:1.5mm; column-span:all; }
.terms .tline { margin-top:1px; break-inside:avoid; }

/* declaration + thank-you */
.bottomrow { display:flex; justify-content:space-between; gap:8mm; padding:3.5mm 8mm 0; }
.decl { flex:1 1 auto; min-width:0; }
.decl .cap2 { font-size:7.8px; font-weight:bold; letter-spacing:1.3px; color:#5B74AD; text-transform:uppercase; margin-bottom:1px; }
.decl .dtxt { font-size:8.8px; color:#3E5170; line-height:1.5; }
.jur { font-size:8.5px; color:#8296BC; margin-top:1.6mm; }
.thanksbox { flex:0 0 62mm; text-align:right; font-size:8.8px; color:#3E5170; line-height:1.55; }

/* footer — royal navy bar, colour to the paper edge */
.foot { margin-top:auto; background:#1E3A8A; color:#fff; display:flex; justify-content:space-between; align-items:center; gap:6mm; padding:2.8mm 8mm; font-size:9px; font-weight:bold; letter-spacing:.4px; }
.foot .sep { color:#8FA9DD; padding:0 2mm; font-weight:normal; }
`;

function billShell(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${BILL_CSS}</style></head><body>${body}</body></html>`;
}

export function buildBillReceiptHtml(bill: Bill, _lang: AdminLang, settings?: BillingSettings | null): string {
  const shop = resolveShop(bill, settings);

  const gstOn = (bill.gstAmount || 0) > 0;
  const inclusiveGst = bill.gstMode === 'inclusive' && gstOn;
  const hasSplit = gstOn && bill.cgstAmount != null;
  const title = gstOn ? 'TAX INVOICE' : 'INVOICE';

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

  // per-item GST rate text — e.g. "18 %" / "5 %"
  const rateTxt = (() => {
    const r = Number(bill.gstRate) || 0;
    return `${Number.isInteger(r) ? r : Number(r.toFixed(2))} %`;
  })();
  // CGST/SGST each carry HALF the headline rate (18% GST → 9% + 9%)
  const halfTxt = (() => {
    const h = Number(halfRate(bill.gstRate)) || 0;
    return `${Number.isInteger(h) ? h : Number(h.toFixed(2))} %`;
  })();

  const qtyTotal = (bill.items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0);
  const itemSum = bill.subtotal || 0;

  // taxable base the tax was computed on (for the "On (…)" annotation)
  const taxableBase = inclusiveGst ? bill.taxableValue ?? 0 : itemSum - disc;

  // paise adjustment booked as "Round Off"
  const expectedTotal = itemSum - disc + (gstOn && !inclusiveGst ? gstAmt : 0);
  const roundOff = Math.round(((bill.total || 0) - expectedTotal) * 100) / 100;

  // payment-status panel — green PAID / amber PARTIAL / red DUE (reference style)
  const paidCls = due > 0.009 ? (paid > 0.009 ? 'partial' : 'due') : '';
  const stText = due > 0.009 ? (paid > 0.009 ? 'PARTIALLY PAID' : 'PAYMENT DUE') : '✓ PAID';

  const itemRows = (bill.items || [])
    .map((it, i) => {
      const sns = (it.serialNumbers || []).filter(Boolean);
      return (
        `<tr><td class="c">${i + 1}</td><td>${esc(it.name)}${
          it.categoryName ? `<div class="cat">Category: ${esc(it.categoryName)}</div>` : ''
        }${
          sns.length ? `<div class="sn">S/N: ${sns.map((s) => esc(s)).join(', ')}</div>` : ''
        }</td><td class="c">${tallyQty(it.quantity)}</td><td class="r">${tallyAmt(
          it.unitPrice
        )}</td><td class="c">Nos.</td><td class="r">${tallyAmt(it.total)}</td></tr>`
      );
    })
    .join('');

  // filler rows keep the grid full so a short bill still covers the A4 sheet
  const MIN_ROWS = 12;
  const fillers = Math.max(0, MIN_ROWS - (bill.items || []).length);
  const fillerRows = Array.from({ length: fillers }, () => `<tr>${'<td></td>'.repeat(6)}</tr>`).join('');

  // adjustment rows — light blue, inside the grid above the grand plate
  const discRow =
    disc > 0.009
      ? `<tr class="tv"><td colspan="5" class="r">Less: Discount</td><td class="r">${tallyAmt(disc)}</td></tr>`
      : '';

  // Inclusive bills (v2.13+) carry their own breakdown: the tax came OUT of
  // the entered amount, so show the taxable value the CGST/SGST sit on.
  const taxableRow =
    inclusiveGst ? `<tr class="tv"><td colspan="5" class="r">Taxable Value</td><td class="r">${tallyAmt(bill.taxableValue ?? 0)}</td></tr>` : '';

  const gstRows = !gstOn
    ? ''
    : hasSplit
      ? `<tr class="tv"><td colspan="5" class="r">OUTPUT CGST @ ${halfTxt}&nbsp;&nbsp;<span class="on">On (${tallyAmt(taxableBase)})</span></td><td class="r">${tallyAmt(bill.cgstAmount)}</td></tr>` +
        `<tr class="tv"><td colspan="5" class="r">OUTPUT SGST @ ${halfTxt}&nbsp;&nbsp;<span class="on">On (${tallyAmt(taxableBase)})</span></td><td class="r">${tallyAmt(bill.sgstAmount)}</td></tr>`
      : `<tr class="tv"><td colspan="5" class="r">OUTPUT GST @ ${rateTxt}&nbsp;&nbsp;<span class="on">On (${tallyAmt(taxableBase)})</span></td><td class="r">${tallyAmt(gstAmt)}</td></tr>`;

  const roundRow =
    Math.abs(roundOff) >= 0.005
      ? `<tr class="tv"><td colspan="5" class="r">Round Off</td><td class="r">${roundOff > 0 ? '' : '−'}${tallyAmt(Math.abs(roundOff))}</td></tr>`
      : '';

  // bottom split row — quantity band LEFT, navy GRAND TOTAL plate RIGHT
  const splitRow = `<tr class="split"><td colspan="3" class="tqty">Total quantity&nbsp;&nbsp;&nbsp;<b>${tallyQty(qtyTotal)} Nos.</b></td><td colspan="3" class="gtcell">GRAND TOTAL&nbsp;&nbsp;&nbsp;<span class="amt">₹ ${tallyAmt(bill.total)}</span></td></tr>`;

  const supplyState = shop.gst ? stateFromGstin(shop.gst) : null;
  const buyerLines = [
    `<div class="pname">${esc(bill.customerName || 'Cash Sale')}</div>`,
    bill.customerMobile ? `<div class="pline">☎ ${esc(bill.customerMobile)}</div>` : '',
    bill.customerAddress ? `<div class="pline">${esc(bill.customerAddress)}</div>` : '',
    supplyState ? `<div class="pline">Place of Supply : ${esc(supplyState)}</div>` : '',
    bill.note ? `<div class="pline">Note : ${esc(bill.note)}</div>` : '',
  ].join('');

  const dueBox =
    due > 0.009
      ? `<div class="duebox">Amount of Rs. ${tallyAmt(due)} (${esc(amountInWords(due))}) receivable from party.</div>`
      : '';

  const bankBits = [
    shop.proprietor ? `<div>A/c Holder: ${esc(shop.proprietor)}</div>` : '',
    shop.upi ? `<div>UPI ID: ${esc(shop.upi)}</div>` : '',
  ].filter(Boolean);
  const bankBlock = bankBits.length
    ? `<div class="cap2">Bank &amp; Payment Details</div>${bankBits.join('')}`
    : '';

  const termsItems = shop.terms
    .split(/\r?\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const termsBlock = termsItems.length
    ? `<div class="terms"><div class="ttitle">Terms &amp; Conditions</div>${termsItems
        .map((x) => `<div class="tline">${esc(x)}</div>`)
        .join('')}</div>`
    : '';

  const jurisdiction = /kolkata/i.test(shop.address) ? 'Kolkata' : 'West Bengal';

  const declBlock = `
  <div class="bottomrow">
    <div class="decl">
      <div class="cap2">Declaration</div>
      <div class="dtxt">We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.</div>
      <div class="jur">Subject to ${jurisdiction} Jurisdiction</div>
    </div>
    <div class="thanksbox">
      ${shop.thankyou ? esc(shop.thankyou) : 'Thank you for your business!'}<br>
      This is a computer generated invoice.
    </div>
  </div>`;

  const body = `
<div class="sheet">
  <div class="topline"></div>

  <div class="hdr">
    <div class="hbrand">
      <div class="co-name">${esc(shop.name)}</div>
      ${shop.proprietor ? `<div class="co-sub">${esc(shop.proprietor)}</div>` : ''}
      ${shop.address ? `<div class="co-line">${escMultiline(shop.address)}</div>` : ''}
      ${shop.phone || shop.gst ? `<div class="co-contact">${[
        shop.phone ? `Phone: ${esc(shop.phone)}` : '',
        shop.gst ? `GSTIN: ${esc(shop.gst)}` : '',
      ].filter(Boolean).join('<span class="sep">|</span>')}</div>` : ''}
    </div>
    <div class="invmeta">
      <div class="k">Invoice No.</div>
      <div class="no">${esc(bill.billNumber || '—')}</div>
      <div class="k">Date</div>
      <div class="v">${tallyDate(bill.date)}</div>
      <div class="k">Payment Mode</div>
      <div class="v">${esc(methodLabel)}</div>
    </div>
  </div>

  <div class="titlebar"><span class="ttl">${esc(title)}</span><span class="copy">CUSTOMER COPY</span></div>

  <div class="party">
    <div class="bto">
      <div class="cap">Bill To</div>
      ${buyerLines}
    </div>
    <div class="pstat ${paidCls}">
      <div class="cap">Payment Status</div>
      <div class="st">${stText}</div>
      <div class="payline">Paid: <b>${money(paid)}</b></div>
      <div class="payline">Balance Due: <b>${money(due)}</b></div>
    </div>
  </div>

  <div class="tblwrap">
    <table class="items">
      <thead><tr>
        <th class="c" style="width:6%">SL.</th>
        <th style="width:44%">DESCRIPTION OF GOODS</th>
        <th class="c" style="width:10%">QTY</th>
        <th class="c" style="width:13%">RATE</th>
        <th class="c" style="width:8%">PER</th>
        <th class="c" style="width:19%">AMOUNT</th>
      </tr></thead>
      <tbody class="rows">
        ${itemRows}
        ${fillerRows}
      </tbody>
      <tbody class="tots">
        ${discRow}
        ${taxableRow}
        ${gstRows}
        ${roundRow}
        ${splitRow}
      </tbody>
    </table>
  </div>

  <div class="words"><b>AMOUNT IN WORDS</b>&nbsp;&nbsp; ${esc(amountInWords(bill.total))}</div>
  ${dueBox}

  <div class="mid">
    <div class="bank">
      ${bankBlock}
    </div>
    <div class="qrbox">${shop.qr ? `<img src="${shop.qr}" alt="payment QR"><div class="qrcap">Scan to Pay</div>` : ''}</div>
    <div class="sig">
      <div class="sigfor">FOR ${esc((shop.name || 'PS TELECOM').toUpperCase())}</div>
      <div class="sigimg">${shop.signature ? `<img src="${shop.signature}" alt="signature">` : ''}</div>
      <div class="sigline">Authorised Signatory</div>
    </div>
  </div>

  ${termsBlock}
  ${declBlock}

  <div class="foot">
    <div><b>${esc(shop.name)}</b>${shop.phone ? `<span class="sep">|</span>${esc(shop.phone)}` : ''}</div>
    <div>${esc(bill.billNumber || '')}</div>
  </div>
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
    ${shop.signature ? `<img src="${shop.signature}" alt="signature">` : ''}
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
    ${shop.signature ? `<img src="${shop.signature}" alt="signature">` : ''}
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
