/**
 * Cloudflare D1 proxy — the ONLY piece of the cloud that holds credentials.
 *
 * The client (src/lib/d1-sync.ts / src/lib/cloud-d1.ts) posts
 * { sql, params, pin } and this route forwards the statement to the official
 * Cloudflare REST API:
 *
 *   POST {base}/accounts/{accountId}/d1/database/{databaseId}/query
 *
 * SERVER-MANAGED MODE (v2.28.0 — the only mode):
 *  Credentials come EXCLUSIVELY from the deployment's environment variables
 *  (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_D1_API_TOKEN).
 *  The app bundle — APK or web — carries no Cloudflare keys at all, so an
 *  expired/revoked token is fixed by a Vercel env change, never an APK
 *  rebuild, and the token can never be extracted from a client.
 *
 * AUTH (who may relay SQL through this route?):
 *  - Same-origin browser calls (the Vercel site itself): allowed — they are
 *    the user's own app, already behind the site password gate.
 *  - EVERYTHING else (the APK shell, curl, other sites): must present
 *    body.pin === SYNC_PIN (falls back to NEXT_PUBLIC_SYNC_PIN). The PIN is
 *    compared timing-safely. Wrong/missing pin → 403.
 *
 * Hardening:
 *  - Per-IP in-memory rate limit: 90 requests / rolling 60s window (429).
 *  - SQL payload capped at 1 MB; bound params strictly validated.
 *  - CORS: preflight + permissive ACAO so the APK WebView fallback and any
 *    future cross-origin FIRST-PARTY host can call it; the pin gate above is
 *    what actually protects the endpoint.
 *
 * CLOUDFLARE_API_BASE env var can override the API base (used by the local
 * d1-mock mini-service for end-to-end testing). Defaults to the real API.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';

const CF_BASE = process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 30_000;
const MAX_SQL_LENGTH = 1_000_000;

interface D1RequestBody {
  /** Ignored — credentials are server-side only since v2.28.0. */
  accountId?: string;
  databaseId?: string;
  apiToken?: string;
  sql?: string;
  params?: unknown[];
  /** Sync PIN — required from cross-origin / non-browser callers. */
  pin?: string;
}

// ---- CORS (APK / first-party cross-origin callers) ----

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
};

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// ---- Per-IP rate limiting (module-scope; in-memory, pruned opportunistically) ----

const RATE_WINDOW_MS = 60_000;
// A live sync device spends ~18 req/min on the normal cycle (pull + push +
// clock) plus ONE integrity id-list per minute. 90/IP/min leaves headroom
// while keeping brute-force pin guessing impractical (10-digit space).
const RATE_MAX_REQUESTS = 90;

const rateMap = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

function checkRateLimit(ip: string): { allowed: boolean; retryAfterS: number } {
  const now = Date.now();
  // Prune expired entries so the map cannot grow without bound.
  for (const [key, entry] of rateMap) {
    if (entry.resetAt <= now) rateMap.delete(key);
  }

  const entry = rateMap.get(ip);
  if (!entry || entry.resetAt <= now) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true, retryAfterS: 0 };
  }

  entry.count += 1;
  if (entry.count > RATE_MAX_REQUESTS) {
    return { allowed: false, retryAfterS: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfterS: 0 };
}

// ---- Response helper ----

interface D1Response {
  ok: boolean;
  rows?: Record<string, unknown>[];
  changes?: number;
  error?: string;
  /** Stable machine code so the UI can show a translated message. */
  errorCode?: string;
  status?: number;
}

function json(payload: D1Response, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store', ...CORS_HEADERS },
  });
}

// ---- Auth helpers ----

/**
 * Same-origin evidence from a real browser: Sec-Fetch-Site is set by modern
 * browsers and cannot be spoofed by page JS. When absent we fall back to an
 * Origin/host match (older browsers); requests with NEITHER header (native
 * shells, curl) are treated as NOT same-origin and must present the pin.
 */
function isSameOrigin(req: NextRequest): boolean {
  const secFetchSite = (req.headers.get('sec-fetch-site') || '').toLowerCase();
  if (secFetchSite === 'same-origin' || secFetchSite === 'same-site') return true;
  if (secFetchSite === 'cross-site') return false;

  // No Sec-Fetch-Site — older browser or non-browser client.
  const origin = req.headers.get('origin');
  if (!origin) return false; // curl / native / no Origin → needs pin
  try {
    const originHost = new URL(origin).host;
    const hostHeader = (req.headers.get('host') || '').trim();
    const fwdHost = (req.headers.get('x-forwarded-host') || '').trim().split(',')[0];
    return originHost === hostHeader || (fwdHost !== '' && originHost === fwdHost);
  } catch {
    return false;
  }
}

/** Constant-time pin comparison (both sides hashed to fixed length first). */
function pinMatches(candidate: string, serverPin: string): boolean {
  const a = createHash('sha256').update(candidate).digest();
  const b = createHash('sha256').update(serverPin).digest();
  return timingSafeEqual(a, b);
}

/**
 * Stable error codes the client UI maps to translated, friendly messages.
 * Keep in sync with the d1-sync/cloud-d1 clients and the i18n keys.
 */
type CloudErrorCode = 'ids_wrong' | 'token_invalid' | 'ids_malformed' | 'rate_limit' | 'missing_creds';

/**
 * Maps raw Cloudflare API failures to short, actionable messages a shop owner
 * can act on (the raw detail is kept in parentheses when available).
 */
function friendlyCloudflareError(
  status: number,
  parsed: { errors?: { message?: string; code?: number }[] } | null,
  rawText: string
): { message: string; code?: CloudErrorCode } {
  const cfMsg = parsed?.errors?.[0]?.message || '';
  const cfCode = parsed?.errors?.[0]?.code || 0;
  const lower = `${cfMsg} ${rawText}`.toLowerCase();

  if (status === 404 || cfCode === 7003 || lower.includes('could not route')) {
    return { message: `Cloudflare Account ID or Database ID is wrong (server env)${cfMsg ? ` (${cfMsg})` : ''}`, code: 'ids_wrong' };
  }
  if (status === 403 || cfCode === 9109 || cfCode === 10000 || lower.includes('authentication error') || lower.includes('unauthorized')) {
    return { message: `The server's Cloudflare API token is invalid or expired — update the CLOUDFLARE_D1_API_TOKEN env var on the deployment${cfMsg ? ` (${cfMsg})` : ''}`, code: 'token_invalid' };
  }
  if (status === 400 && lower.includes('invalid')) {
    return { message: `Cloudflare Account ID or Database ID looks malformed (server env)${cfMsg ? ` (${cfMsg})` : ''}`, code: 'ids_malformed' };
  }
  if (status === 429) {
    return { message: 'Cloudflare rate limit reached — please wait a minute and try again', code: 'rate_limit' };
  }
  return {
    message: (
      cfMsg ||
      (rawText && rawText.length < 400 ? rawText : `Cloudflare API returned HTTP ${status}`)
    ),
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ---- Per-IP rate limit (also throttles pin guessing) ----
  const limit = checkRateLimit(clientIp(req));
  if (!limit.allowed) {
    return json({ ok: false, error: 'Too many requests' }, 429);
  }

  let body: D1RequestBody;
  try {
    body = (await req.json()) as D1RequestBody;
  } catch {
    return json({ ok: false, error: 'Invalid request body' });
  }

  // ---- Auth gate: same-origin browsers pass; everyone else needs the pin ----
  if (!isSameOrigin(req)) {
    const serverPin = (process.env.SYNC_PIN || process.env.NEXT_PUBLIC_SYNC_PIN || '').trim();
    if (!serverPin) {
      return json(
        { ok: false, error: 'Sync server auth is not configured (set SYNC_PIN in the deployment env vars)', errorCode: 'pin_unconfigured' },
        403
      );
    }
    const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
    if (!pin || !pinMatches(pin, serverPin)) {
      return json({ ok: false, error: 'Invalid sync PIN', errorCode: 'pin_invalid' }, 403);
    }
  }

  // ---- Credentials: SERVER ENV ONLY (the client never sends any) ----
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const databaseId = (process.env.CLOUDFLARE_D1_DATABASE_ID || '').trim();
  const apiToken = (process.env.CLOUDFLARE_D1_API_TOKEN || '').trim();

  const sql = (body.sql || '').trim();
  const params = Array.isArray(body.params) ? body.params : undefined;

  if (!accountId || !databaseId || !apiToken) {
    return json({
      ok: false,
      error: 'Cloud sync is not configured on this server (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID / CLOUDFLARE_D1_API_TOKEN env vars missing)',
      errorCode: 'missing_creds',
    });
  }
  if (!sql) {
    return json({ ok: false, error: 'Missing sql' });
  }
  if (sql.length > MAX_SQL_LENGTH) {
    return json({ ok: false, error: 'SQL payload too large' });
  }
  // Bound params must be plain scalars — anything else is rejected outright.
  if (params) {
    for (const p of params) {
      const t = typeof p;
      if (!(p === null || t === 'string' || t === 'number' || t === 'boolean')) {
        return json({ ok: false, error: 'Invalid params' });
      }
    }
  }

  const url = `${CF_BASE}/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        params && params.length > 0 ? { sql, params } : { sql }
      ),
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: {
      success?: boolean;
      errors?: { message?: string; code?: number }[];
      result?: unknown;
    } | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    if (!res.ok || !parsed || parsed.success === false) {
      const fe = friendlyCloudflareError(res.status, parsed, text);
      // Server-side diagnosis: dev.log now shows WHY a cloud call failed
      // (never log the token, the pin, or SQL contents).
      console.log(`[d1-proxy] FAIL http=${res.status} code=${fe.code || 'unknown'}`);
      return json({ ok: false, error: fe.message, errorCode: fe.code, status: res.status });
    }

    // /query returns an array of per-statement results (multi-statement SQL)
    const resultArr = Array.isArray(parsed.result) ? parsed.result : [parsed.result];
    const rows: Record<string, unknown>[] = [];
    let changes = 0;
    for (const r of resultArr) {
      const rr = r as { results?: unknown[]; meta?: { changes?: number } } | null;
      if (rr && Array.isArray(rr.results)) {
        for (const row of rr.results) {
          if (row && typeof row === 'object') rows.push(row as Record<string, unknown>);
        }
      }
      if (rr?.meta && typeof rr.meta.changes === 'number') changes += rr.meta.changes;
    }

    console.log(`[d1-proxy] OK changes=${changes} rows=${rows.length}`);
    return json({ ok: true, rows, changes });
  } catch (e) {
    const err = e as Error;
    const timedOut = err.name === 'AbortError';
    const msg = timedOut
      ? 'Cloudflare request timed out'
      : err.message || 'Network error while contacting Cloudflare';
    console.log(`[d1-proxy] FAIL network=${timedOut ? 'timeout' : 'error'}`);
    return json({ ok: false, error: msg, ...(timedOut ? { errorCode: 'timeout' } : {}) });
  } finally {
    // Never leave a stray 30s abort timer behind, even when fetch throws.
    clearTimeout(timer);
  }
}
