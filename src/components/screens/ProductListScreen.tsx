'use client';

import { useEffect, useState, useCallback, useMemo, memo } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Product } from '@/lib/types';
import { getProductsOffline } from '@/lib/offline-service';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';

// Memoized product item — onTap receives the product so the callback itself
// stays referentially stable (a per-item closure would defeat memo on every keystroke)
const ProductItem = memo(function ProductItem({ product, categoryName, onTap }: {
  product: Product;
  categoryName: string;
  onTap: (product: Product) => void;
}) {
  const profit = product.sellingPrice - product.purchasePrice;
  const isLow = product.quantity <= product.lowStockThreshold;
  return (
    <button
      onClick={() => onTap(product)}
      className="glass-card w-full p-4"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">{product.name}</p>
            {categoryName && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
                {categoryName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-2">
            <span className={`text-xs font-medium ${isLow ? 'text-orange-400' : 'text-green-400'}`}>
              Qty: {product.quantity}
            </span>
            <span className="text-xs text-white/50">Buy: ₹{product.purchasePrice}</span>
            <span className="text-xs text-emerald-400">Sell: ₹{product.sellingPrice}</span>
          </div>
        </div>
        <div className="text-right ml-3">
          <p className={`text-xs font-semibold ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {profit >= 0 ? '+' : ''}₹{profit.toLocaleString()}
          </p>
          <span className={`text-[10px] px-2 py-0.5 rounded-full mt-1 inline-block ${
            isLow ? 'bg-orange-500/20 text-orange-400' : 'bg-green-500/20 text-green-400'
          }`}>
            {isLow ? 'Low Stock' : 'In Stock'}
          </span>
        </div>
      </div>
    </button>
  );
});

export default function ProductListScreen() {
  const user = useAppStore(s => s.user);
  const language = useAppStore(s => s.language);
  const navigateTo = useAppStore(s => s.navigateTo);
  const searchQuery = useAppStore(s => s.searchQuery);
  const setSearchQuery = useAppStore(s => s.setSearchQuery);
  const setSelectedProductId = useAppStore(s => s.setSelectedProductId);
  const categories = useAppStore(s => s.categories);

  const [products, setProducts] = useState<Product[]>([]);
  // Seed once from the dashboard search handoff, then clear the global query so
  // stale searches don't pre-filter every future visit.
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (searchQuery) setSearchQuery('');
  }, []);

  // Build category lookup map (memoized)
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) {
      map.set(c.id, c.name);
    }
    return map;
  }, [categories]);

  // ⚡ SPEED: load ALL products ONCE from IndexedDB, then filter in memory.
  // The old flow re-queried IndexedDB (400ms debounce + loading flash) on every
  // keystroke — now typing is instant even with thousands of products.
  const fetchProducts = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const prods = await getProductsOffline(user.id);
      setProducts(prods || []);
    } catch {
      toast.error(t('error', language));
    } finally {
      setLoading(false);
    }
  }, [user?.id, language]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // ⚡ Instant in-memory filter — runs in <1ms even for 10,000 products
  const filteredProducts = useMemo(() => {
    const q = localSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.boxNumber ? p.boxNumber.toLowerCase().includes(q) : false)
    );
  }, [products, localSearch]);

  const handleProductTap = useCallback((product: Product) => {
    setSelectedProductId(product.id);
    navigateTo('product-detail');
  }, [setSelectedProductId, navigateTo]);

  return (
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-bold neon-glow">{t('products', language)}</h1>
          <button
            onClick={() => { setSelectedProductId(null); navigateTo('add-product'); }}
            className="p-2 rounded-full glass-card"
            aria-label="Add Product"
          >
            <Plus size={20} className="text-emerald-400" />
          </button>
        </div>

        {/* Search bar */}
        <div className="relative mb-4">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder={t('searchProducts', language)}
            className="glass-input w-full pl-11 pr-4 py-3 text-sm"
          />
        </div>

        {/* Product list — spinner ONLY on first load; typing never shows it */}
        <div className="space-y-3 max-h-[calc(100vh-200px)] overflow-y-auto">
          {loading && products.length === 0 ? (
            <div className="text-center py-8 text-white/40">{t('loading', language)}</div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-white/40 text-sm">{t('noData', language)}</p>
              <button
                onClick={() => { setSelectedProductId(null); navigateTo('add-product'); }}
                className="neon-btn mt-4 px-4 py-2 text-sm"
              >
                + {t('addProduct', language)}
              </button>
            </div>
          ) : (
            filteredProducts.map((product) => (
              <ProductItem
                key={product.id}
                product={product}
                categoryName={categoryMap.get(product.categoryId) || ''}
                onTap={handleProductTap}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
