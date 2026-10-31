/**
 * Cloudflare D1 configuration — PS TELECOM cloud database.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SECURITY MODEL (v3 — env-only credentials, zero keys in source code)
 * ─────────────────────────────────────────────────────────────────────────
 * Every credential now comes from ENVIRONMENT VARIABLES — nothing is
 * hardcoded in the repository (the old git-ignored d1-secrets.ts file is
 * gone). Fill them in `.env` (git-ignored, see .env.example):
 *
 *   NEXT_PUBLIC_CF_ACCOUNT_ID    Account ID  (client build: APK direct sync)
 *   NEXT_PUBLIC_CF_DATABASE_ID   Database ID (client build)
 *   NEXT_PUBLIC_CF_API_TOKEN     D1 API token (client build)
 *   NEXT_PUBLIC_SYNC_ID          default Sync ID for auto-connect
 *   NEXT_PUBLIC_SYNC_PIN         default Sync PIN for auto-connect
 *   CLOUDFLARE_ACCOUNT_ID        server-side only (/api/cloud/d1 proxy)
 *   CLOUDFLARE_D1_DATABASE_ID    server-side only
 *   CLOUDFLARE_D1_API_TOKEN      server-side only
 *
 * Transport:
 *  - Web (Vercel / any Next.js server): the browser never needs the keys —
 *    queries are relayed through the same-origin /api/cloud/d1 proxy, which
 *    injects the deployment's own CLOUDFLARE_* env vars. Client builds made
 *    WITHOUT the NEXT_PUBLIC_CF_* vars simply send empty credentials and the
 *    proxy fills them in server-side.
 *  - APK (Capacitor): no Next.js server exists inside the bundle → the app
 *    calls api.cloudflare.com directly using the NEXT_PUBLIC_CF_* values
 *    baked at build time (the APK build hard-fails when they are missing —
 *    scripts/build-apk.js preflight).
 *
 * RESIDUAL RISK (documented): values baked into a client build can be
 * extracted from the bundle. That is survivable because every synced payload
 * is AES-256-GCM encrypted (sync-crypto.ts) and forged/tampered cloud rows
 * fail AES-GCM authentication and are skipped. A token holder can still
 * WRITE/DELETE garbage rows (DoS on the cloud copy) — devices self-heal by
 * re-asserting their copies at boot / every 6h.
 *
 * The per-shop sync account (Sync ID + PIN) is stored in this device's
 * localStorage after the FIRST auto-connect; the PIN is required anyway to
 * derive the decryption key on every sync cycle.
 */

const envVal = (v: string | undefined): string => (v ?? '').trim();

/** Client-build Cloudflare credentials (baked from .env at build time). */
export const D1_ACCOUNT_ID = envVal(process.env.NEXT_PUBLIC_CF_ACCOUNT_ID);
export const D1_DATABASE_ID = envVal(process.env.NEXT_PUBLIC_CF_DATABASE_ID);
export const D1_API_TOKEN = envVal(process.env.NEXT_PUBLIC_CF_API_TOKEN);

/**
 * True when the build carries real (non-placeholder) Cloudflare credentials.
 * Web builds can be cloud-ready even when this is false — the /api/cloud/d1
 * proxy falls back to the server's own CLOUDFLARE_* environment variables.
 */
export const CLOUD_CREDS_CONFIGURED =
  [D1_ACCOUNT_ID, D1_DATABASE_ID, D1_API_TOKEN].every(
    (v) => v.length > 0 && !/paste[._-]?your|change[._-]?me/i.test(v)
  );

/** Default sync account for auto-connect (no sign-in UI anywhere). */
export const DEFAULT_SYNC_ID = envVal(process.env.NEXT_PUBLIC_SYNC_ID);
export const DEFAULT_SYNC_PIN = envVal(process.env.NEXT_PUBLIC_SYNC_PIN);

/**
 * True when DEFAULT_SYNC_ID / DEFAULT_SYNC_PIN hold usable values (not
 * empty, not a .env.example placeholder). The sync engine auto-connects
 * with them when the device has no locally saved account yet.
 */
export const DEFAULT_SYNC_CONFIGURED =
  DEFAULT_SYNC_ID.length > 0 &&
  DEFAULT_SYNC_PIN.length >= 4 &&
  !/paste[._-]?your|change[._-]?me/i.test(`${DEFAULT_SYNC_ID} ${DEFAULT_SYNC_PIN}`);

/** Direct Cloudflare REST endpoint (native/APK transport only). */
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

/**
 * True when the app runs on a STATIC-ONLY web host (GitHub Pages mirror etc.)
 * where no Next.js server — and therefore no /api/cloud/d1 relay — exists.
 * Browsers on such hosts cannot reach api.cloudflare.com at all (the Cloudflare
 * API sends no CORS headers, and its preflight endpoint answers 405), so the
 * sync engines stay dormant and the UI shows a calm explanation instead.
 *
 * NEXT_PUBLIC_STATIC_HOST=1 is stamped at build time for known static deploys;
 * the hostname check covers any other static-only host.
 */
export function isStaticWebHost(): boolean {
  if (process.env.NEXT_PUBLIC_STATIC_HOST === '1') return true;
  if (typeof window === 'undefined') return false;
  try {
    const h = window.location.hostname;
    return h === 'github.io' || h.endsWith('.github.io') || h.endsWith('.gitlab.io');
  } catch {
    return false;
  }
}
