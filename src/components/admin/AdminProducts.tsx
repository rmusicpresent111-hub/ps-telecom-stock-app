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
} from 'lucide-react';
import {
  getProductsOffline,
  getCategoriesOffline,
  createProductOffline,
  updateProductOffline,
  deleteProductOffline,
  createTransactionOffline,
  createCategoryOffline,
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
  purchasePrice: string;
  sellingPrice: string;
  lowStockThreshold: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  categoryId: '',
  quantity: '',
  boxNumber: '',
  purchasePrice: '',
  sellingPrice: '',
  lowStockThreshold: '3',
};

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

export default function AdminProducts() {
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (catFilter && p.categoryId !== catFilter) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.boxNumber.toLowerCase().includes(q)) return false;
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
    setBusy(true);
    try {
      const { category } = await createCategoryOffline(newCatName, categoryImageFor(newCatName), DEFAULT_USER_ID);
      setCategories((prev) => [...prev, category]);
      setForm((f) => ({ ...f, categoryId: category.id }));
      adminToast(t('c.added'));
      setCatModalOpen(false);
      setNewCatName('');
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
    setBusy(true);
    try {
      const payload = {
        userId: DEFAULT_USER_ID,
        name: form.name.trim(),
        categoryId: form.categoryId,
        boxNumber: form.boxNumber.trim(),
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
      } else {
        const rate = Number(stockRate);
        const unitPrice = Number.isFinite(rate) && rate > 0 ? rate : stockModal.product.sellingPrice;
        await createTransactionOffline({
          type: 'STOCK_OUT',
          productId: stockModal.product.id,
          quantity: qty,
          unitPrice,
          totalAmount: qty * unitPrice,
          userId: DEFAULT_USER_ID,
        });
      }
      adminToast(t('c.saved'));
      setStockModal(null);
      setStockQty('');
      setStockRate('');
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
        <div className="flex flex-col sm:flex-row gap-2 p-4 border-b border-[#E8EAED]">
          <div className="relative grow">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
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
              <thead className="bg-[#FAFAFB] sticky top-0 z-10">
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
                  <tr key={p.id} className="hover:bg-[#FFFBF9] transition-colors">
                    <Td>
                      <span className="font-semibold">{p.name}</span>
                      <div className="sm:hidden mt-1">{statusBadge(p)}</div>
                    </Td>
                    <Td className="hidden sm:table-cell">
                      <Badge tone="slate">{catNameMap.get(p.categoryId) || '—'}</Badge>
                    </Td>
                    <Td className="hidden sm:table-cell text-right">
                      <span className="tabular-nums font-semibold">{p.quantity}</span>{' '}
                      <span className="hidden lg:inline">{statusBadge(p)}</span>
                    </Td>
                    <Td className="hidden lg:table-cell text-[#6B7280]">{p.boxNumber || '—'}</Td>
                    <Td className="text-right tabular-nums">{fmtMoney(p.purchasePrice)}</Td>
                    <Td className="text-right tabular-nums">{fmtMoney(p.sellingPrice)}</Td>
                    <Td className="text-right tabular-nums font-semibold">{fmtMoney(p.quantity * p.purchasePrice)}</Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            setStockModal({ product: p, type: 'STOCK_IN' });
                            setStockQty('');
                            setStockRate('');
                          }}
                          title={t('prod.stockIn')}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-[#16A34A] hover:bg-[#F0FDF4]"
                        >
                          <ArrowDownToLine size={15} />
                        </button>
                        <button
                          onClick={() => {
                            setStockModal({ product: p, type: 'STOCK_OUT' });
                            setStockQty('');
                            setStockRate(String(p.sellingPrice));
                          }}
                          title={t('prod.stockOut')}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-[#DC2626] hover:bg-[#FEF2F2]"
                        >
                          <ArrowUpFromLine size={15} />
                        </button>
                        <button
                          onClick={() => openEdit(p)}
                          title={t('c.edit')}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6B7280] hover:bg-[#F3F4F6]"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setDeleting(p)}
                          title={t('c.delete')}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-[#DC2626] hover:bg-[#FEF2F2]"
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
          <Field label={t('prod.category')}>
            <div className="flex gap-2">
              <div className="grow">
                <SelectInput value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                  <option value="">—</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </SelectInput>
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
                <TextInput value={String(editing.quantity)} disabled className="!bg-[#F9FAFB]" />
              </Field>
              <Field label={t('prod.box')}>
                <TextInput value={form.boxNumber} onChange={(e) => setForm({ ...form, boxNumber: e.target.value })} />
              </Field>
            </div>
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
            <Btn variant={stockModal?.type === 'STOCK_IN' ? 'green' : 'primary'} onClick={saveStock} disabled={busy}>
              {t('c.confirm')}
            </Btn>
          </>
        }
      >
        <div className="space-y-3.5">
          <div className="text-xs text-[#6B7280] bg-[#F9FAFB] rounded-lg p-3">
            {t('prod.quantity')}: <b className="text-[#1F2937]">{stockModal?.product.quantity}</b>
          </div>
          <Field label={t('prod.qty')}>
            <TextInput type="number" min="1" value={stockQty} onChange={(e) => setStockQty(e.target.value)} autoFocus />
          </Field>
          <Field
            label={stockModal?.type === 'STOCK_IN' ? t('prod.rate') + ' — ' + t('prod.purchasePrice') : t('prod.rate') + ' — ' + t('prod.sellingPrice')}
            hint={stockModal?.type === 'STOCK_IN' ? t('prod.rateHint') : undefined}
          >
            <TextInput type="number" min="0" value={stockRate} onChange={(e) => setStockRate(e.target.value)} />
          </Field>
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
        <p className="text-sm text-[#374151]">
          <b>{deleting?.name}</b> — {t('prod.deleteNote')}
        </p>
      </Modal>
    </div>
  );
}
