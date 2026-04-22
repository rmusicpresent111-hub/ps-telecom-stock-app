'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Product } from '@/lib/types';
import { getProducts, createTransaction } from '@/lib/supabase-service';
import { ArrowLeft, Search, X, TrendingUp, TrendingDown, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

const stockOpMeta: Record<string, { icon: React.ElementType; confirmLabel: string }> = {
  STOCK_IN: { icon: TrendingUp, confirmLabel: 'Stock In' },
  STOCK_OUT: { icon: TrendingDown, confirmLabel: 'Stock Out' },
  SELL: { icon: ShoppingBag, confirmLabel: 'Sell' },
};

export default function StockOperationScreen() {
  const user = useAppStore(s => s.user);
  const language = useAppStore(s => s.language);
  const goBack = useAppStore(s => s.goBack);
  const selectedProductId = useAppStore(s => s.selectedProductId);
  const stockOperationType = useAppStore(s => s.stockOperationType);
  const selectedCategoryId = useAppStore(s => s.selectedCategoryId);

  const isSell = stockOperationType === 'SELL';

  const [product, setProduct] = useState<Product | null>(null);
  const [productName, setProductName] = useState('');
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const fetchProducts = useCallback(async () => {
    if (!user?.id) return;
    try {
      setFetching(true);
      const data = selectedCategoryId
        ? await getProducts(user.id, { categoryId: selectedCategoryId })
        : await getProducts(user.id);
      setAllProducts(data.products || []);
      setProductName('');
    } catch {
      toast.error(t('error', language));
    } finally {
      setFetching(false);
    }
  }, [user?.id, selectedCategoryId]);

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

  // For non-SELL: auto-match product by exact name
  useEffect(() => {
    if (isSell) return;
    if (!productName.trim()) {
      setProduct(null);
      return;
    }
    const matched = allProducts.find(
      p => p.name.toLowerCase() === productName.trim().toLowerCase()
    );
    if (matched) {
      setProduct(matched);
      if (stockOperationType === 'STOCK_IN') {
        setPrice(String(matched.purchasePrice));
      }
    } else {
      setProduct(null);
    }
  }, [productName, allProducts, stockOperationType, isSell]);

  // SELL: filtered suggestions
  const sellSuggestions = isSell && productName.trim()
    ? allProducts.filter(p =>
        p.name.toLowerCase().includes(productName.toLowerCase())
      )
    : isSell ? allProducts : [];

  const handleSelectSuggestion = (p: Product) => {
    setProduct(p);
    setProductName('');
    setShowSuggestions(false);
    setPrice(String(p.sellingPrice));
    setQuantity('');
  };

  const handleProductNameChange = (val: string) => {
    setProductName(val);
    if (isSell) {
      setShowSuggestions(true);
      if (product) {
        setProduct(null);
        setPrice('');
        setQuantity('');
      }
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
      case 'STOCK_IN': return '#F5DEB3';
      case 'STOCK_OUT': return '#ff6b00';
      case 'SELL': return '#A07C3E';
      default: return '#D4A853';
    }
  };

  const handleConfirmClick = () => {
    if (!product?.id || !user?.id || !stockOperationType || !quantity) {
      toast.error(t('error', language));
      return;
    }
    const qty = parseInt(quantity);
    if (qty <= 0) {
      toast.error(t('enterQuantity', language));
      return;
    }
    setShowConfirmDialog(true);
  };

  const handleConfirmYes = async () => {
    setShowConfirmDialog(false);
    if (!product?.id || !user?.id || !stockOperationType) return;

    const qty = parseInt(quantity);
    const unitPrice = parseFloat(price) || 0;
    const totalAmount = qty * unitPrice;

    setLoading(true);
    try {
      await createTransaction({
        type: stockOperationType,
        productId: product.id,
        quantity: qty,
        unitPrice,
        totalAmount,
        userId: user.id,
      });
      toast.success(t('success', language));
      goBack();
    } catch (error) {
      toast.error((error as Error).message || t('error', language));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmCancel = () => {
    setShowConfirmDialog(false);
  };

  const accent = getAccentColor();
  const meta = stockOperationType ? stockOpMeta[stockOperationType] : null;
  const ConfirmIcon = meta?.icon;

  const totalAmount = quantity && price ? (parseInt(quantity) * parseFloat(price)) : 0;

  return (
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <button onClick={goBack} className="p-2 rounded-full glass-card" aria-label="Back">
            <ArrowLeft size={20} className="text-emerald-400" />
          </button>
          <h1 className="text-lg font-bold" style={{ color: accent }}>{getTitle()}</h1>
          <div className="w-10" />
        </div>

        {fetching ? (
          <div className="text-center py-12 text-white/40">{t('loading', language)}</div>
        ) : allProducts.length === 0 ? (
          <div className="text-center py-12 text-white/40">{t('noData', language)}</div>
        ) : isSell ? (
          /* ==================== INSTANT SELL LAYOUT ==================== */
          <>
            <div className="glass-card-strong p-6 space-y-4">
              {/* Step 1: Product name with suggestion dropdown */}
              <div className="relative" ref={suggestionsRef}>
                <label className="text-xs text-white/60 mb-1 block">{t('productName', language)}</label>
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    type="text"
                    value={productName}
                    onChange={(e) => handleProductNameChange(e.target.value)}
                    onFocus={() => setShowSuggestions(true)}
                    placeholder={t('searchProducts', language)}
                    className="glass-input w-full pl-10 pr-4 py-3 text-sm"
                    autoFocus
                  />
                </div>

                {/* Suggestion dropdown */}
                {showSuggestions && sellSuggestions.length > 0 && !product && (
                  <div className="absolute z-50 left-0 right-0 top-full mt-1 glass-card-strong max-h-60 overflow-y-auto rounded-xl">
                    {sellSuggestions.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => handleSelectSuggestion(p)}
                        className="w-full px-4 py-3 text-left text-sm flex items-center justify-between hover:bg-white/10 transition-colors border-b border-white/5 last:border-b-0"
                      >
                        <div className="flex-1">
                          <span className="text-white/90">{p.name}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[10px] ${p.quantity <= p.lowStockThreshold ? 'text-orange-400' : 'text-green-400'}`}>
                              Stock: {p.quantity}
                            </span>
                            <span className="text-[10px] text-emerald-400/60">₹{p.sellingPrice}</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* No results */}
                {showSuggestions && productName.trim() && sellSuggestions.length === 0 && !product && (
                  <div className="absolute z-50 left-0 right-0 top-full mt-1 glass-card-strong rounded-xl p-4 text-center">
                    <span className="text-xs text-white/40">{t('noData', language)}</span>
                  </div>
                )}
              </div>

              {/* Step 2: After product selected */}
              {product && (
                <div className="space-y-4">
                  {/* Selected product info */}
                  <div className="glass-card p-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white/90">{product.name}</p>
                      <p className={`text-[11px] ${product.quantity <= product.lowStockThreshold ? 'text-orange-400' : 'text-green-400'}`}>
                        Stock: {product.quantity}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setProduct(null);
                        setProductName('');
                        setPrice('');
                        setQuantity('');
                        setShowSuggestions(false);
                      }}
                      className="text-xs text-white/40 hover:text-white/70 px-2 py-1"
                    >
                      ✕ Change
                    </button>
                  </div>

                  {/* Quantity */}
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">{t('quantity', language)}</label>
                    <input
                      type="number"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      placeholder="0"
                      className="glass-input w-full px-4 py-3 text-sm"
                      autoFocus
                    />
                  </div>

                  {/* Selling Price */}
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">{t('sellingPrice', language)}</label>
                    <input
                      type="number"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="₹0"
                      className="glass-input w-full px-4 py-3 text-sm"
                    />
                  </div>

                  {/* Total preview */}
                  {quantity && price && (
                    <div className="pt-2 border-t border-white/10">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-white/60">Total Amount</span>
                        <span className="text-lg font-bold" style={{ color: accent }}>
                          ₹{totalAmount.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Confirm button */}
            <div className="mt-6">
              <button
                onClick={handleConfirmClick}
                disabled={loading || !quantity || !product}
                className="neon-btn-solid w-full py-3 font-semibold text-sm disabled:opacity-50"
                style={{
                  background: `linear-gradient(135deg, ${accent}44, ${accent}88)`,
                  color: 'white',
                }}
              >
                {loading ? t('loading', language) : t('confirm', language)}
              </button>
            </div>
          </>
        ) : (
          /* ==================== STOCK IN / STOCK OUT LAYOUT ==================== */
          <>
            <div className="glass-card-strong p-6 space-y-4">
              {/* Product name */}
              <div>
                <label className="text-xs text-white/60 mb-1 block">{t('productName', language)}</label>
                <input
                  type="text"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder={t('productName', language)}
                  className="glass-input w-full px-4 py-3 text-sm"
                  autoFocus
                />
                {productName.trim() && (
                  product ? (
                    <p className="text-[11px] text-green-400 mt-1">✓ {product.name} — Stock: {product.quantity}</p>
                  ) : (
                    <p className="text-[11px] text-orange-400/60 mt-1">Product not found</p>
                  )
                )}
              </div>

              {product && (
                <>
                  <div>
                    <label className="text-xs text-white/60 mb-1 block">{t('quantity', language)}</label>
                    <input
                      type="number"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      placeholder="0"
                      className="glass-input w-full px-4 py-3 text-sm"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-white/60 mb-1 block">{getPriceLabel()}</label>
                    <input
                      type="number"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="₹0"
                      className="glass-input w-full px-4 py-3 text-sm"
                    />
                  </div>

                  {quantity && price && (
                    <div className="pt-2 border-t border-white/10">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-white/60">Total Amount</span>
                        <span className="text-lg font-bold" style={{ color: accent }}>
                          ₹{totalAmount.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="mt-6">
              <button
                onClick={handleConfirmClick}
                disabled={loading || !quantity || !product}
                className="neon-btn-solid w-full py-3 font-semibold text-sm disabled:opacity-50"
                style={accent !== '#D4A853' ? {
                  background: `linear-gradient(135deg, ${accent}44, ${accent}88)`,
                  color: 'white',
                } : undefined}
              >
                {loading ? t('loading', language) : t('confirm', language)}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Confirmation Dialog */}
      <AnimatePresence>
        {showConfirmDialog && product && meta && ConfirmIcon && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6"
            onClick={handleConfirmCancel}
          >
            <div className="absolute inset-0 bg-black/60" />

            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-card-strong p-6 w-full max-w-sm relative z-10"
            >
              <button
                onClick={handleConfirmCancel}
                className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-white/10 transition-colors"
              >
                <X size={16} className="text-white/40" />
              </button>

              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: `${accent}20`, border: `1px solid ${accent}66` }}
              >
                <ConfirmIcon size={24} style={{ color: accent }} />
              </div>

              <h3 className="text-lg font-bold text-center mb-3" style={{ color: accent }}>
                {meta.confirmLabel}?
              </h3>

              <div className="space-y-2 mb-5">
                <div className="flex justify-between items-center py-2 px-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <span className="text-xs text-white/50">Product</span>
                  <span className="text-sm font-medium text-white/90">{product.name}</span>
                </div>
                <div className="flex justify-between items-center py-2 px-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <span className="text-xs text-white/50">{t('quantity', language)}</span>
                  <span className="text-sm font-medium text-white/90">{quantity} pcs</span>
                </div>
                <div className="flex justify-between items-center py-2 px-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <span className="text-xs text-white/50">{getPriceLabel()}</span>
                  <span className="text-sm font-medium text-white/90">₹{parseFloat(price || '0').toLocaleString()}</span>
                </div>
                {totalAmount > 0 && (
                  <div className="flex justify-between items-center py-2 px-3 rounded-lg" style={{ background: `${accent}10`, border: `1px solid ${accent}30` }}>
                    <span className="text-xs text-white/50">Total</span>
                    <span className="text-sm font-bold" style={{ color: accent }}>₹{totalAmount.toLocaleString()}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleConfirmCancel}
                  className="flex-1 glass-card py-3 text-sm font-semibold text-white/70 rounded-xl hover:bg-white/10 transition-colors"
                >
                  {t('cancel', language)}
                </button>
                <button
                  onClick={handleConfirmYes}
                  disabled={loading}
                  className="flex-1 py-3 text-sm font-semibold rounded-xl text-white transition-all disabled:opacity-50"
                  style={{
                    background: `linear-gradient(135deg, ${accent}, ${accent}aa)`,
                    border: `1px solid ${accent}88`,
                  }}
                >
                  {loading ? t('loading', language) : t('confirm', language)}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
