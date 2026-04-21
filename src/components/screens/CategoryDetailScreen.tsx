'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Category, Product } from '@/lib/types';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Plus, Search, Package, AlertTriangle, ArrowLeftRight, IndianRupee, X, TrendingUp, TrendingDown, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';

type StockOpType = 'STOCK_IN' | 'STOCK_OUT' | 'SELL' | null;

const stockOpConfig: Record<string, { title: string; icon: React.ElementType; color: string; bgColor: string; borderColor: string; desc: string }> = {
  STOCK_IN: {
    title: 'Stock In',
    icon: TrendingUp,
    color: '#39ff14',
    bgColor: 'rgba(57, 255, 20, 0.15)',
    borderColor: 'rgba(57, 255, 20, 0.4)',
    desc: 'Add stock to products in this category',
  },
  STOCK_OUT: {
    title: 'Stock Out',
    icon: TrendingDown,
    color: '#ff6b00',
    bgColor: 'rgba(255, 107, 0, 0.15)',
    borderColor: 'rgba(255, 107, 0, 0.4)',
    desc: 'Remove stock from products in this category',
  },
  SELL: {
    title: 'Instant Sell',
    icon: ShoppingBag,
    color: '#b44aff',
    bgColor: 'rgba(180, 74, 255, 0.15)',
    borderColor: 'rgba(180, 74, 255, 0.4)',
    desc: 'Sell a product from this category',
  },
};

export default function CategoryDetailScreen() {
  const {
    user, language, goBack, navigateTo,
    selectedCategoryId, categories,
    setSelectedProductId, setStockOperationType,
  } = useAppStore();

  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingStockOp, setPendingStockOp] = useState<StockOpType>(null);

  const category = categories.find((c) => c.id === selectedCategoryId);

  const fetchProducts = useCallback(async () => {
    if (!user?.id || !selectedCategoryId) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/products?userId=${user.id}&categoryId=${selectedCategoryId}`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products || []);
      }
    } catch {
      toast.error(t('error', language));
    } finally {
      setLoading(false);
    }
  }, [user?.id, selectedCategoryId, language]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const totalItems = products.length;
  const lowStockCount = products.filter((p) => p.quantity <= p.lowStockThreshold).length;
  const totalValue = products.reduce((sum, p) => sum + p.quantity * p.sellingPrice, 0);
  const todayTxCount = 0;

  const handleProductTap = (product: Product) => {
    setSelectedProductId(product.id);
    navigateTo('product-detail');
  };

  const handleStockOperationClick = (type: 'STOCK_IN' | 'STOCK_OUT' | 'SELL') => {
    if (products.length === 0) {
      toast.error(t('noData', language));
      return;
    }
    // Show confirmation dialog
    setPendingStockOp(type);
  };

  const handleStockOperationConfirm = () => {
    if (!pendingStockOp) return;
    if (!useAppStore.getState().selectedProductId) {
      setSelectedProductId(products[0].id);
    }
    setStockOperationType(pendingStockOp);
    const screenMap = { STOCK_IN: 'stock-in', STOCK_OUT: 'stock-out', SELL: 'instant-sell' } as const;
    navigateTo(screenMap[pendingStockOp]);
    setPendingStockOp(null);
  };

  const handleStockOperationCancel = () => {
    setPendingStockOp(null);
  };

  // Map for category images
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

  const categoryImage = category?.image?.startsWith('/categories/')
    ? category.image
    : (category ? categoryImageMap[category.name] : '');

  const pendingConfig = pendingStockOp ? stockOpConfig[pendingStockOp] : null;
  const PendingIcon = pendingConfig?.icon;

  return (
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-4"
        >
          <button onClick={goBack} className="p-2 rounded-full glass-card" aria-label="Back">
            <ArrowLeft size={20} className="text-cyan-400" />
          </button>
          <h1 className="text-lg font-bold neon-glow">{category?.name || 'Category'}</h1>
          <button
            onClick={() => navigateTo('add-product')}
            className="p-2 rounded-full glass-card"
            aria-label="Add Product"
          >
            <Plus size={20} className="text-cyan-400" />
          </button>
        </motion.div>

        {/* Category Image Banner */}
        {categoryImage && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.05 }}
            className="relative mb-5 rounded-2xl overflow-hidden h-32"
          >
            <img
              src={categoryImage}
              alt={category?.name || 'Category'}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            <div className="absolute bottom-3 left-4">
              <h2 className="text-white font-bold text-lg drop-shadow-lg">{category?.name}</h2>
              <p className="text-white/70 text-xs">{products.length} products in this category</p>
            </div>
          </motion.div>
        )}

        {/* Stats section */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-2 gap-3 mb-6"
        >
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
              <ArrowLeftRight size={16} className="text-cyan-400" />
              <span className="text-xs text-white/60">{t('todayTransaction', language)}</span>
            </div>
            <p className="text-2xl font-bold text-cyan-400">{todayTxCount}</p>
          </div>
          <div className="stat-card-purple rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <IndianRupee size={16} className="text-purple-400" />
              <span className="text-xs text-white/60">{t('stockValue', language)}</span>
            </div>
            <p className="text-2xl font-bold text-purple-400">₹{totalValue.toLocaleString()}</p>
          </div>
        </motion.div>

        {/* Action buttons */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex gap-3 mb-6"
        >
          <button
            onClick={() => handleStockOperationClick('STOCK_IN')}
            className="flex-1 neon-btn py-3 text-sm font-semibold text-center"
            style={{ borderColor: 'rgba(57, 255, 20, 0.4)', color: '#39ff14', background: 'linear-gradient(135deg, rgba(57, 255, 20, 0.15), rgba(57, 200, 120, 0.1))' }}
          >
            {t('stockIn', language)}
          </button>
          <button
            onClick={() => handleStockOperationClick('STOCK_OUT')}
            className="flex-1 neon-btn py-3 text-sm font-semibold text-center"
            style={{ borderColor: 'rgba(255, 107, 0, 0.4)', color: '#ff6b00', background: 'linear-gradient(135deg, rgba(255, 107, 0, 0.15), rgba(255, 180, 0, 0.1))' }}
          >
            {t('stockOut', language)}
          </button>
          <button
            onClick={() => handleStockOperationClick('SELL')}
            className="flex-1 neon-btn py-3 text-sm font-semibold text-center"
            style={{ borderColor: 'rgba(180, 74, 255, 0.4)', color: '#b44aff', background: 'linear-gradient(135deg, rgba(180, 74, 255, 0.15), rgba(140, 50, 220, 0.1))' }}
          >
            {t('instantSell', language)}
          </button>
        </motion.div>

        {/* Search bar */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="relative mb-4"
        >
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchProducts', language)}
            className="glass-input w-full pl-11 pr-4 py-3 text-sm"
          />
        </motion.div>

        {/* Product list */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="space-y-3 max-h-96 overflow-y-auto"
        >
          {loading ? (
            <div className="text-center py-8 text-white/40">{t('loading', language)}</div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-8 text-white/40">{t('noData', language)}</div>
          ) : (
            filteredProducts.map((product, idx) => (
              <motion.button
                key={product.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.05 * idx }}
                onClick={() => handleProductTap(product)}
                className="glass-card glass-shine w-full p-4 flex items-center justify-between"
              >
                <div className="flex-1 text-left">
                  <p className="text-sm font-semibold">{product.name}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className={`text-xs ${product.quantity <= product.lowStockThreshold ? 'text-orange-400' : 'text-green-400'}`}>
                      Qty: {product.quantity}
                    </span>
                    <span className="text-xs text-white/50">₹{product.purchasePrice}</span>
                    <span className="text-xs text-cyan-400">₹{product.sellingPrice}</span>
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
              </motion.button>
            ))
          )}
        </motion.div>
      </div>

      {/* Stock Operation Confirmation Dialog */}
      <AnimatePresence>
        {pendingStockOp && pendingConfig && PendingIcon && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6"
            onClick={handleStockOperationCancel}
          >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            {/* Dialog */}
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-card-strong p-6 w-full max-w-sm relative z-10"
            >
              {/* Close button */}
              <button
                onClick={handleStockOperationCancel}
                className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-white/10 transition-colors"
              >
                <X size={16} className="text-white/40" />
              </button>

              {/* Icon */}
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: pendingConfig.bgColor, border: `1px solid ${pendingConfig.borderColor}` }}
              >
                <PendingIcon size={24} style={{ color: pendingConfig.color }} />
              </div>

              {/* Title */}
              <h3 className="text-lg font-bold text-center mb-1" style={{ color: pendingConfig.color }}>
                {pendingConfig.title}?
              </h3>

              {/* Category name */}
              <p className="text-sm text-white/50 text-center mb-1">
                {category?.name || 'Category'}
              </p>

              {/* Description */}
              <p className="text-xs text-white/40 text-center mb-6">
                {pendingConfig.desc}
              </p>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleStockOperationCancel}
                  className="flex-1 glass-card py-3 text-sm font-semibold text-white/70 rounded-xl hover:bg-white/10 transition-colors"
                >
                  {t('cancel', language)}
                </button>
                <button
                  onClick={handleStockOperationConfirm}
                  className="flex-1 py-3 text-sm font-semibold rounded-xl text-white transition-all"
                  style={{
                    background: `linear-gradient(135deg, ${pendingConfig.color}, ${pendingConfig.color}88)`,
                    border: `1px solid ${pendingConfig.borderColor}`,
                  }}
                >
                  {t('confirm', language)}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
