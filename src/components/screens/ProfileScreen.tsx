'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { t, type TranslationKeys } from '@/lib/i18n';
import { getProfileOffline, updateProfileOffline, exportBackupOffline, importBackupOffline, resetDataOffline, localDateStr, getProductsOffline, getBillsOffline } from '@/lib/offline-service';
import { registerBackModal } from '@/lib/modal-back';
import { subscribeD1Status, getD1SyncStatus, syncNowD1, connectSync, disconnectSync, type D1SyncStatus } from '@/lib/d1-sync';
import { getSyncAccount, generateSyncId, type SyncAccount } from '@/lib/d1-config';
import { motion } from 'framer-motion';
import { User, Pencil, Moon, Sun, Globe, FileText, Download, Upload, Trash2, Receipt, ReceiptText, RefreshCw, CloudUpload, Lock, Repeat2, HandCoins, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import type { User as UserType, Category } from '@/lib/types';

export default function ProfileScreen() {
  const {
    user, language, setLanguage, theme, setTheme,
    setUser, navigateTo, setCategories,
  } = useAppStore();

  const [editName, setEditName] = useState('');
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Restore-from-file: parsed backup waits here until the user confirms
  const [pendingRestore, setPendingRestore] = useState<Record<string, unknown> | null>(null);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);

  // Cloud sync (D1) live status
  const [syncStatus, setSyncStatus] = useState<D1SyncStatus>(getD1SyncStatus());
  const [syncingNow, setSyncingNow] = useState(false);
  useEffect(() => subscribeD1Status(setSyncStatus), []);

  // Cloud sync setup (create / join account)
  const [syncAccount, setSyncAccountState] = useState<SyncAccount | null>(() =>
    typeof window !== 'undefined' ? getSyncAccount() : null
  );
  const [showSyncDialog, setShowSyncDialog] = useState(false);
  const [syncTab, setSyncTab] = useState<'create' | 'join'>('create');
  const [syncIdInput, setSyncIdInput] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const openSyncDialog = () => {
    setSyncTab('create');
    setSyncIdInput((prev) => prev || generateSyncId());
    setPinInput('');
    setPinConfirm('');
    setShowSyncDialog(true);
  };

  const handleConnect = async () => {
    if (connecting) return;
    if (syncTab === 'create' && pinInput !== pinConfirm) {
      toast.error(t('d1ErrMismatch', language));
      return;
    }
    setConnecting(true);
    const res = await connectSync(syncIdInput.trim(), pinInput, syncTab);
    setConnecting(false);
    if (res.ok) {
      setSyncAccountState(getSyncAccount());
      setShowSyncDialog(false);
      setPinInput('');
      setPinConfirm('');
      toast.success(t('d1ConnectedToast', language));
    } else {
      const keyMap: Record<string, string> = {
        taken: 'd1ErrTaken',
        'not-found': 'd1ErrNotFound',
        'wrong-pin': 'd1ErrWrongPin',
        'bad-id': 'd1ErrBadId',
        'bad-pin': 'd1ErrBadPin',
        offline: 'd1ErrOffline',
        fail: 'd1ErrFail',
      };
      toast.error(t((keyMap[res.error ?? 'fail'] ?? 'd1ErrFail') as keyof TranslationKeys, language));
    }
  };

  const handleDisconnect = () => {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true);
      window.setTimeout(() => setConfirmDisconnect(false), 4000);
      return;
    }
    setConfirmDisconnect(false);
    disconnectSync();
    setSyncAccountState(null);
    toast.success(t('d1DisconnectedToast', language));
  };

  const handleSyncNow = async () => {
    if (!user?.id || syncingNow) return;
    setSyncingNow(true);
    const res = await syncNowD1(user.id);
    setSyncingNow(false);
    if (res.ok) toast.success(t('d1StateSynced', language));
    else toast.error(t('d1StateError', language));
  };

  // Hardware/browser back closes the topmost open dialog first
  useEffect(() => {
    if (!showEditDialog) return;
    return registerBackModal(() => setShowEditDialog(false));
  }, [showEditDialog]);

  useEffect(() => {
    if (!showResetDialog) return;
    return registerBackModal(() => setShowResetDialog(false));
  }, [showResetDialog]);

  useEffect(() => {
    if (!showRestoreDialog) return;
    return registerBackModal(() => setShowRestoreDialog(false));
  }, [showRestoreDialog]);

  useEffect(() => {
    if (!showSyncDialog) return;
    return registerBackModal(() => setShowSyncDialog(false));
  }, [showSyncDialog]);

  const fetchProfile = useCallback(async () => {
    if (!user?.id) return;
    try {
      const data = await getProfileOffline(user.id) as Record<string, unknown> | null;
      if (data?.user) {
        setUser(data.user as unknown as UserType);
      }
    } catch {
      // Silently fail
    }
  }, [user?.id, setUser]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleUpdateName = async () => {
    if (!user?.id || !editName.trim()) return;
    setLoading(true);
    try {
      const data = await updateProfileOffline(user.id, { name: editName.trim() });
      if (data?.user) {
        setUser(data.user as unknown as UserType);
      }
      toast.success(t('updated', language));
    } catch {
      toast.error(t('error', language));
    } finally {
      setLoading(false);
      setShowEditDialog(false);
    }
  };

  const handleThemeToggle = async () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    // Update on server
    if (user?.id) {
      try {
        await updateProfileOffline(user.id, { theme: newTheme });
      } catch {
        // Silently fail
      }
    }
  };

  const handleLanguageChange = () => {
    navigateTo('language');
  };

  const handleBackup = async () => {
    if (!user?.id) return;
    try {
      const data = await exportBackupOffline(user.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // localDateStr(): UTC filenames stamp pre-05:30 IST backups with yesterday
      a.download = `ps-telecom-backup-${localDateStr()}.json`;
      a.click();
      // Revoking synchronously can abort the download on some browsers — give it time.
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast.success(t('backup', language) + ' ✓');
    } catch {
      toast.error(t('error', language));
    }
  };

  const handleRestore = () => {
    fileInputRef.current?.click();
  };

  /**
   * CSV data export — the RAW product master / bills register (the Reports
   * screen already exports computed reports). Proper escaping keeps commas &
   * quotes inside names from corrupting columns; a UTF-8 BOM makes Excel open
   * Bangla/Hindi text correctly instead of mojibake.
   */
  const handleExportCsv = async (kind: 'products' | 'bills') => {
    if (!user?.id) return;
    try {
      const esc = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
      let csv = '\uFEFF';
      if (kind === 'products') {
        const products = await getProductsOffline(user.id);
        csv += 'Name,Category,Quantity,Box,Purchase Price,Selling Price,Low Stock Alert,Value\n';
        for (const p of products) {
          csv += [
            esc(p.name),
            esc(p.category?.name || p.categoryId),
            p.quantity,
            esc(p.boxNumber),
            p.purchasePrice,
            p.sellingPrice,
            p.lowStockThreshold,
            p.quantity * p.purchasePrice,
          ].join(',') + '\n';
        }
      } else {
        const bills = await getBillsOffline(user.id);
        csv += 'Bill No,Date,Customer,Mobile,Items,Subtotal,Discount,GST,Total,Paid,Due,Payment\n';
        for (const b of bills) {
          csv += [
            esc(b.billNumber),
            b.date,
            esc(b.customerName),
            esc(b.customerMobile),
            esc(b.items.map(i => `${i.name} x${i.quantity}`).join('; ')),
            b.subtotal,
            b.discountAmount,
            b.gstAmount,
            b.total,
            b.paidAmount,
            b.dueAmount,
            b.paymentMethod,
          ].join(',') + '\n';
        }
      }
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ps-telecom-${kind}-${localDateStr()}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast.success(t('csvExported', language));
    } catch {
      toast.error(t('error', language));
    }
  };

  // File selection only PARSES the backup — the import itself happens after
  // the confirmation dialog, so nobody can wipe the device by dropping a
  // file in by accident.
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const backupData = JSON.parse(text) as Record<string, unknown>;
      setPendingRestore(backupData);
      setShowRestoreDialog(true);
    } catch (error) {
      toast.error((error as Error).message || t('error', language));
    }
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleConfirmRestore = async () => {
    if (!user?.id || !pendingRestore) return;
    setLoading(true);
    try {
      const backupData = pendingRestore;
      const arr = (key: string): unknown[] =>
        Array.isArray(backupData[key]) ? (backupData[key] as unknown[]) : [];
      await importBackupOffline(user.id, {
        categories: arr('categories'),
        products: arr('products'),
        transactions: arr('transactions'),
        expenses: arr('expenses'),
        cashEntries: arr('cashEntries'),
        serviceTransactions: arr('serviceTransactions'),
        bills: arr('bills'),
        billingSettings: backupData.billingSettings,
      });
      // Refresh the UI-side category cache from the imported rows (Add Product's
      // select reads the store — it must not show pre-restore categories).
      if (Array.isArray(backupData.categories)) {
        setCategories(
          (backupData.categories as Record<string, unknown>[])
            .filter(c => !!c && typeof c.id === 'string' && typeof c.name === 'string')
            .map(c => c as unknown as Category)
        );
      }
      toast.success(t('restore', language) + ' ✓');
      setShowRestoreDialog(false);
      setPendingRestore(null);
    } catch (error) {
      toast.error((error as Error).message || t('error', language));
    } finally {
      setLoading(false);
    }
  };

  const handleResetAll = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      await resetDataOffline(user.id);
      // Clear the UI-side category cache too, so the dashboard/product screens
      // immediately reflect the empty DB instead of stale rows.
      setCategories([]);
      toast.success(t('deleted', language));
      setShowResetDialog(false);
    } catch (error) {
      toast.error((error as Error).message || t('error', language));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-center mb-6"
        >
          <div className="flex items-center gap-2">
            <User size={24} className="text-emerald-400" />
            <h1 className="text-lg font-bold neon-glow">{t('profile', language)}</h1>
          </div>
        </motion.div>

        {/* User info card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card-strong p-6 mb-6 text-center"
        >
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-500/30 to-emerald-700/30 flex items-center justify-center mx-auto mb-3">
            <User size={28} className="text-emerald-400" />
          </div>
          <h2 className="text-lg font-bold">{user?.name || 'User'}</h2>
          {user?.email ? <p className="text-sm text-white/60">{user.email}</p> : null}
          <p className="text-xs text-emerald-400 mt-1">{user?.shopName || 'PS TELECOM'}</p>
        </motion.div>

        {/* Settings list */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="space-y-2"
        >
          {/* Change Name */}
          <button
            onClick={() => { setEditName(user?.name || ''); setShowEditDialog(true); }}
            className="glass-card w-full p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <Pencil size={18} className="text-emerald-400" />
              <span className="text-sm">{t('changeName', language)}</span>
            </div>
            <span className="text-xs text-white/40">{user?.name}</span>
          </button>

          {/* Dark/Light Mode */}
          <button
            onClick={handleThemeToggle}
            className="glass-card w-full p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              {theme === 'dark' ? <Moon size={18} className="text-emerald-400" /> : <Sun size={18} className="text-orange-400" />}
              <span className="text-sm">{theme === 'dark' ? t('darkMode', language) : t('lightMode', language)}</span>
            </div>
            <div className={`w-10 h-5 rounded-full transition-all ${theme === 'dark' ? 'bg-emerald-500/40' : 'bg-orange-500/40'} relative`}>
              <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all ${theme === 'dark' ? 'left-0.5' : 'left-[22px]'}`} />
            </div>
          </button>

          {/* Change Language */}
          <button
            onClick={handleLanguageChange}
            className="glass-card w-full p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <Globe size={18} className="text-emerald-400" />
              <span className="text-sm">{t('languageChange', language)}</span>
            </div>
            <span className="text-xs text-white/40 uppercase">{language}</span>
          </button>

          {/* Billing Settings */}
          <button
            onClick={() => navigateTo('billing-settings')}
            className="glass-card w-full p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <ReceiptText size={18} className="text-amber-300" />
              <div className="text-left">
                <span className="text-sm block">{t('billingSettings', language)}</span>
                <span className="text-[10px] text-white/40">{t('billingSettingsDesc', language)}</span>
              </div>
            </div>
            <span className="text-xs text-white/40">₹</span>
          </button>

          {/* Daily Book */}
          <button
            onClick={() => navigateTo('daily-book')}
            className="glass-card w-full p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <Receipt size={18} className="text-amber-400" />
              <span className="text-sm">
                {language === 'bn' ? 'দৈনিক বই' : language === 'hi' ? 'दैनिक बही' : 'Daily Book'}
              </span>
            </div>
            <span className="text-xs text-white/40">₹</span>
          </button>

          {/* Due Book — customer credit tracking */}
          <button
            onClick={() => navigateTo('due-book')}
            className="glass-card w-full p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <HandCoins size={18} className="text-red-400" />
              <div className="text-left">
                <span className="text-sm block">{t('dueBook', language)}</span>
                <span className="text-[10px] text-white/40">{t('dueBookDesc', language)}</span>
              </div>
            </div>
            <span className="text-xs text-white/40">₹</span>
          </button>

          {/* Cloud Sync (D1) — setup / status + manual sync */}
          <button
            onClick={syncAccount ? handleSyncNow : openSyncDialog}
            className="glass-card w-full p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <CloudUpload size={18} className="text-sky-300" />
              <div className="text-left">
                <span className="text-sm block">{t('d1SyncTitle', language)}</span>
                <span className="text-[10px] text-white/40">
                  {syncAccount
                    ? `${syncAccount.syncId} · ${
                        syncStatus.lastSyncAt > 0
                          ? `${t('d1LastSync', language)}: ${new Date(syncStatus.lastSyncAt).toLocaleTimeString()}`
                          : t('d1Never', language)
                      }`
                    : t('d1NotConnected', language)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full ${
                  !syncAccount
                    ? 'bg-sky-500/15 text-sky-300'
                    : syncingNow || syncStatus.state === 'syncing'
                      ? 'bg-amber-500/15 text-amber-300'
                      : syncStatus.state === 'error'
                        ? 'bg-red-500/15 text-red-300'
                        : syncStatus.state === 'offline'
                          ? 'bg-white/10 text-white/50'
                          : 'bg-emerald-500/15 text-emerald-300'
                }`}
              >
                {!syncAccount
                  ? t('d1SetupShort', language)
                  : syncingNow || syncStatus.state === 'syncing'
                    ? t('d1StateSyncing', language)
                    : syncStatus.state === 'error'
                      ? t('d1StateError', language)
                      : syncStatus.state === 'offline'
                        ? t('d1StateOffline', language)
                        : t('d1StateSynced', language)}
              </span>
              <RefreshCw
                size={14}
                className={`text-white/40 ${syncingNow || syncStatus.state === 'syncing' ? 'animate-spin' : ''}`}
              />
            </div>
          </button>

          {/* Connected: encryption note + disconnect (two-tap confirm) */}
          {syncAccount && (
            <div className="glass-card w-full px-4 py-2 flex items-center justify-between">
              <span className="text-[11px] text-white/40 flex items-center gap-1.5 min-w-0">
                <Lock size={11} className="text-emerald-400 shrink-0" />
                <span className="truncate">{t('d1EncNote', language)}</span>
              </span>
              <button
                onClick={handleDisconnect}
                className={`text-[11px] font-semibold px-2 py-1 shrink-0 transition-colors ${
                  confirmDisconnect
                    ? 'text-red-300 bg-red-500/15 rounded-lg'
                    : 'text-red-400/80 hover:text-red-300'
                }`}
              >
                {confirmDisconnect ? t('d1DisconnectConfirm', language) : t('d1Disconnect', language)}
              </button>
            </div>
          )}

          {/* Report Download */}
          <button
            onClick={() => navigateTo('reports')}
            className="glass-card w-full p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <FileText size={18} className="text-emerald-400" />
              <span className="text-sm">{t('reportDownload', language)}</span>
            </div>
          </button>

          {/* Divider */}
          <div className="pt-2">
            <p className="text-xs text-white/40 mb-2">{t('backupRestore', language)}</p>
          </div>

          {/* Backup */}
          <button
            onClick={handleBackup}
            className="glass-card w-full p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <Download size={18} className="text-green-400" />
              <span className="text-sm">{t('backup', language)}</span>
            </div>
          </button>

          {/* Restore */}
          <button
            onClick={handleRestore}
            className="glass-card w-full p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <Upload size={18} className="text-emerald-400" />
              <span className="text-sm">{t('restore', language)}</span>
            </div>
          </button>

          {/* Hidden file input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".json"
            className="hidden"
          />

          {/* CSV data export — products & bills open in Excel/Sheets */}
          <div className="pt-2">
            <p className="text-xs text-white/40 mb-2">{t('exportCsvTitle', language)}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleExportCsv('products')}
              className="glass-card p-4 flex flex-col items-center gap-2"
            >
              <FileSpreadsheet size={18} className="text-emerald-400" />
              <span className="text-xs font-medium">{t('productsCsv', language)}</span>
            </button>
            <button
              onClick={() => handleExportCsv('bills')}
              className="glass-card p-4 flex flex-col items-center gap-2"
            >
              <FileSpreadsheet size={18} className="text-amber-300" />
              <span className="text-xs font-medium">{t('billsCsv', language)}</span>
            </button>
          </div>
          <p className="text-[10px] text-white/30 px-1 -mt-1">{t('exportCsvDesc', language)}</p>

          {/* Reset All Data */}
          <button
            onClick={() => setShowResetDialog(true)}
            className="glass-card w-full p-4 flex items-center justify-between border-red-500/20"
          >
            <div className="flex items-center gap-3">
              <Trash2 size={18} className="text-red-400" />
              <span className="text-sm text-red-400">{t('resetAllData', language)}</span>
            </div>
          </button>
        </motion.div>
      </div>

      {/* Edit Name Dialog */}
      {showEditDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass-card-strong p-6 mx-4 max-w-sm w-full"
          >
            <h3 className="text-lg font-bold mb-4">{t('changeName', language)}</h3>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="glass-input w-full px-4 py-3 text-sm mb-4"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowEditDialog(false)}
                className="flex-1 neon-btn py-2 text-sm font-semibold"
              >
                {t('cancel', language)}
              </button>
              <button
                onClick={handleUpdateName}
                disabled={loading || !editName.trim()}
                className="flex-1 neon-btn-solid py-2 text-sm font-semibold disabled:opacity-50"
              >
                {t('save', language)}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Reset confirmation dialog */}
      {showResetDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass-card-strong p-6 mx-4 max-w-sm w-full"
          >
            <h3 className="text-lg font-bold mb-2 text-red-400">{t('resetAllData', language)}</h3>
            <p className="text-sm text-white/60 mb-5">{t('thisActionCannot', language)}</p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowResetDialog(false)}
                className="flex-1 neon-btn py-2 text-sm font-semibold"
              >
                {t('cancel', language)}
              </button>
              <button
                onClick={handleResetAll}
                disabled={loading}
                className="flex-1 py-2 text-sm font-semibold rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
              >
                {t('delete', language)}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Restore-from-file confirmation dialog */}
      {showRestoreDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass-card-strong p-6 mx-4 max-w-sm w-full"
          >
            <h3 className="text-lg font-bold mb-2 text-amber-300">{t('restore', language)}</h3>
            <p className="text-sm text-white/60 mb-5">{t('thisActionCannot', language)}</p>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowRestoreDialog(false); setPendingRestore(null); }}
                className="flex-1 neon-btn py-2 text-sm font-semibold"
              >
                {t('cancel', language)}
              </button>
              <button
                onClick={handleConfirmRestore}
                disabled={loading}
                className="flex-1 py-2 text-sm font-semibold rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
              >
                {t('restore', language)}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Cloud Sync setup dialog (create new sync / join another device) */}
      {showSyncDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass-card-strong p-6 max-w-sm w-full max-h-[88vh] overflow-y-auto"
          >
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <CloudUpload size={18} className="text-sky-300" />
              {t('d1SetupTitle', language)}
            </h3>

            {/* Tabs */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => {
                  setSyncTab('create');
                  setSyncIdInput((prev) => prev || generateSyncId());
                }}
                className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-colors ${
                  syncTab === 'create'
                    ? 'bg-sky-500/20 border border-sky-400/40 text-sky-300'
                    : 'bg-white/5 border border-white/10 text-white/50'
                }`}
              >
                {t('d1CreateTab', language)}
              </button>
              <button
                onClick={() => setSyncTab('join')}
                className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-colors ${
                  syncTab === 'join'
                    ? 'bg-emerald-500/20 border border-emerald-400/40 text-emerald-300'
                    : 'bg-white/5 border border-white/10 text-white/50'
                }`}
              >
                {t('d1JoinTab', language)}
              </button>
            </div>

            {/* Sync ID */}
            <label className="text-[11px] text-white/50 block mb-1.5">{t('d1IdLabel', language)}</label>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={syncIdInput}
                onChange={(e) => setSyncIdInput(e.target.value)}
                placeholder="PS-XXXX-XXXX"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                className="glass-input flex-1 px-3 py-2.5 text-sm font-mono tracking-wider uppercase"
              />
              {syncTab === 'create' && (
                <button
                  onClick={() => setSyncIdInput(generateSyncId())}
                  title={t('d1Generate', language)}
                  className="glass-card px-3 flex items-center justify-center text-white/60 hover:text-white"
                >
                  <Repeat2 size={16} />
                </button>
              )}
            </div>

            {/* PIN */}
            <label className="text-[11px] text-white/50 block mb-1.5">{t('d1PinLabel', language)}</label>
            <input
              type="password"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              autoComplete="new-password"
              className="glass-input w-full px-3 py-2.5 text-sm mb-2"
            />
            {syncTab === 'create' && (
              <>
                <label className="text-[11px] text-white/50 block mb-1.5">{t('d1PinConfirm', language)}</label>
                <input
                  type="password"
                  value={pinConfirm}
                  onChange={(e) => setPinConfirm(e.target.value)}
                  autoComplete="new-password"
                  className="glass-input w-full px-3 py-2.5 text-sm mb-2"
                />
              </>
            )}
            <p className="text-[10px] text-white/35 flex items-start gap-1.5 mt-2 mb-4">
              <Lock size={11} className="mt-0.5 shrink-0 text-emerald-400/70" />
              {syncTab === 'create' ? t('d1PinHint', language) : t('d1JoinHint', language)}
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowSyncDialog(false)}
                className="flex-1 neon-btn py-2 text-sm font-semibold"
              >
                {t('cancel', language)}
              </button>
              <button
                onClick={handleConnect}
                disabled={connecting || !syncIdInput.trim() || pinInput.length < 6 || (syncTab === 'create' && pinConfirm.length < 6)}
                className="flex-1 neon-btn-solid py-2 text-sm font-semibold disabled:opacity-50"
              >
                {connecting
                  ? '…'
                  : syncTab === 'create'
                    ? t('d1CreateBtn', language)
                    : t('d1JoinBtn', language)}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
