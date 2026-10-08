'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import type { Language } from '@/lib/types';
import {
  getD1Credentials,
  saveD1Credentials,
  clearD1Credentials,
  getD1LastBackup,
  testD1Connection,
  backupToD1,
  restoreFromD1,
  type D1Credentials,
  type CloudMeta,
  type CloudCounts,
  type BackupProgress,
} from '@/lib/cloud-d1';
import { registerBackModal } from '@/lib/modal-back';
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
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';

type ConnState = 'idle' | 'testing' | 'connected' | 'error';

// ============ TRANSLATED CLOUD ERRORS ============
// The friendly cloud-error messages are stable constants emitted by our own
// D1 layer (proxy + native mapper), so matching a stable substring lets the UI
// show them in the user's language instead of English. Unknown messages pass
// through untouched.
function cloudErrorKey(msg: string): Parameters<typeof t>[0] | null {
  const m = msg || '';
  if (m.includes('API token is invalid')) return 'errTokenInvalid';
  if (m.includes('Account ID or Database ID is wrong')) return 'errIdsWrong';
  if (m.includes('looks malformed')) return 'errIdsMalformed';
  if (m.includes('rate limit')) return 'errRateLimit';
  if (m.includes('timed out')) return 'errTimeout';
  return null;
}

function cloudErrorMsg(msg: string | undefined, language: Language): string {
  if (!msg) return '';
  const key = cloudErrorKey(msg);
  return key ? t(key, language) : msg;
}

// ============ PASTE-SAFE ID SANITIZING ============
// Shop owners often copy the whole Cloudflare URL (or an ID with a stray
// suffix like "/home") instead of just the ID. These helpers extract the ID
// from any reasonable input, so a wrong paste can never reach the API.

const ACCOUNT_ID_RE = /[0-9a-f]{32}/i;
const DATABASE_ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Extracts a 32-char Cloudflare Account ID from raw input or a full URL. */
export function sanitizeAccountId(raw: string): string {
  const m = raw.match(ACCOUNT_ID_RE);
  return m ? m[0].toLowerCase() : raw.trim();
}

/** Extracts a D1 Database UUID from raw input or the database page URL. */
export function sanitizeDatabaseId(raw: string): string {
  const m = raw.match(DATABASE_ID_RE);
  return m ? m[0].toLowerCase() : raw.trim();
}

export function isValidAccountId(v: string): boolean {
  return ACCOUNT_ID_RE.test(v) && v.length === 32;
}

export function isValidDatabaseId(v: string): boolean {
  const m = v.match(DATABASE_ID_RE);
  return !!m && m[0] === v;
}

export default function CloudSyncScreen() {
  const user = useAppStore(s => s.user);
  const language = useAppStore(s => s.language);
  const goBack = useAppStore(s => s.goBack);
  const navigateToTab = useAppStore(s => s.navigateToTab);

  const [accountId, setAccountId] = useState('');
  const [databaseId, setDatabaseId] = useState('');
  // The real token is NEVER prefilled into the input — only typed anew.
  const [apiToken, setApiToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  // In-memory copy of the stored credentials (token included) for API calls.
  const [savedCreds, setSavedCreds] = useState<D1Credentials | null>(null);

  const [conn, setConn] = useState<ConnState>('idle');
  const [connError, setConnError] = useState('');
  const [cloudMeta, setCloudMeta] = useState<CloudMeta | null>(null);

  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [showEmailMismatchDialog, setShowEmailMismatchDialog] = useState(false);
  const [mismatchEmail, setMismatchEmail] = useState('');

  // Restore success schedules a delayed navigation — keep the id so an
  // unmount can never leave an orphan timer teleporting the next screen.
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (navTimerRef.current) clearTimeout(navTimerRef.current);
    };
  }, []);

  // Hardware/browser back closes the topmost open dialog first
  useEffect(() => {
    if (!showRestoreDialog) return;
    return registerBackModal(() => setShowRestoreDialog(false));
  }, [showRestoreDialog]);

  useEffect(() => {
    if (!showEmailMismatchDialog) return;
    return registerBackModal(() => setShowEmailMismatchDialog(false));
  }, [showEmailMismatchDialog]);

  // Load saved credentials on mount + auto-verify connection in background
  useEffect(() => {
    if (!user?.id) return;
    const saved = getD1Credentials(user.id);
    if (!saved) return;
    // Account/Database IDs prefill normally (sanitized); the token stays hidden.
    setAccountId(sanitizeAccountId(saved.accountId));
    setDatabaseId(sanitizeDatabaseId(saved.databaseId));
    setApiToken('');
    setSavedCreds(saved);
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
  }, [user?.id]);

  /** Typed values (auto-cleaned), falling back to the stored token when the field is untouched. */
  const currentCreds = (): D1Credentials => ({
    accountId: sanitizeAccountId(accountId),
    databaseId: sanitizeDatabaseId(databaseId),
    apiToken: apiToken.trim() || savedCreds?.apiToken || '',
  });

  const accountValid = accountId === '' || isValidAccountId(sanitizeAccountId(accountId));
  const databaseValid = databaseId === '' || isValidDatabaseId(sanitizeDatabaseId(databaseId));

  const handleTest = useCallback(async () => {
    if (!user?.id) return;
    const creds = currentCreds();
    if (!creds.accountId || !creds.databaseId || !creds.apiToken) {
      toast.error(t('fillAllFields', language));
      return;
    }
    if (!isValidAccountId(creds.accountId) || !isValidDatabaseId(creds.databaseId)) {
      toast.error(
        !isValidAccountId(creds.accountId) ? t('invalidAccountIdHint', language) : t('invalidDatabaseIdHint', language)
      );
      return;
    }
    setConn('testing');
    setConnError('');
    try {
      // Nothing is persisted until the connection test actually passes.
      const res = await testD1Connection(creds);
      if (res.ok) {
        saveD1Credentials(creds, user.id);
        setSavedCreds(creds);
        setApiToken(''); // re-mask: the new token is stored now
        setConn('connected');
        setCloudMeta(res.meta ?? null);
        toast.success(t('connectionOk', language));
      } else {
        setConn('error');
        setConnError(res.error || t('connectionFailed', language));
        toast.error(t('connectionFailed', language) + ': ' + cloudErrorMsg(res.error, language));
      }
    } catch (e) {
      setConn('error');
      setConnError((e as Error).message);
      toast.error(t('connectionFailed', language));
    }
  }, [user?.id, accountId, databaseId, apiToken, savedCreds, language]);

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
      const res = await backupToD1(user.id, creds, {
        userEmail: user.email || '',
        shopName: user.shopName || '',
        onProgress: p => setProgress(p),
      });
      if (res.ok) {
        // Persist only after a successful backup.
        saveD1Credentials(creds, user.id);
        setSavedCreds(creds);
        setApiToken('');
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
        toast.error(t('connectionFailed', language) + ': ' + cloudErrorMsg(res.error, language));
      }
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, [user, accountId, databaseId, apiToken, savedCreds, language]);

  const doRestore = useCallback(async (confirmDifferentEmail: boolean) => {
    if (!user?.id) return;
    const creds = currentCreds();
    if (!creds.accountId || !creds.databaseId || !creds.apiToken) {
      toast.error(t('fillAllFields', language));
      return;
    }
    setShowRestoreDialog(false);
    setShowEmailMismatchDialog(false);
    setBusy('restore');
    try {
      const res = await restoreFromD1(user.id, creds, {
        userEmail: user.email || '',
        confirmDifferentEmail,
      });
      if (res.ok) {
        saveD1Credentials(creds, user.id);
        setSavedCreds(creds);
        setApiToken('');
        toast.success(t('cloudRestoreDone', language));
        navTimerRef.current = setTimeout(() => navigateToTab('dashboard'), 900);
      } else if (res.emailMismatch) {
        // The cloud backup belongs to another account — warn loudly and let
        // the user confirm explicitly.
        setMismatchEmail(res.backupEmail || '');
        setShowEmailMismatchDialog(true);
      } else {
        toast.error(
          res.empty
            ? t('cloudDbEmpty', language)
            : t('connectionFailed', language) + ': ' + cloudErrorMsg(res.error, language)
        );
      }
    } finally {
      setBusy(null);
    }
  }, [user, accountId, databaseId, apiToken, savedCreds, language, navigateToTab]);

  const handleDisconnect = () => {
    clearD1Credentials(user?.id);
    setAccountId('');
    setDatabaseId('');
    setApiToken('');
    setSavedCreds(null);
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
  const tokenSaved = savedCreds !== null;
  const maskedToken = tokenSaved
    ? `••••••••${savedCreds.apiToken.slice(-4)}`
    : '••••••••••••••••••••';
  const backupOwnerVisible = !!cloudMeta?.userEmail && !!user?.email &&
    cloudMeta.userEmail.toLowerCase() !== user.email.toLowerCase();

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
                  <span>{t('cloudBackupOwner', language)}</span>
                  <span className={`truncate max-w-[180px] ${backupOwnerVisible ? 'text-amber-300' : 'text-white/80'}`}>
                    {cloudMeta.userEmail}
                  </span>
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
              {backupOwnerVisible && (
                <p className="text-[10px] text-amber-300/90 flex items-start gap-1 pt-1">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  {t('restoreDifferentAccountWarn', language).replace('{email}', cloudMeta.userEmail)}
                </p>
              )}
            </div>
          )}

          {conn === 'error' && connError && (
            <p className="mt-2 text-[11px] text-red-400/90 break-words bg-red-500/10 rounded-lg p-2">
              {cloudErrorMsg(connError, language)}
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
              onChange={e => setAccountId(sanitizeAccountId(e.target.value))}
              placeholder="e.g. 0123456789abcdef0123456789abcdef"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="glass-input w-full px-3 py-2.5 text-xs"
            />
            {!accountValid && (
              <p className="text-[10px] text-red-400/90 mt-1">{t('invalidAccountIdHint', language)}</p>
            )}
          </div>

          <div>
            <label className="text-[10px] text-white/40 mb-1 block">{t('databaseId', language)}</label>
            <input
              type="text"
              value={databaseId}
              onChange={e => setDatabaseId(sanitizeDatabaseId(e.target.value))}
              placeholder="e.g. 8f1e...-xxxx-xxxx-xxxx"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="glass-input w-full px-3 py-2.5 text-xs"
            />
            {!databaseValid && (
              <p className="text-[10px] text-red-400/90 mt-1">{t('invalidDatabaseIdHint', language)}</p>
            )}
          </div>

          <div>
            <label className="text-[10px] text-white/40 mb-1 block">{t('apiToken', language)}</label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={apiToken}
                onChange={e => setApiToken(e.target.value)}
                placeholder={maskedToken}
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
            {tokenSaved && !apiToken && (
              <p className="text-[10px] text-emerald-400/80 mt-1 flex items-center gap-1">
                <CheckCircle2 size={11} />
                {t('tokenSavedHint', language)}
              </p>
            )}
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
        {(accountId || databaseId || apiToken || tokenSaved) && (
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
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
                onClick={() => doRestore(false)}
                className="flex-1 py-2 text-sm font-semibold rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30 transition-colors"
              >
                {t('restore', language)}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Backup-owner mismatch confirmation */}
      {showEmailMismatchDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass-card-strong p-6 mx-4 max-w-sm w-full"
          >
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={20} className="text-amber-300" />
              <h3 className="text-lg font-bold text-amber-300">
                {t('cloudRestoreTitle', language)}
              </h3>
            </div>
            <p className="text-sm text-white/70 mb-6 break-words">
              {t('restoreDifferentAccountWarn', language).replace('{email}', mismatchEmail)}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowEmailMismatchDialog(false)}
                className="flex-1 neon-btn py-2 text-sm font-semibold"
              >
                {t('cancel', language)}
              </button>
              <button
                onClick={() => doRestore(true)}
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
