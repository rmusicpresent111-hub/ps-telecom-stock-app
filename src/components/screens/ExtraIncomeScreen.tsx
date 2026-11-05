'use client';

/**
 * ExtraIncomeScreen (v2.38.0) — record one-off income sources (recharge
 * commission, scrap sale, old-device resale…). Every entry's amount is added
 * DIRECTLY to the displayed profit (dashboard Today's Profit + Profit tab)
 * by getDashboardOffline / ProfitScreen — see offline-service.ts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import {
  ArrowLeft, Plus, TrendingUp, IndianRupee, Trash2, CalendarDays, Loader2, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getExtraIncomeOffline,
  createExtraIncomeOffline,
  deleteExtraIncomeOffline,
  localDateStr,
} from '@/lib/offline-service';
import { registerBackModal } from '@/lib/modal-back';
import { ExtraIncome } from '@/lib/types';

function fmtMoney(v: number): string {
  return '₹' + (v || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtDay(dateStr: string, language: string): string {
  const [y, m, d] = (dateStr || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const locale = language === 'bn' ? 'bn-BD' : language === 'hi' ? 'hi-IN' : 'en-IN';
  try {
    return dt.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export default function ExtraIncomeScreen() {
  const { user, language, goBack } = useAppStore();

  const [entries, setEntries] = useState<ExtraIncome[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // form state
  const [source, setSource] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(localDateStr());
  const [note, setNote] = useState('');

  // two-tap delete confirm (hardware back closes the dialog first)
  const [confirmDelete, setConfirmDelete] = useState<ExtraIncome | null>(null);
  useEffect(() => {
    if (!confirmDelete) return;
    return registerBackModal(() => setConfirmDelete(null));
  }, [confirmDelete]);

  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      setEntries(await getExtraIncomeOffline(user.id));
    } catch {
      toast.error(t('error', language));
    } finally {
      setLoading(false);
    }
  }, [user?.id, language]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const today = localDateStr();
  const todayTotal = useMemo(
    () => entries.filter(e => (e.date || '').slice(0, 10) === today).reduce((s, e) => s + (e.amount || 0), 0),
    [entries, today]
  );
  const allTotal = useMemo(() => entries.reduce((s, e) => s + (e.amount || 0), 0), [entries]);

  const handleAdd = async () => {
    if (busy) return;
    const amt = Number(amount);
    if (!source.trim() || !Number.isFinite(amt) || amt <= 0) {
      toast.error(t('eiInvalid', language));
      return;
    }
    try {
      setBusy(true);
      await createExtraIncomeOffline({
        userId: user?.id || '',
        sourceName: source,
        amount: amt,
        date,
        note,
      });
      toast.success(t('eiAdded', language));
      setSource('');
      setAmount('');
      setNote('');
      setDate(localDateStr());
      await fetchData();
    } catch {
      toast.error(t('eiInvalid', language));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteExtraIncomeOffline(confirmDelete.id, user?.id || '');
      toast.success(t('eiDeleted', language));
      setConfirmDelete(null);
      await fetchData();
    } catch {
      toast.error(t('error', language));
    }
  };

  return (
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <button onClick={goBack} className="p-2 rounded-full glass-card" aria-label="Back">
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-bold flex items-center gap-2">
              <TrendingUp size={18} className="text-emerald-400" />
              {t('extraIncome', language)}
            </h1>
            <p className="text-[11px] text-white/40 truncate">{t('extraIncomeDesc', language)}</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="glass-card p-4">
            <p className="text-[10px] text-white/40 flex items-center gap-1.5">
              <CalendarDays size={12} /> {t('eiToday', language)}
            </p>
            <p className="text-xl font-bold text-emerald-400 mt-1">{fmtMoney(todayTotal)}</p>
          </div>
          <div className="glass-card p-4">
            <p className="text-[10px] text-white/40 flex items-center gap-1.5">
              <IndianRupee size={12} /> {t('eiTotal', language)}
            </p>
            <p className="text-xl font-bold text-amber-300 mt-1">{fmtMoney(allTotal)}</p>
          </div>
        </div>

        {/* Add form */}
        <div className="glass-card p-4 mb-4">
          <div className="space-y-3">
            <div>
              <label className="text-[11px] text-white/50 mb-1 block">{t('eiSource', language)}</label>
              <input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder={t('eiSourcePh', language)}
                maxLength={80}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-emerald-400/50"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-white/50 mb-1 block">{t('eiAmount', language)}</label>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  placeholder="0"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-emerald-400/50"
                />
              </div>
              <div>
                <label className="text-[11px] text-white/50 mb-1 block">{t('eiDate', language)}</label>
                <input
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  type="date"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-400/50 [color-scheme:dark]"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] text-white/50 mb-1 block">{t('eiNote', language)}</label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('eiNotePh', language)}
                maxLength={140}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-emerald-400/50"
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={busy}
              className="w-full h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-60"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              {busy ? t('eiAdding', language) : t('eiAdd', language)}
            </button>
            <p className="text-[10px] text-emerald-300/60 flex items-center gap-1.5">
              <Sparkles size={11} /> {t('eiProfitHint', language)}
            </p>
          </div>
        </div>

        {/* History */}
        <div className="glass-card p-4">
          <p className="text-sm font-bold mb-3 flex items-center gap-2">
            <CalendarDays size={15} className="text-emerald-400" />
            {t('eiHistory', language)}
          </p>
          {loading ? (
            <div className="py-8 flex justify-center">
              <Loader2 size={20} className="animate-spin text-white/40" />
            </div>
          ) : entries.length === 0 ? (
            <div className="py-8 text-center">
              <TrendingUp size={26} className="mx-auto text-white/20 mb-2" />
              <p className="text-sm text-white/60">{t('eiEmpty', language)}</p>
              <p className="text-[11px] text-white/35 mt-1">{t('eiEmptyBody', language)}</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto divide-y divide-white/5">
              {entries.map((e) => (
                <motion.div
                  key={e.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-3 py-3"
                >
                  <span className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-emerald-500/15 text-emerald-400">
                    <TrendingUp size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white/90 truncate">{e.sourceName}</p>
                    <p className="text-[11px] text-white/40 truncate">
                      {fmtDay(e.date, language)}
                      {e.note ? ` · ${e.note}` : ''}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-emerald-400 shrink-0">+{fmtMoney(e.amount)}</p>
                  <button
                    onClick={() => setConfirmDelete(e)}
                    className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-red-400/80 hover:bg-red-500/10"
                    aria-label={t('eiDelTitle', language)}
                  >
                    <Trash2 size={15} />
                  </button>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card-strong w-full max-w-xs p-5 text-center"
          >
            <p className="text-sm font-bold text-white/90">{t('eiDelTitle', language)}</p>
            <p className="text-[11px] text-white/50 mt-1">
              {confirmDelete.sourceName} · +{fmtMoney(confirmDelete.amount)}
            </p>
            <p className="text-[11px] text-white/40 mt-0.5">{t('eiDelBody', language)}</p>
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button
                onClick={() => setConfirmDelete(null)}
                className="h-10 rounded-xl border border-white/15 text-sm text-white/70"
              >
                {t('cancel', language)}
              </button>
              <button
                onClick={handleDelete}
                className="h-10 rounded-xl bg-red-500 text-white text-sm font-bold"
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
