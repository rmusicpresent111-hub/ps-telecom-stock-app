/**
 * SITE-WIDE PASSWORD GATE (server-enforced).
 *
 * artechnologyapp.com is publicly reachable — anyone who knows the domain
 * could otherwise browse the shop's entire stock. This proxy (Next 16's middleware) runs on
 * EVERY request (Vercel / server mode): without a valid gate cookie the
 * visitor is redirected to /site-lock and every API route answers 401.
 *
 * The password is the shop PIN (9732881732) and there is deliberately NO
 * reset, no hint and no alternate path — wrong or missing password simply
 * never sees the app.
 *
 * NOTE: static builds (APK / GitHub Pages) can't run the proxy — the build
 * scripts move this file out before `next build` (output: 'export') and
 * restore it afterwards. In those contexts the client-side gate
 * (src/components/SiteLockGate.tsx) covers the UI instead.
 *
 * The cookie value is sha256(PIN | domain-salt) so the raw PIN never sits
 * in the cookie and a stolen cookie can't be replayed against a site with
 * a different PIN.
 */

import { NextRequest, NextResponse } from 'next/server';

export const GATE_COOKIE = 'ps_site_gate';
export const GATE_SALT = 'ps-site-gate-v1';

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

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // the lock screen and its auth endpoint are always reachable
  // (trailingSlash: true adds a "/" — normalize before matching)
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/site-lock' || clean === '/api/site-auth') {
    return NextResponse.next();
  }

  const expected = await gateKey();
  const ok = req.cookies.get(GATE_COOKIE)?.value === expected;
  if (ok) return NextResponse.next();

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
