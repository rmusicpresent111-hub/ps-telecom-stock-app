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
// Task 92 (v2.41.0): owner REJECTED the v2.40 rebuild ("bill sevabe hoyni —
// abar regenerate koro, same to same hoya chai"). This revision is a faithful
// element-by-element recreation of upload/PS Telecom GST Invoice Design.png:
//   • cream paper + thin inset gold keyline + layered gold/navy corner
//     ribbon curves (SVG, page-anchored — not the old corner arcs)
//   • corner TAX INVOICE pennant top-right: navy wedge with gold edge,
//     serif gold TAX / INVOICE + white GST INVOICE (hidden when GST off)
//   • BIG serif header — huge Georgia PS TELECOM, blue serif Mobile &
//     Accessories, script tagline + gold swoosh, 40mm gold PS monogram
//   • four gold medallions (gold ring · navy core · white glyph):
//     Mobile | Accessories | Service | Recharge with hairline separators
//   • white meta card (Invoice No. / Invoice Date / Order No.) + gold QR
//     box "Scan to Verify" (real uploaded QR, or decorative placeholder)
//   • navy "Bill To" banner + GOLD-GRADIENT customer card (name / mobile)
//   • navy-headed items grid, GOLD-TINTED rows: # | Product Name | HSN
//     Code | Qty | Rate (₹) | Amount (₹) — HSN from BillItem.hsnCode
//   • laurel-wreath "100% Trusted Shop" rosette (crown + stars, SVG) +
//     white totals plate with navy grid lines and navy GRAND TOTAL band
//   • green-check payment pill (Mode / Status / Due) + Authorized
//     Signature (uploaded image, or script scribble placeholder)
//   • huge script "Thank You!" + Keep Shopping + 3-D phone back art
//   • navy footer WAVE: Best Price | Best Service | Happy Customer + gold
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

// ── inline SVG art set (fixed size + xmlns → print & html2canvas safe) ──

const PS_GOLD = '#F2C94C';

/** White stroke glyph used inside the navy service medallions. */
function glyph(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

const G_MOBILE = glyph('<rect x="7" y="2.5" width="10" height="19" rx="2.4"/><line x1="10.6" y1="18.4" x2="13.4" y2="18.4"/>');
const G_ACCESS = glyph('<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2.8" y="13.6" width="4.6" height="6.4" rx="1.8"/><rect x="16.6" y="13.6" width="4.6" height="6.4" rx="1.8"/>');
const G_SERVICE = glyph('<path d="M14.7 6.3a4.5 4.5 0 0 0-6.4 5.7L3 17.3V21h3.7l5.3-5.3a4.5 4.5 0 0 0 5.7-6.4l-2.9 2.9-2.5-.5-.5-2.5z"/>');
const G_RECHARGE = glyph('<rect x="2.5" y="7.5" width="15" height="9.5" rx="2"/><line x1="20.6" y1="10.6" x2="20.6" y2="14"/><path d="M11.6 9.3 8.6 12.9h3l-2.2 3.4 4.8-4.3h-3z" fill="#FFFFFF" stroke="none"/>');

const I_PERSON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#F2C94C"><circle cx="12" cy="7.4" r="4.1"/><path d="M3.8 21.4c0-4.3 3.7-6.8 8.2-6.8s8.2 2.5 8.2 6.8v.2H3.8z"/></svg>`;

const I_SHIELD = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="#F2C94C"><path d="M12 2l8.2 3v6.1c0 5.1-3.5 9.7-8.2 11.3-4.7-1.6-8.2-6.2-8.2-11.3V5z"/><path d="M8.5 11.7l2.4 2.4 4.7-4.7" fill="none" stroke="#0B2447" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const I_HANDSHAKE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path d="M3 12.2l4.6-4.6 4.1 3.3 3.9-3.1 5.6 4.6-4.4 5.3-4.4-3.5-3.6 3.1z" fill="#F2C94C"/></svg>`;

const I_STAR = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="#F2C94C"><path d="M12 2.2l2.9 6 6.6.9-4.8 4.6 1.2 6.6L12 17.1l-5.9 3.2 1.2-6.6L2.5 9.1l6.6-.9z"/></svg>`;

/** Green gradient check disc for the payment pill. */
function checkCircleSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 38 38"><defs><linearGradient id="psChk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3FD668"/><stop offset="1" stop-color="#17913B"/></linearGradient></defs><circle cx="19" cy="19" r="17.4" fill="url(#psChk)"/><path d="M11.6 19.8l5 5 10-11.2" fill="none" stroke="#FFFFFF" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** Gold swoosh under the script tagline. */
const TAGLINE_SWOOSH = `<svg class="swoosh" xmlns="http://www.w3.org/2000/svg" width="150" height="9" viewBox="0 0 150 9" aria-hidden="true"><path d="M2 7 C44 1.5 96 1.5 148 5.5" fill="none" stroke="#D4A62A" stroke-width="2" stroke-linecap="round"/></svg>`;

/**
 * Top page art — layered corner curves (left), TAX INVOICE corner pennant
 * (right) and the swoosh pair under it. Page-absolute coordinates on a
 * 794-wide viewBox stretched to the sheet width.
 */
function topDecoSvg(gstOn: boolean): string {
  const gstTxt = gstOn
    ? `<text x="740" y="110" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="12.5" font-weight="800" letter-spacing="1.2" fill="#FFFFFF">GST INVOICE</text>`
    : '';
  return `<svg class="deco top" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 794 186" preserveAspectRatio="none" aria-hidden="true">
  <defs><linearGradient id="psRib" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2653A4"/><stop offset=".45" stop-color="#12356F"/><stop offset="1" stop-color="#081A3C"/></linearGradient></defs>
  <path d="M-6 162 C78 152 116 108 124 -6" fill="none" stroke="#D4A62A" stroke-width="6.5"/>
  <path d="M-6 174 C88 164 126 116 134 -6" fill="none" stroke="#0E2A5C" stroke-width="1.7" opacity=".5"/>
  <path d="M-6 150 C68 140 104 100 112 -6" fill="none" stroke="#F2C94C" stroke-width="1.5" opacity=".75"/>
  <path d="M154 10 C330 27 470 22 556 5" fill="none" stroke="#DCBE6E" stroke-width="1.6" opacity=".8"/>
  <path d="M580 -6 C592 70 650 120 798 142 L798 -6 Z" fill="url(#psRib)"/>
  <path d="M580 -6 C592 70 650 120 798 142" fill="none" stroke="#D4A62A" stroke-width="5.5"/>
  <path d="M590 -6 C600 66 654 112 790 132" fill="none" stroke="#F7E39B" stroke-width="1.3" opacity=".8"/>
  <path d="M452 160 C550 124 662 118 792 154" fill="none" stroke="#D4A62A" stroke-width="4" opacity=".95"/>
  <path d="M452 166 C550 132 662 126 792 160" fill="none" stroke="#0E2A5C" stroke-width="1.2" opacity=".4"/>
  <text x="698" y="44" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="36" font-weight="900" letter-spacing="1" fill="#F5D061">TAX</text>
  <text x="714" y="82" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="29" font-weight="900" letter-spacing=".5" fill="#F5D061">INVOICE</text>
  ${gstTxt}
</svg>`;
}

/** Bottom page art — gold/navy curve pairs framing the footer wave. */
function bottomDecoSvg(): string {
  return `<svg class="deco bot" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 794 158" preserveAspectRatio="none" aria-hidden="true">
  <path d="M-6 16 C84 26 132 62 142 116" fill="none" stroke="#D4A62A" stroke-width="5.5"/>
  <path d="M-6 28 C74 38 118 70 128 122" fill="none" stroke="#0E2A5C" stroke-width="1.5" opacity=".5"/>
  <path d="M800 10 C706 20 656 48 648 100" fill="none" stroke="#D4A62A" stroke-width="5"/>
  <path d="M800 22 C712 32 666 58 658 106" fill="none" stroke="#0E2A5C" stroke-width="1.5" opacity=".5"/>
</svg>`;
}

/** Navy footer wave with double gold accents. */
function footerWaveSvg(): string {
  return `<svg class="wave" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 794 100" preserveAspectRatio="none" aria-hidden="true">
  <path d="M0 54 C110 22 250 68 410 46 C550 28 690 44 794 32 L794 100 L0 100 Z" fill="#0B2447"/>
  <path d="M0 52 C110 20 250 66 410 44 C550 26 690 42 794 30" fill="none" stroke="#D4A62A" stroke-width="4"/>
  <path d="M0 60 C110 28 250 74 410 52 C550 34 690 50 794 38" fill="none" stroke="#F7E39B" stroke-width="1.4" opacity=".7"/>
  <path d="M470 98 C580 78 700 84 794 64" fill="none" stroke="#D4A62A" stroke-width="3" opacity=".9"/>
</svg>`;
}

/**
 * "100% Trusted Shop" rosette — gold laurel branches, scalloped gold ring,
 * dark disc, crown, serif 100% + stars (reference centrepiece).
 */
function trustedBadgeSvg(): string {
  let leaves = '';
  for (let k = 0; k < 7; k++) {
    const degL = 118 + k * 21;
    const degR = 62 - k * 21;
    const R = 85;
    const lx = 100 + R * Math.cos((degL * Math.PI) / 180);
    const ly = 100 + R * Math.sin((degL * Math.PI) / 180);
    const rx = 100 + R * Math.cos((degR * Math.PI) / 180);
    const ry = 100 + R * Math.sin((degR * Math.PI) / 180);
    const rotL = (degL + 90).toFixed(1);
    const rotR = (degR + 90).toFixed(1);
    leaves += `<ellipse cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" rx="6" ry="15" fill="url(#psBg1)" transform="rotate(${rotL} ${lx.toFixed(1)} ${ly.toFixed(1)})"/>`;
    leaves += `<ellipse cx="${rx.toFixed(1)}" cy="${ry.toFixed(1)}" rx="6" ry="15" fill="url(#psBg1)" transform="rotate(${rotR} ${rx.toFixed(1)} ${ry.toFixed(1)})"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" aria-hidden="true">
  <defs>
    <linearGradient id="psBg1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F9E9B0"/><stop offset=".5" stop-color="#D9AC33"/><stop offset="1" stop-color="#8C6A1D"/></linearGradient>
    <linearGradient id="psBg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2C313D"/><stop offset="1" stop-color="#0B0E14"/></linearGradient>
  </defs>
  ${leaves}
  <circle cx="100" cy="100" r="80" fill="none" stroke="url(#psBg1)" stroke-width="13"/>
  <circle cx="100" cy="100" r="90" fill="none" stroke="#D4A62A" stroke-width="4" stroke-dasharray="4.5 4.5"/>
  <circle cx="100" cy="100" r="64" fill="url(#psBg2)"/>
  <circle cx="100" cy="100" r="64" fill="none" stroke="#D4A62A" stroke-width="1.4"/>
  <circle cx="100" cy="100" r="58" fill="none" stroke="#F7E39B" stroke-width="1" opacity=".55"/>
  <g transform="translate(100 50) scale(1.12)">
    <path d="M-15 8 L-15 -5 L-7 1 L0 -10 L7 1 L15 -5 L15 8 Z" fill="#F5D061"/>
    <rect x="-16" y="8" width="32" height="4.4" rx="1.6" fill="#D4A62A"/>
    <circle cx="0" cy="-12.6" r="2.4" fill="#F5D061"/>
  </g>
  <text x="100" y="97" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="33" font-weight="900" fill="#F5D061">100%</text>
  <text x="100" y="121" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="800" fill="#FFFFFF">Trusted</text>
  <text x="100" y="141" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="800" fill="#FFFFFF">Shop</text>
  <text x="100" y="160" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="12" fill="#F2C94C" letter-spacing="2.5">★ ★ ★ ★ ★</text>
</svg>`;
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

/** Script-style signature placeholder (uploaded signature replaces it). */
function sigScribbleSvg(): string {
  return `<svg class="scrib" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 52" aria-hidden="true"><path d="M8 40 C16 16 30 8 36 16 C41 23 30 30 25 23 C20 15 36 6 50 10 M48 30 C56 20 68 16 72 22 C76 28 66 32 62 26 C58 19 72 10 86 13 C98 16 96 26 106 22 C114 18 122 20 130 16" fill="none" stroke="#1A2C56" stroke-width="2.4" stroke-linecap="round"/></svg>`;
}

/** 3-D phone-back art docked above the footer wave (reference bottom-left). */
function phoneSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 210" aria-hidden="true">
  <defs><linearGradient id="psPhone" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F2F4FB"/><stop offset=".5" stop-color="#C6B4EE"/><stop offset="1" stop-color="#9C87DE"/></linearGradient></defs>
  <g transform="rotate(-10 60 105)">
    <rect x="15" y="6" width="90" height="198" rx="16" fill="url(#psPhone)" stroke="#8FA3C8" stroke-width="1.6"/>
    <rect x="24" y="16" width="48" height="48" rx="11" fill="#141B33" opacity=".94"/>
    <circle cx="36" cy="28" r="7" fill="#1E2C55" stroke="#44619C" stroke-width="1.6"/><circle cx="36" cy="28" r="2.8" fill="#0A1128"/>
    <circle cx="57" cy="28" r="7" fill="#1E2C55" stroke="#44619C" stroke-width="1.6"/><circle cx="57" cy="28" r="2.8" fill="#0A1128"/>
    <circle cx="36" cy="50" r="7" fill="#1E2C55" stroke="#44619C" stroke-width="1.6"/><circle cx="36" cy="50" r="2.8" fill="#0A1128"/>
    <circle cx="58" cy="50" r="3.2" fill="#F2C94C" opacity=".9"/>
    <rect x="106" y="56" width="3.4" height="24" rx="1.7" fill="#C9D2E8"/>
    <rect x="106" y="88" width="3.4" height="14" rx="1.7" fill="#C9D2E8"/>
  </g>
</svg>`;
}

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
body { background:#fff; color:#0E2A5C; font-family:Arial,'Noto Sans Bengali','Hind Siliguri','Helvetica Neue',Helvetica,'Liberation Sans',sans-serif; font-size:11px; line-height:1.4; }

/* full-page A4 sheet — cream paper, inset gold keyline, corner SVG art */
.sheet { position:relative; width:210mm; max-width:100%; min-height:296.6mm; margin:0 auto; background:linear-gradient(180deg,#FEFBF0 0%,#FCF3DC 46%,#F8EAC8 100%); overflow:hidden; display:flex; flex-direction:column; }
.keyline { position:absolute; top:3.2mm; right:3.2mm; bottom:3.2mm; left:3.2mm; border:0.35mm solid #E0C685; border-radius:2mm; z-index:0; pointer-events:none; }
.deco { position:absolute; left:0; width:100%; z-index:1; pointer-events:none; }
.deco.top { top:0; height:49mm; }
.deco.bot { bottom:0; height:42mm; }
.page { position:relative; z-index:2; flex:1 1 auto; display:flex; flex-direction:column; }

/* header — big gold PS monogram · huge serif brand block (pennant is SVG art) */
.hdr { display:flex; align-items:center; gap:4.5mm; padding:7.5mm 8mm 0 10mm; }
.plogo { flex:0 0 37mm; width:37mm; height:37mm; border-radius:50%; background:linear-gradient(135deg,#F9E9B0 0%,#D9AC33 42%,#8C6A1D 72%,#E9C766 100%); padding:2.1mm; }
.plogo .in { width:100%; height:100%; border-radius:50%; background:radial-gradient(circle at 36% 30%,#1E4788 0%,#0B2447 74%); border:0.5mm solid #F7E39B; display:flex; align-items:center; justify-content:center; }
.plogo .in b { font-family:Georgia,'Times New Roman',serif; font-style:italic; font-size:27px; font-weight:900; color:#F2C94C; letter-spacing:.5px; }
.hmid { flex:1 1 auto; min-width:0; text-align:center; padding-right:2mm; }
.co-name { font-family:Georgia,'Times New Roman',serif; font-size:36px; font-weight:900; color:#0E2A5C; letter-spacing:1.4px; line-height:1.05; }
.co-sub { font-family:Georgia,'Times New Roman',serif; font-size:20.5px; font-weight:800; color:#2447A9; margin-top:.8mm; letter-spacing:.3px; }
.co-tag { font-family:'Segoe Script','Brush Script MT','Apple Chancery','Comic Sans MS',cursive; font-style:italic; font-weight:700; font-size:14.5px; color:#153A78; margin-top:1mm; }
.swoosh { display:block; margin:.7mm auto 0; }
.co-gstin { font-size:9px; font-weight:700; color:#41527A; margin-top:.6mm; letter-spacing:.4px; }

/* services medallions — gold ring · navy core · white glyph */
.svcs { display:flex; align-items:stretch; margin:2mm 12mm 0; }
.svc { flex:1 1 0; text-align:center; padding:.6mm 1mm 0; }
.svc + .svc { border-left:0.3mm solid rgba(14,42,92,.28); }
.svc .ic { width:14.5mm; height:14.5mm; margin:0 auto; border-radius:50%; background:linear-gradient(150deg,#F7E39B 0%,#D9AC33 55%,#A67C2E 100%); padding:1.5mm; }
.svc .inn { width:100%; height:100%; border-radius:50%; background:radial-gradient(circle at 36% 30%,#1E4788 0%,#0B2447 74%); display:flex; align-items:center; justify-content:center; }
.svc .inn svg { display:block; }
.svc .lb { font-size:13px; font-weight:800; color:#0E2A5C; margin-top:1.1mm; letter-spacing:.2px; }

/* meta card + gold verify-QR box */
.meta { display:flex; gap:5mm; align-items:stretch; margin:3.4mm 8mm 0; }
.mrows { flex:1 1 auto; min-width:0; background:rgba(255,255,255,.93); border:0.4mm solid #EAD9A8; border-radius:2.5mm; padding:2.6mm 5mm; display:flex; flex-direction:column; justify-content:center; gap:1.4mm; }
.mrow { display:flex; align-items:baseline; font-size:16px; font-weight:800; color:#0E2A5C; }
.mrow .k { flex:0 0 34mm; }
.mrow .c { flex:0 0 6mm; }
.mrow .v { flex:1 1 auto; min-width:0; }
.qrbox { flex:0 0 36mm; background:#FFFFFF; border:0.6mm solid #D4A62A; border-radius:2.2mm; padding:1.8mm 1.8mm 1.3mm; display:flex; flex-direction:column; align-items:center; justify-content:center; }
.qrbox img, .qrbox svg { width:27.5mm; height:27.5mm; display:block; }
.qrbox .qc { font-size:12.5px; font-weight:800; color:#0E2A5C; margin-top:.9mm; letter-spacing:.2px; }

/* Bill To — navy banner + GOLD-GRADIENT customer card */
.bto { margin:3.4mm 8mm 0; }
.bto-cap { display:inline-flex; align-items:center; gap:3mm; background:linear-gradient(90deg,#0A1F44 0%,#14336B 55%,#24509E 100%); border:0.5mm solid #D4A62A; border-radius:2.8mm; padding:2.2mm 11mm 2.2mm 4.5mm; }
.bto-cap .t { font-size:20px; font-weight:900; color:#F5D061; letter-spacing:.6px; }
.bto-cap svg { display:block; }
.bto-body { margin-top:1.5mm; border:0.5mm solid #D4A62A; background:linear-gradient(180deg,#FCF1CC 0%,#F5E0A6 100%); border-radius:2.8mm; padding:2mm 5.5mm; }
.brow { display:flex; align-items:baseline; font-size:16px; font-weight:800; color:#0E2A5C; padding:.8mm 0; }
.brow .k { flex:0 0 42mm; }
.brow .c { flex:0 0 6mm; }
.brow .v { flex:1 1 auto; min-width:0; }

/* items grid — navy header, gold-tinted rows, navy cell lines */
.tblwrap { margin:3.4mm 8mm 0; border:0.5mm solid #0E2A5C; border-radius:1.6mm; overflow:hidden; background:#FDF3DC; }
table.items { width:100%; border-collapse:collapse; }
.items th { background:#0B2447; color:#F2C94C; font-size:14px; font-weight:800; text-align:center; padding:2.8mm 2mm; border:0.3mm solid #274F94; letter-spacing:.3px; }
.items td { background:#FDF3DC; border:0.3mm solid #14336B; padding:3mm 2mm; font-size:14px; font-weight:700; color:#0E2A5C; vertical-align:middle; }
.items td.c, .items th.c { text-align:center; }
.items td.r, .items th.r { text-align:center; padding-right:0; }
.items thead { display:table-header-group; }
.items tr { page-break-inside:avoid; }
.cat { font-size:9px; font-weight:700; color:#A05A1F; margin-top:1px; }
.sn { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:9px; color:#41527A; margin-top:1px; }

/* trusted-shop rosette + navy totals plate */
.grandrow { display:flex; gap:5mm; align-items:center; margin:3.4mm 8mm 0; }
.badgewrap { flex:0 0 56mm; display:flex; align-items:center; justify-content:center; }
.badgewrap svg { width:43mm; height:43mm; }
.totbox { flex:1 1 auto; min-width:0; background:#FFFFFF; border:0.5mm solid #0E2A5C; border-radius:2mm; overflow:hidden; }
.trow { display:flex; justify-content:space-between; align-items:center; gap:4mm; padding:2.5mm 4.5mm; font-size:15px; font-weight:800; color:#0E2A5C; border-bottom:0.35mm solid #14336B; }
.trow .lbl { min-width:0; }
.trow .amt { flex:0 0 auto; }
.trow.neg .amt { color:#15803D; }
.trow.grand { background:linear-gradient(90deg,#0A1F44 0%,#15336B 100%); border-bottom:none; color:#F5D061; font-size:18px; font-weight:900; padding:2.9mm 4.5mm; }
.trow.grand .amt { font-size:20px; letter-spacing:.4px; }

/* payment pill + authorised signature */
.payrow { display:flex; align-items:center; gap:8mm; margin:3.8mm 8mm 0; }
.paybox { display:inline-flex; align-items:center; gap:3.6mm; margin-left:40mm; background:#FFFFFF; border:0.6mm solid #D4A62A; border-radius:14mm; padding:2.4mm 8mm 2.4mm 3mm; }
.chkbox { flex:0 0 auto; }
.chkbox svg { width:11.5mm; height:11.5mm; display:block; }
.plines { min-width:0; }
.pline { font-size:15.5px; font-weight:800; color:#0E2A5C; padding:.5mm 0; white-space:nowrap; }
.pline .ok { color:#1FA342; }
.pline .part { color:#B45309; }
.pline .bad { color:#C62828; }
.sigwrap { margin-left:auto; flex:0 0 46mm; text-align:center; }
.sigwrap img { max-width:44mm; max-height:13mm; object-fit:contain; display:block; margin:0 auto; }
.sigwrap svg { width:36mm; height:13.5mm; display:block; margin:0 auto; }
.sigcap { font-size:13.5px; font-weight:800; color:#0E2A5C; margin-top:.4mm; }

/* thank-you script row */
.thanksrow { display:flex; align-items:flex-end; margin:1mm 8mm 0; padding-bottom:3mm; }
.thanksbox { flex:1 1 auto; min-width:0; text-align:center; padding-right:34mm; padding-bottom:1mm; }
.ty { font-family:'Segoe Script','Brush Script MT','Apple Chancery','Comic Sans MS',cursive; font-style:italic; font-weight:800; font-size:39px; color:#1D5AB9; line-height:1.05; margin:0; }
.keep { font-size:14px; font-weight:800; font-style:italic; color:#0E2A5C; margin-top:1.2mm; }

/* 3-D phone art docked above the footer wave */
.phoneart { position:absolute; left:2.5mm; bottom:19mm; width:31mm; z-index:2; pointer-events:none; }
.phoneart svg { width:100%; height:auto; display:block; }

/* navy footer wave */
.foot { margin-top:auto; position:relative; height:20mm; }
.foot svg.wave { position:absolute; top:0; left:0; width:100%; height:100%; display:block; }
.fcontent { position:relative; z-index:2; display:flex; align-items:center; gap:7mm; height:100%; padding:5mm 8mm 0; }
.fitem { display:flex; align-items:center; gap:2.2mm; color:#FFFFFF; font-size:12.5px; font-weight:800; letter-spacing:.3px; }
.fitem svg { display:block; }
.fvisit { margin-left:auto; font-family:'Segoe Script','Brush Script MT','Apple Chancery','Comic Sans MS',cursive; font-style:italic; font-weight:800; font-size:20px; color:#F5D061; }
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

  // the reference shows a full 3-row grid — pad shorter bills so the
  // sheet never shows a collapsed table
  const MIN_ROWS = 3;
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
  <div class="keyline"></div>
  ${topDecoSvg(gstOn)}
  ${bottomDecoSvg()}
  <div class="page">
    <div class="hdr">
      <div class="plogo"><div class="in"><b>${esc(brandInitials(shop.name))}</b></div></div>
      <div class="hmid">
        <div class="co-name">${esc(shop.name)}</div>
        <div class="co-sub">Mobile &amp; Accessories</div>
        <div class="co-tag">Your Trusted Mobile Partner</div>
        ${TAGLINE_SWOOSH}
        ${shop.gst && gstOn ? `<div class="co-gstin">GSTIN: ${esc(shop.gst)}</div>` : ''}
      </div>
    </div>

    <div class="svcs">
      <div class="svc"><div class="ic"><div class="inn">${G_MOBILE}</div></div><div class="lb">Mobile</div></div>
      <div class="svc"><div class="ic"><div class="inn">${G_ACCESS}</div></div><div class="lb">Accessories</div></div>
      <div class="svc"><div class="ic"><div class="inn">${G_SERVICE}</div></div><div class="lb">Service</div></div>
      <div class="svc"><div class="ic"><div class="inn">${G_RECHARGE}</div></div><div class="lb">Recharge</div></div>
    </div>

    <div class="meta">
      <div class="mrows">
        <div class="mrow"><span class="k">Invoice No.</span><span class="c">:</span><span class="v">${esc(bill.billNumber || '—')}</span></div>
        <div class="mrow"><span class="k">Invoice Date</span><span class="c">:</span><span class="v">${esc(fmtDate(bill.date))}</span></div>
        ${ordNo ? `<div class="mrow"><span class="k">Order No.</span><span class="c">:</span><span class="v">${esc(ordNo)}</span></div>` : ''}
      </div>
      <div class="qrbox">${qr ? `<img src="${qr}" alt="QR">` : qrPlaceholderSvg()}<div class="qc">Scan to Verify</div></div>
    </div>

    <div class="bto">
      <div class="bto-cap">${I_PERSON}<span class="t">Bill To</span></div>
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
          <th style="width:34%">Product Name</th>
          <th class="c" style="width:15%">HSN Code</th>
          <th class="c" style="width:9%">Qty</th>
          <th class="r" style="width:16%">Rate (₹)</th>
          <th class="r" style="width:19%">Amount (₹)</th>
        </tr></thead>
        <tbody>
          ${itemRows}
          ${fillerRows}
        </tbody>
      </table>
    </div>

    <div class="grandrow">
      <div class="badgewrap">${trustedBadgeSvg()}</div>
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
        <span class="chkbox">${checkCircleSvg()}</span>
        <div class="plines">
          <div class="pline">Payment Mode : ${esc(methodLabel)}</div>
          <div class="pline">Payment Status : <span class="${stCls}">${stText}</span></div>
          ${due > 0.009 ? `<div class="pline">Due Amount : <span class="bad">₹${tallyAmt(due)}</span></div>` : ''}
        </div>
      </div>
      <div class="sigwrap">
        ${sig ? `<img src="${sig}" alt="signature">` : sigScribbleSvg()}
        <div class="sigcap">Authorized Signature</div>
      </div>
    </div>

    <div class="thanksrow">
      <div class="thanksbox">
        <p class="ty">Thank You!</p>
        <div class="keep">${shop.thankyou ? esc(shop.thankyou) : 'Keep Shopping with PS TELECOM…'}</div>
      </div>
    </div>

    <div class="phoneart">${phoneSvg()}</div>

    <div class="foot">
      ${footerWaveSvg()}
      <div class="fcontent">
        <div class="fitem">${I_SHIELD}<span>Best Price</span></div>
        <div class="fitem">${I_HANDSHAKE}<span>Best Service</span></div>
        <div class="fitem">${I_STAR}<span>Happy Customer</span></div>
        <div class="fvisit">Visit Again…</div>
      </div>
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
