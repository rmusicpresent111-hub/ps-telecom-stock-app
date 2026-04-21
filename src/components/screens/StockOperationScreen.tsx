'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Product } from '@/lib/types';
import { motion } from 'framer-motion';
import { ArrowLeft, Search } from 'lucide-react';
import { toast } from 'sonner';

export default function StockOperationScreen() {
  const {
    user, language, goBack,
    selectedProductId, stockOperationType,
    selectedCategoryId,
  } = useAppStore();

  const [product, setProduct] = useState<Product | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const fetchProducts = useCallback(async () => {
    if (!user?.id) return;
    try {
      setFetching(true);
      const url = selectedCategoryId
        ? `/api/products?userId=${user.id}&categoryId=${selectedCategoryId}`
        : `/api/products?userId=${user.id}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const products = data.products || [];
        setAllProducts(products);

        // If a product was pre-selected, set it
        if (selectedProductId) {
          const found = products.find((p: Product) => p.id === selectedProductId);
          if (found) {
            setProduct(found);
            setProductSearch(found.name);
            if (stockOperationType === 'SELL') {
              setPrice(String(found.sellingPrice));
            } else if (stockOperationType === 'STOCK_IN') {
              setPrice(String(found.purchasePrice));
            }
          }
        }
      }
    } catch {
      toast.error(t('error', language));
    } finally {
      setFetching(false);
    }
  }, [user?.id, selectedCategoryId, selectedProductId, stockOperationType, language]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Close suggestions on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredSuggestions = productSearch.trim()
    ? allProducts.filter(p =>
        p.name.toLowerCase().includes(productSearch.toLowerCase())
      )
    : allProducts;

  const handleSelectProduct = (p: Product) => {
    setProduct(p);
    setProductSearch(p.name);
    setShowSuggestions(false);
    // Pre-fill price based on operation type
    if (stockOperationType === 'SELL') {
      setPrice(String(p.sellingPrice));
    } else if (stockOperationType === 'STOCK_IN') {
      setPrice(String(p.purchasePrice));
    }
  };

  const getTitle = () => {
    switch (stockOperationType) {
      case 'STOCK_IN': return t('stockInTitle', language);
      case 'STOCK_OUT': return t('stockOutTitle', language);
      case 'SELL': return t('instantSellTitle', language);
      default: return '';
    }
  };

  const getPriceLabel = () => {
    switch (stockOperationType) {
      case 'SELL': return t('sellingPrice', language);
      case 'STOCK_IN': return t('purchasePrice', language);
      case 'STOCK_OUT': return t('price', language);
      default: return t('price', language);
    }
  };

  const getAccentColor = () => {
    switch (stockOperationType) {
      case 'STOCK_IN': return '#39ff14';
      case 'STOCK_OUT': return '#ff6b00';
      case 'SELL': return '#b44aff';
      default: return '#00f0ff';
    }
  };

  const handleConfirm = async () => {
    if (!product?.id || !user?.id || !stockOperationType || !quantity) {
      toast.error(t('error', language));
      return;
    }

    const qty = parseInt(quantity);
    const unitPrice = parseFloat(price) || 0;
    const totalAmount = qty * unitPrice;

    if (qty <= 0) {
      toast.error(t('enterQuantity', language));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: stockOperationType,
          productId: product.id,
          quantity: qty,
          unitPrice,
          totalAmount,
          userId: user.id,
        }),
      });

      if (res.ok) {
        toast.success(t('success', language));
        goBack();
      } else {
        const err = await res.json();
        toast.error(err.error || t('error', language));
      }
    } catch {
      toast.error(t('error', language));
    } finally {
      setLoading(false);
    }
  };

  const accent = getAccentColor();

  return (
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-6"
        >
          <button onClick={goBack} className="p-2 rounded-full glass-card" aria-label="Back">
            <ArrowLeft size={20} className="text-cyan-400" />
          </button>
          <h1 className="text-lg font-bold" style={{ color: accent }}>{getTitle()}</h1>
          <div className="w-10" />
        </motion.div>

        {fetching ? (
          <div className="text-center py-12 text-white/40">{t('loading', language)}</div>
        ) : allProducts.length === 0 ? (
          <div className="text-center py-12 text-white/40">{t('noData', language)}</div>
        ) : (
          <>
            {/* Form */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="glass-card-strong p-6 space-y-4"
            >
              {/* Product name with search/suggest */}
              <div className="relative" ref={suggestionsRef}>
                <label className="text-xs text-white/60 mb-1 block">{t('productName', language)}</label>
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(e) => {
                      setProductSearch(e.target.value);
                      setShowSuggestions(true);
                      // Clear selected product if search text doesn't match
                      if (product && e.target.value !== product.name) {
                        setProduct(null);
                      }
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    placeholder={t('searchProducts', language)}
                    className="glass-input w-full pl-10 pr-4 py-3 text-sm"
                    autoFocus
                  />
                </div>

                {/* Suggestions dropdown */}
                {showSuggestions && filteredSuggestions.length > 0 && (
                  <div className="absolute z-50 left-0 right-0 top-full mt-1 glass-card-strong max-h-48 overflow-y-auto rounded-xl">
                    {filteredSuggestions.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => handleSelectProduct(p)}
                        className="w-full px-4 py-3 text-left text-sm flex items-center justify-between hover:bg-white/10 transition-colors border-b border-white/5 last:border-b-0"
                      >
                        <div className="flex-1">
                          <span className="text-white/90">{p.name}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[10px] ${p.quantity <= p.lowStockThreshold ? 'text-orange-400' : 'text-green-400'}`}>
                              Qty: {p.quantity}
                            </span>
                            <span className="text-[10px] text-white/40">₹{p.sellingPrice}</span>
                          </div>
                        </div>
                        {product?.id === p.id && (
                          <span className="text-cyan-400 text-xs font-semibold">✓</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* No results message */}
                {showSuggestions && productSearch.trim() && filteredSuggestions.length === 0 && (
                  <div className="absolute z-50 left-0 right-0 top-full mt-1 glass-card-strong rounded-xl p-4 text-center">
                    <span className="text-xs text-white/40">{t('noData', language)}</span>
                  </div>
                )}
              </div>

              {/* Selected product info */}
              {product && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="glass-card p-3 space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/50">{t('quantity', language)} (Current)</span>
                    <span className={`text-sm font-bold ${
                      product.quantity <= product.lowStockThreshold ? 'text-orange-400' : 'text-green-400'
                    }`}>
                      {product.quantity}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/50">{t('purchasePrice', language)}</span>
                    <span className="text-xs text-white/70">₹{product.purchasePrice}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/50">{t('sellingPrice', language)}</span>
                    <span className="text-xs text-cyan-400">₹{product.sellingPrice}</span>
                  </div>
                </motion.div>
              )}

              {/* Quantity input */}
              <div>
                <label className="text-xs text-white/60 mb-1 block">{t('enterQuantity', language)}</label>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0"
                  className="glass-input w-full px-4 py-3 text-sm"
                  disabled={!product}
                />
              </div>

              {/* Price input */}
              <div>
                <label className="text-xs text-white/60 mb-1 block">{getPriceLabel()}</label>
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="₹0"
                  className="glass-input w-full px-4 py-3 text-sm"
                  disabled={!product}
                />
              </div>

              {/* Total preview */}
              {product && quantity && price && (
                <div className="pt-2 border-t border-white/10">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-white/60">Total Amount</span>
                    <span className="text-lg font-bold" style={{ color: accent }}>
                      ₹{(parseInt(quantity) * parseFloat(price)).toLocaleString()}
                    </span>
                  </div>
                </div>
              )}
            </motion.div>

            {/* Confirm button */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mt-6"
            >
              <button
                onClick={handleConfirm}
                disabled={loading || !quantity || !product}
                className="neon-btn-solid w-full py-3 font-semibold text-sm disabled:opacity-50"
                style={accent !== '#00f0ff' ? {
                  background: `linear-gradient(135deg, ${accent}44, ${accent}88)`,
                  color: 'white',
                } : undefined}
              >
                {loading ? t('loading', language) : t('confirm', language)}
              </button>
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
}
