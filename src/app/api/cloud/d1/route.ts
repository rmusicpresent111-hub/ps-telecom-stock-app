/**
 * Cloudflare D1 proxy — the ONLY server-side piece of the cloud backup feature.
 *
 * The client (src/lib/cloud-d1.ts) posts { accountId, databaseId, apiToken, sql, params }
 * and this route forwards the query to the official Cloudflare REST API:
 *
 *   POST {base}/accounts/{accountId}/d1/database/{databaseId}/query
 *
 * Why a proxy instead of calling Cloudflare directly from the browser?
 *  - No CORS issues (api.cloudflare.com blocks browser calls).
 *  - Credentials are never stored server-side — they are only relayed per request.
 *
 * Hardening:
 *  - Same-origin gate: cross-origin browser calls are refused (403).
 *  - Per-IP in-memory rate limit: 30 requests / rolling 60s window (429).
 *  - SQL payload capped at 1 MB; bound params strictly validated.
 *
 * CLOUDFLARE_API_BASE env var can override the API base (used by the local
 * d1-mock mini-service for end-to-end testing). Defaults to the real API.
 */

import { NextRequest, NextResponse } from 'next/server';

const CF_BASE = process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 30_000;
const MAX_SQL_LENGTH = 1_000_000;

interface D1RequestBody {
  accountId?: string;
  databaseId?: string;
  apiToken?: string;
  sql?: string;
  params?: unknown[];
}

// ---- Per-IP rate limiting (module-scope; in-memory, pruned opportunistically) ----

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 30;

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

function json(payload: D1Response, status = 200, extraHeaders?: Record<string, string>): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

/**
 * Stable error codes the client UI maps to translated, friendly messages.
 * Keep in sync with src/lib/cloud-d1.ts (native path) and the i18n keys.
 */
type CloudErrorCode = 'ids_wrong' | 'token_invalid' | 'ids_malformed' | 'rate_limit';

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
    return { message: `Account ID or Database ID is wrong — please re-copy both from Cloudflare${cfMsg ? ` (${cfMsg})` : ''}`, code: 'ids_wrong' };
  }
  if (status === 403 || cfCode === 9109 || cfCode === 10000 || lower.includes('authentication error') || lower.includes('unauthorized')) {
    return { message: `API token is invalid, expired, or missing the "D1 Edit" permission${cfMsg ? ` (${cfMsg})` : ''}`, code: 'token_invalid' };
  }
  if (status === 400 && lower.includes('invalid')) {
    return { message: `Account ID or Database ID looks malformed — paste the ID only, without any extra text${cfMsg ? ` (${cfMsg})` : ''}`, code: 'ids_malformed' };
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
  // ---- Same-origin gate: block cross-site BROWSER calls ----
  // Modern browsers always send Sec-Fetch-Site and JavaScript cannot spoof it,
  // so it is the most reliable signal — and it survives reverse proxies that
  // rewrite the Host header (which broke legit calls with a bare "Forbidden").
  const secFetchSite = (req.headers.get('sec-fetch-site') || '').toLowerCase();
  if (secFetchSite === 'cross-site') {
    return json({ ok: false, error: 'Cross-origin requests are not allowed' }, 403);
  }
  if (!secFetchSite) {
    // Older browser / unknown client — fall back to comparing Origin with the
    // forwarded/original host (either may carry the public domain).
    const origin = req.headers.get('origin');
    if (origin) {
      let blocked = true;
      try {
        const originHost = new URL(origin).host;
        const hostHeader = (req.headers.get('host') || '').trim();
        const fwdHost = (req.headers.get('x-forwarded-host') || '').trim().split(',')[0];
        if (originHost === hostHeader || (fwdHost && originHost === fwdHost)) blocked = false;
      } catch {
        blocked = true;
      }
      if (blocked) {
        return json({ ok: false, error: 'Cross-origin requests are not allowed' }, 403);
      }
    }
  }

  // ---- Per-IP rate limit ----
  const limit = checkRateLimit(clientIp(req));
  if (!limit.allowed) {
    return json({ ok: false, error: 'Too many requests' }, 429, {
      'Retry-After': String(limit.retryAfterS),
    });
  }

  let body: D1RequestBody;
  try {
    body = (await req.json()) as D1RequestBody;
  } catch {
    return json({ ok: false, error: 'Invalid request body' });
  }

  const accountId = (body.accountId || '').trim();
  const databaseId = (body.databaseId || '').trim();
  const apiToken = (body.apiToken || '').trim();
  const sql = (body.sql || '').trim();
  const params = Array.isArray(body.params) ? body.params : undefined;

  if (!accountId || !databaseId || !apiToken) {
    return json({ ok: false, error: 'Missing accountId, databaseId or apiToken' });
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
      // (never log the token or SQL contents).
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
