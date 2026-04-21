'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Product } from '@/lib/types';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { getProducts, createProduct, updateProduct } from '@/lib/supabase-service';

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
      getProducts(user.id)
        .then((data) => {
          const product = data.products?.find((p: Product) => p.id === selectedProductId);
          if (product) {
            setExistingProduct(product);
            setName(product.name);
            setCategoryId(product.categoryId);
            setQuantity(String(product.quantity));
            setBoxNumber(product.boxNumber);
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

    setLoading(true);
    try {
      if (isEditing && selectedProductId) {
        await updateProduct(selectedProductId, {
          name: name.trim(),
          categoryId,
          quantity: parseInt(quantity) || 0,
          boxNumber: boxNumber.trim(),
          purchasePrice: parseFloat(purchasePrice) || 0,
          sellingPrice: parseFloat(sellingPrice) || 0,
          lowStockThreshold: parseInt(lowStockThreshold) || 5,
        });
      } else {
        await createProduct({
          name: name.trim(),
          categoryId,
          quantity: parseInt(quantity) || 0,
          boxNumber: boxNumber.trim(),
          purchasePrice: parseFloat(purchasePrice) || 0,
          sellingPrice: parseFloat(sellingPrice) || 0,
          lowStockThreshold: parseInt(lowStockThreshold) || 5,
          userId: user.id,
        });
      }

      toast.success(isEditing ? t('updated', language) : t('added', language));
      if (isEditing) {
        setSelectedProductId(null);
        goBack();
      } else {
        // Clear all fields but keep the selected category
        setName('');
        setQuantity('');
        setBoxNumber('');
        setPurchasePrice('');
        setSellingPrice('');
        setLowStockThreshold('5');
        // categoryId stays the same - auto selected for next product
      }
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
            <ArrowLeft size={20} className="text-cyan-400" />
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
