/**
 * SITE-WIDE PASSWORD GATE (server-enforced, 5-minute sliding session).
 *
 * artechnologyapp.com is publicly reachable — anyone who knows the domain
 * could otherwise browse the shop's entire stock. This proxy (Next 16's middleware) runs on
 * EVERY request (Vercel / server mode): without a valid gate cookie the
 * visitor is redirected to /site-lock and every API route answers 401.
 *
 * SESSION MODEL (v2.24.1 — owner request: "probesh korle password chay,
 * 5 minute por auto lock"):
 *   • Unlocking issues a cookie valid for 5 MINUTES.
 *   • Every authenticated request RENEWS it (sliding window) — active use is
 *     never interrupted mid-work.
 *   • After 5 idle minutes the cookie dies (browser drops it via Max-Age AND
 *     the embedded timestamp makes even a replayed cookie fail server-side).
 *     The next entry asks for the password again.
 *   • The value is `${sha256(PIN|salt)}.${issuedAtMs}` so a stolen cookie is
 *     worthless 5 minutes after it was last issued.
 *
 * The password is the shop PIN (9732881732) and there is deliberately NO
 * reset, no hint and no alternate path — wrong or missing password simply
 * never sees the app.
 *
 * NOTE: static builds (APK / GitHub Pages) can't run the proxy — the build
 * scripts move this file out before `next build` (output: 'export') and
 * restore it afterwards. In those contexts the client-side gate
 * (src/components/SiteLockGate.tsx) covers the UI instead, with the same
 * 5-minute idle auto-lock.
 */

import { NextRequest, NextResponse } from 'next/server';

export const GATE_COOKIE = 'ps_site_gate';
export const GATE_SALT = 'ps-site-gate-v1';

/** Session length in seconds — "5 minite por auto lock". */
export const GATE_MAX_AGE_S = 5 * 60;

/** Effective PIN: SITE_LOCK_PIN → NEXT_PUBLIC_SYNC_PIN → factory default. */
function lockPin(): string {
  return (
    process.env.SITE_LOCK_PIN ||
    process.env.NEXT_PUBLIC_SYNC_PIN ||
    '9732881732'
  ).trim();
}

/** sha256(PIN + salt) as hex — must match src/app/api/site-auth/route.ts. */
async function gateKey(): Promise<string> {
  const data = new TextEncoder().encode(`${lockPin()}|${GATE_SALT}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** A freshly-issued cookie value: `<key>.<issuedAtMs>`. */
async function freshGateValue(): Promise<string> {
  return `${await gateKey()}.${Date.now()}`;
}

/**
 * Valid = right key AND younger than the 5-minute session (sliding — the
 * proxy re-issues on every authenticated request, so active use never dies).
 */
async function gateValid(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false;
  const dot = cookieValue.lastIndexOf('.');
  if (dot <= 0) return false;
  const key = await gateKey();
  if (cookieValue.slice(0, dot) !== key) return false;
  const issuedAt = Number(cookieValue.slice(dot + 1));
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return false;
  return Date.now() - issuedAt < GATE_MAX_AGE_S * 1000;
}

/** Cookie attributes consistent with src/app/api/site-auth/route.ts. */
function gateCookieOptions(https: boolean) {
  return {
    httpOnly: true,
    sameSite: https ? ('none' as const) : ('lax' as const),
    secure: https,
    maxAge: GATE_MAX_AGE_S,
    path: '/',
  };
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // the lock screen and its auth endpoint are always reachable
  // (trailingSlash: true adds a "/" — normalize before matching)
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/site-lock' || clean === '/api/site-auth') {
    return NextResponse.next();
  }

  if (await gateValid(req.cookies.get(GATE_COOKIE)?.value)) {
    // sliding renewal — every authenticated request restarts the 5-minute
    // window so active browsing/admin work is never interrupted
    const https = (req.headers.get('x-forwarded-proto') || '').includes('https');
    const res = NextResponse.next();
    res.cookies.set(GATE_COOKIE, await freshGateValue(), gateCookieOptions(https));
    return res;
  }

  // APIs (incl. the D1 sync proxy!) never leak data without the cookie
  if (clean.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: 'site_locked' }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = '/site-lock';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  // everything except Next's immutable static assets and PWA icons
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|logo.svg|apple-touch-icon|pwa-192.png|pwa-512.png|robots.txt|sitemap.xml).*)',
  ],
};
