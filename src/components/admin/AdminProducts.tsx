'use client';

/**
 * Admin Products — Vyapar-style stock table with add/edit, stock in/out and delete.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  ArrowDownToLine,
  ArrowUpFromLine,
  Search,
  Package,
  PackageX,
  Zap,
  Check,
  X,
} from 'lucide-react';
import {
  getProductsOffline,
  getCategoriesOffline,
  createProductOffline,
  updateProductOffline,
  deleteProductOffline,
  createTransactionOffline,
  createCategoryOffline,
  normalizeSerialList,
} from '@/lib/offline-service';
import { DEFAULT_USER_ID } from '@/lib/local-auth';
import { useAdminStore } from '@/store/adminStore';
import { ta } from '@/lib/admin-i18n';
import { useAdminDataTick } from './useAdminData';
import {
  AdminCard,
  Badge,
  Btn,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  SelectInput,
  StatCard,
  Td,
  TextArea,
  TextInput,
  Th,
  adminToast,
  fmtMoney,
} from './admin-ui';
import type { Category, Product } from '@/lib/types';

type FormState = {
  name: string;
  categoryId: string;
  quantity: string;
  boxNumber: string;
  /** ONE slot per unit — a mobile product with qty 3 has three S/N inputs. */
  serialNumbers: string[];
  purchasePrice: string;
  sellingPrice: string;
  lowStockThreshold: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  categoryId: '',
  quantity: '',
  boxNumber: '',
  serialNumbers: [],
  purchasePrice: '',
  sellingPrice: '',
  lowStockThreshold: '3',
};

/** Add-form ceiling: beyond 50 units the per-unit inputs stop scaling
 *  (typing 500 serials in a modal is not a phone shop, it's a warehouse). */
const MAX_SERIAL_INPUTS = 50;

/** Serial numbers are a phone-only concept — the input appears just for
 *  phone categories. EXACT name match (case-insensitive, trimmed) so seeded
 *  accessory categories like "Mobile Stand" never get the field. Covers the
 *  seeded "Mobile" category plus common Bengali/English variants. */
const MOBILE_CATEGORY_NAMES = new Set([
  'mobile',
  'mobiles',
  'mobile phone',
  'mobile phones',
  'মোবাইল',
  'মোবাইল ফোন',
]);

function isMobileCategory(name: string | undefined): boolean {
  if (!name) return false;
  return MOBILE_CATEGORY_NAMES.has(name.trim().toLowerCase());
}

/** Default category tile (orange gradient + first letter) for admin-created categories. */
function categoryImageFor(name: string): string {
  const letter = encodeURIComponent(name.trim().charAt(0).toUpperCase() || '•');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#FA6E41"/><stop offset="1" stop-color="#E8552C"/></linearGradient></defs>` +
    `<rect width="120" height="120" rx="24" fill="url(#g)"/>` +
    `<text x="60" y="80" font-family="sans-serif" font-size="54" font-weight="700" fill="#ffffff" text-anchor="middle">${letter}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Category suggestions combobox — once a category exists it is suggested
 * EVERY time a product is added/edited. Typing filters; a new name creates
 * the category inline and selects it.
 */
function CategoryCombobox({
  value,
  categories,
  onSelect,
  onCreate,
  placeholder,
  createLabel,
  noneLabel,
}: {
  value: string;
  categories: Category[];
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  placeholder: string;
  createLabel: string;
  noneLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const selected = categories.find((c) => c.id === value) || null;
  const query = q.trim().toLowerCase();
  const matches = query ? categories.filter((c) => c.name.toLowerCase().includes(query)) : categories;
  const exact = categories.find((c) => c.name.toLowerCase() === query);
  const canCreate = q.trim().length > 0 && !exact;

  return (
    <div className="relative">
      <TextInput
        value={open ? q : selected?.name || ''}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          setQ('');
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-[var(--psa-border)] bg-[var(--psa-card)] shadow-[0_10px_30px_rgba(16,24,40,0.14)] py-1">
          {matches.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(c.id);
                setOpen(false);
                setQ('');
              }}
              className={`w-full text-left px-3.5 py-2 text-sm hover:bg-[var(--psa-hover)] transition-colors flex items-center justify-between gap-2 ${
                c.id === value ? 'text-[#E8552C] font-semibold' : 'text-[var(--psa-ink)]'
              }`}
            >
              <span className="truncate">{c.name}</span>
              {c.id === value && <Check size={14} />}
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onCreate(q.trim());
                setOpen(false);
                setQ('');
              }}
              className="w-full text-left px-3.5 py-2.5 text-sm font-semibold text-[#E8552C] hover:bg-[var(--psa-soft-orange)] transition-colors flex items-center gap-2 border-t border-[var(--psa-line)]"
            >
              <Plus size={14} /> {createLabel} “{q.trim()}”
            </button>
          )}
          {matches.length === 0 && !canCreate && (
            <p className="px-3.5 py-2.5 text-xs text-[var(--psa-faint)]">{noneLabel}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminProducts({ onQuickSell }: { onQuickSell?: (p: Product) => void }) {
  const lang = useAdminStore((s) => s.language);
  const t = (k: string) => ta(k, lang);
  const tick = useAdminDataTick();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const [stockModal, setStockModal] = useState<{ product: Product; type: 'STOCK_IN' | 'STOCK_OUT' } | null>(null);
  const [stockQty, setStockQty] = useState('');
  const [stockRate, setStockRate] = useState('');
  /** STOCK_OUT of serialized stock: exactly which units leave. */
  const [stockOutSerials, setStockOutSerials] = useState<string[]>([]);
  /** STOCK_IN of serialized stock: new S/N list, one per line (optional). */
  const [stockInSerials, setStockInSerials] = useState('');

  const [catModalOpen, setCatModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  const [deleting, setDeleting] = useState<Product | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [ps, cs] = await Promise.all([
        getProductsOffline(DEFAULT_USER_ID),
        getCategoriesOffline(DEFAULT_USER_ID),
      ]);
      if (!alive) return;
      setProducts(ps);
      setCategories(cs);
    })();
    return () => {
      alive = false;
    };
  }, [tick]);

  const catNameMap = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  // Serial input shows only when the picked category is a phone category.
  const serialVisible = isMobileCategory(categories.find((c) => c.id === form.categoryId)?.name);

  // Add mode: quantity N → N serial inputs (one per unit).
  const addQtyN = Math.max(0, Math.min(MAX_SERIAL_INPUTS, Math.floor(Number(form.quantity) || 0) || 0));

  // Keep the serial slots in sync with the quantity: growing the quantity
  // appends empty slots, shrinking trims the tail (values are plain inputs).
  useEffect(() => {
    if (!formOpen || editing || !serialVisible) return;
    setForm((f) => {
      if (f.serialNumbers.length === addQtyN) return f;
      const next = f.serialNumbers.slice(0, addQtyN);
      while (next.length < addQtyN) next.push('');
      return { ...f, serialNumbers: next };
    });
  }, [formOpen, editing, serialVisible, addQtyN]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (catFilter && p.categoryId !== catFilter) return false;
      if (
        q &&
        !p.name.toLowerCase().includes(q) &&
        !p.boxNumber.toLowerCase().includes(q) &&
        !(p.serialNumbers || []).some((s) => s.toLowerCase().includes(q)) &&
        !(p.serialNumber || '').toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [products, search, catFilter]);

  const totals = useMemo(() => {
    const value = products.reduce((s, p) => s + p.quantity * p.purchasePrice, 0);
    const low = products.filter((p) => p.quantity <= p.lowStockThreshold).length;
    return { value, low, count: products.length };
  }, [products]);

  const saveCategory = async () => {
    if (!newCatName.trim()) {
      adminToast(t('c.required'), 'err');
      return;
    }
    await createAndPickCategory(newCatName);
    setCatModalOpen(false);
    setNewCatName('');
  };

  /** Create a category inline (combobox “create” row) and select it for the form. */
  const createAndPickCategory = async (name: string) => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { category } = await createCategoryOffline(name, categoryImageFor(name), DEFAULT_USER_ID);
      setCategories((prev) => [...prev, category]);
      setForm((f) => ({ ...f, categoryId: category.id }));
      adminToast(t('c.added'));
    } catch (err) {
      adminToast((err as Error)?.message || t('c.error'), 'err');
    } finally {
      setBusy(false);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, categoryId: categories[0]?.id || '' });
    setFormOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name,
      categoryId: p.categoryId,
      quantity: String(p.quantity),
      boxNumber: p.boxNumber || '',
      // legacy v2.11.5 rows carry one serialNumber string — lift it into the
      // per-unit list so the edit form always works with serialNumbers
      serialNumbers: normalizeSerialList(p.serialNumbers?.length ? p.serialNumbers : [p.serialNumber || '']),
      purchasePrice: String(p.purchasePrice),
      sellingPrice: String(p.sellingPrice),
      lowStockThreshold: String(p.lowStockThreshold),
    });
    setFormOpen(true);
  };

  const saveForm = async () => {
    if (!form.name.trim()) {
      adminToast(t('c.required'), 'err');
      return;
    }
    if (!form.categoryId) {
      adminToast(t('prod.addCategoryFirst'), 'err');
      return;
    }
    // Duplicate guard — the same name must not exist twice inside ONE
    // category (trimmed + case-insensitive). Editing exempts its own row.
    // The service layer enforces this too — this pre-check just gives an
    // instant, localized toast before any write is attempted.
    const needle = form.name.trim().toLowerCase();
    const isDuplicate = products.some(
      (p) => p.id !== editing?.id && p.categoryId === form.categoryId && p.name.trim().toLowerCase() === needle
    );
    if (isDuplicate) {
      adminToast(t('prod.duplicate'), 'err');
      return;
    }
    // Per-unit serial validation (mobile products only):
    //  add  → every unit needs its S/N (quantity N → N serials, no dupes)
    //  edit → blank slots are dropped, duplicates are rejected
    let serials: string[] = [];
    if (serialVisible) {
      const raw = editing ? form.serialNumbers : form.serialNumbers.slice(0, addQtyN);
      serials = normalizeSerialList(raw);
      const filled = raw.map((s) => s.trim()).filter(Boolean);
      if (filled.length !== serials.length) {
        adminToast(t('prod.serialsDup'), 'err');
        return;
      }
      if (!editing && serials.length < addQtyN) {
        adminToast(t('prod.serialsRequired'), 'err');
        return;
      }
    }
    setBusy(true);
    try {
      // Serial numbers are a mobile-category-only field: captured when the
      // picked category is a phone category and CLEARED when the product
      // lives in any other category (moving a phone out of Mobile drops its
      // serials with it — the field is hidden there anyway).
      const payload = {
        userId: DEFAULT_USER_ID,
        name: form.name.trim(),
        categoryId: form.categoryId,
        boxNumber: form.boxNumber.trim(),
        serialNumbers: serialVisible ? serials : [],
        purchasePrice: Math.max(0, Number(form.purchasePrice) || 0),
        sellingPrice: Math.max(0, Number(form.sellingPrice) || 0),
        lowStockThreshold: Math.max(0, Math.floor(Number(form.lowStockThreshold) || 0)),
      };
      if (editing) {
        await updateProductOffline(editing.id, payload);
        adminToast(t('c.saved'));
      } else {
        await createProductOffline({ ...payload, quantity: Math.max(0, Math.floor(Number(form.quantity) || 0)) });
        adminToast(t('c.added'));
      }
      setFormOpen(false);
    } catch (err) {
      adminToast((err as Error)?.message || t('c.error'), 'err');
    } finally {
      setBusy(false);
    }
  };

  const saveStock = async () => {
    if (!stockModal) return;
    const qty = Math.floor(Number(stockQty));
    if (!Number.isFinite(qty) || qty <= 0) {
      adminToast(t('c.required'), 'err');
      return;
    }
    // Serialized stock going out: the exact units must be identified —
    // pick min(qty, available serials) serials before confirming.
    const availableSerials = normalizeSerialList(stockModal.product.serialNumbers);
    let soldSerials: string[] = [];
    if (stockModal.type === 'STOCK_OUT' && availableSerials.length > 0) {
      const need = Math.min(qty, availableSerials.length);
      if (stockOutSerials.length !== need) {
        adminToast(t('qsell.pickSerial'), 'err');
        return;
      }
      soldSerials = stockOutSerials;
    }
    // Serialized stock coming in: optional new S/N list (one per line) that
    // merges into the product's per-unit list — new phones get their IMEIs.
    const newSerials = normalizeSerialList(stockInSerials.split('\n'));
    setBusy(true);
    try {
      if (stockModal.type === 'STOCK_IN') {
        const rate = Number(stockRate);
        const unitPrice = Number.isFinite(rate) && rate > 0 ? rate : stockModal.product.purchasePrice;
        await createTransactionOffline({
          type: 'STOCK_IN',
          productId: stockModal.product.id,
          quantity: qty,
          unitPrice,
          totalAmount: qty * unitPrice,
          userId: DEFAULT_USER_ID,
        });
        if (newSerials.length > 0) {
          await updateProductOffline(stockModal.product.id, {
            userId: DEFAULT_USER_ID,
            serialNumbers: [...availableSerials, ...newSerials],
          });
        }
      } else {
        const rate = Number(stockRate);
        const unitPrice = Number.isFinite(rate) && rate > 0 ? rate : stockModal.product.sellingPrice;
        await createTransactionOffline({
          type: 'STOCK_OUT',
          productId: stockModal.product.id,
          quantity: qty,
          unitPrice,
          totalAmount: qty * unitPrice,
          soldSerials,
          userId: DEFAULT_USER_ID,
        });
      }
      adminToast(t('c.saved'));
      setStockModal(null);
      setStockQty('');
      setStockRate('');
      setStockOutSerials([]);
      setStockInSerials('');
    } catch (err) {
      adminToast((err as Error)?.message || t('c.error'), 'err');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteProductOffline(deleting.id, DEFAULT_USER_ID);
      adminToast(t('c.deleted'));
      setDeleting(null);
    } catch (err) {
      adminToast((err as Error)?.message || t('c.error'), 'err');
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = (p: Product) =>
    p.quantity <= 0 ? (
      <Badge tone="red">{t('prod.out')}</Badge>
    ) : p.quantity <= p.lowStockThreshold ? (
      <Badge tone="amber">{t('prod.low')} · {p.quantity}</Badge>
    ) : (
      <Badge tone="green">{p.quantity}</Badge>
    );

  /** Per-unit serials of a product — legacy single-string rows are lifted
   *  into a one-element list so every view below works with arrays only. */
  const serialsOf = (p: Product): string[] =>
    normalizeSerialList(p.serialNumbers?.length ? p.serialNumbers : [p.serialNumber || '']);

  // ── stock-modal serial helpers ──
  const stockSerialList = stockModal ? serialsOf(stockModal.product) : [];
  const stockQtyNum = Math.max(0, Math.floor(Number(stockQty) || 0));
  const stockNeed = stockModal?.type === 'STOCK_OUT' ? Math.min(stockQtyNum, stockSerialList.length) : 0;
  const stockIsMobile =
    !!stockModal && (stockSerialList.length > 0 || isMobileCategory(catNameMap.get(stockModal.product.categoryId)));

  return (
    <div>
      <PageHeader
        title={t('prod.title')}
        action={
          <Btn onClick={openAdd}>
            <Plus size={16} /> {t('prod.add')}
          </Btn>
        }
      />

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard icon={<Package size={18} />} label={t('dash.totalItems')} value={totals.count} tone="orange" />
        <StatCard icon={<PackageX size={18} />} label={t('dash.lowStock')} value={totals.low} tone="amber" />
        <StatCard icon={<ArrowDownToLine size={18} />} label={t('dash.stockValue')} value={fmtMoney(totals.value)} tone="green" />
      </div>

      <AdminCard bodyClass="!p-0">
        <div className="flex flex-col sm:flex-row gap-2 p-4 border-b border-[var(--psa-border)]">
          <div className="relative grow">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--psa-faint)]" />
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('prod.search')}
              className="!pl-9"
            />
          </div>
          <SelectInput value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="sm:w-52">
            <option value="">{t('prod.allCategories')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectInput>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={<Package size={22} />} title={t('c.noData')} />
        ) : (
          <div className="overflow-x-auto max-h-[62vh] overflow-y-auto">
            <table className="w-full min-w-[760px]">
              <thead className="bg-[var(--psa-hover)] sticky top-0 z-10">
                <tr>
                  <Th>{t('prod.name')}</Th>
                  <Th>{t('prod.category')}</Th>
                  <Th className="text-right">{t('prod.quantity')}</Th>
                  <Th>{t('prod.box')}</Th>
                  <Th className="text-right">{t('prod.purchasePrice')}</Th>
                  <Th className="text-right">{t('prod.sellingPrice')}</Th>
                  <Th className="text-right">{t('prod.value')}</Th>
                  <Th className="text-right">{t('c.edit')}</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-[var(--psa-row-hover)] transition-colors">
                    <Td>
                      <span className="font-semibold">{p.name}</span>
                      {serialsOf(p).length > 0 && (
                        <div className="mt-0.5 text-xs text-[var(--psa-muted)] font-mono tracking-tight">
                          S/N: {serialsOf(p).slice(0, 2).join(', ')}
                          {serialsOf(p).length > 2 ? ` +${serialsOf(p).length - 2}` : ''}
                        </div>
                      )}
                      <div className="sm:hidden mt-1">{statusBadge(p)}</div>
                    </Td>
                    <Td className="hidden sm:table-cell">
                      <Badge tone="slate">{catNameMap.get(p.categoryId) || '—'}</Badge>
                    </Td>
                    <Td className="hidden sm:table-cell text-right">
                      <span className="tabular-nums font-semibold">{p.quantity}</span>{' '}
                      <span className="hidden lg:inline">{statusBadge(p)}</span>
                    </Td>
                    <Td className="hidden lg:table-cell text-[var(--psa-muted)]">{p.boxNumber || '—'}</Td>
                    <Td className="text-right tabular-nums">{fmtMoney(p.purchasePrice)}</Td>
                    <Td className="text-right tabular-nums">{fmtMoney(p.sellingPrice)}</Td>
                    <Td className="text-right tabular-nums font-semibold">{fmtMoney(p.quantity * p.purchasePrice)}</Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => onQuickSell?.(p)}
                          title={t('shell.quickSell')}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-[#E8552C] hover:bg-[var(--psa-soft-orange)]"
                        >
                          <Zap size={15} />
                        </button>
                        <button
                          onClick={() => {
                            setStockModal({ product: p, type: 'STOCK_IN' });
                            setStockQty('');
                            setStockRate('');
                            setStockOutSerials([]);
                            setStockInSerials('');
                          }}
                          title={t('prod.stockIn')}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-[#16A34A] hover:bg-[var(--psa-soft-green)]"
                        >
                          <ArrowDownToLine size={15} />
                        </button>
                        <button
                          onClick={() => {
                            setStockModal({ product: p, type: 'STOCK_OUT' });
                            setStockQty('');
                            setStockRate(String(p.sellingPrice));
                            setStockOutSerials([]);
                            setStockInSerials('');
                          }}
                          title={t('prod.stockOut')}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-[#DC2626] hover:bg-[var(--psa-soft-red)]"
                        >
                          <ArrowUpFromLine size={15} />
                        </button>
                        <button
                          onClick={() => openEdit(p)}
                          title={t('c.edit')}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--psa-muted)] hover:bg-[var(--psa-hover2)]"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setDeleting(p)}
                          title={t('c.delete')}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-[#DC2626] hover:bg-[var(--psa-soft-red)]"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      {/* add / edit product */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? t('c.edit') : t('prod.add')}
        footer={
          <>
            <Btn variant="outline" onClick={() => setFormOpen(false)}>
              {t('c.cancel')}
            </Btn>
            <Btn onClick={saveForm} disabled={busy}>
              {t('c.save')}
            </Btn>
          </>
        }
      >
        <div className="space-y-3.5">
          <Field label={t('prod.name')}>
            <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t('prod.category')} hint={t('cat.searchOrCreate')}>
            <div className="flex gap-2">
              <div className="grow">
                <CategoryCombobox
                  value={form.categoryId}
                  categories={categories}
                  onSelect={(id) => setForm((f) => ({ ...f, categoryId: id }))}
                  onCreate={createAndPickCategory}
                  placeholder={t('cat.searchOrCreate')}
                  createLabel={t('cat.create')}
                  noneLabel={t('cat.none')}
                />
              </div>
              <Btn variant="soft" onClick={() => setCatModalOpen(true)} title={t('prod.newCategory')} className="!px-3 shrink-0">
                <Plus size={16} />
              </Btn>
            </div>
          </Field>
          {!editing && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('prod.quantity')}>
                <TextInput
                  type="number"
                  min="0"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                />
              </Field>
              <Field label={t('prod.box')}>
                <TextInput value={form.boxNumber} onChange={(e) => setForm({ ...form, boxNumber: e.target.value })} />
              </Field>
            </div>
          )}
          {editing && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('prod.quantity')} hint={t('prod.stockIn') + ' / ' + t('prod.stockOut')}>
                <TextInput value={String(editing.quantity)} disabled className="!bg-[var(--psa-hover)]" />
              </Field>
              <Field label={t('prod.box')}>
                <TextInput value={form.boxNumber} onChange={(e) => setForm({ ...form, boxNumber: e.target.value })} />
              </Field>
            </div>
          )}
          {/* ── per-unit serials — MOBILE CATEGORY ONLY ──
              add:  quantity N → exactly N S/N inputs (one per unit)
              edit: editable list + add/remove slots within stock */}
          {serialVisible && !editing && addQtyN > 0 && (
            <Field label={`${t('prod.serials')} — ${addQtyN}`} hint={t('prod.serialsHint')}>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {form.serialNumbers.slice(0, addQtyN).map((sn, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-10 shrink-0 text-[11px] font-bold text-[var(--psa-muted)] tabular-nums">#{i + 1}</span>
                    <TextInput
                      value={sn}
                      onChange={(e) => {
                        const v = e.target.value;
                        setForm((f) => {
                          const next = [...f.serialNumbers];
                          while (next.length <= i) next.push('');
                          next[i] = v;
                          return { ...f, serialNumbers: next };
                        });
                      }}
                      placeholder={`IMEI / S/N ${i + 1}`}
                    />
                  </div>
                ))}
              </div>
            </Field>
          )}
          {serialVisible && editing && (
            <Field label={`${t('prod.serials')} — ${form.serialNumbers.filter((s) => s.trim()).length}`} hint={t('prod.serialsHintEdit')}>
              <div className="space-y-2">
                {form.serialNumbers.map((sn, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="w-10 shrink-0 text-[11px] font-bold text-[var(--psa-muted)] tabular-nums">#{i + 1}</span>
                    <TextInput
                      value={sn}
                      onChange={(e) => {
                        const v = e.target.value;
                        setForm((f) => {
                          const next = [...f.serialNumbers];
                          next[i] = v;
                          return { ...f, serialNumbers: next };
                        });
                      }}
                      placeholder="IMEI / S/N"
                    />
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, serialNumbers: f.serialNumbers.filter((_, j) => j !== i) }))}
                      title={t('c.delete')}
                      className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-[#DC2626] hover:bg-[var(--psa-soft-red)]"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                {form.serialNumbers.length < editing.quantity && (
                  <Btn variant="soft" size="sm" onClick={() => setForm((f) => ({ ...f, serialNumbers: [...f.serialNumbers, ''] }))}>
                    <Plus size={14} /> {t('prod.serialAdd')}
                  </Btn>
                )}
              </div>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('prod.purchasePrice')}>
              <TextInput
                type="number"
                min="0"
                value={form.purchasePrice}
                onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })}
              />
            </Field>
            <Field label={t('prod.sellingPrice')}>
              <TextInput
                type="number"
                min="0"
                value={form.sellingPrice}
                onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })}
              />
            </Field>
          </div>
          <Field label={t('prod.lowThreshold')}>
            <TextInput
              type="number"
              min="0"
              value={form.lowStockThreshold}
              onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })}
            />
          </Field>
        </div>
      </Modal>

      {/* new category (inline) */}
      <Modal
        open={catModalOpen}
        onClose={() => setCatModalOpen(false)}
        title={t('prod.newCategory')}
        footer={
          <>
            <Btn variant="outline" onClick={() => setCatModalOpen(false)}>
              {t('c.cancel')}
            </Btn>
            <Btn onClick={saveCategory} disabled={busy}>
              {t('c.add')}
            </Btn>
          </>
        }
      >
        <Field label={t('prod.categoryName')}>
          <TextInput
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            autoFocus
            placeholder={t('prod.category')}
          />
        </Field>
      </Modal>

      {/* stock in / out */}
      <Modal
        open={!!stockModal}
        onClose={() => setStockModal(null)}
        title={
          stockModal?.type === 'STOCK_IN' ? (
            <span className="text-[#16A34A]">↓ {t('prod.stockIn')} — {stockModal?.product.name}</span>
          ) : (
            <span className="text-[#DC2626]">↑ {t('prod.stockOut')} — {stockModal?.product.name}</span>
          )
        }
        footer={
          <>
            <Btn variant="outline" onClick={() => setStockModal(null)}>
              {t('c.cancel')}
            </Btn>
            <Btn
              variant={stockModal?.type === 'STOCK_IN' ? 'green' : 'primary'}
              onClick={saveStock}
              disabled={busy || (stockModal?.type === 'STOCK_OUT' && stockSerialList.length > 0 && stockOutSerials.length !== stockNeed)}
            >
              {t('c.confirm')}
            </Btn>
          </>
        }
      >
        <div className="space-y-3.5">
          <div className="text-xs text-[var(--psa-muted)] bg-[var(--psa-hover)] rounded-lg p-3">
            {t('prod.quantity')}: <b className="text-[var(--psa-ink)]">{stockModal?.product.quantity}</b>
          </div>
          <Field label={t('prod.qty')}>
            <TextInput type="number" min="1" value={stockQty} onChange={(e) => {
              setStockQty(e.target.value);
              // quantity shrank → trim over-picked serials
              const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
              setStockOutSerials((prev) => prev.slice(0, Math.min(n, stockSerialList.length)));
            }} autoFocus />
          </Field>
          <Field
            label={stockModal?.type === 'STOCK_IN' ? t('prod.rate') + ' — ' + t('prod.purchasePrice') : t('prod.rate') + ' — ' + t('prod.sellingPrice')}
            hint={stockModal?.type === 'STOCK_IN' ? t('prod.rateHint') : undefined}
          >
            <TextInput type="number" min="0" value={stockRate} onChange={(e) => setStockRate(e.target.value)} />
          </Field>

          {/* STOCK_OUT of serialized stock — pick exactly which units leave */}
          {stockModal?.type === 'STOCK_OUT' && stockSerialList.length > 0 && (
            <Field label={`${t('qsell.pickSerial')} — ${stockOutSerials.length}/${stockNeed}`}>
              <div className="max-h-44 overflow-y-auto rounded-xl border border-[var(--psa-border)] divide-y divide-[var(--psa-line)]">
                {stockSerialList.map((sn) => {
                  const picked = stockOutSerials.some((x) => x.toLowerCase() === sn.toLowerCase());
                  return (
                    <button
                      key={sn}
                      type="button"
                      onClick={() =>
                        setStockOutSerials((prev) =>
                          prev.some((x) => x.toLowerCase() === sn.toLowerCase())
                            ? prev.filter((x) => x.toLowerCase() !== sn.toLowerCase())
                            : prev.length < stockNeed
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

          {/* STOCK_IN of mobile stock — optional new S/N list, one per line */}
          {stockModal?.type === 'STOCK_IN' && stockIsMobile && (
            <Field label={t('prod.serialsAdd')} hint={t('prod.serialsInHint')}>
              <TextArea
                value={stockInSerials}
                onChange={(e) => setStockInSerials(e.target.value)}
                rows={3}
                placeholder={'IMEI1\nIMEI2\nIMEI3'}
                className="font-mono text-[13px]"
              />
            </Field>
          )}
        </div>
      </Modal>

      {/* delete confirm */}
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('prod.confirmDelete')}
        footer={
          <>
            <Btn variant="outline" onClick={() => setDeleting(null)}>
              {t('c.cancel')}
            </Btn>
            <Btn variant="danger" onClick={doDelete} disabled={busy}>
              {t('c.delete')}
            </Btn>
          </>
        }
      >
        <p className="text-sm text-[var(--psa-sub)]">
          <b>{deleting?.name}</b> — {t('prod.deleteNote')}
        </p>
      </Modal>
    </div>
  );
}
