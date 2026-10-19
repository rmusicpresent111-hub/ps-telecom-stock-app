/**
 * Admin print helpers — generates printer-friendly HTML documents and
 * prints them through a hidden iframe (browser "Save as PDF" gives the PDF).
 *
 * Print documents are ALWAYS light (paper) and carry their own inline CSS,
 * so admin dark mode never leaks into printouts. Bangla/Hindi render natively
 * because the browser's own font stack is used (no jsPDF glyph problem).
 */

import type { AdminLang } from '@/lib/admin-i18n';
import { ta } from '@/lib/admin-i18n';
import type { Bill } from '@/lib/types';

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
  // give the document a beat to lay out tables/fonts before the dialog opens
  window.setTimeout(fire, 250);
}

const PRINT_CSS = `
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin:0; font-family:'Noto Sans Bengali','Hind Siliguri',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; color:#111827; font-size:12.5px; line-height:1.45; }
.head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; border-bottom:3px solid #FA6E41; padding-bottom:10px; margin-bottom:14px; }
.brand { font-size:20px; font-weight:800; margin:0; }
.sub { color:#6B7280; font-size:11px; margin:2px 0 0; }
.doc-title { font-size:15px; margin:0 0 2px; }
.muted { color:#6B7280; }
table { width:100%; border-collapse:collapse; margin-top:8px; }
th { background:#FFF1EB; color:#9A3412; text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.04em; padding:7px 8px; border:1px solid #F3D8CB; }
th.r, td.r { text-align:right; }
td { padding:6px 8px; border:1px solid #E8EAED; vertical-align:top; }
tbody tr:nth-child(even) td { background:#FAFBFC; }
.tot td { font-weight:700; background:#FFF7F3; }
.sec { font-size:13px; font-weight:800; margin:16px 0 0; }
.summary-box { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
.chip { border:1px solid #E8EAED; border-radius:10px; padding:8px 12px; min-width:130px; }
.chip .k { color:#6B7280; font-size:10px; text-transform:uppercase; font-weight:700; }
.chip .v { font-weight:800; font-size:14px; }
.foot { margin-top:22px; display:flex; justify-content:space-between; align-items:flex-end; color:#6B7280; font-size:11px; gap:16px; }
.sig { border-top:1px solid #9CA3AF; padding-top:4px; min-width:160px; text-align:center; font-weight:700; color:#374151; }
.note-box { margin-top:10px; background:#F9FAFB; border:1px solid #E8EAED; border-radius:8px; padding:8px 10px; font-size:11px; color:#4B5563; }
`;

function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>${body}</body></html>`;
}

// ── document 1: sold-products report (all bills in a period) ───

export function buildSoldProductsReportHtml(
  bills: Bill[],
  opts: { from?: string; to?: string; lang: AdminLang }
): string {
  const lang = opts.lang;
  const t = (k: string) => ta(k, lang);

  const first = bills[0];
  const shop = first?.shopSnapshot?.name || 'PS TELECOM';
  const shopSub = [
    first?.shopSnapshot?.address,
    first?.shopSnapshot?.phone ? `☎ ${first.shopSnapshot.phone}` : '',
    first?.shopSnapshot?.gstNumber ? `GSTIN: ${first.shopSnapshot.gstNumber}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const periodLabel =
    opts.from && opts.to
      ? opts.from === opts.to
        ? fmtDate(opts.from)
        : `${fmtDate(opts.from)} → ${fmtDate(opts.to)}`
      : t('bills.allTime');

  // sorted chronological rows (bill → item)
  const rows = bills
    .slice()
    .sort((a, b) => (a.date === b.date ? String(a.createdAt).localeCompare(String(b.createdAt)) : a.date.localeCompare(b.date)))
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

  const body = `
<div class="head">
  <div>
    <p class="brand">${esc(shop)}</p>
    ${shopSub ? `<p class="sub">${esc(shopSub)}</p>` : ''}
  </div>
  <div style="text-align:right">
    <h2 class="doc-title">${esc(t('bills.soldReport'))}</h2>
    <p class="sub">${esc(t('rep.period'))}: ${esc(periodLabel)}</p>
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

<div class="foot">
  <span>${esc(t('print.generated'))}: ${new Date().toLocaleString('en-IN')}</span>
  <span class="sig">${esc(t('print.signature'))}</span>
</div>`;

  return pageShell(`${shop} — ${t('bills.soldReport')}`, body);
}

// ── document 2: single bill receipt ─────────────────────────────

export function buildBillReceiptHtml(bill: Bill, lang: AdminLang): string {
  const t = (k: string) => ta(k, lang);
  const shop = bill.shopSnapshot?.name || 'PS TELECOM';
  const snap = bill.shopSnapshot;
  const shopSub = [snap?.address, snap?.phone ? `☎ ${snap.phone}` : '', snap?.gstNumber ? `GSTIN: ${snap.gstNumber}` : '']
    .filter(Boolean)
    .join(' · ');

  const methodLabel =
    bill.paymentMethod === 'cash'
      ? t('c.cash')
      : bill.paymentMethod === 'upi'
        ? 'UPI'
        : bill.paymentMethod === 'card'
          ? t('c.card')
          : t('c.due');

  const itemRows = (bill.items || [])
    .map(
      (it, i) =>
        `<tr><td>${i + 1}</td><td>${esc(it.name)}</td><td class="r">${it.quantity}</td><td class="r">${money(
          it.unitPrice
        )}</td><td class="r">${money(it.total)}</td></tr>`
    )
    .join('');

  const body = `
<div class="head">
  <div>
    <p class="brand">${esc(shop)}</p>
    ${shopSub ? `<p class="sub">${esc(shopSub)}</p>` : ''}
    ${snap?.proprietorName ? `<p class="sub">${esc(snap.proprietorName)}</p>` : ''}
  </div>
  <div style="text-align:right">
    <h2 class="doc-title">${esc(t('bills.billNo'))}: ${esc(bill.billNumber || '—')}</h2>
    <p class="sub">${esc(t('exp.date'))}: ${fmtDate(bill.date)}</p>
  </div>
</div>

<div class="summary-box">
  <div class="chip"><div class="k">${esc(t('bills.customer'))}</div><div class="v">${esc(bill.customerName || t('due.walkIn'))}</div></div>
  ${bill.customerMobile ? `<div class="chip"><div class="k">${esc(t('qsell.mobile'))}</div><div class="v" style="font-size:12px">${esc(bill.customerMobile)}</div></div>` : ''}
  <div class="chip"><div class="k">${esc(t('bills.method'))}</div><div class="v">${esc(methodLabel)}</div></div>
</div>

<table><thead><tr><th style="width:34px">#</th><th>${esc(t('bills.items'))}</th><th class="r">${esc(t('prod.qty'))}</th><th class="r">${esc(
    t('prod.rate')
  )}</th><th class="r">${esc(t('bills.total'))}</th></tr></thead>
<tbody>${itemRows}</tbody></table>

<div class="summary-box" style="margin-top:12px">
  <div class="chip"><div class="k">${esc(t('bills.subtotal'))}</div><div class="v">${money(bill.subtotal)}</div></div>
  ${(bill.discountAmount || 0) > 0 ? `<div class="chip"><div class="k">${esc(t('bills.discount'))}</div><div class="v">− ${money(bill.discountAmount)}</div></div>` : ''}
  ${(bill.gstAmount || 0) > 0 ? `<div class="chip"><div class="k">${esc(t('bills.gst'))} (${bill.gstRate}%)</div><div class="v">+ ${money(bill.gstAmount)}</div></div>` : ''}
  <div class="chip" style="border-color:#FA6E41"><div class="k">${esc(t('bills.total'))}</div><div class="v">${money(bill.total)}</div></div>
  <div class="chip"><div class="k">${esc(t('bills.paid'))}</div><div class="v">${money(bill.paidAmount)}</div></div>
  <div class="chip"><div class="k">${esc(t('bills.due'))}</div><div class="v">${money(bill.dueAmount)}</div></div>
</div>

${bill.note ? `<div class="note-box"><b>${esc(t('bills.note'))}:</b> ${esc(bill.note)}</div>` : ''}

<div class="foot">
  <span>${esc(t('print.thankyou'))}</span>
  <span class="sig">${esc(t('print.signature'))}</span>
</div>`;

  return pageShell(`${shop} — ${bill.billNumber}`, body);
}
