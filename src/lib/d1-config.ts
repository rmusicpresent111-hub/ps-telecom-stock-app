/**
 * Cloudflare D1 configuration — PS TELECOM cloud database.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SECURITY MODEL (v2.28.0 — server-managed sync, ZERO credentials in app)
 * ─────────────────────────────────────────────────────────────────────────
 * The app bundle (APK / web) carries NO Cloudflare credentials at all.
 * Every D1 statement is relayed through the /api/cloud/d1 proxy of the
 * deployed Next.js server, which injects the SERVER's own env vars:
 *
 *   CLOUDFLARE_ACCOUNT_ID        server-side only (Vercel env)
 *   CLOUDFLARE_D1_DATABASE_ID    server-side only (Vercel env)
 *   CLOUDFLARE_D1_API_TOKEN      server-side only (Vercel env)
 *   SYNC_PIN                     server-side only — auth for cross-origin
 *                                proxy callers (the APK); falls back to
 *                                NEXT_PUBLIC_SYNC_PIN when unset
 *
 * What the CLIENT build keeps (not secrets — account identity only):
 *   NEXT_PUBLIC_SYNC_ID          default Sync ID for auto-connect
 *   NEXT_PUBLIC_SYNC_PIN         default Sync PIN (admin PIN — doubles as
 *                                the AES-256-GCM key source AND the proxy
 *                                auth pin; it is already the app's admin
 *                                password, so baking it adds no exposure)
 *   NEXT_PUBLIC_SYNC_API_URL     deployment origin for the APK's proxy calls
 *                                (e.g. https://artechnologyapp.com) — just
 *                                a URL, no credentials
 *
 * Transport:
 *  - Web (Vercel / any Next.js server): same-origin /api/cloud/d1.
 *  - APK (Capacitor): no Next.js server inside the bundle → the app calls
 *    `${NEXT_PUBLIC_SYNC_API_URL}/api/cloud/d1` (CapacitorHttp-patched
 *    fetch — no WebView CORS) with the sync PIN for the proxy's auth gate.
 *
 * RESIDUAL RISK (documented): the sync PIN can be extracted from the APK by
 * a determined attacker, exactly like the old baked-token. That is
 * survivable because every synced payload is AES-256-GCM encrypted
 * (sync-crypto.ts) and forged/tampered cloud rows fail AES-GCM
 * authentication and are skipped. A pin-holder can still WRITE/DELETE
 * garbage rows (DoS on the cloud copy) — devices self-heal by re-asserting
 * their copies at boot / every 6h. The API token itself never leaves the
 * server.
 *
 * The per-shop sync account (Sync ID + PIN) is stored in this device's
 * localStorage after the FIRST auto-connect; the PIN is required anyway to
 * derive the decryption key on every sync cycle.
 */

const envVal = (v: string | undefined): string => (v ?? '').trim();

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

// ─────────────────────────────────────────────────────────────────────────
// Sync server (the deployment that runs the /api/cloud/d1 proxy)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Origin of the Next.js deployment that hosts the /api/cloud/d1 proxy
 * (e.g. "https://artechnologyapp.com"). Used ONLY by the native APK shell,
 * which has no same-origin server of its own. Web builds ignore it and call
 * the proxy same-origin; an empty value on a native build means cloud sync
 * is unavailable (clear runtime error, never a crash).
 */
export const SYNC_SERVER_BASE = envVal(process.env.NEXT_PUBLIC_SYNC_API_URL).replace(
  /\/+$/, 
  ''
);

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
