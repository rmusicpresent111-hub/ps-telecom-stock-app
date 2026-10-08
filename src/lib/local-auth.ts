/**
 * Local Authentication Service — 100% offline, no cloud database.
 *
 * Users are stored in the IndexedDB `users` store (see offline-db.ts).
 *
 * Password storage (v2 — PBKDF2 via Web Crypto):
 *   "pbkdf2$310000$<saltB64>$<hashB64>"
 *   PBKDF2-HMAC-SHA-256, 310,000 iterations, 256-bit derived key,
 *   random 16-byte salt per user.
 *
 * Legacy storage (v1 — single-pass SHA-256) is STILL VERIFIED:
 *   "<saltHex>:<sha256Hex(salt + ':' + password)>"
 *   On a successful legacy login the record is transparently re-hashed with
 *   PBKDF2 and written back (migration on login — no user action needed).
 *
 * Brute-force protection: failed login attempts are tracked per email in
 * localStorage ("ps-login-throttle"); after 5 failures inside 15 minutes a
 * growing delay (30s → 60s → 120s …) is enforced before the next try.
 */

import { generateId } from './id';
import { getOfflineDB, type LocalUserRecord } from './offline-db';

// ============ PASSWORD HASHING (Web Crypto — browser safe) ============

const PBKDF2_ITERATIONS = 310_000;
const PBKDF2_KEY_BITS = 256;
const SALT_BYTES = 16;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomSaltB64(): string {
  const bytes = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64(bytes);
}

/** UTF-8 bytes as a plain ArrayBuffer-backed view (satisfies BufferSource). */
function utf8Bytes(s: string): Uint8Array<ArrayBuffer> {
  const src = new TextEncoder().encode(s);
  const out = new Uint8Array(src.length);
  out.set(src);
  return out;
}

async function pbkdf2Bits(
  password: string,
  saltBytes: BufferSource,
  iterations: number
): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    utf8Bytes(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    keyMaterial,
    PBKDF2_KEY_BITS
  );
}

/** Produces the v2 stored string: "pbkdf2$310000$<saltB64>$<hashB64>". */
async function hashPassword(password: string, saltB64: string, iterations: number = PBKDF2_ITERATIONS): Promise<string> {
  const bits = await pbkdf2Bits(password, fromBase64(saltB64), iterations);
  return `pbkdf2$${iterations}$${saltB64}$${toBase64(new Uint8Array(bits))}`;
}

/** Length-independent constant-time-ish string comparison. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Legacy v1 verify: "<saltHex>:<sha256Hex(salt:password)>" */
async function verifyLegacyPassword(password: string, stored: string): Promise<boolean> {
  const sep = stored.indexOf(':');
  if (sep <= 0) return false;
  const salt = stored.slice(0, sep);
  const hash = stored.slice(sep + 1);
  if (!salt || !hash) return false;
  const digest = await crypto.subtle.digest('SHA-256', utf8Bytes(`${salt}:${password}`));
  return safeEqual(toHex(digest), hash);
}

/**
 * Verifies a password against either storage format (v2 PBKDF2 or v1 legacy).
 * The PBKDF2 branch derives with the iteration count recorded in the stored
 * string, so future cost upgrades keep old records verifiable.
 */
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith('pbkdf2$')) {
    const parts = stored.split('$'); // ["pbkdf2", iterations, saltB64, hashB64]
    if (parts.length !== 4) return false;
    const iterations = parseInt(parts[1], 10);
    const [, , saltB64, hashB64] = parts;
    if (!saltB64 || !hashB64 || !Number.isFinite(iterations) || iterations < 1) return false;
    try {
      const bits = await pbkdf2Bits(password, fromBase64(saltB64), iterations);
      return safeEqual(toBase64(new Uint8Array(bits)), hashB64);
    } catch {
      return false;
    }
  }
  return verifyLegacyPassword(password, stored);
}

function isLegacyHash(stored: string): boolean {
  return !stored.startsWith('pbkdf2$');
}

// ============ LOGIN THROTTLE (brute-force backoff, per email, per device) ============

const THROTTLE_KEY = 'ps-login-throttle';
const THROTTLE_WINDOW_MS = 15 * 60 * 1000; // 15 min failure window
const THROTTLE_FREE_ATTEMPTS = 5; // failures before delays kick in
const THROTTLE_BASE_DELAY_S = 30; // 30s, 60s, 120s, 240s …
const THROTTLE_MAX_DELAY_S = 3600; // cap the growth at 1 hour

interface ThrottleEntry {
  count: number; // failed attempts inside the current window
  windowStart: number; // when the current window opened
  blockedUntil: number; // epoch ms until which login is refused (0 = not blocked)
}

type ThrottleMap = Record<string, ThrottleEntry>;

function readThrottleMap(): ThrottleMap {
  try {
    const raw = localStorage.getItem(THROTTLE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ThrottleMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeThrottleMap(map: ThrottleMap): void {
  try {
    const now = Date.now();
    // Opportunistically prune entries that can no longer matter.
    for (const k of Object.keys(map)) {
      const e = map[k];
      if (!e || (now - e.windowStart > THROTTLE_WINDOW_MS && e.blockedUntil <= now)) {
        delete map[k];
      }
    }
    localStorage.setItem(THROTTLE_KEY, JSON.stringify(map));
  } catch {
    // localStorage unavailable (private mode) — throttle is best-effort.
  }
}

function liveThrottleEntry(email: string): ThrottleEntry {
  const map = readThrottleMap();
  const e = map[email];
  const now = Date.now();
  if (!e || now - e.windowStart > THROTTLE_WINDOW_MS) {
    return { count: 0, windowStart: now, blockedUntil: 0 };
  }
  return e;
}

function recordLoginFailure(email: string): void {
  const map = readThrottleMap();
  const now = Date.now();
  const prev = map[email];
  const entry: ThrottleEntry =
    prev && now - prev.windowStart <= THROTTLE_WINDOW_MS
      ? prev
      : { count: 0, windowStart: now, blockedUntil: 0 };
  entry.count += 1;
  if (entry.count > THROTTLE_FREE_ATTEMPTS) {
    const extra = entry.count - THROTTLE_FREE_ATTEMPTS; // 1, 2, 3 …
    const delayS = Math.min(THROTTLE_BASE_DELAY_S * 2 ** (extra - 1), THROTTLE_MAX_DELAY_S);
    entry.blockedUntil = now + delayS * 1000;
  }
  map[email] = entry;
  writeThrottleMap(map);
}

function clearLoginFailures(email: string): void {
  const map = readThrottleMap();
  if (map[email]) {
    delete map[email];
    writeThrottleMap(map);
  }
}

// ============ HELPERS ============

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Strip password before handing a user record to the UI/store. */
function toSafeUser(record: LocalUserRecord): Omit<LocalUserRecord, 'password'> {
  const { password: _pw, ...safe } = record;
  return safe;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ============ SIGNUP ============

export async function signup(
  name: string,
  email: string,
  password: string,
  shopName: string
): Promise<{ user: Omit<LocalUserRecord, 'password'> }> {
  const cleanName = name.trim();
  const cleanEmail = normalizeEmail(email);

  if (!cleanName) throw new Error('Name is required');
  if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) throw new Error('Please enter a valid email address');
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters');

  const db = await getOfflineDB();
  const existing = await db.getFromIndex('users', 'by-email', cleanEmail);
  if (existing) throw new Error('An account with this email already exists');

  const salt = randomSaltB64();
  const hashed = await hashPassword(password, salt);
  const now = new Date().toISOString();

  const record: LocalUserRecord = {
    id: generateId(),
    name: cleanName,
    email: cleanEmail,
    password: hashed,
    shopName: shopName.trim() || 'PS TELECOM',
    role: 'owner',
    language: 'en',
    theme: 'dark',
    createdAt: now,
    updatedAt: now,
  };

  await db.put('users', record);
  return { user: toSafeUser(record) };
}

// ============ LOGIN ============

export async function login(
  email: string,
  password: string
): Promise<{ user: Omit<LocalUserRecord, 'password'> }> {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail || !password) throw new Error('Email and password are required');

  // Brute-force backoff: refuse to even try while a block is active.
  const throttled = liveThrottleEntry(cleanEmail);
  const now = Date.now();
  if (throttled.blockedUntil > now) {
    const waitSec = Math.ceil((throttled.blockedUntil - now) / 1000);
    throw new Error(`Too many attempts, try again in ${waitSec}s`);
  }

  const db = await getOfflineDB();
  const record = await db.getFromIndex('users', 'by-email', cleanEmail);

  // Same generic message for unknown email and wrong password (no enumeration)
  if (!record || !(await verifyPassword(password, record.password))) {
    recordLoginFailure(cleanEmail);
    throw new Error('Invalid email or password');
  }

  clearLoginFailures(cleanEmail);

  // Transparent migration: legacy salt:sha256 → PBKDF2 on successful login.
  if (isLegacyHash(record.password)) {
    try {
      const salt = randomSaltB64();
      const upgraded = await hashPassword(password, salt);
      await db.put('users', {
        ...record,
        password: upgraded,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // Migration is best-effort — the login itself already succeeded and the
      // legacy record stays valid until the next successful login retries it.
    }
  }

  return { user: toSafeUser(record) };
}

// ============ PROFILE ============

export async function getLocalUser(userId: string): Promise<Omit<LocalUserRecord, 'password'> | null> {
  if (!userId) return null;
  const db = await getOfflineDB();
  const record = await db.get('users', userId);
  return record ? toSafeUser(record) : null;
}

/** True iff a user with this id exists in the local users store (session checks). */
export async function verifyLocalUserId(userId: string): Promise<boolean> {
  if (!userId) return false;
  const db = await getOfflineDB();
  const record = await db.get('users', userId);
  return !!record;
}

export async function updateLocalUser(
  userId: string,
  updates: { name?: string; shopName?: string; language?: string; theme?: string }
): Promise<Omit<LocalUserRecord, 'password'>> {
  const db = await getOfflineDB();
  const record = await db.get('users', userId);
  if (!record) throw new Error('User not found');

  const updated: LocalUserRecord = {
    ...record,
    ...(updates.name !== undefined ? { name: updates.name.trim() || record.name } : {}),
    ...(updates.shopName !== undefined ? { shopName: updates.shopName.trim() || record.shopName } : {}),
    ...(updates.language !== undefined ? { language: updates.language } : {}),
    ...(updates.theme !== undefined ? { theme: updates.theme } : {}),
    updatedAt: new Date().toISOString(),
  };

  await db.put('users', updated);
  return toSafeUser(updated);
}

// ============ PASSWORD RESET (local account recovery) ============

export async function resetLocalPassword(email: string, newPassword: string): Promise<void> {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) throw new Error('Please enter a valid email address');
  if (!newPassword || newPassword.length < 6) throw new Error('Password must be at least 6 characters');

  const db = await getOfflineDB();
  const record = await db.getFromIndex('users', 'by-email', cleanEmail);
  // Generic error — does not reveal whether the account exists (no enumeration).
  if (!record) throw new Error('Unable to reset password for this email');

  const salt = randomSaltB64();
  const hashed = await hashPassword(newPassword, salt);
  await db.put('users', {
    ...record,
    password: hashed,
    updatedAt: new Date().toISOString(),
  });
}
