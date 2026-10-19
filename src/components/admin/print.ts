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
  const ini = ((parts[0]?.[0] || 'P') + (parts[1]?.[0] || 'S')).toUpperCase();
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

// ── document 1: single-bill A4 invoice ─────────────────────────

export function buildBillReceiptHtml(bill: Bill, lang: AdminLang, settings?: BillingSettings | null): string {
  const t = (k: string) => ta(k, lang);
  const shop = resolveShop(bill, settings);

  const gstOn = (bill.gstAmount || 0) > 0;
  const title = gstOn ? t('print.taxInvoice') : t('print.invoice');

  const due = bill.dueAmount || 0;
  const [statusCls, statusLabel] =
    due <= 0.009
      ? ['st-paid', t('print.stPaid')]
      : (bill.paidAmount || 0) > 0.009
        ? ['st-partial', t('print.stPartial')]
        : ['st-due', t('print.stDue')];

  const methodLabel =
    bill.paymentMethod === 'cash'
      ? t('c.cash')
      : bill.paymentMethod === 'upi'
        ? 'UPI'
        : bill.paymentMethod === 'card'
          ? t('c.card')
          : t('c.due');

  const shopSub = [
    shop.proprietor ? `<p class="proprietor">${esc(shop.proprietor)}</p>` : '',
    shop.address ? `<p class="shopline">${escMultiline(shop.address)}</p>` : '',
    contactBits(shop) ? `<p class="shopline">${esc(contactBits(shop))}</p>` : '',
  ].join('');

  const itemRows = (bill.items || [])
    .map(
      (it, i) =>
        `<tr><td>${i + 1}</td><td>${esc(it.name)}</td><td class="r">${it.quantity}</td><td class="r">${money(
          it.unitPrice
        )}</td><td class="r">${money(it.total)}</td></tr>`
    )
    .join('');

  const totalsRows = [
    `<div class="trow"><span>${esc(t('bills.subtotal'))}</span><b>${money(bill.subtotal)}</b></div>`,
    (bill.discountAmount || 0) > 0
      ? `<div class="trow"><span>${esc(t('bills.discount'))}</span><b>− ${money(bill.discountAmount)}</b></div>`
      : '',
    gstOn
      ? `<div class="trow"><span>${esc(t('bills.gst'))} (${bill.gstRate}%)</span><b>+ ${money(bill.gstAmount)}</b></div>`
      : '',
    `<div class="trow grand"><span>${esc(t('bills.total'))}</span><span>${money(bill.total)}</span></div>`,
    `<div class="trow"><span>${esc(t('bills.paid'))}</span><b>${money(bill.paidAmount)}</b></div>`,
    due > 0.009 ? `<div class="trow"><span>${esc(t('bills.due'))}</span><b>${money(due)}</b></div>` : '',
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

  const payBlock =
    shop.qr || shop.upi
      ? `<div class="pay">${
          shop.qr ? `<img src="${shop.qr}" alt="payment QR">` : ''
        }<div><p class="upi">${esc(t('print.scanPay'))}</p>${
          shop.upi ? `<p class="upi">UPI: <b>${esc(shop.upi)}</b></p>` : ''
        }</div></div>`
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
      <h2 class="doc-title">${esc(title)}</h2>
      <p class="meta"><b>${esc(t('bills.billNo'))}:</b> ${esc(bill.billNumber || '—')}</p>
      <p class="meta"><b>${esc(t('exp.date'))}:</b> ${fmtDate(bill.date)}</p>
      ${shop.gst ? `<span class="gstin-chip">GSTIN: ${esc(shop.gst)}</span>` : ''}
    </div>
  </div>

  <div class="party">
    <div class="pbox">
      <span class="k" style="color:#6B7280;font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em">${esc(
        t('print.billTo')
      )}</span>
      <p class="name">${esc(bill.customerName || t('due.walkIn'))}</p>
      ${bill.customerMobile ? `<p class="line">${esc(bill.customerMobile)}</p>` : ''}
    </div>
    <div class="pbox" style="max-width:210px">
      <span class="k" style="color:#6B7280;font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em">${esc(
        t('bills.method')
      )}</span>
      <p class="name">${esc(methodLabel)}</p>
      <p class="line" style="margin-top:4px"><span class="chip-status ${statusCls}">${esc(statusLabel)}</span></p>
    </div>
  </div>

  <table>
    <thead><tr><th style="width:34px">#</th><th>${esc(t('bills.items'))}</th><th class="r">${esc(
    t('prod.qty')
  )}</th><th class="r">${esc(t('prod.rate'))}</th><th class="r">${esc(t('bills.total'))}</th></tr></thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="totals">${totalsRows}</div>

  <div class="words"><b>${esc(t('print.words'))}:</b> ${esc(amountInWords(bill.total))}</div>

  ${payBlock}
  ${bill.note ? `<div class="note-box"><b>${esc(t('bills.note'))}:</b> ${esc(bill.note)}</div>` : ''}

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

  return pageShell(`${shop.name} — ${bill.billNumber}`, body);
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
