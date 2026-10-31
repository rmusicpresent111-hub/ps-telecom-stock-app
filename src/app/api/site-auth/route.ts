/**
 * Site-gate auth endpoint.
 *
 * POST { pin }  → verifies the shop password and sets the httpOnly gate
 *                 cookie (30 days) — see src/proxy.ts for the gate.
 * GET           → tells the client-side gate whether this browser already
 *                 carries a valid cookie (so it never asks twice).
 *
 * The cookie value is sha256(PIN | salt) — the raw PIN is never stored and
 * the comparison is server-side only. There is no reset path by design.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';

const GATE_COOKIE = 'ps_site_gate';
const GATE_SALT = 'ps-site-gate-v1';

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

function hasValidGate(req: NextRequest): boolean {
  return req.cookies.get(GATE_COOKIE)?.value === gateKey();
}

export async function GET(req: NextRequest) {
  return NextResponse.json({ ok: hasValidGate(req) });
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
  res.cookies.set(GATE_COOKIE, gateKey(), {
    httpOnly: true,
    sameSite: https ? 'none' : 'lax',
    secure: https,
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  });
  return res;
}
