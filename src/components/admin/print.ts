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


// ── document 1: single-bill FULL-PAGE A4 invoice — "PS TELECOM GST Invoice" ──
//
// Task 91 (v2.40.0): the admin bill template is now a same-to-same rebuild of
// the owner's reference design (upload/PS Telecom GST Invoice Design.png):
//   • deep-navy outer frame + gold keyline + cream paper with gold corner arcs
//   • header: circular gold PS monogram (left) · PS TELECOM + "Mobile &
//     Accessories" + script tagline (centre) · navy/gold TAX INVOICE +
//     GST INVOICE ribbon (right)
//   • gold service medallions row — Mobile | Accessories | Service | Recharge
//   • white meta card: Invoice No. / Invoice Date / Order No. (transactionId)
//     + gold-bordered payment QR with "Scan to Verify"
//   • navy "Bill To" banner + gold-edged customer card (name / mobile)
//   • navy-headed items grid with HSN Code column: # | Product Name | HSN
//     Code | Qty | Rate (₹) | Amount (₹)
//   • black/gold "100% Trusted Shop" seal + totals plate: Taxable Amount,
//     CGST/SGST @ half-rate, Round Off, navy GRAND TOTAL band
//   • green-check payment box (Mode / Status / Due) + Authorized Signature
//   • script "Thank You!" + Keep Shopping + CSS phone mock-up
//   • navy footer strip: Best Price | Best Service | Happy Customer | gold
//     script "Visit Again…"
// Pure CSS/SVG art only (inline SVG with xmlns — print iframe AND html2canvas
// PDF both render it; no emoji, no external images, no box-shadows).

/** Tally money: plain Indian-grouped 2-decimals, NO ₹ symbol (e.g. 12,600.00). */
function tallyAmt(n: number | undefined | null): string {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Tally quantity: trim trailing zeros (1 → "1", 0.5 → "0.5"). */
function tallyQty(n: number): string {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)));
}

// ── inline SVG icon set (fixed size + xmlns → print & html2canvas safe) ──

const PS_NAVY = '#0E2A5C';
const PS_GOLD = '#F2C94C';

function psStrokeIcon(inner: string, size = 20, color = PS_NAVY): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

const ICO_MOBILE = psStrokeIcon('<rect x="7" y="2" width="10" height="20" rx="2.5"/><line x1="10.5" y1="18.5" x2="13.5" y2="18.5"/>');
const ICO_HEADSET = psStrokeIcon('<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>');
const ICO_WRENCH = psStrokeIcon('<path d="M14.7 6.3a4.5 4.5 0 0 0-6.4 5.7L3 17.3V21h3.7l5.3-5.3a4.5 4.5 0 0 0 5.7-6.4l-2.9 2.9-2.5-.5-.5-2.5z"/>');
const ICO_RECHARGE = psStrokeIcon('<rect x="2" y="8" width="16" height="9" rx="2"/><line x1="20.5" y1="10.5" x2="20.5" y2="14.5"/><path d="M10 9.5 7.5 13h3L8.5 16l4-4h-3z"/>');
const ICO_PERSON = `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="${PS_GOLD}"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7v1H4z"/></svg>`;
const ICO_SHIELD = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="${PS_GOLD}"><path d="M12 2l8 3v6c0 5-3.4 9.5-8 11-4.6-1.5-8-6-8-11V5z"/><path d="M8.7 11.8l2.3 2.3 4.3-4.3" fill="none" stroke="#0B2148" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICO_WRENCH_GOLD = psStrokeIcon('<path d="M14.7 6.3a4.5 4.5 0 0 0-6.4 5.7L3 17.3V21h3.7l5.3-5.3a4.5 4.5 0 0 0 5.7-6.4l-2.9 2.9-2.5-.5-.5-2.5z"/>', 14, PS_GOLD);
const ICO_STAR = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="${PS_GOLD}"><path d="M12 2l2.9 6.2 6.6.8-4.9 4.6 1.3 6.6-5.9-3.3-5.9 3.3 1.3-6.6L2.5 9l6.6-.8z"/></svg>`;

/** Two-letter brand initials for the circular logo tile (PS TELECOM → PS). */
function brandInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] || 'PS';
  return /^[A-Z]{2,3}$/.test(first)
    ? first
    : ((first[0] || 'P') + (parts[1]?.[0] || 'S')).toUpperCase();
}

const BILL_CSS = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin:0; padding:0; }
body { background:#fff; color:#0E2A5C; font-family:Arial,'Noto Sans Bengali','Hind Siliguri','Helvetica Neue',Helvetica,'Liberation Sans',sans-serif; font-size:10.5px; line-height:1.4; }

/* full-page A4 sheet — deep-navy frame, gold keyline, cream paper */
.sheet { width:210mm; max-width:100%; min-height:296.6mm; margin:0 auto; background:linear-gradient(135deg,#16356F 0%,#0B2148 50%,#16356F 100%); padding:2.8mm; display:flex; }
.frame { flex:1 1 auto; display:flex; flex-direction:column; background:linear-gradient(180deg,#FFFDF6 0%,#FFF8EA 55%,#FDF1D8 100%); border:0.55mm solid #D9B45C; position:relative; overflow:hidden; }

/* gold corner arcs — the reference's ribbon swirls, kept print-safe */
.arc { position:absolute; width:24mm; height:24mm; }
.arc.tl { top:1.2mm; left:1.2mm; border-top:1.2mm solid #D9B45C; border-left:1.2mm solid #D9B45C; border-top-left-radius:22mm; }
.arc.tr { top:1.2mm; right:1.2mm; border-top:1.2mm solid #D9B45C; border-right:1.2mm solid #D9B45C; border-top-right-radius:22mm; }
.arc.bl { bottom:1.2mm; left:1.2mm; border-bottom:1.2mm solid #D9B45C; border-left:1.2mm solid #D9B45C; border-bottom-left-radius:22mm; }
.arc.br { bottom:1.2mm; right:1.2mm; border-bottom:1.2mm solid #D9B45C; border-right:1.2mm solid #D9B45C; border-bottom-right-radius:22mm; }

/* header — circular PS monogram · brand block · TAX INVOICE ribbon */
.hdr { display:flex; align-items:center; gap:5mm; padding:7mm 7mm 2.5mm; }
.plogo { flex:0 0 24mm; width:24mm; height:24mm; border-radius:50%; background:linear-gradient(135deg,#F3D98B 0%,#D4A853 55%,#A67C34 100%); padding:1.7mm; }
.plogo .in { width:100%; height:100%; border-radius:50%; background:linear-gradient(160deg,#1A3C82 0%,#0B2148 80%); border:0.5mm solid #F3D98B; display:flex; align-items:center; justify-content:center; }
.plogo .in b { font-family:Georgia,'Times New Roman',serif; font-style:italic; font-size:18px; font-weight:900; color:#F2C94C; letter-spacing:.5px; }
.hmid { flex:1 1 auto; min-width:0; text-align:center; }
.co-name { font-size:27px; font-weight:900; color:#0E2A5C; letter-spacing:1.2px; line-height:1.05; }
.co-sub { font-size:14.5px; font-weight:800; color:#1D5AB9; margin-top:1mm; letter-spacing:.3px; }
.co-tag { font-family:'Segoe Script','Brush Script MT','Apple Chancery','Comic Sans MS',cursive; font-style:italic; font-weight:700; font-size:12px; color:#123A7E; margin-top:1.4mm; }
.co-gstin { font-size:8.5px; font-weight:700; color:#41527A; margin-top:1mm; letter-spacing:.4px; }
.taxinv { flex:0 0 auto; background:linear-gradient(180deg,#16356F 0%,#0B2148 100%); border:0.55mm solid #D9B45C; border-radius:2.6mm; padding:2.8mm 5mm 2.6mm; text-align:center; }
.taxinv .t1 { color:#FFFFFF; font-size:14.5px; font-weight:900; letter-spacing:.8px; line-height:1.15; white-space:nowrap; }
.taxinv .t2 { color:#F2C94C; font-size:8.5px; font-weight:800; letter-spacing:2.2px; margin-top:.9mm; }

/* services medallions — Mobile | Accessories | Service | Recharge */
.svcs { display:flex; align-items:stretch; margin:1.5mm 9mm 0; }
.svc { flex:1 1 0; text-align:center; padding:1.4mm 1mm; }
.svc + .svc { border-left:0.3mm solid rgba(14,42,92,.30); }
.svc .ic { width:10.5mm; height:10.5mm; margin:0 auto; border-radius:50%; background:linear-gradient(180deg,#F3D98B 0%,#D4A853 62%,#B08A3E 100%); display:flex; align-items:center; justify-content:center; }
.svc .ic svg { display:block; }
.svc .lb { font-size:9.5px; font-weight:800; color:#0E2A5C; margin-top:1.3mm; letter-spacing:.2px; }

/* meta card + verify QR */
.meta { display:flex; gap:5mm; align-items:stretch; margin:4.5mm 7mm 0; }
.mrows { flex:1 1 auto; min-width:0; background:#FFFFFF; border:0.45mm solid #E3D2A6; border-radius:2.6mm; padding:3mm 5mm; display:flex; flex-direction:column; justify-content:center; gap:1.5mm; }
.mrow { display:flex; align-items:baseline; font-size:12.5px; font-weight:800; color:#0E2A5C; }
.mrow .k { flex:0 0 30mm; }
.mrow .c { flex:0 0 7mm; }
.mrow .v { flex:1 1 auto; min-width:0; }
.qrbox { flex:0 0 33mm; background:#FFFFFF; border:0.55mm solid #D9B45C; border-radius:2mm; padding:2mm; display:flex; flex-direction:column; align-items:center; justify-content:center; }
.qrbox img { width:25mm; height:25mm; object-fit:contain; }
.qrbox .qc { font-size:10px; font-weight:800; color:#0E2A5C; margin-top:1.2mm; letter-spacing:.3px; }

/* Bill To — navy banner + gold-edged customer card */
.bto { margin:5mm 7mm 0; }
.bto-cap { display:inline-flex; align-items:center; gap:3mm; background:linear-gradient(90deg,#0B2148 0%,#16356F 55%,#2A50A0 100%); border:0.55mm solid #D9B45C; border-bottom:none; border-radius:2.6mm 2.6mm 0 0; padding:2.4mm 10mm 2.2mm 4.5mm; color:#FFFFFF; font-size:14px; font-weight:900; letter-spacing:.4px; }
.bto-cap svg { display:block; }
.bto-body { border:0.55mm solid #D9B45C; background:#FFFFFF; border-radius:0 2.6mm 2.6mm 2.6mm; padding:2.8mm 5.5mm; }
.brow { display:flex; align-items:baseline; font-size:12.5px; font-weight:800; color:#0E2A5C; padding:1mm 0; }
.brow .k { flex:0 0 34mm; }
.brow .c { flex:0 0 7mm; }
.brow .v { flex:1 1 auto; min-width:0; }

/* items grid — navy header with gold text, HSN Code column */
.tblwrap { margin:5mm 7mm 0; border:0.5mm solid #D9B45C; border-radius:1.2mm; overflow:hidden; }
table.items { width:100%; border-collapse:collapse; }
.items th { background:#0E2A5C; color:#F2C94C; font-size:11px; font-weight:800; text-align:center; padding:2.8mm 2mm; border:0.3mm solid #2A50A0; letter-spacing:.3px; line-height:1.25; }
.items td { background:#FFFFFF; border:0.3mm solid #1C3E7E; padding:2.5mm; font-size:11.5px; font-weight:600; color:#0E2A5C; vertical-align:top; }
.items td.c, .items th.c { text-align:center; }
.items td.r { text-align:right; }
.items thead { display:table-header-group; }
.items tr { page-break-inside:avoid; }
.cat { font-size:8.5px; font-weight:700; color:#A05A1F; margin-top:1px; }
.sn { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:8.5px; color:#41527A; margin-top:1px; }

/* trusted-shop seal + totals plate */
.grandrow { display:flex; gap:5mm; align-items:stretch; margin:5mm 7mm 0; }
.badgewrap { flex:0 0 62mm; display:flex; align-items:center; justify-content:center; padding:1mm 0; }
.badge { width:37mm; height:37mm; border-radius:50%; background:linear-gradient(180deg,#262B33 0%,#10141A 70%); border:1.3mm solid #D4A853; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:.5mm; }
.badge .b0 { color:#F2C94C; font-size:12px; line-height:1; }
.badge .b1 { color:#F2C94C; font-size:14.5px; font-weight:900; letter-spacing:.4px; line-height:1.1; }
.badge .b2 { color:#FFFFFF; font-size:9.5px; font-weight:800; letter-spacing:.4px; line-height:1.2; }
.badge .b3 { color:#F2C94C; font-size:8px; letter-spacing:2px; line-height:1; }
.totbox { flex:1 1 auto; min-width:0; background:#FFFFFF; border:0.55mm solid #D9B45C; border-radius:2mm; overflow:hidden; display:flex; flex-direction:column; justify-content:center; }
.trow { display:flex; justify-content:space-between; align-items:center; gap:4mm; padding:2.3mm 4.5mm; font-size:12px; font-weight:700; color:#0E2A5C; border-bottom:0.3mm solid #EADFC0; }
.trow .lbl { min-width:0; }
.trow .amt { flex:0 0 auto; font-weight:800; }
.trow.neg .amt { color:#15803D; }
.trow.grand { background:linear-gradient(90deg,#0B2148 0%,#16356F 100%); border-bottom:none; color:#F2C94C; font-size:14px; font-weight:900; padding:3mm 4.5mm; }
.trow.grand .amt { font-size:15.5px; letter-spacing:.4px; }

/* payment box + authorised signature */
.payrow { display:flex; gap:6mm; align-items:flex-end; margin:4.5mm 7mm 0; }
.paybox { flex:1 1 auto; min-width:0; background:#FFFFFF; border:0.55mm solid #D9B45C; border-radius:3mm; padding:3mm 4.5mm; display:flex; align-items:center; gap:4mm; }
.chk { flex:0 0 10mm; width:10mm; height:10mm; border-radius:50%; background:linear-gradient(180deg,#34C759 0%,#1FA342 100%); color:#FFFFFF; font-size:15px; font-weight:900; display:flex; align-items:center; justify-content:center; }
.plines { flex:1 1 auto; min-width:0; }
.pline { font-size:12.5px; font-weight:800; color:#0E2A5C; padding:.7mm 0; }
.pline .ok { color:#1FA342; }
.pline .part { color:#B45309; }
.pline .bad { color:#C62828; }
.sigwrap { flex:0 0 52mm; text-align:center; padding-bottom:1.5mm; }
.sigwrap img { max-width:50mm; max-height:13mm; object-fit:contain; display:block; margin:0 auto 1mm; }
.sigline { border-top:0.45mm solid #0E2A5C; padding-top:1.4mm; font-size:11px; font-weight:800; color:#0E2A5C; }

/* thank-you + phone mock-up */
.thanksrow { display:flex; align-items:flex-end; gap:6mm; margin:2mm 7mm 0; padding-bottom:7mm; }
.phonewrap { flex:0 0 30mm; display:flex; align-items:flex-end; justify-content:center; }
.phone { width:21mm; height:39mm; border-radius:3.6mm; background:linear-gradient(160deg,#1A3C82 0%,#0B2148 75%); padding:1.7mm; }
.phone .scr { width:100%; height:100%; border-radius:2.6mm; background:linear-gradient(150deg,#9BD1FF 0%,#4364F7 48%,#B23AF0 100%); position:relative; }
.phone .notch { position:absolute; top:1.2mm; left:6.5mm; width:8mm; height:1.6mm; border-radius:1mm; background:#0B2148; }
.thanksbox { flex:1 1 auto; min-width:0; text-align:center; padding-bottom:2.5mm; }
.ty { font-family:'Segoe Script','Brush Script MT','Apple Chancery','Comic Sans MS',cursive; font-style:italic; font-weight:800; font-size:29px; color:#1D5AB9; line-height:1.1; margin:0; }
.keep { font-size:11.5px; font-weight:800; font-style:italic; color:#0E2A5C; margin-top:1.6mm; }

/* navy footer strip */
.foot { margin-top:auto; background:linear-gradient(90deg,#0B2148 0%,#16356F 55%,#0B2148 100%); border-top:0.8mm solid #D9B45C; display:flex; align-items:center; gap:6mm; padding:3mm 7mm; }
.fitem { display:flex; align-items:center; gap:2.2mm; color:#FFFFFF; font-size:10.5px; font-weight:800; letter-spacing:.3px; }
.fitem svg { display:block; }
.fvisit { margin-left:auto; font-family:'Segoe Script','Brush Script MT','Apple Chancery','Comic Sans MS',cursive; font-style:italic; font-weight:800; font-size:15px; color:#F2C94C; }
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

  // CGST/SGST each carry HALF the headline rate (18% GST → 9% + 9%)
  const rateTxt = (() => {
    const r = Number(bill.gstRate) || 0;
    return `${Number.isInteger(r) ? r : Number(r.toFixed(2))} %`;
  })();
  const halfTxt = (() => {
    const h = Number(halfRate(bill.gstRate)) || 0;
    return `${Number.isInteger(h) ? h : Number(h.toFixed(2))} %`;
  })();

  // taxable base the CGST/SGST sit on (inclusive bills carry their own value)
  const taxableBase = inclusiveGst ? bill.taxableValue ?? 0 : (bill.subtotal || 0) - disc;

  // paise adjustment booked as "Round Off"
  const expectedTotal = (bill.subtotal || 0) - disc + (gstOn && !inclusiveGst ? gstAmt : 0);
  const roundOff = Math.round(((bill.total || 0) - expectedTotal) * 100) / 100;

  // payment status — green Paid / amber Partial / red Due (reference style)
  const stCls = due > 0.009 ? (paid > 0.009 ? 'part' : 'bad') : 'ok';
  const stText = due > 0.009 ? (paid > 0.009 ? 'Partial' : 'Due') : 'Paid';

  const itemRows = (bill.items || [])
    .map((it, i) => {
      const sns = (it.serialNumbers || []).filter(Boolean);
      const hsn = (it.hsnCode || '').trim() || '—';
      return (
        `<tr><td class="c">${i + 1}</td><td>${esc(it.name)}${
          it.categoryName ? `<div class="cat">${esc(it.categoryName)}</div>` : ''
        }${
          sns.length ? `<div class="sn">S/N: ${sns.map((s) => esc(s)).join(', ')}</div>` : ''
        }</td><td class="c">${esc(hsn)}</td><td class="c">${tallyQty(it.quantity)}</td><td class="r">${tallyAmt(
          it.unitPrice
        )}</td><td class="r">${tallyAmt(it.total)}</td></tr>`
      );
    })
    .join('');

  // filler rows keep the grid full so a short bill still covers the A4 sheet
  const MIN_ROWS = 10;
  const fillers = Math.max(0, MIN_ROWS - (bill.items || []).length);
  const fillerRows = Array.from({ length: fillers }, () => `<tr>${'<td></td>'.repeat(6)}</tr>`).join('');

  // totals plate rows — image order: Taxable → CGST → SGST → Grand Total
  const discRow =
    disc > 0.009
      ? `<div class="trow neg"><span class="lbl">Discount</span><span class="amt">− ₹${tallyAmt(disc)}</span></div>`
      : '';
  const taxableRow = gstOn
    ? `<div class="trow"><span class="lbl">Taxable Amount</span><span class="amt">₹${tallyAmt(taxableBase)}</span></div>`
    : '';
  const gstRows = !gstOn
    ? ''
    : hasSplit
      ? `<div class="trow"><span class="lbl">CGST @ ${halfTxt}</span><span class="amt">₹${tallyAmt(bill.cgstAmount)}</span></div>` +
        `<div class="trow"><span class="lbl">SGST @ ${halfTxt}</span><span class="amt">₹${tallyAmt(bill.sgstAmount)}</span></div>`
      : `<div class="trow"><span class="lbl">GST @ ${rateTxt}</span><span class="amt">₹${tallyAmt(gstAmt)}</span></div>`;
  const roundRow =
    Math.abs(roundOff) >= 0.005
      ? `<div class="trow"><span class="lbl">Round Off</span><span class="amt">${roundOff > 0 ? '+' : '−'} ₹${tallyAmt(Math.abs(roundOff))}</span></div>`
      : '';

  const qr = safeImgDataUrl(shop.qr);
  const sig = safeImgDataUrl(shop.signature);
  const ordNo = (bill.transactionId || '').trim();

  const body = `
<div class="sheet">
  <div class="frame">
    <div class="arc tl"></div><div class="arc tr"></div><div class="arc bl"></div><div class="arc br"></div>

    <div class="hdr">
      <div class="plogo"><div class="in"><b>${esc(brandInitials(shop.name))}</b></div></div>
      <div class="hmid">
        <div class="co-name">${esc(shop.name)}</div>
        <div class="co-sub">Mobile &amp; Accessories</div>
        <div class="co-tag">Your Trusted Mobile Partner</div>
        ${shop.gst && gstOn ? `<div class="co-gstin">GSTIN: ${esc(shop.gst)}</div>` : ''}
      </div>
      <div class="taxinv">
        <div class="t1">${gstOn ? 'TAX INVOICE' : 'INVOICE'}</div>
        ${gstOn ? '<div class="t2">GST INVOICE</div>' : ''}
      </div>
    </div>

    <div class="svcs">
      <div class="svc"><div class="ic">${ICO_MOBILE}</div><div class="lb">Mobile</div></div>
      <div class="svc"><div class="ic">${ICO_HEADSET}</div><div class="lb">Accessories</div></div>
      <div class="svc"><div class="ic">${ICO_WRENCH}</div><div class="lb">Service</div></div>
      <div class="svc"><div class="ic">${ICO_RECHARGE}</div><div class="lb">Recharge</div></div>
    </div>

    <div class="meta">
      <div class="mrows">
        <div class="mrow"><span class="k">Invoice No.</span><span class="c">:</span><span class="v">${esc(bill.billNumber || '—')}</span></div>
        <div class="mrow"><span class="k">Invoice Date</span><span class="c">:</span><span class="v">${esc(fmtDate(bill.date))}</span></div>
        ${ordNo ? `<div class="mrow"><span class="k">Order No.</span><span class="c">:</span><span class="v">${esc(ordNo)}</span></div>` : ''}
      </div>
      ${qr ? `<div class="qrbox"><img src="${qr}" alt="QR"><div class="qc">Scan to Verify</div></div>` : ''}
    </div>

    <div class="bto">
      <div class="bto-cap">${ICO_PERSON}<span>Bill To</span></div>
      <div class="bto-body">
        <div class="brow"><span class="k">Customer Name</span><span class="c">:</span><span class="v">${esc(bill.customerName || 'Cash Sale')}</span></div>
        ${bill.customerMobile ? `<div class="brow"><span class="k">Mobile No.</span><span class="c">:</span><span class="v">${esc(bill.customerMobile)}</span></div>` : ''}
        ${bill.customerAddress ? `<div class="brow"><span class="k">Address</span><span class="c">:</span><span class="v">${esc(bill.customerAddress)}</span></div>` : ''}
      </div>
    </div>

    <div class="tblwrap">
      <table class="items">
        <thead><tr>
          <th class="c" style="width:7%">#</th>
          <th style="width:37%">Product Name</th>
          <th class="c" style="width:14%">HSN Code</th>
          <th class="c" style="width:9%">Qty</th>
          <th class="r" style="width:15%">Rate (₹)</th>
          <th class="r" style="width:18%">Amount (₹)</th>
        </tr></thead>
        <tbody>
          ${itemRows}
          ${fillerRows}
        </tbody>
      </table>
    </div>

    <div class="grandrow">
      <div class="badgewrap">
        <div class="badge">
          <div class="b0">★</div>
          <div class="b1">100%</div>
          <div class="b2">Trusted Shop</div>
          <div class="b3">★★★★★</div>
        </div>
      </div>
      <div class="totbox">
        ${discRow}
        ${taxableRow}
        ${gstRows}
        ${roundRow}
        <div class="trow grand"><span class="lbl">Grand Total</span><span class="amt">₹ ${tallyAmt(bill.total)}</span></div>
      </div>
    </div>

    <div class="payrow">
      <div class="paybox">
        <div class="chk">✓</div>
        <div class="plines">
          <div class="pline">Payment Mode : ${esc(methodLabel)}</div>
          <div class="pline">Payment Status : <span class="${stCls}">${stText}</span></div>
          ${due > 0.009 ? `<div class="pline">Due Amount : <span class="bad">₹${tallyAmt(due)}</span></div>` : ''}
        </div>
      </div>
      <div class="sigwrap">
        ${sig ? `<img src="${sig}" alt="signature">` : ''}
        <div class="sigline">Authorized Signature</div>
      </div>
    </div>

    <div class="thanksrow">
      <div class="phonewrap">
        <div class="phone"><div class="scr"><div class="notch"></div></div></div>
      </div>
      <div class="thanksbox">
        <p class="ty">Thank You!</p>
        <div class="keep">${shop.thankyou ? esc(shop.thankyou) : 'Keep Shopping with PS TELECOM…'}</div>
      </div>
    </div>

    <div class="foot">
      <div class="fitem">${ICO_SHIELD}<span>Best Price</span></div>
      <div class="fitem">${ICO_WRENCH_GOLD}<span>Best Service</span></div>
      <div class="fitem">${ICO_STAR}<span>Happy Customer</span></div>
      <div class="fvisit">Visit Again…</div>
    </div>
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
