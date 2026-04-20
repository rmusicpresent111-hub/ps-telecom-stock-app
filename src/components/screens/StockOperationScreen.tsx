'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Product } from '@/lib/types';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

export default function StockOperationScreen() {
  const {
    user, language, goBack,
    selectedProductId, stockOperationType,
  } = useAppStore();

  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  const fetchProduct = useCallback(async () => {
    if (!user?.id || !selectedProductId) return;
    try {
      setFetching(true);
      const res = await fetch(`/api/products?userId=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        const found = data.products?.find((p: Product) => p.id === selectedProductId);
        if (found) {
          setProduct(found);
          // Pre-fill price based on operation type
          if (stockOperationType === 'SELL') {
            setPrice(String(found.sellingPrice));
          } else if (stockOperationType === 'STOCK_IN') {
            setPrice(String(found.purchasePrice));
          }
        }
      }
    } catch {
      toast.error(t('error', language));
    } finally {
      setFetching(false);
    }
  }, [user?.id, selectedProductId, language, stockOperationType]);

  useEffect(() => {
    fetchProduct();
  }, [fetchProduct]);

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
    if (!selectedProductId || !user?.id || !stockOperationType || !quantity) {
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
          productId: selectedProductId,
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
        ) : !product ? (
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
              {/* Product name (display only) */}
              <div>
                <label className="text-xs text-white/60 mb-1 block">{t('productName', language)}</label>
                <div className="glass-input w-full px-4 py-3 text-sm opacity-70">
                  {product.name}
                </div>
              </div>

              {/* Current quantity (display) */}
              <div>
                <label className="text-xs text-white/60 mb-1 block">{t('quantity', language)} (Current)</label>
                <div className={`glass-input w-full px-4 py-3 text-sm font-semibold ${
                  product.quantity <= product.lowStockThreshold ? 'text-orange-400' : 'text-green-400'
                }`}>
                  {product.quantity}
                </div>
              </div>

              {/* Quantity input */}
              <div>
                <label className="text-xs text-white/60 mb-1 block">{t('enterQuantity', language)}</label>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0"
                  className="glass-input w-full px-4 py-3 text-sm"
                  autoFocus
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
                />
              </div>

              {/* Total preview */}
              {quantity && price && (
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
                disabled={loading || !quantity}
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
