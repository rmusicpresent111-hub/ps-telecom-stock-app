'use client';

/**
 * Sell Cart (v2.25) — the cart-based selling flow, built exactly the way
 * the shop bills a customer:
 *
 *   1. shop step    → pick a CATEGORY (required), then tap a PRODUCT —
 *                     a qty/price sheet opens with the price pre-filled
 *                     from the product (still editable) + serial picker
 *                     for phone S/N units.
 *   2. "Add to Cart" → the line lands in the cart; the picker stays on the
 *                     same category so as many products as needed can be
 *                     added one after another.
 *   3. cart step    → every line (qty × rate), editable + removable, with
 *                     the live SUBTOTAL / GST / GRAND TOTAL.
 *   4. checkout     → customer name, mobile, address (all optional) +
 *                     payment method (Cash / Card / UPI) + optional note.
 *   5. "Complete Sale" → ONE atomic multi-item bill → done screen with
 *                     receipt print, new sale, view bills.
 *
 * The cart survives closing/reopening the dialog (so a stray tap never
 * wipes a half-built bill); it is cleared only after a successful sale or
 * an explicit "clear cart". Checkout re-validates stock + serials inside
 * one atomic IndexedDB transaction — no partial sells, ever.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ShoppingCart,
  Search,
  CheckCircle2,
  Printer,
  RotateCcw,
  ReceiptText,
  AlertTriangle,
  FolderOpen,
  ArrowLeft,
  Check,
  Hash,
  Trash2,
  Pencil,
  Plus,
  PackageOpen,
} from 'lucide-react';
import {
  getProductsOffline,
  getCategoriesOffline,
  createCartBillOffline,
  getBillingSettingsOffline,
} from '@/lib/offline-service';
import { DEFAULT_USER_ID } from '@/lib/local-auth';
import { computeGst, normalizeGstMode, round2, halfRate } from '@/lib/gst';
import { useAdminStore } from '@/store/adminStore';
import { ta, taf } from '@/lib/admin-i18n';
import { Badge, Btn, Field, Modal, TextInput, adminToast, fmtMoney } from './admin-ui';
import { printBillReceipt } from './print';
import type { Bill, BillingSettings, Category, PaymentMethod, Product } from '@/lib/types';

/** Payment choices of the cart flow — exactly Cash / Card / UPI. */
const METHODS: PaymentMethod[] = ['cash', 'card', 'upi'];

/** One line of the cart — a snapshot of what was added (revalidated at checkout). */
interface CartLine {
  productId: string;
  name: string;
  categoryName: string;
  unitPrice: number;
  quantity: number;
  serials: string[];
  stock: number;
  availableSerials: string[];
}

/** The qty/price sheet currently open (editIndex ≥ 0 → editing a cart line). */
interface Editing {
  product: Product;
  qty: string;
  rate: string;
  serials: string[];
  editIndex: number;
}

type Step = 'shop' | 'cart' | 'checkout' | 'done';

/** Per-unit serials of a product (serialNumbers array, legacy single fallback). */
function serialsOf(p: Product): string[] {
  return (p.serialNumbers?.length ? p.serialNumbers : p.serialNumber ? [p.serialNumber] : [])
    .map((s) => String(s).trim())
    .filter(Boolean);
}

export default function SellCartModal({
  open,
  onClose,
  prefill,
  onGoBills,
  onCartChange,
}: {
  open: boolean;
  onClose: () => void;
  /** When set (Products-page sell button), the qty/price sheet opens at once. */
  prefill: Product | null;
  onGoBills: () => void;
  /** Reports the pending cart item count — the header cart badge. */
  onCartChange?: (count: number) => void;
}) {
  const lang = useAdminStore((s) => s.language);
  const t = (k: string) => ta(k, lang);

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [billSettings, setBillSettings] = useState<BillingSettings | null>(null);

  // shop step state — kept across open/close so the seller can continue
  const [step, setStep] = useState<Step>('shop');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [catSearch, setCatSearch] = useState('');
  const [search, setSearch] = useState('');

  // qty/price sheet
  const [editing, setEditing] = useState<Editing | null>(null);

  // the cart itself
  const [cart, setCart] = useState<CartLine[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);

  // checkout state
  const [customerName, setCustomerName] = useState('');
  const [customerMobile, setCustomerMobile] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [note, setNote] = useState('');

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Bill | null>(null);

  // report the pending cart count upward (header cart badge) — ref keeps the
  // effect stable even though the parent passes a fresh callback each render
  const onCartChangeRef = useRef(onCartChange);
  onCartChangeRef.current = onCartChange;
  useEffect(() => {
    onCartChangeRef.current?.(cart.length);
  }, [cart.length]);

  // ── load data every time the dialog opens ────────────────────
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

  // ── a completed sale closes everything; closing after done resets ──
  useEffect(() => {
    if (!open || !done) return;
    // nothing to do here — reset happens on close (see close())
  }, [open, done]);

  // ── Products-page prefill: open the qty/price sheet directly ──
  useEffect(() => {
    if (!open || !prefill) return;
    setStep('shop');
    setCategoryId(prefill.categoryId);
    setEditing({
      product: prefill,
      qty: '1',
      rate: String(prefill.sellingPrice || ''),
      serials: [],
      editIndex: -1,
    });
  }, [open, prefill]);

  const catNameOf = (id: string) => categories.find((c) => c.id === id)?.name || '';

  // ── step 1 lists ─────────────────────────────────────────────
  const catFiltered = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    const counts = new Map<string, number>();
    for (const p of products) counts.set(p.categoryId, (counts.get(p.categoryId) || 0) + 1);
    return categories
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .map((c) => ({ id: c.id, name: c.name, count: counts.get(c.id) || 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [categories, products, catSearch]);

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

  // ── the qty/price sheet math ─────────────────────────────────
  const editProduct = editing?.product ?? null;
  const editQtyNum = Math.max(0, Math.floor(Number(editing?.qty) || 0));
  const editRateNum = Math.max(0, Number(editing?.rate) || 0);
  const editTotal = round2(editQtyNum * editRateNum);
  const editAvailableSerials = useMemo(() => (editProduct ? serialsOf(editProduct) : []), [editProduct]);
  const editSerialsNeeded = Math.min(editQtyNum, editAvailableSerials.length);
  const editOverStock = !!editProduct && editQtyNum > editProduct.quantity;
  /** Serials already committed to OTHER lines of the same product must not be re-picked. */
  const editTakenSerials = useMemo(() => {
    if (!editProduct) return new Set<string>();
    const taken = new Set<string>();
    cart.forEach((l, i) => {
      if (l.productId === editProduct.id && i !== editing?.editIndex) {
        l.serials.forEach((s) => taken.add(s.toLowerCase()));
      }
    });
    return taken;
  }, [cart, editProduct, editing?.editIndex]);

  const lineTotal = (l: CartLine) => round2(l.unitPrice * l.quantity);

  // ── cart totals — mirrors createCartBillOffline exactly ─────
  const cartSubtotal = round2(cart.reduce((s, l) => s + lineTotal(l), 0));
  const cartQty = cart.reduce((s, l) => s + l.quantity, 0);
  const gstOn = !!billSettings?.gstEnabled && !!billSettings?.gstNumber.trim() && (billSettings?.gstRate || 0) > 0;
  const gstMode = normalizeGstMode(billSettings?.gstMode);
  const breakup = gstOn && cartSubtotal > 0 ? computeGst(cartSubtotal, billSettings?.gstRate || 0, gstMode) : null;
  const grand = breakup ? breakup.total : cartSubtotal;

  // ── cart actions ─────────────────────────────────────────────
  const openForProduct = (p: Product) => {
    const existingIdx = cart.findIndex((l) => l.productId === p.id);
    setEditing({
      product: p,
      qty: existingIdx >= 0 ? String(cart[existingIdx].quantity) : '1',
      rate: String(existingIdx >= 0 ? cart[existingIdx].unitPrice : p.sellingPrice || ''),
      serials: existingIdx >= 0 ? [...cart[existingIdx].serials] : [],
      editIndex: existingIdx, // same product again → edits its own line
    });
  };

  const openForLine = (idx: number) => {
    const l = cart[idx];
    if (!l) return;
    const p = products.find((x) => x.id === l.productId);
    setEditing({
      product: p || ({ id: l.productId, name: l.name, quantity: l.stock, sellingPrice: l.unitPrice } as Product),
      qty: String(l.quantity),
      rate: String(l.unitPrice),
      serials: [...l.serials],
      editIndex: idx,
    });
  };

  /** Add / update a cart line from the qty-price sheet. */
  const addToCart = () => {
    if (!editing || !editProduct) return;
    if (editQtyNum <= 0) {
      adminToast(t('c.required'), 'err');
      return;
    }
    if (editOverStock) {
      adminToast(`${t('qsell.errStock')} (${editProduct.quantity})`, 'err');
      return;
    }
    if (editAvailableSerials.length > 0 && editing.serials.length !== editSerialsNeeded) {
      adminToast(t('qsell.pickSerial'), 'err');
      return;
    }
    const line: CartLine = {
      productId: editProduct.id,
      name: editProduct.name,
      categoryName: catNameOf(editProduct.categoryId),
      unitPrice: editRateNum,
      quantity: editQtyNum,
      serials: [...editing.serials],
      stock: editProduct.quantity,
      availableSerials: editAvailableSerials,
    };
    setCart((prev) => {
      if (editing.editIndex >= 0) {
        const next = [...prev];
        if (editing.editIndex < next.length) next[editing.editIndex] = line;
        return next;
      }
      const idx = prev.findIndex((l) => l.productId === editProduct.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = line;
        return next;
      }
      return [...prev, line];
    });
    adminToast(t(editing.editIndex >= 0 ? 'cart.updated' : 'cart.added'));
    setEditing(null);
    // stay inside the same category — more products can be added at once
    if (editing.editIndex >= 0) setStep('cart');
  };

  const removeLine = (idx: number) => {
    setCart((prev) => prev.filter((_, i) => i !== idx));
    adminToast(t('cart.removed'));
  };

  const clearCart = () => {
    setCart([]);
    setConfirmClear(false);
    adminToast(t('cart.cleared'));
  };

  // ── checkout ─────────────────────────────────────────────────
  // v2.35.0 audit: same-frame double-tap guard — two clicks before setBusy
  // commits used to create TWO bills and deduct stock twice.
  const completeSaleBusyRef = useRef(false);
  const completeSale = async () => {
    if (completeSaleBusyRef.current) return;
    if (cart.length === 0) {
      adminToast(t('qsell.cartEmptyErr'), 'err');
      return;
    }
    completeSaleBusyRef.current = true;
    setBusy(true);
    try {
      const { bill } = await createCartBillOffline({
        userId: DEFAULT_USER_ID,
        entries: cart.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          soldSerials: l.serials,
        })),
        customerName,
        customerMobile,
        customerAddress,
        paymentMethod: method,
        note,
      });
      setDone(bill);
      setCart([]);
      setConfirmClear(false);
      setStep('done');
      setCustomerName('');
      setCustomerMobile('');
      setCustomerAddress('');
      setMethod('cash');
      setNote('');
      adminToast(`${t('qsell.done')} · ${bill.billNumber}`);
    } catch (err) {
      adminToast((err as Error)?.message || t('c.error'), 'err');
    } finally {
      completeSaleBusyRef.current = false;
      setBusy(false);
    }
  };

  const startNewSale = () => {
    setDone(null);
    setStep('shop');
    setCategoryId(null);
    setSearch('');
    setCatSearch('');
    setEditing(null);
  };

  const close = () => {
    onClose();
    // after a completed sale the whole flow resets (after the animation frame)
    if (done) window.setTimeout(startNewSale, 50);
  };

  const cartBar = cart.length > 0 && (
    <button
      type="button"
      onClick={() => setStep('cart')}
      className="w-full flex items-center justify-between gap-3 rounded-xl bg-gradient-to-r from-[#FA6E41] to-[#E8552C] px-4 py-3 text-left text-white shadow-[0_4px_12px_rgba(250,110,65,0.35)] transition-transform hover:scale-[1.01] active:scale-[0.99]"
    >
      <span className="flex items-center gap-2.5 min-w-0">
        <ShoppingCart size={18} className="shrink-0" />
        <span className="text-sm font-bold truncate">
          {cartQty} {t('cart.items')} · {t('cart.inCart')} {fmtMoney(cartSubtotal)}
        </span>
      </span>
      <span className="text-xs font-bold shrink-0 uppercase tracking-wide">{t('cart.checkout')} →</span>
    </button>
  );

  // ══════════════════════════════════════════════════════════════
  // DONE — sale completed
  // ══════════════════════════════════════════════════════════════
  if (step === 'done' && done) {
    const b = done;
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
            <Btn variant="green" onClick={startNewSale}>
              <RotateCcw size={15} /> {t('qsell.sellAgain')}
            </Btn>
          </>
        }
      >
        <div className="text-center py-2">
          <div className="mx-auto w-14 h-14 rounded-full bg-[var(--psa-soft-green)] flex items-center justify-center mb-3">
            <CheckCircle2 size={28} className="text-[#16A34A]" />
          </div>
          <p className="text-lg font-bold text-[var(--psa-ink)]">
            {b.items.length} {t('cart.items')}
          </p>
          <p className="text-2xl font-black text-[#E8552C] tabular-nums mt-1">{fmtMoney(b.total)}</p>
          <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
            <Badge tone="slate">
              {t('bills.billNo')}: {b.billNumber}
            </Badge>
            <Badge tone="green">{b.items.reduce((s, i) => s + (i.quantity || 0), 0)} {t('cart.items')}</Badge>
            {b.customerName && b.customerName !== 'Walk-in Customer' && <Badge tone="orange">{b.customerName}</Badge>}
          </div>
          {/* bought items — name × qty, category beneath */}
          <div className="mt-3 rounded-xl border border-[var(--psa-border)] divide-y divide-[var(--psa-line)] text-left max-h-44 overflow-y-auto">
            {b.items.map((it, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3.5 py-2">
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-[var(--psa-ink)] truncate">{it.name}</span>
                  {it.categoryName && (
                    <span className="block text-[10px] font-semibold text-[#E8552C]">
                      <FolderOpen size={9} className="inline -mt-0.5 mr-1" />
                      {it.categoryName}
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-[var(--psa-muted)] tabular-nums shrink-0">
                  {it.quantity} × {fmtMoney(it.unitPrice)}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--psa-muted)] mt-3">{t('qsell.doneDesc')}</p>
          <Btn size="sm" variant="ghost" className="mt-2" onClick={() => { close(); onGoBills(); }}>
            <ReceiptText size={14} /> {t('qsell.viewBills')}
          </Btn>
        </div>
      </Modal>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // QTY / PRICE SHEET — opened by tapping a product
  // ══════════════════════════════════════════════════════════════
  if (editing && editProduct) {
    const isNew = editing.editIndex < 0;
    return (
      <Modal
        open={open}
        onClose={close}
        title={
          <span className="flex items-center gap-2">
            <ShoppingCart size={17} className="text-[#FA6E41]" /> {t('qsell.saleDetails')}
          </span>
        }
        footer={
          <>
            <Btn
              variant="outline"
              onClick={() => {
                setEditing(null);
                // coming from the cart view → go back to the cart
                if (!isNew) setStep('cart');
              }}
            >
              {t('c.cancel')}
            </Btn>
            <Btn onClick={addToCart} disabled={editQtyNum <= 0 || editOverStock || (editAvailableSerials.length > 0 && editing.serials.length !== editSerialsNeeded)}>
              {isNew ? <Plus size={15} /> : <Check size={15} />}
              {isNew ? t('cart.add') : t('cart.update')} · {fmtMoney(editTotal)}
            </Btn>
          </>
        }
      >
        <div className="space-y-3.5">
          {/* product summary */}
          <div className="flex items-center justify-between gap-3 bg-[var(--psa-soft-orange)] rounded-xl p-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-[var(--psa-ink)] truncate">{editProduct.name}</p>
              <p className="text-[11px] text-[var(--psa-muted)]">
                {editProduct.categoryId && catNameOf(editProduct.categoryId) && (
                  <span className="font-semibold text-[#E8552C] mr-2">{catNameOf(editProduct.categoryId)}</span>
                )}
                {t('qsell.stockLeft')}: <b className="text-[var(--psa-ink)]">{editProduct.quantity}</b>
              </p>
            </div>
            <Badge tone={editOverStock ? 'red' : 'orange'}>{editOverStock ? t('qsell.errStock') : fmtMoney(editTotal)}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('prod.qty')} hint={editOverStock ? `${t('qsell.errStock')} (${editProduct.quantity})` : undefined}>
              <TextInput
                type="number"
                min="1"
                max={editProduct.quantity}
                value={editing.qty}
                onChange={(e) => {
                  const v = e.target.value;
                  setEditing((prev) => {
                    if (!prev) return prev;
                    const n = Math.max(0, Math.floor(Number(v) || 0));
                    return { ...prev, qty: v, serials: prev.serials.slice(0, Math.min(n, editAvailableSerials.length)) };
                  });
                }}
                autoFocus
              />
            </Field>
            <Field label={t('prod.rate') + ' — ' + t('prod.sellingPrice')}>
              <TextInput
                type="number"
                min="0"
                value={editing.rate}
                onChange={(e) => setEditing((prev) => (prev ? { ...prev, rate: e.target.value } : prev))}
              />
            </Field>
          </div>

          {/* serial picker — the customer's exact unit(s) */}
          {editAvailableSerials.length > 0 && (
            <Field
              label={`${t('qsell.pickSerial')} — ${editing.serials.length}/${editSerialsNeeded}`}
              hint={t('qsell.pickSerialHint')}
            >
              <div className="max-h-44 overflow-y-auto rounded-xl border border-[var(--psa-border)] divide-y divide-[var(--psa-line)]">
                {editAvailableSerials.map((sn) => {
                  const takenElsewhere = editTakenSerials.has(sn.toLowerCase());
                  const picked = editing.serials.some((x) => x.toLowerCase() === sn.toLowerCase());
                  const disabled = takenElsewhere && !picked;
                  return (
                    <button
                      key={sn}
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        setEditing((prev) => {
                          if (!prev) return prev;
                          const has = prev.serials.some((x) => x.toLowerCase() === sn.toLowerCase());
                          if (has) return { ...prev, serials: prev.serials.filter((x) => x.toLowerCase() !== sn.toLowerCase()) };
                          if (prev.serials.length < editSerialsNeeded) return { ...prev, serials: [...prev.serials, sn] };
                          return prev;
                        })
                      }
                      className={`w-full flex items-center justify-between gap-2 px-3.5 py-2 text-left text-sm transition-colors ${
                        picked ? 'bg-[var(--psa-soft-orange)]' : disabled ? 'opacity-40' : 'hover:bg-[var(--psa-row-hover)]'
                      }`}
                    >
                      <span className="font-mono text-[13px] text-[var(--psa-ink)] truncate">{sn}</span>
                      {picked ? <Check size={14} className="text-[#E8552C] shrink-0" /> : takenElsewhere ? <Hash size={12} className="text-[var(--psa-faint)] shrink-0" /> : null}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          {/* live line total */}
          <div className="flex items-center justify-between border-t border-[var(--psa-border)] pt-3">
            <span className="text-sm font-semibold text-[var(--psa-muted)]">
              {editQtyNum} × {fmtMoney(editRateNum)}
            </span>
            <span className="text-xl font-black text-[#E8552C] tabular-nums">{fmtMoney(editTotal)}</span>
          </div>
        </div>
      </Modal>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // CART — all lines + totals
  // ══════════════════════════════════════════════════════════════
  if (step === 'cart') {
    return (
      <Modal
        open={open}
        onClose={close}
        title={
          <span className="flex items-center gap-2">
            <ShoppingCart size={17} className="text-[#FA6E41]" /> {t('cart.title')}
            <Badge tone="orange">{cart.length}</Badge>
          </span>
        }
        footer={
          confirmClear ? (
            <>
              <Btn variant="outline" onClick={() => setConfirmClear(false)}>
                {t('c.cancel')}
              </Btn>
              <Btn variant="danger" onClick={clearCart}>
                <Trash2 size={15} /> {t('cart.clear')}
              </Btn>
            </>
          ) : (
            <>
              <Btn variant="outline" onClick={() => setStep('shop')}>
                <Plus size={15} /> {t('cart.addMore')}
              </Btn>
              <Btn variant="green" onClick={() => setStep('checkout')} disabled={cart.length === 0}>
                <ShoppingCart size={15} /> {t('cart.checkout')} · {fmtMoney(grand)}
              </Btn>
            </>
          )
        }
      >
        {cart.length === 0 ? (
          <div className="py-8 text-center">
            <PackageOpen size={34} className="mx-auto text-[var(--psa-faint)] mb-3" />
            <p className="text-sm text-[var(--psa-muted)]">{t('cart.empty')}</p>
            <Btn size="sm" className="mt-4" onClick={() => setStep('shop')}>
              <Plus size={14} /> {t('cart.addMore')}
            </Btn>
          </div>
        ) : (
          <div className="space-y-3">
            {/* lines */}
            <div className="rounded-xl border border-[var(--psa-border)] divide-y divide-[var(--psa-line)]">
              {cart.map((l, idx) => (
                <div key={`${l.productId}-${idx}`} className="flex items-start justify-between gap-2 px-3.5 py-3">
                  <div className="min-w-0 grow">
                    <p className="text-sm font-bold text-[var(--psa-ink)] truncate">{l.name}</p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      {l.categoryName && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-[var(--psa-hover)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--psa-muted)]">
                          <FolderOpen size={9} className="text-[#E8552C]" /> {l.categoryName}
                        </span>
                      )}
                      <span className="text-[11px] text-[var(--psa-muted)] tabular-nums">
                        {l.quantity} × {fmtMoney(l.unitPrice)}
                      </span>
                    </div>
                    {l.serials.length > 0 && (
                      <div className="mt-1 flex items-center gap-1 flex-wrap">
                        {l.serials.map((sn) => (
                          <span key={sn} className="inline-flex items-center gap-1 rounded-md bg-[var(--psa-hover)] border border-[var(--psa-border)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--psa-ink)]">
                            <Hash size={9} className="text-[#E8552C]" /> {sn}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-sm font-black text-[var(--psa-ink)] tabular-nums">{fmtMoney(lineTotal(l))}</span>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => openForLine(idx)}
                        title={t('cart.edit')}
                        aria-label={t('cart.edit')}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--psa-muted)] hover:bg-[var(--psa-hover2)] hover:text-[#E8552C] transition-colors"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        title={t('cart.remove')}
                        aria-label={t('cart.remove')}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-[#DC2626] hover:bg-[var(--psa-soft-red)] transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* totals */}
            <div className="rounded-xl bg-[var(--psa-hover)] px-4 py-3 space-y-1.5">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-[var(--psa-muted)] font-semibold">
                  {t('cart.subtotal')} ({cartQty} {t('cart.items')})
                </span>
                <span className="font-bold text-[var(--psa-ink)] tabular-nums">{fmtMoney(cartSubtotal)}</span>
              </div>
              {gstOn && breakup && (
                <div className="flex items-center justify-between text-[11px] text-[var(--psa-muted)]">
                  <span>
                    {gstMode === 'inclusive'
                      ? `CGST + SGST @ ${halfRate(billSettings?.gstRate || 0)} + ${halfRate(billSettings?.gstRate || 0)}%`
                      : `GST @ ${billSettings?.gstRate || 0}%`}
                  </span>
                  <span className="tabular-nums">{fmtMoney(breakup.gstAmount)}</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-[var(--psa-border)] pt-2">
                <span className="text-sm font-bold text-[var(--psa-ink)]">{t('bills.grandTotal')}</span>
                <span className="text-xl font-black text-[#E8552C] tabular-nums">{fmtMoney(grand)}</span>
              </div>
            </div>

            {/* the cart is NOT a sale yet — stock & history move only on Complete Sale */}
            <p className="flex items-start gap-1.5 rounded-lg bg-[var(--psa-hover)] px-3 py-2 text-[11px] leading-snug text-[var(--psa-muted)]">
              <AlertTriangle size={12} className="mt-0.5 shrink-0 text-[#E8552C]" />
              {t('cart.pendingNote')}
            </p>

            {!confirmClear && (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold text-[#DC2626] hover:bg-[var(--psa-soft-red)] transition-colors"
              >
                <Trash2 size={12} /> {t('cart.clear')}
              </button>
            )}
          </div>
        )}
      </Modal>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // CHECKOUT — customer + payment
  // ══════════════════════════════════════════════════════════════
  if (step === 'checkout') {
    return (
      <Modal
        open={open}
        onClose={close}
        title={
          <span className="flex items-center gap-2">
            <ShoppingCart size={17} className="text-[#FA6E41]" /> {t('cart.checkout')}
          </span>
        }
        footer={
          <>
            <Btn variant="outline" onClick={() => setStep('cart')} disabled={busy}>
              <ArrowLeft size={15} /> {t('qsell.changeCategory')}
            </Btn>
            <Btn variant="green" onClick={completeSale} disabled={busy || cart.length === 0}>
              {busy ? <span className="inline-block w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" /> : <CheckCircle2 size={15} />}
              {t('qsell.complete')} · {fmtMoney(grand)}
            </Btn>
          </>
        }
      >
        <div className="space-y-3.5">
          {/* compact cart recap */}
          <button
            type="button"
            onClick={() => setStep('cart')}
            className="w-full flex items-center justify-between gap-3 rounded-xl bg-[var(--psa-soft-orange)] px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--psa-hover)]"
          >
            <span className="flex items-center gap-2 min-w-0">
              <ShoppingCart size={14} className="text-[#E8552C] shrink-0" />
              <span className="text-sm font-semibold text-[var(--psa-ink)] truncate">
                {cart.length} {t('cart.items')} · {cartQty} pcs
              </span>
            </span>
            <span className="text-base font-black text-[#E8552C] tabular-nums shrink-0">{fmtMoney(grand)}</span>
          </button>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('qsell.customer')}>
              <TextInput value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder={t('due.walkIn')} />
            </Field>
            <Field label={t('qsell.mobile')}>
              <TextInput value={customerMobile} onChange={(e) => setCustomerMobile(e.target.value)} inputMode="tel" />
            </Field>
          </div>

          <Field label={t('qsell.address')}>
            <TextInput value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} />
          </Field>

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
                  {m === 'cash' ? t('c.cash') : m === 'card' ? t('c.card') : 'UPI'}
                </button>
              ))}
            </div>
          </Field>

          <Field label={t('qsell.note')}>
            <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          {/* final amount */}
          <div className="rounded-xl bg-[var(--psa-hover)] px-4 py-3 space-y-1.5">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-[var(--psa-muted)] font-semibold">{t('cart.subtotal')}</span>
              <span className="font-bold text-[var(--psa-ink)] tabular-nums">{fmtMoney(cartSubtotal)}</span>
            </div>
            {gstOn && breakup && (
              <div className="flex items-center justify-between text-[11px] text-[var(--psa-muted)]">
                <span>GST @ {billSettings?.gstRate || 0}%</span>
                <span className="tabular-nums">{fmtMoney(breakup.gstAmount)}</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-[var(--psa-border)] pt-2">
              <span className="text-sm font-bold text-[var(--psa-ink)]">{t('bills.grandTotal')}</span>
              <span className="text-xl font-black text-[#E8552C] tabular-nums">{fmtMoney(grand)}</span>
            </div>
            {gstOn && breakup && cartSubtotal > 0 && (
              <p className="text-[11px] text-[var(--psa-muted)]">
                {gstMode === 'inclusive'
                  ? taf('qsell.gstNoteIn', lang, {
                      rate: billSettings?.gstRate || 0,
                      half: halfRate(billSettings?.gstRate || 0),
                      taxable: fmtMoney(breakup.taxable),
                      cgst: fmtMoney(breakup.cgst),
                      sgst: fmtMoney(breakup.sgst),
                      grand: fmtMoney(grand),
                    })
                  : taf('qsell.gstNote', lang, { rate: billSettings?.gstRate || 0, gst: fmtMoney(breakup.gstAmount), grand: fmtMoney(grand) })}
              </p>
            )}
          </div>

          {/* the cart is NOT a sale yet — stock & history move only on Complete Sale */}
          <p className="flex items-start gap-1.5 rounded-lg bg-[var(--psa-hover)] px-3 py-2 text-[11px] leading-snug text-[var(--psa-muted)]">
            <AlertTriangle size={12} className="mt-0.5 shrink-0 text-[#E8552C]" />
            {t('cart.pendingNote')}
          </p>
        </div>
      </Modal>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // SHOP — category → product (the default view)
  // ══════════════════════════════════════════════════════════════
  return (
    <Modal
      open={open}
      onClose={close}
      title={
        <span className="flex items-center gap-2">
          <ShoppingCart size={17} className="text-[#FA6E41]" /> {t('shell.newSale')}
        </span>
      }
      footer={cartBar || <Btn variant="outline" onClick={close}>{t('c.close')}</Btn>}
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
                const pSerials = serialsOf(p);
                const inCart = cart.find((l) => l.productId === p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={out}
                    onClick={() => openForProduct(p)}
                    className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
                      out ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[var(--psa-row-hover)]'
                    }`}
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
                      {inCart && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-[var(--psa-soft-green)] px-1.5 py-0.5 text-[10px] font-bold text-[#16A34A]">
                          <ShoppingCart size={9} /> {t('cart.inCart')} {inCart.quantity} · {t('cart.remaining')} {Math.max(0, p.quantity - inCart.quantity)}
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
