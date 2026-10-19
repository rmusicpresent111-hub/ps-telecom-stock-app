'use client';

/**
 * Quick Sell — one dialog to sell a product in seconds (Vyapar-style):
 *   step 1: pick product (searchable, stock + price visible)
 *   step 2: qty / rate / customer / payment → SELL transaction + bill
 *   step 3: done — receipt print, sell again, or jump to Bills.
 *
 * The created bill lands in the Bills / Sales register automatically
 * (and in the Due Book when payment method is "due").
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, Zap, CheckCircle2, Printer, RotateCcw, ReceiptText, AlertTriangle } from 'lucide-react';
import {
  getProductsOffline,
  createTransactionOffline,
  createBillOffline,
} from '@/lib/offline-service';
import { DEFAULT_USER_ID } from '@/lib/local-auth';
import { useAdminStore } from '@/store/adminStore';
import { ta } from '@/lib/admin-i18n';
import { Badge, Btn, Field, Modal, TextInput, adminToast, fmtMoney } from './admin-ui';
import { buildBillReceiptHtml, printHtml } from './print';
import type { Bill, PaymentMethod, Product } from '@/lib/types';

const METHODS: PaymentMethod[] = ['cash', 'upi', 'card', 'due'];

export default function QuickSellModal({
  open,
  onClose,
  prefill,
  onGoBills,
}: {
  open: boolean;
  onClose: () => void;
  /** When set, the picker is skipped and the form opens with this product. */
  prefill: Product | null;
  onGoBills: () => void;
}) {
  const lang = useAdminStore((s) => s.language);
  const t = (k: string) => ta(k, lang);

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const [selected, setSelected] = useState<Product | null>(null);
  const [qty, setQty] = useState('1');
  const [rate, setRate] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerMobile, setCustomerMobile] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ bill: Bill; productName: string } | null>(null);

  // load products each time the dialog opens
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    getProductsOffline(DEFAULT_USER_ID)
      .then((ps) => {
        if (alive) setProducts(ps);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  // (re)initialize the flow whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    setDone(null);
    setSearch('');
    setQty('1');
    setRate('');
    setCustomerName('');
    setCustomerMobile('');
    setMethod('cash');
    setNote('');
    setSelected(prefill);
    if (prefill) setRate(String(prefill.sellingPrice || ''));
  }, [open, prefill]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? products.filter((p) => p.name.toLowerCase().includes(q) || (p.boxNumber || '').toLowerCase().includes(q))
      : products;
    return [...list].sort((a, b) => {
      const ao = a.quantity <= 0 ? 1 : 0;
      const bo = b.quantity <= 0 ? 1 : 0;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });
  }, [products, search]);

  const qtyNum = Math.max(0, Math.floor(Number(qty) || 0));
  const rateNum = Math.max(0, Number(rate) || 0);
  const total = qtyNum * rateNum;
  const overStock = !!selected && qtyNum > selected.quantity;

  const confirmSale = async () => {
    if (!selected) return;
    if (qtyNum <= 0) {
      adminToast(t('c.required'), 'err');
      return;
    }
    if (qtyNum > selected.quantity) {
      adminToast(`${t('qsell.errStock')} (${selected.quantity})`, 'err');
      return;
    }
    setBusy(true);
    try {
      const { transaction } = await createTransactionOffline({
        type: 'SELL',
        productId: selected.id,
        quantity: qtyNum,
        unitPrice: rateNum,
        totalAmount: Number(total.toFixed(2)),
        userId: DEFAULT_USER_ID,
      });
      const { bill } = await createBillOffline({
        userId: DEFAULT_USER_ID,
        transactionId: transaction.id,
        productId: selected.id,
        productName: selected.name,
        quantity: qtyNum,
        unitPrice: rateNum,
        customerName,
        customerMobile,
        paymentMethod: method,
        note,
      });
      setDone({ bill, productName: selected.name });
      adminToast(`${t('qsell.done')} · ${bill.billNumber}`);
    } catch (err) {
      adminToast((err as Error)?.message || t('c.error'), 'err');
    } finally {
      setBusy(false);
    }
  };

  const resetToPicker = () => {
    setDone(null);
    setSelected(null);
    setSearch('');
    setQty('1');
    setRate('');
    setCustomerName('');
    setCustomerMobile('');
    setMethod('cash');
    setNote('');
  };

  const close = () => {
    onClose();
    // reset after the close animation frame
    window.setTimeout(() => {
      setDone(null);
      setSelected(null);
      setSearch('');
    }, 50);
  };

  // ── step 3: done ──────────────────────────────────────────────
  if (done) {
    const b = done.bill;
    return (
      <Modal
        open={open}
        onClose={close}
        title={
          <span className="flex items-center gap-2 text-[#16A34A]">
            <CheckCircle2 size={18} /> {t('qsell.done')}
          </span>
        }
        footer={
          <>
            <Btn variant="outline" onClick={close}>
              {t('c.close')}
            </Btn>
            <Btn variant="soft" onClick={() => printHtml(buildBillReceiptHtml(b, lang))}>
              <Printer size={15} /> {t('qsell.printReceipt')}
            </Btn>
            <Btn variant="green" onClick={resetToPicker}>
              <RotateCcw size={15} /> {t('qsell.sellAgain')}
            </Btn>
          </>
        }
      >
        <div className="text-center py-2">
          <div className="mx-auto w-14 h-14 rounded-full bg-[var(--psa-soft-green)] flex items-center justify-center mb-3">
            <CheckCircle2 size={28} className="text-[#16A34A]" />
          </div>
          <p className="text-lg font-bold text-[var(--psa-ink)]">{done.productName}</p>
          <p className="text-2xl font-black text-[#E8552C] tabular-nums mt-1">{fmtMoney(b.total)}</p>
          <div className="flex items-center justify-center gap-2 mt-2">
            <Badge tone="slate">
              {t('bills.billNo')}: {b.billNumber}
            </Badge>
            <Badge tone="green">
              {qtyNum} × {fmtMoney(rateNum)}
            </Badge>
            {b.customerName && b.customerName !== 'Walk-in Customer' && <Badge tone="orange">{b.customerName}</Badge>}
          </div>
          <p className="text-xs text-[var(--psa-muted)] mt-3">{t('qsell.doneDesc')}</p>
          <Btn size="sm" variant="ghost" className="mt-2" onClick={() => { close(); onGoBills(); }}>
            <ReceiptText size={14} /> {t('qsell.viewBills')}
          </Btn>
        </div>
      </Modal>
    );
  }

  // ── step 1: product picker ───────────────────────────────────
  if (!selected) {
    return (
      <Modal
        open={open}
        onClose={close}
        title={
          <span className="flex items-center gap-2">
            <Zap size={17} className="text-[#FA6E41]" /> {t('shell.quickSell')}
          </span>
        }
        footer={
          <Btn variant="outline" onClick={close}>
            {t('c.cancel')}
          </Btn>
        }
      >
        <Field label={t('qsell.pickProduct')}>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--psa-faint)]" />
            <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('qsell.searchProduct')} className="!pl-9" autoFocus />
          </div>
        </Field>

        <div className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-[var(--psa-border)] divide-y divide-[var(--psa-line)]">
          {loading ? (
            <p className="text-sm text-[var(--psa-muted)] text-center py-6">{t('c.loading')}</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-[var(--psa-muted)] text-center py-6">{t('qsell.noProduct')}</p>
          ) : (
            filtered.map((p) => {
              const out = p.quantity <= 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelected(p);
                    setRate(String(p.sellingPrice || ''));
                    setQty('1');
                  }}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--psa-row-hover)] transition-colors"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[var(--psa-ink)] truncate">{p.name}</span>
                    <span className="block text-[11px] text-[var(--psa-faint)]">
                      {out ? (
                        <span className="inline-flex items-center gap-1 text-[#DC2626] font-semibold">
                          <AlertTriangle size={11} /> {t('qsell.outOfStock')}
                        </span>
                      ) : (
                        `${t('qsell.stockLeft')}: ${p.quantity}`
                      )}
                    </span>
                  </span>
                  <span className="text-sm font-bold text-[var(--psa-ink)] tabular-nums shrink-0">{fmtMoney(p.sellingPrice)}</span>
                </button>
              );
            })
          )}
        </div>
      </Modal>
    );
  }

  // ── step 2: sale details ─────────────────────────────────────
  return (
    <Modal
      open={open}
      onClose={close}
      title={
        <span className="flex items-center gap-2">
          <Zap size={17} className="text-[#FA6E41]" /> {t('qsell.saleDetails')}
        </span>
      }
      footer={
        <>
          <Btn variant="outline" onClick={() => setSelected(null)}>
            {t('c.cancel')}
          </Btn>
          <Btn onClick={confirmSale} disabled={busy || qtyNum <= 0 || overStock}>
            <CheckCircle2 size={15} /> {t('qsell.complete')} · {fmtMoney(total)}
          </Btn>
        </>
      }
    >
      <div className="space-y-3.5">
        {/* selected product summary */}
        <div className="flex items-center justify-between gap-3 bg-[var(--psa-soft-orange)] rounded-xl p-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-[var(--psa-ink)] truncate">{selected.name}</p>
            <p className="text-[11px] text-[var(--psa-muted)]">
              {t('qsell.stockLeft')}: <b className="text-[var(--psa-ink)]">{selected.quantity}</b>
            </p>
          </div>
          <Badge tone={overStock ? 'red' : 'orange'}>{overStock ? t('qsell.errStock') : fmtMoney(total)}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('prod.qty')} hint={overStock ? `${t('qsell.errStock')} (${selected.quantity})` : undefined}>
            <TextInput
              type="number"
              min="1"
              max={selected.quantity}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label={t('prod.rate') + ' — ' + t('prod.sellingPrice')}>
            <TextInput type="number" min="0" value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('qsell.customer')}>
            <TextInput value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder={t('due.walkIn')} />
          </Field>
          <Field label={t('qsell.mobile')}>
            <TextInput value={customerMobile} onChange={(e) => setCustomerMobile(e.target.value)} inputMode="tel" />
          </Field>
        </div>

        <Field label={t('bills.method')}>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {METHODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                  method === m
                    ? 'bg-[var(--psa-soft-orange)] border-[#FA6E41] text-[#E8552C]'
                    : 'bg-[var(--psa-card)] border-[var(--psa-field-border)] text-[var(--psa-muted)] hover:border-[#FA6E41]/50'
                }`}
              >
                {m === 'cash' ? t('c.cash') : m === 'upi' ? 'UPI' : m === 'card' ? t('c.card') : t('c.due')}
              </button>
            ))}
          </div>
        </Field>

        {method === 'due' && (
          <p className="text-xs text-[var(--psa-amber-ink)] bg-[var(--psa-soft-amber)] rounded-lg p-2.5">{t('qsell.dueNote')}</p>
        )}

        <Field label={t('qsell.note')}>
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {/* live total */}
        <div className="flex items-center justify-between border-t border-[var(--psa-border)] pt-3">
          <span className="text-sm font-semibold text-[var(--psa-muted)]">
            {qtyNum} × {fmtMoney(rateNum)}
          </span>
          <span className="text-xl font-black text-[#E8552C] tabular-nums">{fmtMoney(total)}</span>
        </div>
      </div>
    </Modal>
  );
}
