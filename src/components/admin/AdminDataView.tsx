'use client';

/**
 * Database View — category-wise columns (v2.15.0).
 *
 * The owner's mental model: "প্রতিটা ক্যাটাগরি হলো ডাটাবেসের একটা কলাম, আর
 * প্রোডাক্ট তার ক্যাটাগরির কলামের ভেতরেই সেভ থাকে" — every category is a
 * column (Mobile, Charger, Data Cable, Power Bank…) and its products live
 * inside that column. The database has ALWAYS filed products this way
 * (products carry categoryId; IndexedDB keeps a by-category index; D1 sync
 * payloads carry the same link) — this view simply MAKES IT VISIBLE: one live
 * column per category, products filed underneath, read straight from the
 * same IndexedDB every surface writes to, auto-refreshing on local writes,
 * cloud-sync cycles and the 20s poll.
 */

import { useEffect, useMemo, useState } from 'react';
import { Boxes, PackageX, Search } from 'lucide-react';
import { getCategoriesOffline, getProductsOffline } from '@/lib/offline-service';
import { DEFAULT_USER_ID } from '@/lib/local-auth';
import type { Category, Product } from '@/lib/types';
import { useAdminStore } from '@/store/adminStore';
import { useAdminDataTick } from './useAdminData';
import { ta } from '@/lib/admin-i18n';
import { AdminCard, Badge, EmptyState, Spinner, TextInput, fmtMoney } from './admin-ui';

interface CatColumn {
  category: Category;
  products: Product[];
  pieces: number; // total units in stock
  invest: number; // qty × purchasePrice
  retail: number; // qty × sellingPrice
}

function CategoryThumb({ image, size = 34 }: { image: string; size?: number }) {
  const isImg = !!image && (image.startsWith('data:') || image.startsWith('/'));
  return (
    <span
      className="rounded-lg bg-[var(--psa-canvas)] border border-[var(--psa-border)] flex items-center justify-center overflow-hidden shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.55 }}
    >
      {isImg ? (
         
        <img src={image} alt="" className="w-full h-full object-cover" />
      ) : (
        image || '📦'
      )}
    </span>
  );
}

export default function AdminDataView() {
  const lang = useAdminStore((s) => s.language);
  const t = (k: string) => ta(k, lang);
  const tick = useAdminDataTick();

  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [cs, ps] = await Promise.all([
          getCategoriesOffline(DEFAULT_USER_ID),
          getProductsOffline(DEFAULT_USER_ID),
        ]);
        if (!alive) return;
        setCategories(cs);
        setProducts(ps);
      } catch {
        /* best-effort — keeps the previous view */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [tick]);

  const needle = search.trim().toLowerCase();
  const match = (p: Product) =>
    !needle ||
    p.name.toLowerCase().includes(needle) ||
    (p.boxNumber || '').toLowerCase().includes(needle);

  // One column per category — the "database columns" the owner asked for.
  const columns = useMemo<CatColumn[]>(
    () =>
      categories.map((category) => {
        const list = products.filter((p) => p.categoryId === category.id && match(p));
        return {
          category,
          products: list,
          pieces: list.reduce((s, p) => s + p.quantity, 0),
          invest: list.reduce((s, p) => s + p.quantity * p.purchasePrice, 0),
          retail: list.reduce((s, p) => s + p.quantity * p.sellingPrice, 0),
        };
      }),
     
    [categories, products, needle]
  );

  // Products whose categoryId no longer resolves (legacy ids from older syncs)
  const orphanProducts = useMemo(() => {
    const ids = new Set(categories.map((c) => c.id));
    return products.filter((p) => !ids.has(p.categoryId) && match(p));
     
  }, [categories, products, needle]);

  const totals = useMemo(
    () => ({
      pieces: products.reduce((s, p) => s + p.quantity, 0),
      invest: products.reduce((s, p) => s + p.quantity * p.purchasePrice, 0),
    }),
    [products]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="w-7 h-7" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* summary strip — the whole database at a glance */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <AdminCard className="p-4">
          <p className="text-[11px] font-semibold text-[var(--psa-faint)] uppercase tracking-wide">{t('dbview.cats')}</p>
          <p className="text-2xl font-black text-[var(--psa-ink)] mt-1">{categories.length}</p>
        </AdminCard>
        <AdminCard className="p-4">
          <p className="text-[11px] font-semibold text-[var(--psa-faint)] uppercase tracking-wide">{t('dbview.products')}</p>
          <p className="text-2xl font-black text-[var(--psa-ink)] mt-1">{products.length}</p>
        </AdminCard>
        <AdminCard className="p-4">
          <p className="text-[11px] font-semibold text-[var(--psa-faint)] uppercase tracking-wide">{t('dbview.pieces')}</p>
          <p className="text-2xl font-black text-[var(--psa-ink)] mt-1">{totals.pieces}</p>
        </AdminCard>
        <AdminCard className="p-4">
          <p className="text-[11px] font-semibold text-[var(--psa-faint)] uppercase tracking-wide">{t('dbview.stockValue')}</p>
          <p className="text-2xl font-black text-[#E8552C] mt-1">{fmtMoney(totals.invest)}</p>
        </AdminCard>
      </div>

      {/* search across all columns */}
      <div className="relative max-w-md">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--psa-faint)]" />
        <TextInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('dbview.search')}
          className="!pl-9"
          aria-label={t('dbview.search')}
        />
      </div>

      {categories.length === 0 ? (
        <AdminCard className="p-0">
          <EmptyState
            icon={<Boxes size={34} />}
            title={t('dbview.none')}
          />
        </AdminCard>
      ) : (
        <div>
          <p className="text-xs font-semibold text-[var(--psa-faint)] mb-2">{t('dbview.sub')}</p>
          {/* category columns — horizontal Kanban board */}
          <div className="flex gap-4 overflow-x-auto pb-4 -mx-1 px-1 snap-x" role="list" aria-label={t('dbview.title')}>
            {columns.map(({ category, products: list, pieces, invest, retail }) => (
              <div
                key={category.id}
                role="listitem"
                className="w-[272px] shrink-0 snap-start flex flex-col rounded-xl border border-[var(--psa-border)] bg-[var(--psa-card)] overflow-hidden"
              >
                {/* column head = the category itself */}
                <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-[var(--psa-line)] bg-[var(--psa-canvas)]/60">
                  <CategoryThumb image={category.image} />
                  <div className="min-w-0 grow">
                    <p className="text-sm font-bold text-[var(--psa-ink)] truncate leading-tight">{category.name}</p>
                    <p className="text-[11px] text-[var(--psa-faint)] leading-tight">
                      {list.length} {t('dbview.items')} · {pieces} {t('dbview.pieces')}
                    </p>
                  </div>
                  <Badge tone={list.length > 0 ? 'orange' : 'slate'}>{list.length}</Badge>
                </div>

                {/* the products filed inside this column */}
                <div className="grow overflow-y-auto max-h-[46vh] lg:max-h-[520px] divide-y divide-[var(--psa-line)]">
                  {list.length === 0 ? (
                    <div className="px-3.5 py-8 text-center">
                      <PackageX size={20} className="mx-auto text-[var(--psa-faint)] mb-1.5" />
                      <p className="text-[11px] text-[var(--psa-faint)]">{t('dbview.emptyCol')}</p>
                    </div>
                  ) : (
                    list.map((p) => (
                      <div key={p.id} className="px-3.5 py-2.5 hover:bg-[var(--psa-hover)] transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[13px] font-semibold text-[var(--psa-ink)] truncate leading-snug">{p.name}</p>
                          <span
                            className={`shrink-0 text-[10px] font-bold rounded-full px-1.5 py-0.5 ${
                              p.quantity <= p.lowStockThreshold
                                ? 'bg-red-500/10 text-red-600'
                                : 'bg-emerald-500/10 text-emerald-600'
                            }`}
                          >
                            ×{p.quantity}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <span className="text-[10px] text-[var(--psa-faint)] truncate">
                            {p.boxNumber ? `📦 ${p.boxNumber}` : p.serialNumbers?.length ? `S/N ${p.serialNumbers.length}` : '—'}
                          </span>
                          <span className="text-[11px] font-bold text-[#E8552C] shrink-0">{fmtMoney(p.sellingPrice)}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* column footer = the category's money */}
                <div className="border-t border-[var(--psa-line)] px-3.5 py-2 flex items-center justify-between text-[10px] font-semibold text-[var(--psa-sub)] bg-[var(--psa-canvas)]/40">
                  <span title={t('dbview.stockValue')}>⬇ {fmtMoney(invest)}</span>
                  <span title={t('dbview.retail')} className="text-[#E8552C]">⬆ {fmtMoney(retail)}</span>
                </div>
              </div>
            ))}

            {/* legacy ids that lost their category — surfaced, never hidden */}
            {orphanProducts.length > 0 && (
              <div
                role="listitem"
                className="w-[272px] shrink-0 snap-start flex flex-col rounded-xl border border-dashed border-[var(--psa-border)] bg-[var(--psa-card)] overflow-hidden"
              >
                <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-[var(--psa-line)] bg-[var(--psa-canvas)]/60">
                  <span className="w-[34px] h-[34px] rounded-lg bg-[var(--psa-canvas)] border border-[var(--psa-border)] flex items-center justify-center">❓</span>
                  <div className="min-w-0 grow">
                    <p className="text-sm font-bold text-[var(--psa-ink)] truncate leading-tight">{t('dbview.unknown')}</p>
                    <p className="text-[11px] text-[var(--psa-faint)] leading-tight">
                      {orphanProducts.length} {t('dbview.items')}
                    </p>
                  </div>
                  <Badge tone="slate">{orphanProducts.length}</Badge>
                </div>
                <div className="grow overflow-y-auto max-h-[46vh] lg:max-h-[520px] divide-y divide-[var(--psa-line)]">
                  {orphanProducts.map((p) => (
                    <div key={p.id} className="px-3.5 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[13px] font-semibold text-[var(--psa-ink)] truncate leading-snug">{p.name}</p>
                        <span className="shrink-0 text-[10px] font-bold rounded-full px-1.5 py-0.5 bg-red-500/10 text-red-600">×{p.quantity}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <span className="text-[10px] text-[var(--psa-faint)] truncate">{p.boxNumber ? `📦 ${p.boxNumber}` : '—'}</span>
                        <span className="text-[11px] font-bold text-[#E8552C] shrink-0">{fmtMoney(p.sellingPrice)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
