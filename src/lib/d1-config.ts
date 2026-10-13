/**
 * Cloudflare D1 configuration — PS TELECOM cloud database (user's own account).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SECURITY MODEL (v2 — E2E encrypted direct mode)
 * ─────────────────────────────────────────────────────────────────────────
 * The app talks DIRECTLY to the D1 REST API:
 *   POST https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{db}/query
 * so a D1 API token is compiled into the app bundle. Threat model: assume
 * anyone can extract it from the APK. That is survivable because:
 *
 *   1. EVERY synced payload is AES-256-GCM encrypted (see sync-crypto.ts).
 *      The key is derived from the shop's Sync PIN — which is NOT in the app;
 *      each shop owner types it once on their own devices. A leaked token
 *      yields nothing but ciphertext.
 *   2. Forged/tampered cloud rows fail AES-GCM authentication and are skipped,
 *      so device data cannot be damaged through the cloud.
 *   3. The token is scoped by the user in the Cloudflare dashboard
 *      (D1 access to THIS database only — no account-wide rights).
 *   4. Deletes propagate as encrypted tombstone rows — outsiders cannot
 *      forge deletions either.
 *
 * RESIDUAL RISK (documented): a token holder can still DELETE/WRITE garbage
 * rows (denial-of-service on the cloud copy). Devices self-heal: missing or
 * poisoned rows are re-asserted from device copies at boot / every 6h.
 * The long-term fix is the staged Cloudflare Worker proxy
 * (/home/z/ps-stock-sync/worker.js) which needs a token with Workers
 * "Scripts:Edit" — after it is deployed the token can be removed from the
 * app entirely and this file shrinks to just the worker URL.
 *
 * The per-shop account (Sync ID + PIN) is stored in this device's
 * localStorage — app-private on Android (sandboxed WebView storage), and
 * required anyway to derive the decryption key on every sync cycle.
 *
 * GIT-HYGIENE: the token itself lives in src/lib/d1-secrets.ts which is
 * GIT-IGNORED (see d1-secrets.example.ts). Copy the example, paste values.
 * GitHub Push Protection blocks tokens in pushed code — with good reason.
 */

import { D1_ACCOUNT_ID, D1_DATABASE_ID, D1_API_TOKEN } from './d1-secrets';

export { D1_ACCOUNT_ID, D1_DATABASE_ID, D1_API_TOKEN };

export const D1_QUERY_URL =
  `https://api.cloudflare.com/client/v4/accounts/${D1_ACCOUNT_ID}` +
  `/d1/database/${D1_DATABASE_ID}/query`;

// ─────────────────────────────────────────────────────────────────────────
// Sync account (this device's cloud identity)
// ─────────────────────────────────────────────────────────────────────────

export interface SyncAccount {
  syncId: string;
  pin: string;
  createdAt: number;
}

const LS_KEY = 'ps-sync-account-v1';

type AccountListener = () => void;
const accountListeners = new Set<AccountListener>();

export function getSyncAccount(): SyncAccount | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SyncAccount>;
    if (typeof parsed.syncId !== 'string' || typeof parsed.pin !== 'string') return null;
    return {
      syncId: parsed.syncId,
      pin: parsed.pin,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
    };
  } catch {
    return null;
  }
}

export function setSyncAccount(account: SyncAccount): void {
  localStorage.setItem(LS_KEY, JSON.stringify(account));
  accountListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* non-fatal */
    }
  });
}

export function clearSyncAccount(): void {
  localStorage.removeItem(LS_KEY);
  accountListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* non-fatal */
    }
  });
}

/** Subscribe to connect/disconnect events (used by the sync engine). */
export function onSyncAccountChanged(fn: AccountListener): () => void {
  accountListeners.add(fn);
  return () => {
    accountListeners.delete(fn);
  };
}

/** Sync ID format shared by UI + engine. */
export const SYNC_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{3,63}$/;

/** Human-friendly random Sync ID, e.g. "PS-K7M2-Q9X4". */
export function generateSyncId(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const pick = (n: number): string => {
    const bytes = crypto.getRandomValues(new Uint8Array(n));
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  };
  return `PS-${pick(4)}-${pick(4)}`;
}
