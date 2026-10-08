'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Product } from '@/lib/types';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { createProductOffline, updateProductOffline, getProductsOffline } from '@/lib/offline-service';
import { playSuccessSound } from '@/lib/sound-service';

export default function AddProductScreen() {
  const {
    user, language, goBack, navigateTo,
    categories, selectedProductId, setSelectedProductId,
    selectedCategoryId,
  } = useAppStore();

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState(selectedCategoryId || '');
  const [quantity, setQuantity] = useState('');
  const [boxNumber, setBoxNumber] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [lowStockThreshold, setLowStockThreshold] = useState('5');
  const [loading, setLoading] = useState(false);
  const [existingProduct, setExistingProduct] = useState<Product | null>(null);

  const isEditing = !!selectedProductId;

  useEffect(() => {
    if (selectedProductId && user?.id) {
      getProductsOffline(user.id)
        .then((prods) => {
          const product = prods?.find((p: Product) => p.id === selectedProductId);
          if (product) {
            setExistingProduct(product);
            setName(product.name);
            setCategoryId(product.categoryId);
            setQuantity(String(product.quantity));
            setBoxNumber(product.boxNumber ?? '');
            setPurchasePrice(String(product.purchasePrice));
            setSellingPrice(String(product.sellingPrice));
            setLowStockThreshold(String(product.lowStockThreshold));
          }
        })
        .catch(() => {});
    }
  }, [selectedProductId, user?.id]);

  const handleSave = async () => {
    if (!name.trim() || !categoryId || !user?.id) {
      toast.error(t('error', language));
      return;
    }

    // Numeric validation — negative/invalid values would corrupt stock reports
    const qty = Number(quantity);
    const purchase = Number(purchasePrice);
    const selling = Number(sellingPrice);
    const threshold = Number(lowStockThreshold);
    if (!Number.isFinite(qty) || qty < 0 || !Number.isInteger(qty)) {
      toast.error(t('error', language), { description: 'Quantity must be a non-negative whole number' });
      return;
    }
    if (!Number.isFinite(purchase) || purchase < 0) {
      toast.error(t('error', language), { description: 'Purchase price cannot be negative' });
      return;
    }
    if (!Number.isFinite(selling) || selling < 0) {
      toast.error(t('error', language), { description: 'Selling price cannot be negative' });
      return;
    }
    if (!Number.isFinite(threshold) || threshold < 0) {
      toast.error(t('error', language), { description: 'Low stock threshold cannot be negative' });
      return;
    }

    // Duplicate product name check (only when adding new product, not editing)
    if (!isEditing) {
      try {
        const existingProducts = await getProductsOffline(user.id);
        const isDuplicate = existingProducts?.some(
          (p: Product) =>
            p.categoryId === categoryId &&
            p.name.trim().toLowerCase() === name.trim().toLowerCase()
        );
        if (isDuplicate) {
          toast.error(t('duplicateProduct', language));
          return;
        }
      } catch {
        // If offline check fails, proceed (let server handle it)
      }
    }

    setLoading(true);
    try {
      if (isEditing && selectedProductId) {
        await updateProductOffline(selectedProductId, {
          name: name.trim(),
          categoryId,
          quantity: qty,
          boxNumber: boxNumber.trim(),
          purchasePrice: purchase,
          sellingPrice: selling,
          lowStockThreshold: Number.isFinite(threshold) ? threshold : 5,
          userId: user.id,
        });
      } else {
        await createProductOffline({
          name: name.trim(),
          categoryId,
          quantity: qty,
          boxNumber: boxNumber.trim(),
          purchasePrice: purchase,
          sellingPrice: selling,
          lowStockThreshold: Number.isFinite(threshold) ? threshold : 5,
          userId: user.id,
        });
      }

      playSuccessSound();
      toast.success(isEditing ? t('updated', language) : t('added', language));
      setSelectedProductId(null);
      goBack();
    } catch (error) {
      toast.error((error as Error).message || t('error', language));
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setSelectedProductId(null);
    goBack();
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
          <button onClick={handleCancel} className="p-2 rounded-full glass-card" aria-label="Back">
            <ArrowLeft size={20} className="text-emerald-400" />
          </button>
          <h1 className="text-lg font-bold">
            {isEditing ? t('edit', language) : t('addProduct', language)}
          </h1>
          <div className="w-10" />
        </motion.div>

        {/* Form */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card-strong p-6 space-y-4"
        >
          {/* Product Name */}
          <div>
            <label className="text-xs text-white/60 mb-1 block">{t('productName', language)}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('productName', language)}
              className="glass-input w-full px-4 py-3 text-sm"
            />
          </div>

          {/* Category */}
          <div>
            <label className="text-xs text-white/60 mb-1 block">{t('category', language)}</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="glass-input w-full px-4 py-3 text-sm"
            >
              <option value="" className="bg-gray-900">Select Category</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id} className="bg-gray-900">
                  {cat.name}
                </option>
              ))}
            </select>
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
            />
          </div>

          {/* Box Number */}
          <div>
            <label className="text-xs text-white/60 mb-1 block">{t('boxNumber', language)}</label>
            <input
              type="text"
              value={boxNumber}
              onChange={(e) => setBoxNumber(e.target.value)}
              placeholder={t('boxNumber', language)}
              className="glass-input w-full px-4 py-3 text-sm"
            />
          </div>

          {/* Purchase Price */}
          <div>
            <label className="text-xs text-white/60 mb-1 block">{t('purchasePrice', language)}</label>
            <input
              type="number"
              value={purchasePrice}
              onChange={(e) => setPurchasePrice(e.target.value)}
              placeholder="₹0"
              className="glass-input w-full px-4 py-3 text-sm"
            />
          </div>

          {/* Selling Price */}
          <div>
            <label className="text-xs text-white/60 mb-1 block">{t('sellingPrice', language)}</label>
            <input
              type="number"
              value={sellingPrice}
              onChange={(e) => setSellingPrice(e.target.value)}
              placeholder="₹0"
              className="glass-input w-full px-4 py-3 text-sm"
            />
          </div>

          {/* Low Stock Threshold */}
          <div>
            <label className="text-xs text-white/60 mb-1 block">{t('lowStock', language)} Threshold</label>
            <input
              type="number"
              value={lowStockThreshold}
              onChange={(e) => setLowStockThreshold(e.target.value)}
              placeholder="5"
              className="glass-input w-full px-4 py-3 text-sm"
            />
          </div>
        </motion.div>

        {/* Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-6 space-y-3"
        >
          <button
            onClick={handleSave}
            disabled={loading}
            className="neon-btn-solid w-full py-3 font-semibold text-sm disabled:opacity-50"
          >
            {loading ? t('loading', language) : t('save', language)}
          </button>
          <button
            onClick={handleCancel}
            className="neon-btn w-full py-3 font-semibold text-sm"
          >
            {t('cancel', language)}
          </button>
        </motion.div>
      </div>
    </div>
  );
}
