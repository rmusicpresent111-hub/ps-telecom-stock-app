'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Product, Transaction } from '@/lib/types';
import { ArrowLeft, Edit, Trash2, Package, Archive, IndianRupee, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { deleteProductOffline, getProductsOffline, getTransactionsOffline } from '@/lib/offline-service';
import { motion, AnimatePresence } from 'framer-motion';

export default function ProductDetailScreen() {
  const user = useAppStore(s => s.user);
  const language = useAppStore(s => s.language);
  const goBack = useAppStore(s => s.goBack);
  const navigateTo = useAppStore(s => s.navigateTo);
  const selectedProductId = useAppStore(s => s.selectedProductId);
  const setSelectedProductId = useAppStore(s => s.setSelectedProductId);
  const setStockOperationType = useAppStore(s => s.setStockOperationType);
  const categories = useAppStore(s => s.categories);

  const [product, setProduct] = useState<Product | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Memoize category lookup
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) {
      map.set(c.id, c.name);
    }
    return map;
  }, [categories]);

  const fetchProduct = useCallback(async () => {
    if (!user?.id || !selectedProductId) return;
    try {
      setLoading(true);
      const [prodData, txnData] = await Promise.all([
        getProductsOffline(user.id),
        getTransactionsOffline(user.id),
      ]);

      const found = prodData?.find((p: Product) => p.id === selectedProductId);
      if (found) setProduct(found);
      setTransactions(txnData?.filter((t: Transaction) => t.productId === selectedProductId) || []);
    } catch {
      toast.error(t('error', language));
    } finally {
      setLoading(false);
    }
  }, [user?.id, selectedProductId]);

  useEffect(() => {
    fetchProduct();
  }, [fetchProduct]);

  const handleEdit = useCallback(() => {
    navigateTo('add-product');
  }, [navigateTo]);

  const handleDelete = useCallback(async () => {
    if (!selectedProductId || deleting) return;
    setDeleting(true);
    try {
      await deleteProductOffline(selectedProductId, user?.id || '');
      toast.success(t('deleted', language));
      setSelectedProductId(null);
      goBack();
    } catch (error) {
      toast.error((error as Error).message || t('error', language));
    } finally {
      setDeleting(false);
      setShowDeleteDialog(false);
    }
  }, [selectedProductId, deleting, language, setSelectedProductId, goBack, user?.id]);

  const handleStockOperation = useCallback((type: 'STOCK_IN' | 'STOCK_OUT' | 'SELL') => {
    setStockOperationType(type);
    const screenMap = { STOCK_IN: 'stock-in', STOCK_OUT: 'stock-out', SELL: 'instant-sell' } as const;
    navigateTo(screenMap[type]);
  }, [setStockOperationType, navigateTo]);

  if (loading) {
    return (
      <div className="animated-bg min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#D4A853]/30 border-t-[#D4A853] rounded-full animate-spin" />
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
        <div className="flex items-center justify-between mb-6">
          <button onClick={goBack} className="p-2 rounded-full glass-card" aria-label="Back">
            <ArrowLeft size={20} className="text-emerald-400" />
          </button>
          <h1 className="text-lg font-bold truncate max-w-[200px]">{product.name}</h1>
          <div className="flex gap-2">
            <button onClick={handleEdit} className="p-2 rounded-full glass-card" aria-label="Edit">
              <Edit size={18} className="text-emerald-400" />
            </button>
            <button onClick={() => setShowDeleteDialog(true)} className="p-2 rounded-full glass-card" aria-label="Delete">
              <Trash2 size={18} className="text-red-400" />
            </button>
          </div>
        </div>

        {/* Info section */}
        <div className="glass-card-strong p-6 mb-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <Tag size={14} className="text-white/40" />
              <div>
                <p className="text-[10px] text-white/40">{t('category', language)}</p>
                <p className="text-sm font-medium">{categoryMap.get(product.categoryId) || ''}</p>
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
                <p className="text-sm font-medium text-emerald-400">₹{product.sellingPrice}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <IndianRupee size={14} className="text-white/40" />
              <div>
                <p className="text-[10px] text-white/40">Profit/Unit</p>
                <p className={`text-sm font-bold ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {profit >= 0 ? '+' : ''}₹{profit.toLocaleString()}
                </p>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-white/10">
            <div className="flex justify-between items-center">
              <span className="text-xs text-white/40">{t('lowStock', language)} Threshold</span>
              <span className="text-xs text-white/60">{product.lowStockThreshold}</span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 mb-6">
          <button
            onClick={() => handleStockOperation('STOCK_IN')}
            className="flex-1 neon-btn py-3 text-xs font-semibold text-center"
            style={{ borderColor: 'rgba(245, 222, 179, 0.4)', color: '#F5DEB3', background: 'linear-gradient(135deg, rgba(245, 222, 179, 0.15), rgba(57, 200, 120, 0.1))' }}
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
            style={{ borderColor: 'rgba(160, 124, 62, 0.4)', color: '#A07C3E', background: 'linear-gradient(135deg, rgba(160, 124, 62, 0.15), rgba(140, 105, 50, 0.1))' }}
          >
            {t('instantSell', language)}
          </button>
        </div>

        {/* Transaction history */}
        <div>
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
                      'bg-emerald-700/20 text-emerald-600'
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
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <AnimatePresence>
        {showDeleteDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
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
                  disabled={deleting}
                  className="flex-1 py-2 text-sm font-semibold rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                >
                  {deleting ? t('loading', language) : t('delete', language)}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
