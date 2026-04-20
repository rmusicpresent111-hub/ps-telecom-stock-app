'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Product } from '@/lib/types';
import { motion } from 'framer-motion';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';

export default function ProductListScreen() {
  const { user, language, navigateTo, searchQuery, setSelectedProductId, categories } = useAppStore();

  const [products, setProducts] = useState<Product[]>([]);
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [loading, setLoading] = useState(true);

  const fetchProducts = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const searchParam = localSearch ? `&search=${encodeURIComponent(localSearch)}` : '';
      const res = await fetch(`/api/products?userId=${user.id}${searchParam}`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products || []);
      }
    } catch {
      toast.error(t('error', language));
    } finally {
      setLoading(false);
    }
  }, [user?.id, localSearch, language]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const handleProductTap = (product: Product) => {
    setSelectedProductId(product.id);
    navigateTo('product-detail');
  };

  const getCategoryName = (categoryId: string) => {
    const cat = categories.find((c) => c.id === categoryId);
    return cat?.name || '';
  };

  return (
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-6"
        >
          <h1 className="text-lg font-bold neon-glow">{t('products', language)}</h1>
          <button
            onClick={() => navigateTo('add-product')}
            className="p-2 rounded-full glass-card"
            aria-label="Add Product"
          >
            <Plus size={20} className="text-cyan-400" />
          </button>
        </motion.div>

        {/* Search bar */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="relative mb-4"
        >
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder={t('searchProducts', language)}
            className="glass-input w-full pl-11 pr-4 py-3 text-sm"
          />
        </motion.div>

        {/* Product list */}
        <div className="space-y-3 max-h-[calc(100vh-200px)] overflow-y-auto">
          {loading ? (
            <div className="text-center py-8 text-white/40">{t('loading', language)}</div>
          ) : products.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-white/40 text-sm">{t('noData', language)}</p>
              <button
                onClick={() => navigateTo('add-product')}
                className="neon-btn mt-4 px-4 py-2 text-sm"
              >
                + {t('addProduct', language)}
              </button>
            </div>
          ) : (
            products.map((product, idx) => {
              const profit = product.sellingPrice - product.purchasePrice;
              const isLow = product.quantity <= product.lowStockThreshold;
              return (
                <motion.button
                  key={product.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.03 * idx }}
                  onClick={() => handleProductTap(product)}
                  className="glass-card glass-shine w-full p-4"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{product.name}</p>
                        {getCategoryName(product.categoryId) && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400">
                            {getCategoryName(product.categoryId)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <span className={`text-xs font-medium ${isLow ? 'text-orange-400' : 'text-green-400'}`}>
                          Qty: {product.quantity}
                        </span>
                        <span className="text-xs text-white/50">Buy: ₹{product.purchasePrice}</span>
                        <span className="text-xs text-cyan-400">Sell: ₹{product.sellingPrice}</span>
                      </div>
                    </div>
                    <div className="text-right ml-3">
                      <p className="text-xs text-green-400 font-semibold">
                        +₹{profit}
                      </p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full mt-1 inline-block ${
                        isLow ? 'bg-orange-500/20 text-orange-400' : 'bg-green-500/20 text-green-400'
                      }`}>
                        {isLow ? 'Low Stock' : 'In Stock'}
                      </span>
                    </div>
                  </div>
                </motion.button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
