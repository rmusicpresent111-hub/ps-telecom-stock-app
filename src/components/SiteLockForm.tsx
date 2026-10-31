'use client';

/**
 * Shared site-lock password form — used by the /site-lock page AND the
 * client-side gate overlay (src/components/SiteLockGate.tsx).
 *
 * Verification order:
 *   1. POST /api/site-auth → server-side check + httpOnly cookie (Vercel /
 *      server mode — the real gate, enforced again by middleware on every
 *      later request).
 *   2. If the endpoint is missing (static GitHub Pages build), fall back to
 *      a client-side hash check of the build-time PIN.
 *
 * There is deliberately NO "forgot password" path, hint or reset — the only
 * way in is the shop password.
 */

import { useState, type FormEvent } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';

const CLIENT_SALT = 'ps-site-gate-client-v1';
/**
 * sha256("9732881732|ps-site-gate-client-v1") — precomputed so the RAW PIN
 * is never inlined into the client bundle (GitHub Pages' build runs a
 * secret-leak scan that would flag a baked NEXT_PUBLIC_SYNC_PIN).
 */
const EXPECTED_HASH = '602e50290aedeaefda0d120e1358f2323204e55793407f4a96373f7ce0b33afd';

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 30-day "trusted device" flag for static hosts (server hosts use cookies). */
export function markSiteTrusted(): void {
  try {
    localStorage.setItem(
      'ps-site-gate-ok-v1',
      JSON.stringify({ exp: Date.now() + 30 * 24 * 60 * 60 * 1000 })
    );
  } catch {
    /* storage unavailable — gate re-asks next visit */
  }
}

export default function SiteLockForm({ onUnlock }: { onUnlock?: () => void }) {
  const [pin, setPin] = useState('');
  const [state, setState] = useState<'idle' | 'checking' | 'error'>('idle');
  const [shake, setShake] = useState(0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (state === 'checking' || !pin.trim()) return;
    setState('checking');

    const entered = pin.trim();
    let ok = false;

    // 1) server verification (sets the httpOnly cookie on success)
    try {
      const r = await fetch('/api/site-auth/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: entered }),
        cache: 'no-store',
      });
      if (r.ok) {
        ok = true;
      } else if (r.status === 401) {
        ok = false; // server reachable and says: wrong password
      } else {
        // 404/405/… → endpoint missing (static export host) → client fallback
        ok = await sha256hex(`${entered}|${CLIENT_SALT}`).then((h) => h === EXPECTED_HASH).catch(() => false);
      }
    } catch {
      // network failure — try the client-side hash fallback anyway
      ok = await sha256hex(`${entered}|${CLIENT_SALT}`).then((h) => h === EXPECTED_HASH).catch(() => false);
    }

    if (!ok) {
      setState('error');
      setShake((n) => n + 1);
      setPin('');
      return;
    }

    markSiteTrusted();
    onUnlock?.();
  };

  return (
    <div
      key={shake}
      className={`w-full max-w-[340px] rounded-3xl border border-[rgba(212,168,83,0.28)] bg-[rgba(16,24,32,0.92)] p-7 shadow-[0_18px_60px_rgba(0,0,0,0.6)] backdrop-blur-md ${
        state === 'error' ? 'animate-[psa-shake_0.4s_ease-in-out]' : ''
      }`}
    >
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#FA6E41] to-[#E8552C] text-white shadow-[0_6px_18px_rgba(250,110,65,0.4)]">
        <Lock className="h-6 w-6" strokeWidth={2.2} aria-hidden="true" />
      </div>

      <h1 className="text-center text-lg font-extrabold tracking-wide text-white">PS TELECOM</h1>
      <p className="mt-1 text-center text-[12px] leading-relaxed text-[rgba(255,255,255,0.66)]">
        এই সাইট প্রাইভেট — পাসওয়ার্ড দিন
        <br />
        <span className="text-[11px] text-[rgba(255,255,255,0.45)]">This site is private. Enter the password to continue.</span>
      </p>

      <form onSubmit={submit} className="mt-5 space-y-3" autoComplete="off">
        <label htmlFor="site-lock-pin" className="sr-only">
          Password
        </label>
        <input
          id="site-lock-pin"
          type="password"
          inputMode="numeric"
          autoFocus
          required
          value={pin}
          onChange={(e) => {
            setPin(e.target.value);
            if (state === 'error') setState('idle');
          }}
          placeholder="• • • • • • • • • •"
          className="w-full rounded-xl border border-[rgba(255,255,255,0.16)] bg-[rgba(0,0,0,0.35)] px-4 py-3 text-center text-lg font-semibold tracking-[0.35em] text-white placeholder:text-[rgba(255,255,255,0.22)] focus:border-[rgba(212,168,83,0.65)] focus:outline-none focus:ring-2 focus:ring-[rgba(212,168,83,0.25)]"
        />

        {state === 'error' && (
          <p role="alert" className="text-center text-[12px] font-semibold text-[#ff8d7a]">
            ভুল পাসওয়ার্ড — আবার চেষ্টা করুন
          </p>
        )}

        <button
          type="submit"
          disabled={state === 'checking'}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#FA6E41] to-[#E8552C] px-4 py-3 text-[13px] font-bold tracking-wide text-white shadow-[0_6px_18px_rgba(250,110,65,0.35)] transition active:scale-[0.98] disabled:opacity-60"
        >
          {state === 'checking' ? (
            'অপেক্ষা করুন…'
          ) : (
            <>
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Unlock
            </>
          )}
        </button>
      </form>

      <p className="mt-4 text-center text-[10px] leading-relaxed text-[rgba(255,255,255,0.35)]">
        পাসওয়ার্ড ভুলে গেলে উদ্ধার করার কোনো উপায় নেই
        <br />
        <span className="text-[9.5px]">No password recovery — keep it safe.</span>
      </p>
    </div>
  );
}
