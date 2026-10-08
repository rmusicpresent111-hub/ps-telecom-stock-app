'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import {
  getD1Credentials,
  saveD1Credentials,
  clearD1Credentials,
  getD1LastBackup,
  testD1Connection,
  backupToD1,
  restoreFromD1,
  type CloudMeta,
  type CloudCounts,
  type BackupProgress,
} from '@/lib/cloud-d1';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Cloud,
  CloudUpload,
  CloudDownload,
  KeyRound,
  Database,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  ChevronDown,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';

type ConnState = 'idle' | 'testing' | 'connected' | 'error';

export default function CloudSyncScreen() {
  const user = useAppStore(s => s.user);
  const language = useAppStore(s => s.language);
  const goBack = useAppStore(s => s.goBack);
  const navigateToTab = useAppStore(s => s.navigateToTab);

  const [accountId, setAccountId] = useState('');
  const [databaseId, setDatabaseId] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  const [conn, setConn] = useState<ConnState>('idle');
  const [connError, setConnError] = useState('');
  const [cloudMeta, setCloudMeta] = useState<CloudMeta | null>(null);

  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);

  // Load saved credentials on mount + auto-verify connection in background
  useEffect(() => {
    const saved = getD1Credentials();
    if (!saved) return;
    setAccountId(saved.accountId);
    setDatabaseId(saved.databaseId);
    setApiToken(saved.apiToken);
    let cancelled = false;
    setConn('testing');
    testD1Connection(saved)
      .then(res => {
        if (cancelled) return;
        if (res.ok) {
          setConn('connected');
          setCloudMeta(res.meta ?? null);
        } else {
          setConn('error');
          setConnError(res.error || '');
        }
      })
      .catch(() => {
        if (!cancelled) setConn('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentCreds = () => ({
    accountId: accountId.trim(),
    databaseId: databaseId.trim(),
    apiToken: apiToken.trim(),
  });

  const handleTest = useCallback(async () => {
    const creds = currentCreds();
    if (!creds.accountId || !creds.databaseId || !creds.apiToken) {
      toast.error(t('fillAllFields', language));
      return;
    }
    setConn('testing');
    setConnError('');
    try {
      saveD1Credentials(creds);
      const res = await testD1Connection(creds);
      if (res.ok) {
        setConn('connected');
        setCloudMeta(res.meta ?? null);
        toast.success(t('connectionOk', language));
      } else {
        setConn('error');
        setConnError(res.error || t('connectionFailed', language));
        toast.error(t('connectionFailed', language) + ': ' + (res.error || ''));
      }
    } catch (e) {
      setConn('error');
      setConnError((e as Error).message);
      toast.error(t('connectionFailed', language));
    }
  }, [accountId, databaseId, apiToken, language]);

  const handleBackup = useCallback(async () => {
    if (!user?.id) return;
    const creds = currentCreds();
    if (!creds.accountId || !creds.databaseId || !creds.apiToken) {
      toast.error(t('fillAllFields', language));
      return;
    }
    setBusy('backup');
    setProgress(null);
    try {
      saveD1Credentials(creds);
      const res = await backupToD1(user.id, creds, {
        userEmail: user.email || '',
        shopName: user.shopName || '',
        onProgress: p => setProgress(p),
      });
      if (res.ok) {
        const c: CloudCounts | undefined = res.counts;
        const summary = c
          ? ` (${c.categories}+${c.products}+${c.transactions}+${c.expenses}+${c.cashEntries}+${c.serviceTransactions}+${c.bills})`
          : '';
        toast.success(t('cloudBackupDone', language) + summary);
        setCloudMeta({
          backedUpAt: new Date().toISOString(),
          userEmail: user.email || '',
          shopName: user.shopName || '',
          totalRows: c
            ? c.categories + c.products + c.transactions + c.expenses + c.cashEntries + c.serviceTransactions + c.bills
            : 0,
        });
        setConn('connected');
      } else {
        toast.error(t('connectionFailed', language) + ': ' + (res.error || ''));
      }
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, [user, accountId, databaseId, apiToken, language]);

  const doRestore = useCallback(async () => {
    if (!user?.id) return;
    const creds = currentCreds();
    if (!creds.accountId || !creds.databaseId || !creds.apiToken) {
      toast.error(t('fillAllFields', language));
      return;
    }
    setShowRestoreDialog(false);
    setBusy('restore');
    try {
      saveD1Credentials(creds);
      const res = await restoreFromD1(user.id, creds);
      if (res.ok) {
        toast.success(t('cloudRestoreDone', language));
        setTimeout(() => navigateToTab('dashboard'), 900);
      } else {
        toast.error(
          res.empty
            ? t('cloudDbEmpty', language)
            : t('connectionFailed', language) + ': ' + (res.error || '')
        );
      }
    } finally {
      setBusy(null);
    }
  }, [user, accountId, databaseId, apiToken, language, navigateToTab]);

  const handleDisconnect = () => {
    clearD1Credentials();
    setAccountId('');
    setDatabaseId('');
    setApiToken('');
    setConn('idle');
    setCloudMeta(null);
    setConnError('');
  };

  const lastBackup = user?.id ? getD1LastBackup(user.id) : 0;
  const fmtDate = (ts: number | string) => {
    const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString(language === 'bn' ? 'bn-IN' : language === 'hi' ? 'hi-IN' : 'en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const progressPct =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const working = busy !== null || conn === 'testing';

  const steps = [
    t('setupStep1', language),
    t('setupStep2', language),
    t('setupStep3', language),
    t('setupStep4', language),
    t('setupStep5', language),
  ];

  return (
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={goBack}
            className="glass-card p-2.5 rounded-xl active:scale-95 transition-transform"
            aria-label="Back"
          >
            <ArrowLeft size={18} className="text-emerald-400" />
          </button>
          <div className="flex items-center gap-2">
            <Cloud size={22} className="text-emerald-400" />
            <h1 className="text-lg font-bold neon-glow">{t('cloudSync', language)}</h1>
          </div>
        </div>

        {/* Status card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card-strong p-4 mb-4"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-white/50 uppercase tracking-wide">
              Cloudflare D1
            </span>
            {conn === 'connected' ? (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold">
                <CheckCircle2 size={14} />
                {t('cloudStatusConnected', language)}
              </span>
            ) : conn === 'error' ? (
              <span className="flex items-center gap-1.5 text-xs text-red-400 font-semibold">
                <XCircle size={14} />
                {t('cloudStatusNotConnected', language)}
              </span>
            ) : conn === 'testing' ? (
              <span className="flex items-center gap-1.5 text-xs text-white/50">
                <Loader2 size={14} className="animate-spin" />
                {t('connecting', language)}
              </span>
            ) : (
              <span className="text-xs text-white/40">{t('cloudStatusNotConnected', language)}</span>
            )}
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-white/50">{t('lastCloudBackup', language)}</span>
            <span className="text-white/80">
              {lastBackup ? fmtDate(lastBackup) : t('never', language)}
            </span>
          </div>

          {cloudMeta && (
            <div className="mt-2 pt-2 border-t border-white/10 text-xs text-white/50 space-y-1">
              {cloudMeta.userEmail && (
                <div className="flex justify-between">
                  <span>Account</span>
                  <span className="text-white/80 truncate max-w-[180px]">{cloudMeta.userEmail}</span>
                </div>
              )}
              {cloudMeta.backedUpAt && (
                <div className="flex justify-between">
                  <span>{t('lastCloudBackup', language)}</span>
                  <span className="text-white/80">{fmtDate(cloudMeta.backedUpAt)}</span>
                </div>
              )}
              {cloudMeta.totalRows > 0 && (
                <div className="flex justify-between">
                  <span>Rows</span>
                  <span className="text-white/80">{cloudMeta.totalRows}</span>
                </div>
              )}
            </div>
          )}

          {conn === 'error' && connError && (
            <p className="mt-2 text-[11px] text-red-400/90 break-words bg-red-500/10 rounded-lg p-2">
              {connError}
            </p>
          )}
        </motion.div>

        {/* Credentials card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-card p-4 mb-4 space-y-3"
        >
          <div className="flex items-center gap-2 mb-1">
            <KeyRound size={15} className="text-emerald-400" />
            <span className="text-xs font-semibold text-white/70">Cloudflare Credentials</span>
          </div>

          <div>
            <label className="text-[10px] text-white/40 mb-1 block">{t('accountId', language)}</label>
            <input
              type="text"
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
              placeholder="e.g. 0123456789abcdef0123456789abcdef"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="glass-input w-full px-3 py-2.5 text-xs"
            />
          </div>

          <div>
            <label className="text-[10px] text-white/40 mb-1 block">{t('databaseId', language)}</label>
            <input
              type="text"
              value={databaseId}
              onChange={e => setDatabaseId(e.target.value)}
              placeholder="e.g. 8f1e...-xxxx-xxxx-xxxx"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="glass-input w-full px-3 py-2.5 text-xs"
            />
          </div>

          <div>
            <label className="text-[10px] text-white/40 mb-1 block">{t('apiToken', language)}</label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={apiToken}
                onChange={e => setApiToken(e.target.value)}
                placeholder="••••••••••••••••••••"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="glass-input w-full px-3 py-2.5 pr-10 text-xs"
              />
              <button
                type="button"
                onClick={() => setShowToken(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-white/40 hover:text-white/70"
                aria-label={showToken ? 'Hide token' : 'Show token'}
              >
                {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {/* Save & Test */}
          <button
            onClick={handleTest}
            disabled={conn === 'testing' || busy !== null}
            className="neon-btn-solid w-full py-3 text-sm font-semibold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {conn === 'testing' ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                {t('connecting', language)}
              </>
            ) : (
              <>
                <ShieldCheck size={15} />
                {t('saveTestConnection', language)}
              </>
            )}
          </button>
        </motion.div>

        {/* Actions */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-3 mb-4"
        >
          {/* Backup */}
          <button
            onClick={handleBackup}
            disabled={working || conn !== 'connected'}
            className="w-full p-4 rounded-2xl bg-gradient-to-r from-emerald-600/80 to-emerald-500/80 border border-emerald-400/40 flex items-center justify-between disabled:opacity-40 active:scale-[0.98] transition-all"
          >
            <div className="flex items-center gap-3">
              {busy === 'backup' ? (
                <Loader2 size={20} className="text-white animate-spin" />
              ) : (
                <CloudUpload size={20} className="text-white" />
              )}
              <div className="text-left">
                <span className="text-sm font-semibold text-white block">
                  {busy === 'backup' ? t('backingUp', language) : t('backupToCloud', language)}
                </span>
                {busy === 'backup' && progress && (
                  <span className="text-[10px] text-white/70">
                    {progress.done}/{progress.total}
                  </span>
                )}
              </div>
            </div>
            <Database size={16} className="text-white/60" />
          </button>
          {busy === 'backup' && progress && (
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-emerald-400 rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}

          {/* Restore */}
          <button
            onClick={() => setShowRestoreDialog(true)}
            disabled={working || conn !== 'connected'}
            className="glass-card w-full p-4 flex items-center justify-between disabled:opacity-40 active:scale-[0.98] transition-all"
          >
            <div className="flex items-center gap-3">
              {busy === 'restore' ? (
                <Loader2 size={20} className="text-amber-300 animate-spin" />
              ) : (
                <CloudDownload size={20} className="text-amber-300" />
              )}
              <span className="text-sm font-semibold">
                {busy === 'restore' ? t('restoring', language) : t('restoreFromCloud', language)}
              </span>
            </div>
          </button>
        </motion.div>

        {/* Info */}
        <div className="glass-card p-3 mb-4 flex items-start gap-2">
          <ShieldCheck size={14} className="text-emerald-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-white/50 leading-relaxed">{t('cloudInfo', language)}</p>
        </div>

        {/* Setup guide */}
        <button
          onClick={() => setShowGuide(v => !v)}
          className="glass-card w-full p-4 flex items-center justify-between mb-2"
        >
          <span className="text-sm font-semibold">{t('setupGuide', language)}</span>
          <ChevronDown
            size={16}
            className={`text-white/40 transition-transform ${showGuide ? 'rotate-180' : ''}`}
          />
        </button>
        {showGuide && (
          <motion.ol
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="glass-card p-4 space-y-2.5 mb-4 overflow-hidden"
          >
            {steps.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-xs text-white/70 leading-relaxed">
                <span className="w-5 h-5 shrink-0 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-bold">
                  {i + 1}
                </span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </motion.ol>
        )}

        {/* Disconnect */}
        {(accountId || databaseId || apiToken) && (
          <button
            onClick={handleDisconnect}
            disabled={working}
            className="w-full py-2.5 text-xs text-red-400/80 hover:text-red-400 disabled:opacity-40"
          >
            {t('clearCredentials', language)}
          </button>
        )}
      </div>

      {/* Restore confirmation dialog */}
      {showRestoreDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass-card-strong p-6 mx-4 max-w-sm w-full"
          >
            <h3 className="text-lg font-bold mb-2 text-amber-300">
              {t('cloudRestoreTitle', language)}
            </h3>
            <p className="text-sm text-white/60 mb-6">{t('cloudRestoreDesc', language)}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowRestoreDialog(false)}
                className="flex-1 neon-btn py-2 text-sm font-semibold"
              >
                {t('cancel', language)}
              </button>
              <button
                onClick={doRestore}
                className="flex-1 py-2 text-sm font-semibold rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30 transition-colors"
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
