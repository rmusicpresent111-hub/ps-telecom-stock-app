'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Product, Transaction } from '@/lib/types';
import { motion } from 'framer-motion';
import { ArrowLeft, Edit, Trash2, Package, Archive, IndianRupee, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { getProducts, getTransactions, deleteProduct } from '@/lib/supabase-service';

export default function ProductDetailScreen() {
  const {
    user, language, goBack, navigateTo,
    selectedProductId, setSelectedProductId,
    setSelectedCategoryId, setStockOperationType,
    categories,
  } = useAppStore();

  const [product, setProduct] = useState<Product | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const fetchProduct = useCallback(async () => {
    if (!user?.id || !selectedProductId) return;
    try {
      setLoading(true);
      const [prodData, txnData] = await Promise.all([
        getProducts(user.id),
        getTransactions(user.id, { productId: selectedProductId }),
      ]);

      const found = prodData.products?.find((p: Product) => p.id === selectedProductId);
      if (found) setProduct(found);
      setTransactions(txnData.transactions || []);
    } catch {
      toast.error(t('error', language));
    } finally {
      setLoading(false);
    }
  }, [user?.id, selectedProductId, language]);

  useEffect(() => {
    fetchProduct();
  }, [fetchProduct]);

  const handleEdit = () => {
    navigateTo('add-product');
  };

  const handleDelete = async () => {
    if (!selectedProductId) return;
    try {
      await deleteProduct(selectedProductId);
      toast.success(t('deleted', language));
      setSelectedProductId(null);
      goBack();
    } catch (error) {
      toast.error((error as Error).message || t('error', language));
    }
    setShowDeleteDialog(false);
  };

  const handleStockOperation = (type: 'STOCK_IN' | 'STOCK_OUT' | 'SELL') => {
    setStockOperationType(type);
    const screenMap = { STOCK_IN: 'stock-in', STOCK_OUT: 'stock-out', SELL: 'instant-sell' } as const;
    navigateTo(screenMap[type]);
  };

  const getCategoryName = (categoryId: string) => {
    const cat = categories.find((c) => c.id === categoryId);
    return cat?.name || '';
  };

  if (loading) {
    return (
      <div className="animated-bg min-h-screen flex items-center justify-center">
        <p className="text-white/40">{t('loading', language)}</p>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="animated-bg min-h-screen flex items-center justify-center">
        <p className="text-white/40">{t('noData', language)}</p>
      </div>
    );
  }

  const profit = product.sellingPrice - product.purchasePrice;
  const isLow = product.quantity <= product.lowStockThreshold;

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
          <h1 className="text-lg font-bold truncate max-w-[200px]">{product.name}</h1>
          <div className="flex gap-2">
            <button onClick={handleEdit} className="p-2 rounded-full glass-card" aria-label="Edit">
              <Edit size={18} className="text-cyan-400" />
            </button>
            <button onClick={() => setShowDeleteDialog(true)} className="p-2 rounded-full glass-card" aria-label="Delete">
              <Trash2 size={18} className="text-red-400" />
            </button>
          </div>
        </motion.div>

        {/* Info section */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card-strong p-6 mb-6"
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <Tag size={14} className="text-white/40" />
              <div>
                <p className="text-[10px] text-white/40">{t('category', language)}</p>
                <p className="text-sm font-medium">{getCategoryName(product.categoryId)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Package size={14} className="text-white/40" />
              <div>
                <p className="text-[10px] text-white/40">{t('quantity', language)}</p>
                <p className={`text-sm font-medium ${isLow ? 'text-orange-400' : 'text-green-400'}`}>
                  {product.quantity}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Archive size={14} className="text-white/40" />
              <div>
                <p className="text-[10px] text-white/40">{t('boxNumber', language)}</p>
                <p className="text-sm font-medium">{product.boxNumber || '-'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <IndianRupee size={14} className="text-white/40" />
              <div>
                <p className="text-[10px] text-white/40">{t('purchasePrice', language)}</p>
                <p className="text-sm font-medium">₹{product.purchasePrice}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <IndianRupee size={14} className="text-white/40" />
              <div>
                <p className="text-[10px] text-white/40">{t('sellingPrice', language)}</p>
                <p className="text-sm font-medium text-cyan-400">₹{product.sellingPrice}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <IndianRupee size={14} className="text-white/40" />
              <div>
                <p className="text-[10px] text-white/40">Profit/Unit</p>
                <p className="text-sm font-bold text-green-400">+₹{profit}</p>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-white/10">
            <div className="flex justify-between items-center">
              <span className="text-xs text-white/40">{t('lowStock', language)} Threshold</span>
              <span className="text-xs text-white/60">{product.lowStockThreshold}</span>
            </div>
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
            onClick={() => handleStockOperation('STOCK_IN')}
            className="flex-1 neon-btn py-3 text-xs font-semibold text-center"
            style={{ borderColor: 'rgba(57, 255, 20, 0.4)', color: '#39ff14', background: 'linear-gradient(135deg, rgba(57, 255, 20, 0.15), rgba(57, 200, 120, 0.1))' }}
          >
            {t('stockIn', language)}
          </button>
          <button
            onClick={() => handleStockOperation('STOCK_OUT')}
            className="flex-1 neon-btn py-3 text-xs font-semibold text-center"
            style={{ borderColor: 'rgba(255, 107, 0, 0.4)', color: '#ff6b00', background: 'linear-gradient(135deg, rgba(255, 107, 0, 0.15), rgba(255, 180, 0, 0.1))' }}
          >
            {t('stockOut', language)}
          </button>
          <button
            onClick={() => handleStockOperation('SELL')}
            className="flex-1 neon-btn py-3 text-xs font-semibold text-center"
            style={{ borderColor: 'rgba(180, 74, 255, 0.4)', color: '#b44aff', background: 'linear-gradient(135deg, rgba(180, 74, 255, 0.15), rgba(140, 50, 220, 0.1))' }}
          >
            {t('instantSell', language)}
          </button>
        </motion.div>

        {/* Transaction history */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <h3 className="text-sm font-semibold mb-3">{t('history', language)}</h3>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {transactions.length === 0 ? (
              <div className="text-center py-6 text-white/40 text-xs">{t('noData', language)}</div>
            ) : (
              transactions.map((txn) => (
                <div key={txn.id} className="glass-card p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      txn.type === 'STOCK_IN' ? 'bg-green-500/20 text-green-400' :
                      txn.type === 'STOCK_OUT' ? 'bg-orange-500/20 text-orange-400' :
                      'bg-purple-500/20 text-purple-400'
                    }`}>
                      {txn.type === 'STOCK_IN' ? t('stockInLabel', language) :
                       txn.type === 'STOCK_OUT' ? t('stockOutLabel', language) :
                       t('sellLabel', language)}
                    </span>
                    <span className="text-xs text-white/60">×{txn.quantity}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-medium">₹{txn.totalAmount}</p>
                    <p className="text-[10px] text-white/40">{txn.date}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </motion.div>
      </div>

      {/* Delete confirmation dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass-card-strong p-6 mx-4 max-w-sm w-full"
          >
            <h3 className="text-lg font-bold mb-2">{t('areYouSure', language)}</h3>
            <p className="text-sm text-white/60 mb-6">{t('thisActionCannot', language)}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteDialog(false)}
                className="flex-1 neon-btn py-2 text-sm font-semibold"
              >
                {t('cancel', language)}
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-2 text-sm font-semibold rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-colors"
              >
                {t('delete', language)}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
