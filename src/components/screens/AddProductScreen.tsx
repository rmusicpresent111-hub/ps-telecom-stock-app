'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Product, Category } from '@/lib/types';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { createProductOffline, updateProductOffline, getProductByIdOffline, getProductsOffline, getCategoriesOffline, ensureCategoryOffline } from '@/lib/offline-service';
import { playSuccessSound } from '@/lib/sound-service';

/**
 * Type-to-create category field (v2.14.0) — replaces the old fixed <select>.
 * Typing filters existing categories; any name that doesn't match is created
 * automatically (on pick, or on save) so the category appears on the app AND
 * the web via cloud sync. The product form never blocks on category setup.
 */
function CategoryField({
  categories,
  value,
  text,
  onText,
  onPick,
  onCreate,
  placeholder,
  createLabel,
}: {
  categories: Category[];
  value: string;
  text: string;
  onText: (v: string) => void;
  onPick: (cat: Category) => void;
  onCreate: (name: string) => void;
  placeholder: string;
  createLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const query = text.trim().toLowerCase();
  const matches = query
    ? categories.filter((c) => c.name.toLowerCase().includes(query))
    : categories;
  const exact = query.length > 0 && categories.some((c) => c.name.toLowerCase() === query);
  const canCreate = query.length > 0 && !exact;

  return (
    <div className="relative">
      <input
        type="text"
        value={text}
        onChange={(e) => onText(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
        aria-label={placeholder}
        className="glass-input w-full px-4 py-3 text-sm"
      />
      {open && (matches.length > 0 || canCreate) && (
        <div className="absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-gray-900/95 backdrop-blur-xl shadow-2xl py-1" role="listbox">
          {matches.map((cat) => (
            <button
              key={cat.id}
              type="button"
              role="option"
              aria-selected={cat.id === value}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(cat);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2.5 hover:bg-emerald-500/10 active:bg-emerald-500/15 transition-colors min-h-[44px] ${
                cat.id === value ? 'text-emerald-400 font-semibold' : 'text-white/85'
              }`}
            >
              <span className="w-8 h-8 rounded-lg glass-card flex items-center justify-center overflow-hidden shrink-0 text-base">
                {cat.image && (cat.image.startsWith('data:') || cat.image.startsWith('/')) ? (
                  <img src={cat.image} alt="" className="w-full h-full object-cover" />
                ) : (
                  cat.image || '📦'
                )}
              </span>
              <span className="truncate">{cat.name}</span>
              {cat.id === value && <Check size={15} className="ml-auto shrink-0" />}
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onCreate(text.trim());
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2.5 text-sm font-semibold text-emerald-400 hover:bg-emerald-500/10 active:bg-emerald-500/15 transition-colors flex items-center gap-2 min-h-[44px] border-t border-white/10"
            >
              <Plus size={15} className="shrink-0" />
              <span className="truncate">{createLabel} “{text.trim()}”</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function AddProductScreen() {
  const {
    user, language, goBack, navigateTo,
    categories, selectedProductId, setSelectedProductId,
    selectedCategoryId,
  } = useAppStore();

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState(selectedCategoryId || '');
  const [catName, setCatName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [boxNumber, setBoxNumber] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [lowStockThreshold, setLowStockThreshold] = useState('5');
  const [loading, setLoading] = useState(false);
  const [existingProduct, setExistingProduct] = useState<Product | null>(null);

  const isEditing = !!selectedProductId;

  useEffect(() => {
    if (selectedProductId) {
      // ⚡ Direct O(1) IndexedDB get — the old path loaded ALL products to find one
      getProductByIdOffline(selectedProductId)
        .then(async (product) => {
          if (product) {
            setExistingProduct(product);
            setName(product.name);
            setCategoryId(product.categoryId);
            setQuantity(String(product.quantity));
            setBoxNumber(product.boxNumber ?? '');
            setPurchasePrice(String(product.purchasePrice));
            setSellingPrice(String(product.sellingPrice));
            setLowStockThreshold(String(product.lowStockThreshold));
            // Category display name — store list first, IndexedDB fallback
            const known = useAppStore
              .getState()
              .categories.find((c) => c.id === product.categoryId);
            if (known) {
              setCatName(known.name);
              return;
            }
            try {
              const cats = await getCategoriesOffline(product.userId || user?.id || '');
              const cat = cats.find((x) => x.id === product.categoryId);
              if (cat) setCatName(cat.name);
            } catch {
              /* id still set — name stays empty */
            }
          }
        })
        .catch(() => {});
    }
  }, [selectedProductId, user?.id]);

  // Arriving from a category screen ("+ Add Product"): prefill that category
  useEffect(() => {
    if (selectedProductId || !selectedCategoryId) return;
    setCategoryId(selectedCategoryId);
    const known = useAppStore
      .getState()
      .categories.find((c) => c.id === selectedCategoryId);
    if (known) {
      setCatName(known.name);
      return;
    }
    getCategoriesOffline(user?.id || '')
      .then((cats) => {
        const cat = cats.find((x) => x.id === selectedCategoryId);
        if (cat) setCatName(cat.name);
      })
      .catch(() => {});
  }, [selectedCategoryId, selectedProductId, user?.id]);

  const handleSave = async () => {
    // categoryId may be empty here — a typed category name resolves on save
    if (!name.trim() || !user?.id) {
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

    // 🔒 v2.14.0 Resolve the category BEFORE anything is written: a picked id
    // wins; otherwise the typed name is find-or-created (case-insensitive) so
    // the category exists on this device AND syncs to every other device
    // (app + web). The user never has to visit Add Category first.
    let finalCategoryId = categoryId;
    const typedName = catName.trim();
    if (!finalCategoryId) {
      if (!typedName) {
        toast.error(t('error', language), { description: t('searchOrCreateCategory', language) });
        return;
      }
      try {
        const res = await ensureCategoryOffline(typedName, user.id);
        finalCategoryId = res.category.id;
        if (res.created) {
          const cur = useAppStore.getState().categories;
          useAppStore.getState().setCategories([...cur, res.category]);
          toast.success(t('categoryCreated', language));
        }
      } catch (err) {
        toast.error((err as Error).message || t('error', language));
        return;
      }
    }

    // Duplicate product name check (only when adding new product, not editing)
    // ⚡ Only fetches THIS category's products instead of the user's whole list
    if (!isEditing) {
      try {
        const categoryProducts = await getProductsOffline(user.id, { categoryId: finalCategoryId });
        const isDuplicate = categoryProducts?.some(
          (p: Product) => p.name.trim().toLowerCase() === name.trim().toLowerCase()
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
          categoryId: finalCategoryId,
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
          categoryId: finalCategoryId,
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
      // Service-level duplicate guard (also covers the edit path, which has
      // no UI pre-check) → show the localized duplicate message.
      if ((error as { code?: string } | null)?.code === 'DUPLICATE_PRODUCT') {
        toast.error(t('duplicateProduct', language));
      } else {
        toast.error((error as Error).message || t('error', language));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setSelectedProductId(null);
    goBack();
  };

  const handlePickCategory = (cat: Category) => {
    setCategoryId(cat.id);
    setCatName(cat.name);
  };

  const handleCreateCategory = async (newName: string) => {
    if (!user?.id || !newName.trim()) return;
    try {
      const { category, created } = await ensureCategoryOffline(newName, user.id);
      if (created) {
        const cur = useAppStore.getState().categories;
        useAppStore.getState().setCategories([...cur, category]);
        toast.success(t('categoryCreated', language));
      }
      setCategoryId(category.id);
      setCatName(category.name);
    } catch (err) {
      toast.error((err as Error).message || t('error', language));
    }
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

          {/* Category — type to search or create (syncs to app + web) */}
          <div>
            <label className="text-xs text-white/60 mb-1 block">{t('category', language)}</label>
            <CategoryField
              categories={categories}
              value={categoryId}
              text={catName}
              onText={(v) => {
                setCatName(v);
                setCategoryId(''); // typing invalidates the picked id — resolved on save
              }}
              onPick={handlePickCategory}
              onCreate={handleCreateCategory}
              placeholder={t('searchOrCreateCategory', language)}
              createLabel={t('createCategory', language)}
            />
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
