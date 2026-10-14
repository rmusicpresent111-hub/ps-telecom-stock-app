'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { motion } from 'framer-motion';
import {
  ArrowLeft, CloudUpload, CloudDownload, RefreshCw, AlertTriangle,
  Database, CheckCircle2, Clock, Package, Receipt, Tag, IndianRupee, Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { registerBackModal } from '@/lib/modal-back';
import type { Category } from '@/lib/types';
import {
  getFirebaseSyncInfo, pushAllToFirebase, restoreFromFirebase,
  setAutoSyncEnabled, type FirebaseSyncInfo,
} from '@/lib/firebase-sync';

const STORE_ICONS = [Package, Tag, RefreshCw, IndianRupee, Wrench, Receipt];

export default function CloudBackupScreen() {
  const { user, language, goBack, setCategories } = useAppStore();
  const uid = user?.id || '';

  const [info, setInfo] = useState<FirebaseSyncInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);

  // Hardware/browser back closes the restore dialog first
  useEffect(() => {
    if (!showRestoreDialog) return;
    return registerBackModal(() => setShowRestoreDialog(false));
  }, [showRestoreDialog]);

  const refresh = useCallback(async () => {
    if (!uid) return;
    try {
      setInfo(await getFirebaseSyncInfo(uid));
    } catch {
      // non-fatal — status stays as-is
    }
  }, [uid]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Live updates from the sync engine (push finished / failed)
  useEffect(() => {
    const handler = () => { void refresh(); };
    window.addEventListener('ps-fb-sync', handler);
    return () => window.removeEventListener('ps-fb-sync', handler);
  }, [refresh]);

  const handleBackupNow = async () => {
    if (!uid || busy) return;
    setBusy(true);
    try {
      const res = await pushAllToFirebase(uid);
      if (res.ok) toast.success(t('syncDone', language) + ` (${res.pushed})`);
      else toast.error(t('syncFailed', language) + (res.error && res.error !== 'busy' ? `: ${res.error}` : ''));
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const handleConfirmRestore = async () => {
    if (!uid || busy) return;
    setBusy(true);
    try {
      const res = await restoreFromFirebase(uid);
      if (res.ok) {
        // Refresh the UI-side category cache (Add Product's select reads the store)
        try {
          const { getCategoriesOffline } = await import('@/lib/offline-service');
          setCategories((await getCategoriesOffline(uid)) as unknown as Category[]);
        } catch {
          // category cache refresh is best-effort
        }
        toast.success(t('restore', language) + ' ✓');
      } else {
        toast.error(t('syncFailed', language) + (res.error ? `: ${res.error}` : ''));
      }
    } finally {
      setBusy(false);
      setShowRestoreDialog(false);
      void refresh();
    }
  };

  const toggleAutoSync = () => {
    if (!uid || !info) return;
    const next = !info.autoSync;
    setAutoSyncEnabled(uid, next);
    setInfo({ ...info, autoSync: next });
  };

  const fmtTime = (ts: number | null) => {
    if (!ts) return t('neverSynced', language);
    try {
      return new Date(ts).toLocaleString(language === 'bn' ? 'bn-BD' : language === 'hi' ? 'hi-IN' : 'en-IN');
    } catch {
      return new Date(ts).toLocaleString();
    }
  };

  const countEntries = info
    ? ([
        ['products', info.counts.products],
        ['transactions', info.counts.transactions],
        ['bills', info.counts.bills],
        ['categories', info.counts.categories],
        ['expenses', info.counts.expenses],
      ] as const).filter(([, n]) => typeof n === 'number')
    : [];

  // Any persistent failure → show the setup hint (DB missing, rules, network)
  const showRulesHint = !!info?.lastError;

  return (
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 mb-6"
        >
          <button onClick={goBack} className="p-2 rounded-xl glass-card" aria-label="Back">
            <ArrowLeft size={20} className="text-white/70" />
          </button>
          <div className="flex items-center gap-2">
            <CloudUpload size={22} className="text-sky-300" />
            <h1 className="text-lg font-bold neon-glow">{t('cloudBackup', language)}</h1>
          </div>
        </motion.div>

        {/* Status card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-card-strong p-5 mb-4"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Database size={16} className="text-sky-300" />
              <span className="text-sm font-semibold">{info?.project || 'firebase'}</span>
            </div>
            <span className={`text-[10px] px-2 py-1 rounded-full border ${
              info?.lastError
                ? 'text-red-300 border-red-400/30 bg-red-400/10'
                : info?.busy
                  ? 'text-amber-300 border-amber-400/30 bg-amber-400/10'
                  : info?.live
                    ? 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10'
                    : 'text-white/50 border-white/20 bg-white/5'
            }`}>
              {info?.busy
                ? t('syncing', language)
                : info?.lastError
                  ? t('syncFailed', language)
                  : info?.live
                    ? t('liveSync', language)
                    : t('connecting', language)}
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-white/50">
            <Clock size={13} className="text-white/40" />
            <span>{t('lastSynced', language)}:</span>
            <span className="text-white/70">{fmtTime(info?.lastSync ?? null)}</span>
          </div>

          {info?.lastError ? (
            <p className="mt-2 text-[11px] text-red-300/80 break-words">{info.lastError}</p>
          ) : null}

          {showRulesHint ? (
            <div className="mt-3 p-3 rounded-xl border border-amber-400/20 bg-amber-400/5 flex items-start gap-2">
              <AlertTriangle size={14} className="text-amber-300 mt-0.5 shrink-0" />
              <p className="text-[11px] text-amber-200/90 leading-relaxed">{t('rulesHint', language)}</p>
            </div>
          ) : null}
        </motion.div>

        {/* Auto Sync toggle */}
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          onClick={toggleAutoSync}
          className="glass-card w-full p-4 flex items-center justify-between mb-4"
          aria-pressed={info?.autoSync ?? true}
        >
          <div className="flex items-center gap-3 text-left">
            <RefreshCw size={18} className="text-emerald-400" />
            <div>
              <span className="text-sm block">{t('autoSync', language)}</span>
              <span className="text-[10px] text-white/40">{t('autoSyncDesc', language)}</span>
            </div>
          </div>
          <div className={`w-10 h-5 rounded-full transition-all relative ${info?.autoSync !== false ? 'bg-emerald-500/40' : 'bg-white/10'}`}>
            <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all ${info?.autoSync !== false ? 'left-[22px]' : 'left-0.5'}`} />
          </div>
        </motion.button>

        {/* Actions */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="space-y-2 mb-4"
        >
          <button
            onClick={handleBackupNow}
            disabled={busy || !uid}
            className="neon-btn-solid w-full p-4 flex items-center justify-center gap-2 text-sm font-semibold disabled:opacity-50"
          >
            <CloudUpload size={17} />
            {busy ? t('syncing', language) : t('backupNow', language)}
          </button>

          <button
            onClick={() => setShowRestoreDialog(true)}
            disabled={busy || !uid}
            className="glass-card w-full p-4 flex items-center justify-center gap-2 text-sm font-semibold text-amber-300 disabled:opacity-50"
          >
            <CloudDownload size={17} />
            {t('restoreFromCloud', language)}
          </button>
        </motion.div>

        {/* Record counts */}
        {countEntries.length > 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="glass-card p-4"
          >
            <div className="grid grid-cols-2 gap-3">
              {countEntries.map(([store, count], idx) => {
                const Icon = STORE_ICONS[idx % STORE_ICONS.length];
                return (
                  <div key={store} className="flex items-center gap-2">
                    <Icon size={14} className="text-sky-300/80 shrink-0" />
                    <span className="text-xs text-white/50 flex-1">{t(store as 'products', language)}</span>
                    <span className="text-xs font-semibold text-white/80">{count}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-white/5">
              <CheckCircle2 size={12} className="text-emerald-400/70" />
              <span className="text-[10px] text-white/40">psStock/{uid || '{user}'}</span>
            </div>
          </motion.div>
        ) : null}
      </div>

      {/* Restore confirmation dialog */}
      {showRestoreDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass-card-strong p-6 mx-4 max-w-sm w-full"
          >
            <h3 className="text-lg font-bold mb-2 text-amber-300">{t('restoreFromCloud', language)}</h3>
            <p className="text-sm text-white/60 mb-5">{t('thisActionCannot', language)}</p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowRestoreDialog(false)}
                className="flex-1 neon-btn py-2 text-sm font-semibold"
              >
                {t('cancel', language)}
              </button>
              <button
                onClick={handleConfirmRestore}
                disabled={busy}
                className="flex-1 py-2 text-sm font-semibold rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
              >
                {t('restore', language)}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
