'use client';

/**
 * Admin PIN gate — full-screen security lock for the /admin console.
 *
 * Renders INSTEAD of the whole AdminShell until the correct security PIN is
 * entered, so no shop data (not even section components) ever mounts on a
 * locked device. The PIN lives in BillingSettings (D1-synced); the factory
 * default is DEFAULT_ADMIN_PIN. A successful unlock sets a localStorage flag
 * so the owner's own device stays open until they press "Lock panel".
 *
 * NOTE (Task 47 lesson): LockScreen lives at MODULE scope — a component
 * defined inside a render body would remount (and lose input focus) every
 * time the theme/store state changes.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { getBillingSettingsOffline } from '@/lib/offline-service';
import { DEFAULT_USER_ID } from '@/lib/local-auth';
import { adminPanelUnlocked, resolveAdminPin, setAdminPanelUnlocked } from '@/lib/admin-pin';
import { useAdminStore } from '@/store/adminStore';
import { ta, taf } from '@/lib/admin-i18n';
import { Btn } from './admin-ui';

const MAX_TRIES = 3; // consecutive wrong attempts before a cooldown
const COOLDOWN_MS = 30_000;

/** Clear the "unlocked on this device" flag (Lock button in the sidebar). */
export function lockAdminPanel(): void {
  setAdminPanelUnlocked(false);
}

function LangMini() {
  const lang = useAdminStore((s) => s.language);
  const setLanguage = useAdminStore((s) => s.setLanguage);
  const opts: { v: 'bn' | 'en' | 'hi'; label: string }[] = [
    { v: 'bn', label: 'বাং' },
    { v: 'en', label: 'EN' },
    { v: 'hi', label: 'हिं' },
  ];
  return (
    <div className="inline-flex bg-[var(--psa-card)] border border-[var(--psa-border)] rounded-full overflow-hidden">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => setLanguage(o.v)}
          className={`px-2.5 py-1 text-[11px] font-bold transition-colors ${
            lang === o.v ? 'bg-[var(--psa-soft-orange)] text-[#E8552C]' : 'text-[var(--psa-muted)] hover:bg-[var(--psa-hover)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const lang = useAdminStore((s) => s.language);
  const theme = useAdminStore((s) => s.theme);
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const triesRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // cooldown countdown
  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const id = window.setInterval(() => {
      setCooldownLeft((s) => (s <= 1 ? (window.clearInterval(id), 0) : s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldownLeft]);

  // focus the input once mounted (and again when the cooldown ends)
  useEffect(() => {
    if (cooldownLeft === 0) inputRef.current?.focus();
  }, [cooldownLeft]);

  const submit = async () => {
    if (busy || cooldownLeft > 0) return;
    const pin = value.trim();
    if (!pin) return;
    setBusy(true);
    setError('');
    try {
      let effective = resolveAdminPin(null); // offline / settings missing → factory default
      try {
        const s = await getBillingSettingsOffline(DEFAULT_USER_ID);
        effective = resolveAdminPin(s.adminPin);
      } catch {
        /* private mode — factory default */
      }
      if (pin === effective) {
        triesRef.current = 0;
        setAdminPanelUnlocked(true);
        onUnlock();
        return;
      }
      triesRef.current += 1;
      if (triesRef.current >= MAX_TRIES) {
        triesRef.current = 0;
        setCooldownLeft(COOLDOWN_MS / 1000);
        setError('');
      } else {
        setError(ta('lock.wrong', lang));
      }
      setValue('');
    } finally {
      setBusy(false);
    }
  };

  const locked = cooldownLeft > 0;

  return (
    <div
      className={`psadmin ${theme === 'dark' ? 'admin-dark' : ''} min-h-screen bg-[var(--psa-canvas)] text-[var(--psa-ink)] flex flex-col items-center justify-center px-4 relative`}
    >
      <div className="absolute top-4 right-4">
        <LangMini />
      </div>

      <div className="w-full max-w-sm bg-[var(--psa-card)] border border-[var(--psa-border)] rounded-2xl shadow-[0_10px_30px_rgba(15,23,42,0.08)] p-6">
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#FA6E41] to-[#E8552C] text-white flex items-center justify-center font-black text-base shadow-[0_4px_10px_rgba(250,110,65,0.35)]">
            PS
          </div>
          <div>
            <p className="text-[17px] font-black tracking-tight">PS TELECOM</p>
            <p className="text-[12px] font-semibold text-[#FA6E41]">{ta('shell.title', lang)}</p>
          </div>
          <div className="w-11 h-11 rounded-full bg-[var(--psa-soft-orange)] text-[#E8552C] flex items-center justify-center">
            <Lock size={20} />
          </div>
          <p className="text-[13px] font-semibold text-[var(--psa-sub)]">{ta('lock.subtitle', lang)}</p>
        </div>

        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--psa-faint)]">{ta('lock.pin', lang)}</span>
            <div className="relative mt-1">
              <input
                ref={inputRef}
                type={show ? 'text' : 'password'}
                inputMode="numeric"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={locked || busy}
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 12))}
                placeholder="••••••••"
                aria-label={ta('lock.pin', lang)}
                aria-invalid={!!error}
                className="w-full h-12 rounded-xl border border-[var(--psa-border)] bg-[var(--psa-canvas)] px-4 pr-11 text-lg font-bold tracking-[0.35em] text-center outline-none focus:border-[#FA6E41]/60 focus:ring-2 focus:ring-[#FA6E41]/20 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? ta('lock.hide', lang) : ta('lock.show', lang)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center text-[var(--psa-muted)] hover:bg-[var(--psa-hover2)]"
              >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          {locked ? (
            <p role="alert" className="text-[12px] font-semibold text-[#DC2626] text-center">
              {taf('lock.tryIn', lang, { s: cooldownLeft })}
            </p>
          ) : error ? (
            <p role="alert" className="text-[12px] font-semibold text-[#DC2626] text-center">
              {error}
            </p>
          ) : null}

          <Btn type="submit" disabled={locked || busy || !value.trim()} className="w-full !h-11 justify-center">
            <ShieldCheck size={17} />
            {busy ? ta('lock.unlocking', lang) : ta('lock.unlock', lang)}
          </Btn>
        </form>

        <p className="mt-4 text-[11px] leading-relaxed text-[var(--psa-faint)] text-center">{ta('lock.hint', lang)}</p>
      </div>
    </div>
  );
}

type GateState = 'checking' | 'locked' | 'open';

/**
 * The localStorage flag never changes mid-session (unlock = in-place open,
 * re-lock = full reload), so a no-op subscription is enough. Server snapshot
 * keeps the prerendered HTML ('checking' splash) hydration-safe, while the
 * client immediately re-renders with the real stored value.
 */
const subscribeGate = () => () => {};
const gateSnapshot = (): GateState => (adminPanelUnlocked() ? 'open' : 'locked');
const gateServerSnapshot = (): GateState => 'checking';

/**
 * Hydration-safe gate holder: renders a quiet splash until the client knows
 * whether this device is already unlocked, then either the lock screen or
 * the console itself.
 */
export default function AdminPinGate({ children }: { children: React.ReactNode }) {
  const stored = useSyncExternalStore(subscribeGate, gateSnapshot, gateServerSnapshot);
  const [justUnlocked, setJustUnlocked] = useState(false);

  const state: GateState = justUnlocked || stored === 'open' ? 'open' : stored;

  if (state === 'open') return <>{children}</>;
  if (state === 'locked') return <LockScreen onUnlock={() => setJustUnlocked(true)} />;

  // checking — minimal splash (no admin content, no localStorage flash)
  return (
    <div className="psadmin min-h-screen bg-[var(--psa-canvas)] flex items-center justify-center">
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#FA6E41] to-[#E8552C] text-white flex items-center justify-center font-black text-sm shadow-[0_4px_10px_rgba(250,110,65,0.35)]">
        PS
      </div>
    </div>
  );
}
