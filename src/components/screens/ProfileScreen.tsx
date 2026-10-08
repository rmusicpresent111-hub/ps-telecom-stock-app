'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { getProfileOffline, updateProfileOffline, exportBackupOffline, importBackupOffline, resetDataOffline } from '@/lib/offline-service';
import { login } from '@/lib/local-auth';
import { registerBackModal } from '@/lib/modal-back';
import { motion } from 'framer-motion';
import { User, Pencil, Moon, Sun, Globe, FileText, Download, Upload, Trash2, LogOut, Receipt, ReceiptText, CloudUpload, Lock } from 'lucide-react';
import { toast } from 'sonner';
import type { User as UserType, Category } from '@/lib/types';

export default function ProfileScreen() {
  const {
    user, language, setLanguage, theme, setTheme,
    setUser, navigateTo, logout: storeLogout, setCategories,
  } = useAppStore();

  const [editName, setEditName] = useState('');
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Destructive actions require re-entering the account password
  const [resetPassword, setResetPassword] = useState('');
  // Restore-from-file: parsed backup waits here until the password is confirmed
  const [pendingRestore, setPendingRestore] = useState<Record<string, unknown> | null>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);

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

  /**
   * Verifies the typed password against the local account.
   * Returns true when correct; shows a toast (never throws).
   */
  const verifyPassword = async (password: string): Promise<boolean> => {
    if (!user?.email) return false;
    if (!password) {
      toast.error(t('wrongPassword', language));
      return false;
    }
    try {
      await login(user.email, password);
      return true;
    } catch (e) {
      // Brute-force throttle messages stay actionable; everything else is generic
      const msg = (e as Error).message || '';
      toast.error(msg.startsWith('Too many attempts') ? msg : t('wrongPassword', language));
      return false;
    }
  };

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
      a.download = `ps-telecom-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t('backup', language) + ' ✓');
    } catch {
      toast.error(t('error', language));
    }
  };

  const handleRestore = () => {
    fileInputRef.current?.click();
  };

  // File selection only PARSES the backup — the import itself happens after
  // the password confirmation dialog, so nobody can wipe the device by
  // dropping a file in.
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const backupData = JSON.parse(text) as Record<string, unknown>;
      setRestorePassword('');
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
    if (!(await verifyPassword(restorePassword))) return;
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
      setRestorePassword('');
    } catch (error) {
      toast.error((error as Error).message || t('error', language));
    } finally {
      setLoading(false);
    }
  };

  const handleResetAll = async () => {
    if (!user?.id) return;
    // Password re-auth: a wrong password never reaches resetDataOffline
    if (!(await verifyPassword(resetPassword))) return;
    setLoading(true);
    try {
      await resetDataOffline(user.id);
      // Clear the UI-side category cache too, so the dashboard/product screens
      // immediately reflect the empty DB instead of stale rows.
      setCategories([]);
      toast.success(t('deleted', language));
      setShowResetDialog(false);
      setResetPassword('');
    } catch (error) {
      toast.error((error as Error).message || t('error', language));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    storeLogout();
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
          <p className="text-sm text-white/60">{user?.email || ''}</p>
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

          {/* Cloud Backup (Cloudflare D1) */}
          <button
            onClick={() => navigateTo('cloud-sync')}
            className="glass-card w-full p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <CloudUpload size={18} className="text-emerald-300" />
              <div className="text-left">
                <span className="text-sm block">{t('cloudSync', language)}</span>
                <span className="text-[10px] text-white/40">{t('cloudSyncDesc', language)}</span>
              </div>
            </div>
            <span className="text-xs text-white/40">D1</span>
          </button>

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

          {/* Reset All Data */}
          <button
            onClick={() => { setResetPassword(''); setShowResetDialog(true); }}
            className="glass-card w-full p-4 flex items-center justify-between border-red-500/20"
          >
            <div className="flex items-center gap-3">
              <Trash2 size={18} className="text-red-400" />
              <span className="text-sm text-red-400">{t('resetAllData', language)}</span>
            </div>
          </button>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="glass-card w-full p-4 flex items-center justify-center mt-4 border-red-500/20"
          >
            <LogOut size={18} className="text-red-400 mr-2" />
            <span className="text-sm text-red-400 font-semibold">{t('logout', language)}</span>
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

      {/* Reset confirmation dialog — password re-auth required */}
      {showResetDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass-card-strong p-6 mx-4 max-w-sm w-full"
          >
            <h3 className="text-lg font-bold mb-2 text-red-400">{t('resetAllData', language)}</h3>
            <p className="text-sm text-white/60 mb-4">{t('thisActionCannot', language)}</p>

            <div className="mb-5">
              <label className="flex items-center gap-1.5 text-[10px] text-white/40 mb-1 uppercase tracking-wide">
                <Lock size={11} />
                {t('reauthTitle', language)}
              </label>
              <input
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder={t('password', language)}
                autoComplete="current-password"
                className="glass-input w-full px-4 py-3 text-sm"
                autoFocus
              />
              <p className="text-[10px] text-white/40 mt-1">{t('reauthDesc', language)}</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowResetDialog(false)}
                className="flex-1 neon-btn py-2 text-sm font-semibold"
              >
                {t('cancel', language)}
              </button>
              <button
                onClick={handleResetAll}
                disabled={loading || !resetPassword}
                className="flex-1 py-2 text-sm font-semibold rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
              >
                {t('delete', language)}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Restore-from-file confirmation dialog — password re-auth required */}
      {showRestoreDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass-card-strong p-6 mx-4 max-w-sm w-full"
          >
            <h3 className="text-lg font-bold mb-2 text-amber-300">{t('restore', language)}</h3>
            <p className="text-sm text-white/60 mb-4">{t('thisActionCannot', language)}</p>

            <div className="mb-5">
              <label className="flex items-center gap-1.5 text-[10px] text-white/40 mb-1 uppercase tracking-wide">
                <Lock size={11} />
                {t('reauthTitle', language)}
              </label>
              <input
                type="password"
                value={restorePassword}
                onChange={(e) => setRestorePassword(e.target.value)}
                placeholder={t('password', language)}
                autoComplete="current-password"
                className="glass-input w-full px-4 py-3 text-sm"
                autoFocus
              />
              <p className="text-[10px] text-white/40 mt-1">{t('reauthDesc', language)}</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowRestoreDialog(false); setPendingRestore(null); }}
                className="flex-1 neon-btn py-2 text-sm font-semibold"
              >
                {t('cancel', language)}
              </button>
              <button
                onClick={handleConfirmRestore}
                disabled={loading || !restorePassword}
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
