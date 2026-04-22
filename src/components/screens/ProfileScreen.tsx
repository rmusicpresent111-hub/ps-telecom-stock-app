'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { getProfileOffline, updateProfileOffline, exportBackupOffline, importBackupOffline, resetDataOffline } from '@/lib/offline-service';
import { motion } from 'framer-motion';
import { User, Pencil, Moon, Sun, Globe, FileText, Download, Upload, Trash2, LogOut, Receipt } from 'lucide-react';
import { toast } from 'sonner';

export default function ProfileScreen() {
  const {
    user, language, setLanguage, theme, setTheme,
    setUser, navigateTo, logout: storeLogout,
  } = useAppStore();

  const [editName, setEditName] = useState('');
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchProfile = useCallback(async () => {
    if (!user?.id) return;
    try {
      const data = await getProfileOffline(user.id);
      if (data?.user) {
        setUser(data.user);
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
        setUser(data.user);
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;
    try {
      const text = await file.text();
      const backupData = JSON.parse(text);
      await importBackupOffline(user.id, {
        categories: backupData.categories || [],
        products: backupData.products || [],
        transactions: backupData.transactions || [],
      });
      toast.success(t('restore', language) + ' ✓');
    } catch (error) {
      toast.error((error as Error).message || t('error', language));
    }
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleResetAll = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      await resetDataOffline(user.id);
      toast.success(t('deleted', language));
    } catch (error) {
      toast.error((error as Error).message || t('error', language));
    } finally {
      setLoading(false);
      setShowResetDialog(false);
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
            onClick={() => setShowResetDialog(true)}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass-card-strong p-6 mx-4 max-w-sm w-full"
          >
            <h3 className="text-lg font-bold mb-2 text-red-400">{t('resetAllData', language)}</h3>
            <p className="text-sm text-white/60 mb-6">{t('thisActionCannot', language)}</p>
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
    </div>
  );
}
