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
 * CLOUDFLARE_API_BASE env var can override the API base (used by the local
 * d1-mock mini-service for end-to-end testing). Defaults to the real API.
 */

import { NextRequest, NextResponse } from 'next/server';

const CF_BASE = process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 30_000;

interface D1RequestBody {
  accountId?: string;
  databaseId?: string;
  apiToken?: string;
  sql?: string;
  params?: unknown[];
}

interface D1Response {
  ok: boolean;
  rows?: Record<string, unknown>[];
  changes?: number;
  error?: string;
  status?: number;
}

function json(payload: D1Response): NextResponse {
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
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
  if (sql.length > 4_000_000) {
    return json({ ok: false, error: 'SQL payload too large' });
  }

  const url = `${CF_BASE}/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

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

    clearTimeout(timer);

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
      const cfMsg = parsed?.errors?.[0]?.message;
      const msg =
        cfMsg ||
        (text && text.length < 400 ? text : `Cloudflare API returned HTTP ${res.status}`);
      return json({ ok: false, error: msg, status: res.status });
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

    return json({ ok: true, rows, changes });
  } catch (e) {
    const err = e as Error;
    const msg =
      err.name === 'AbortError'
        ? 'Cloudflare request timed out'
        : err.message || 'Network error while contacting Cloudflare';
    return json({ ok: false, error: msg });
  }
}
