'use client';

/**
 * Quick Sell — one dialog to sell a product in seconds (Vyapar-style):
 *   step 0: pick a CATEGORY first (required — products of only that
 *           category are offered afterwards)
 *   step 1: pick product inside the chosen category (searchable,
 *           stock + price visible)
 *   step 2: qty / rate / customer / payment → SELL transaction + bill
 *   step 3: done — receipt print, sell again, or jump to Bills.
 *
 * The created bill lands in the Bills / Sales register automatically
 * (and in the Due Book when payment method is "due").
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, Zap, CheckCircle2, Printer, RotateCcw, ReceiptText, AlertTriangle, FolderOpen, ArrowLeft, Check, Hash } from 'lucide-react';
import {
  getProductsOffline,
  getCategoriesOffline,
  createTransactionOffline,
  createBillOffline,
  getBillingSettingsOffline,
} from '@/lib/offline-service';
import { DEFAULT_USER_ID } from '@/lib/local-auth';
import { computeGst, normalizeGstMode, halfRate } from '@/lib/gst';
import { useAdminStore } from '@/store/adminStore';
import { ta, taf } from '@/lib/admin-i18n';
import { Badge, Btn, Field, Modal, TextInput, adminToast, fmtMoney } from './admin-ui';
import { printBillReceipt } from './print';
import type { Bill, BillingSettings, Category, PaymentMethod, Product } from '@/lib/types';

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
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [catSearch, setCatSearch] = useState('');
  /** Chosen category — MUST be set before any product can be picked. */
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const [selected, setSelected] = useState<Product | null>(null);
  const [qty, setQty] = useState('1');
  const [rate, setRate] = useState('');
  /** Serialized (mobile) product: exactly which S/N units the customer buys. */
  const [pickedSerials, setPickedSerials] = useState<string[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerMobile, setCustomerMobile] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ bill: Bill; productName: string; serials: string[] } | null>(null);
  const [billSettings, setBillSettings] = useState<BillingSettings | null>(null);

  // load products each time the dialog opens
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    Promise.all([getProductsOffline(DEFAULT_USER_ID), getCategoriesOffline(DEFAULT_USER_ID)])
      .then(([ps, cs]) => {
        if (alive) {
          setProducts(ps);
          setCategories(cs);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false);
      });
    getBillingSettingsOffline(DEFAULT_USER_ID)
      .then((s) => {
        if (alive) setBillSettings(s);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open]);

  // (re)initialize the flow whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    setDone(null);
    setSearch('');
    setCatSearch('');
    setCategoryId(null);
    setQty('1');
    setRate('');
    setPickedSerials([]);
    setCustomerName('');
    setCustomerMobile('');
    setMethod('cash');
    setNote('');
    setSelected(prefill);
    if (prefill) setRate(String(prefill.sellingPrice || ''));
  }, [open, prefill]);

  /** Category rows for step 0 — alphabetical, each with its product count. */
  const catFiltered = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    const counts = new Map<string, number>();
    for (const p of products) counts.set(p.categoryId, (counts.get(p.categoryId) || 0) + 1);
    return categories
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .map((c) => ({ id: c.id, name: c.name, count: counts.get(c.id) || 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [categories, products, catSearch]);

  /** Only the chosen category's products reach the picker. */
  const filtered = useMemo(() => {
    if (!categoryId) return [];
    const q = search.trim().toLowerCase();
    const inCat = products.filter((p) => p.categoryId === categoryId);
    // search matches the model name, box number AND any per-unit serial —
    // typing an IMEI finds the phone that carries it
    const list = q
      ? inCat.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.boxNumber || '').toLowerCase().includes(q) ||
            (p.serialNumbers || []).some((s) => s.toLowerCase().includes(q)) ||
            (p.serialNumber || '').toLowerCase().includes(q)
        )
      : inCat;
    return [...list].sort((a, b) => {
      const ao = a.quantity <= 0 ? 1 : 0;
      const bo = b.quantity <= 0 ? 1 : 0;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });
  }, [products, search, categoryId]);

  const activeCat = categories.find((c) => c.id === categoryId) || null;

  const qtyNum = Math.max(0, Math.floor(Number(qty) || 0));
  const rateNum = Math.max(0, Number(rate) || 0);
  const total = qtyNum * rateNum;
  const overStock = !!selected && qtyNum > selected.quantity;

  /** Available per-unit serials of the product being sold. */
  const availableSerials = useMemo(
    () =>
      selected
        ? (selected.serialNumbers?.length
            ? selected.serialNumbers
            : selected.serialNumber
              ? [selected.serialNumber]
            : []
          ).map((s) => String(s).trim()).filter(Boolean)
        : [],
    [selected]
  );
  /** Every serialized unit being sold must be identified. */
  const serialsNeeded = Math.min(qtyNum, availableSerials.length);

  // mirror createBillOffline's GST rule so the shown total == the bill total
  const gstOn = !!billSettings?.gstEnabled && !!billSettings?.gstNumber.trim() && (billSettings?.gstRate || 0) > 0;
  const gstMode = normalizeGstMode(billSettings?.gstMode);
  const breakup = gstOn && total > 0 ? computeGst(total, billSettings?.gstRate || 0, gstMode) : null;
  const gstAmt = breakup ? breakup.gstAmount : 0;
  const grand = breakup ? breakup.total : total;

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
    // serialized product: the customer's chosen unit(s) must be picked
    if (availableSerials.length > 0 && pickedSerials.length !== serialsNeeded) {
      adminToast(t('qsell.pickSerial'), 'err');
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
        soldSerials: pickedSerials,
        userId: DEFAULT_USER_ID,
      });
      const { bill } = await createBillOffline({
        userId: DEFAULT_USER_ID,
        transactionId: transaction.id,
        productId: selected.id,
        productName: selected.name,
        quantity: qtyNum,
        unitPrice: rateNum,
        soldSerials: pickedSerials,
        customerName,
        customerMobile,
        paymentMethod: method,
        note,
      });
      setDone({ bill, productName: selected.name, serials: pickedSerials });
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
    setPickedSerials([]);
    setSearch('');
    setCatSearch('');
    setCategoryId(null);
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
      setPickedSerials([]);
      setSearch('');
      setCatSearch('');
      setCategoryId(null);
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
            <Btn variant="soft" onClick={() => void printBillReceipt(b, lang)}>
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
          <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
            <Badge tone="slate">
              {t('bills.billNo')}: {b.billNumber}
            </Badge>
            <Badge tone="green">
              {qtyNum} × {fmtMoney(rateNum)}
            </Badge>
            {b.customerName && b.customerName !== 'Walk-in Customer' && <Badge tone="orange">{b.customerName}</Badge>}
          </div>
          {done.serials.length > 0 && (
            <div className="mt-2 flex items-center justify-center gap-1.5 flex-wrap">
              {done.serials.map((sn) => (
                <span key={sn} className="inline-flex items-center gap-1 rounded-lg bg-[var(--psa-hover)] border border-[var(--psa-border)] px-2 py-1 text-[11px] font-mono text-[var(--psa-ink)]">
                  <Hash size={11} className="text-[#E8552C]" /> {sn}
                </span>
              ))}
            </div>
          )}
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
        {!activeCat ? (
          <>
            <Field label={t('qsell.pickCategory')}>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--psa-faint)]" />
                <TextInput
                  value={catSearch}
                  onChange={(e) => setCatSearch(e.target.value)}
                  placeholder={t('qsell.searchCategory')}
                  className="!pl-9"
                  autoFocus
                />
              </div>
            </Field>

            <div className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-[var(--psa-border)] divide-y divide-[var(--psa-line)]">
              {loading ? (
                <p className="text-sm text-[var(--psa-muted)] text-center py-6">{t('c.loading')}</p>
              ) : catFiltered.length === 0 ? (
                <p className="text-sm text-[var(--psa-muted)] text-center py-6">{t('qsell.noCategory')}</p>
              ) : (
                catFiltered.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCategoryId(c.id);
                      setSearch('');
                    }}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--psa-row-hover)] transition-colors"
                  >
                    <span className="min-w-0 flex items-center gap-2.5">
                      <span className="shrink-0 w-8 h-8 rounded-lg bg-[var(--psa-soft-orange)] flex items-center justify-center">
                        <FolderOpen size={15} className="text-[#E8552C]" />
                      </span>
                      <span className="block text-sm font-semibold text-[var(--psa-ink)] truncate">{c.name}</span>
                    </span>
                    <Badge tone={c.count > 0 ? 'slate' : 'amber'}>{taf('qsell.catItems', lang, { n: c.count })}</Badge>
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            {/* chosen-category chip — tap to go back and change it */}
            <button
              type="button"
              onClick={() => {
                setCategoryId(null);
                setSearch('');
              }}
              className="w-full flex items-center gap-2 rounded-xl bg-[var(--psa-soft-orange)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--psa-hover)]"
            >
              <ArrowLeft size={14} className="text-[#E8552C] shrink-0" />
              <FolderOpen size={14} className="text-[#E8552C] shrink-0" />
              <span className="text-sm font-semibold text-[var(--psa-ink)] truncate flex-1">{activeCat.name}</span>
              <span className="text-[11px] font-semibold text-[#E8552C] shrink-0">{t('qsell.changeCategory')}</span>
            </button>

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
              const pSerials = (p.serialNumbers?.length ? p.serialNumbers : p.serialNumber ? [p.serialNumber] : []).filter(Boolean);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelected(p);
                    setRate(String(p.sellingPrice || ''));
                    setQty('1');
                    setPickedSerials([]);
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
                    {pSerials.length > 0 && !out && (
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-[#E8552C]">
                        <Hash size={11} /> S/N: {pSerials.length}
                      </span>
                    )}
                  </span>
                  <span className="text-sm font-bold text-[var(--psa-ink)] tabular-nums shrink-0">{fmtMoney(p.sellingPrice)}</span>
                </button>
              );
            })
          )}
        </div>
          </>
        )}
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
          <Btn
            onClick={confirmSale}
            disabled={
              busy ||
              qtyNum <= 0 ||
              overStock ||
              (availableSerials.length > 0 && pickedSerials.length !== serialsNeeded)
            }
          >
            <CheckCircle2 size={15} /> {t('qsell.complete')} · {fmtMoney(grand)}
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
          <Badge tone={overStock ? 'red' : 'orange'}>{overStock ? t('qsell.errStock') : fmtMoney(grand)}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('prod.qty')} hint={overStock ? `${t('qsell.errStock')} (${selected.quantity})` : undefined}>
            <TextInput
              type="number"
              min="1"
              max={selected.quantity}
              value={qty}
              onChange={(e) => {
                setQty(e.target.value);
                // quantity shrank → trim over-picked serials
                const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                setPickedSerials((prev) => prev.slice(0, Math.min(n, availableSerials.length)));
              }}
              autoFocus
            />
          </Field>
          <Field label={t('prod.rate') + ' — ' + t('prod.sellingPrice')}>
            <TextInput type="number" min="0" value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
        </div>

        {/* ── serial picker — the customer's exact unit(s) ──
            every S/N of this model is listed; pick min(qty, available) */}
        {availableSerials.length > 0 && (
          <Field label={`${t('qsell.pickSerial')} — ${pickedSerials.length}/${serialsNeeded}`} hint={t('qsell.pickSerialHint')}>
            <div className="max-h-44 overflow-y-auto rounded-xl border border-[var(--psa-border)] divide-y divide-[var(--psa-line)]">
              {availableSerials.map((sn) => {
                const picked = pickedSerials.some((x) => x.toLowerCase() === sn.toLowerCase());
                return (
                  <button
                    key={sn}
                    type="button"
                    onClick={() =>
                      setPickedSerials((prev) =>
                        prev.some((x) => x.toLowerCase() === sn.toLowerCase())
                          ? prev.filter((x) => x.toLowerCase() !== sn.toLowerCase())
                          : prev.length < serialsNeeded
                            ? [...prev, sn]
                            : prev
                      )
                    }
                    className={`w-full flex items-center justify-between gap-2 px-3.5 py-2 text-left text-sm transition-colors ${
                      picked ? 'bg-[var(--psa-soft-orange)]' : 'hover:bg-[var(--psa-row-hover)]'
                    }`}
                  >
                    <span className="font-mono text-[13px] text-[var(--psa-ink)] truncate">{sn}</span>
                    {picked && <Check size={14} className="text-[#E8552C] shrink-0" />}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

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
          <span className="text-xl font-black text-[#E8552C] tabular-nums">{fmtMoney(grand)}</span>
        </div>
        {gstOn && breakup && total > 0 && (
          <p className="text-[11px] text-[var(--psa-muted)] bg-[var(--psa-hover)] rounded-lg px-2.5 py-1.5">
            {gstMode === 'inclusive'
              ? taf('qsell.gstNoteIn', lang, {
                  rate: billSettings?.gstRate || 0,
                  half: halfRate(billSettings?.gstRate || 0),
                  taxable: fmtMoney(breakup.taxable),
                  cgst: fmtMoney(breakup.cgst),
                  sgst: fmtMoney(breakup.sgst),
                  grand: fmtMoney(grand),
                })
              : taf('qsell.gstNote', lang, { rate: billSettings?.gstRate || 0, gst: fmtMoney(gstAmt), grand: fmtMoney(grand) })}
          </p>
        )}
      </div>
    </Modal>
  );
}
