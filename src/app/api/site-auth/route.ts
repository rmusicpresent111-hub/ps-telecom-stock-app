/**
 * Site-gate auth endpoint — 5-minute sliding session (v2.24.1).
 *
 * POST { pin }  → verifies the shop password and sets the httpOnly gate
 *                 cookie (valid 5 MINUTES) — see src/proxy.ts for the gate.
 * GET           → tells the client-side gate whether this browser already
 *                 carries a valid cookie; a VALID cookie is also re-issued
 *                 (sliding renewal) so active use never expires mid-work.
 *
 * Cookie value = `${sha256(PIN|salt)}.${issuedAtMs}` — the raw PIN is never
 * stored, and the embedded timestamp makes a stolen/replayed cookie fail
 * 5 minutes after its last renewal. There is no reset path by design.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';

const GATE_COOKIE = 'ps_site_gate';
const GATE_SALT = 'ps-site-gate-v1';
/** Session length — "5 minite por auto lock" (owner request, v2.24.1). */
const GATE_MAX_AGE_S = 5 * 60;

function lockPin(): string {
  return (
    process.env.SITE_LOCK_PIN ||
    process.env.NEXT_PUBLIC_SYNC_PIN ||
    '9732881732'
  ).trim();
}

function gateKey(): string {
  return createHash('sha256').update(`${lockPin()}|${GATE_SALT}`).digest('hex');
}

function gateCookieOptions(https: boolean) {
  return {
    httpOnly: true,
    sameSite: https ? ('none' as const) : ('lax' as const),
    secure: https,
    maxAge: GATE_MAX_AGE_S,
    path: '/',
  };
}

function issueCookie(https: boolean) {
  return `${gateKey()}.${Date.now()}`;
}

/** Valid = right key AND younger than the 5-minute session window. */
function hasValidGate(req: NextRequest): boolean {
  const value = req.cookies.get(GATE_COOKIE)?.value;
  if (!value) return false;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return false;
  if (value.slice(0, dot) !== gateKey()) return false;
  const issuedAt = Number(value.slice(dot + 1));
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return false;
  return Date.now() - issuedAt < GATE_MAX_AGE_S * 1000;
}

export async function GET(req: NextRequest) {
  const ok = hasValidGate(req);
  const res = NextResponse.json({ ok });
  if (ok) {
    // sliding renewal — the client gate probes this on every page load
    const https = (req.headers.get('x-forwarded-proto') || '').includes('https');
    res.cookies.set(GATE_COOKIE, issueCookie(https), gateCookieOptions(https));
  }
  return res;
}

export async function POST(req: NextRequest) {
  let pin = '';
  try {
    const body = (await req.json()) as { pin?: unknown };
    pin = String(body?.pin ?? '');
  } catch {
    /* malformed body → wrong pin below */
  }

  if (pin.trim() !== lockPin()) {
    return NextResponse.json({ ok: false, error: 'wrong' }, { status: 401 });
  }

  // https deployments (incl. cross-site preview iframes) need SameSite=None;
  // plain http (local dev) keeps SameSite=Lax without the Secure flag.
  const https = (req.headers.get('x-forwarded-proto') || '').includes('https');

  const res = NextResponse.json({ ok: true });
  res.cookies.set(GATE_COOKIE, issueCookie(https), gateCookieOptions(https));
  return res;
}
