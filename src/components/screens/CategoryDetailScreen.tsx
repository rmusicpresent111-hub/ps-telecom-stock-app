'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Category, Product } from '@/lib/types';
import { getProductsOffline } from '@/lib/offline-service';
import { ArrowLeft, Plus, Search, Package, AlertTriangle, ArrowLeftRight, IndianRupee } from 'lucide-react';
import { toast } from 'sonner';
import { useDebounce } from '@/hooks/useDebounce';

// Map for category images - defined outside component
const categoryImageMap: Record<string, string> = {
  'Mobile': '/categories/mobile.png',
  'Display/Combo': '/categories/display.png',
  'Tempered Glass': '/categories/tempered-glass.png',
  'Flip Cover': '/categories/flip-cover.png',
  'Back Cover': '/categories/back-cover.png',
  'UV Glass': '/categories/uv-glass.png',
  'Smart Watch': '/categories/smart-watch.png',
  'Battery': '/categories/battery.png',
  'Charger': '/categories/charger.png',
  'Neck Band': '/categories/neckband.png',
  'Ear Pods': '/categories/earpods.png',
  'Selfie Stick': '/categories/selfie-stick.png',
  'Ring Light': '/categories/ring-light.png',
  'Mobile Stand': '/categories/mobile-stand.png',
  'Watch Strap': '/categories/watch-strap.png',
  'Earphone': '/categories/earphone.png',
  'Memory Card': '/categories/memory-card.png',
  'Data Cable': '/categories/data-cable.png',
  'Home Theater': '/categories/home-theater.png',
  'Refrigerator': '/categories/refrigerator.png',
};

export default function CategoryDetailScreen() {
  const user = useAppStore(s => s.user);
  const language = useAppStore(s => s.language);
  const goBack = useAppStore(s => s.goBack);
  const navigateTo = useAppStore(s => s.navigateTo);
  const selectedCategoryId = useAppStore(s => s.selectedCategoryId);
  const categories = useAppStore(s => s.categories);
  const setSelectedProductId = useAppStore(s => s.setSelectedProductId);
  const setStockOperationType = useAppStore(s => s.setStockOperationType);

  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const debouncedSearch = useDebounce(search, 300);

  const category = useMemo(() => categories.find((c) => c.id === selectedCategoryId), [categories, selectedCategoryId]);

  const fetchProducts = useCallback(async () => {
    if (!user?.id || !selectedCategoryId) return;
    try {
      setLoading(true);
      const prods = await getProductsOffline(user.id, { categoryId: selectedCategoryId });
      setProducts(prods || []);
    } catch {
      toast.error(t('error', language));
    } finally {
      setLoading(false);
    }
  }, [user?.id, selectedCategoryId]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Client-side search filter
  const filteredProducts = useMemo(() => {
    if (!debouncedSearch.trim()) return products;
    return products.filter((p) =>
      p.name.toLowerCase().includes(debouncedSearch.toLowerCase())
    );
  }, [products, debouncedSearch]);

  const totalItems = products.length;
  const lowStockCount = useMemo(() => products.filter((p) => p.quantity <= p.lowStockThreshold).length, [products]);
  const totalValue = useMemo(() => products.reduce((sum, p) => sum + p.quantity * p.sellingPrice, 0), [products]);

  const handleProductTap = useCallback((product: Product) => {
    setSelectedProductId(product.id);
    navigateTo('product-detail');
  }, [setSelectedProductId, navigateTo]);

  const handleStockOperation = useCallback((type: 'STOCK_IN' | 'STOCK_OUT' | 'SELL') => {
    if (products.length === 0) {
      toast.error(t('noData', language));
      return;
    }
    if (!useAppStore.getState().selectedProductId) {
      setSelectedProductId(products[0].id);
    }
    setStockOperationType(type);
    const screenMap = { STOCK_IN: 'stock-in', STOCK_OUT: 'stock-out', SELL: 'instant-sell' } as const;
    navigateTo(screenMap[type]);
  }, [products, language, setSelectedProductId, setStockOperationType, navigateTo]);

  const categoryImage = category?.image?.startsWith('/categories/')
    ? category.image
    : (category ? categoryImageMap[category.name] : '');

  return (
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={goBack} className="p-2 rounded-full glass-card" aria-label="Back">
            <ArrowLeft size={20} className="text-emerald-400" />
          </button>
          <h1 className="text-lg font-bold neon-glow">{category?.name || 'Category'}</h1>
          <button
            onClick={() => navigateTo('add-product')}
            className="p-2 rounded-full glass-card"
            aria-label="Add Product"
          >
            <Plus size={20} className="text-emerald-400" />
          </button>
        </div>

        {/* Category Image Banner */}
        {categoryImage && (
          <div className="relative mb-5 rounded-2xl overflow-hidden h-32">
            <img
              src={categoryImage}
              alt={category?.name || 'Category'}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            <div className="absolute bottom-3 left-4">
              <h2 className="text-white font-bold text-lg drop-shadow-lg">{category?.name}</h2>
              <p className="text-white/70 text-xs">{products.length} products in this category</p>
            </div>
          </div>
        )}

        {/* Stats section */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="stat-card-green rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Package size={16} className="text-green-400" />
              <span className="text-xs text-white/60">{t('totalItems', language)}</span>
            </div>
            <p className="text-2xl font-bold text-green-400">{totalItems}</p>
          </div>
          <div className={`rounded-2xl p-4 ${lowStockCount > 0 ? 'stat-card-orange' : 'stat-card-green'}`}>
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle size={16} className={lowStockCount > 0 ? 'text-orange-400' : 'text-green-400'} />
              <span className="text-xs text-white/60">{t('lowStock', language)}</span>
            </div>
            <p className={`text-2xl font-bold ${lowStockCount > 0 ? 'text-orange-400' : 'text-green-400'}`}>{lowStockCount}</p>
          </div>
          <div className="stat-card-blue rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <ArrowLeftRight size={16} className="text-emerald-400" />
              <span className="text-xs text-white/60">{t('todayTransaction', language)}</span>
            </div>
            <p className="text-2xl font-bold text-emerald-400">0</p>
          </div>
          <div className="stat-card-purple rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <IndianRupee size={16} className="text-emerald-600" />
              <span className="text-xs text-white/60">{t('stockValue', language)}</span>
            </div>
            <p className="text-2xl font-bold text-emerald-600">₹{totalValue.toLocaleString()}</p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 mb-6">
          <button
            onClick={() => handleStockOperation('STOCK_IN')}
            className="flex-1 neon-btn py-3 text-sm font-semibold text-center"
            style={{ borderColor: 'rgba(245, 222, 179, 0.4)', color: '#F5DEB3', background: 'linear-gradient(135deg, rgba(245, 222, 179, 0.15), rgba(57, 200, 120, 0.1))' }}
          >
            {t('stockIn', language)}
          </button>
          <button
            onClick={() => handleStockOperation('STOCK_OUT')}
            className="flex-1 neon-btn py-3 text-sm font-semibold text-center"
            style={{ borderColor: 'rgba(255, 107, 0, 0.4)', color: '#ff6b00', background: 'linear-gradient(135deg, rgba(255, 107, 0, 0.15), rgba(255, 180, 0, 0.1))' }}
          >
            {t('stockOut', language)}
          </button>
          <button
            onClick={() => handleStockOperation('SELL')}
            className="flex-1 neon-btn py-3 text-sm font-semibold text-center"
            style={{ borderColor: 'rgba(160, 124, 62, 0.4)', color: '#A07C3E', background: 'linear-gradient(135deg, rgba(160, 124, 62, 0.15), rgba(140, 105, 50, 0.1))' }}
          >
            {t('instantSell', language)}
          </button>
        </div>

        {/* Search bar */}
        <div className="relative mb-4">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchProducts', language)}
            className="glass-input w-full pl-11 pr-4 py-3 text-sm"
          />
        </div>

        {/* Product list */}
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {loading ? (
            <div className="text-center py-8 text-white/40">{t('loading', language)}</div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-8 text-white/40">{t('noData', language)}</div>
          ) : (
            filteredProducts.map((product) => (
              <button
                key={product.id}
                onClick={() => handleProductTap(product)}
                className="glass-card w-full p-4 flex items-center justify-between"
              >
                <div className="flex-1 text-left">
                  <p className="text-sm font-semibold">{product.name}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className={`text-xs ${product.quantity <= product.lowStockThreshold ? 'text-orange-400' : 'text-green-400'}`}>
                      Qty: {product.quantity}
                    </span>
                    <span className="text-xs text-white/50">₹{product.purchasePrice}</span>
                    <span className="text-xs text-emerald-400">₹{product.sellingPrice}</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    product.quantity <= product.lowStockThreshold
                      ? 'bg-orange-500/20 text-orange-400'
                      : 'bg-green-500/20 text-green-400'
                  }`}>
                    {product.quantity <= product.lowStockThreshold ? 'Low' : 'In Stock'}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
