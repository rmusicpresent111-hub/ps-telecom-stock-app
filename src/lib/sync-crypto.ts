/**
 * End-to-end encryption for the cloud sync layer.
 *
 * THREAT MODEL: the D1 API token ships inside the app (direct REST mode), so
 * assume anyone can extract it from the APK and obtain full SQL access to the
 * database. With this module every synced PAYLOAD is AES-256-GCM encrypted
 * with a key derived from the shop's Sync PIN — an attacker holding the token
 * sees only ciphertext, cannot forge rows (GCM auth tags), and cannot read or
 * corrupt device data.
 *
 * Key derivation (WebCrypto, ~100k PBKDF2 iterations each):
 *   kAcc — account credential hash  (stored in D1 sync_accounts to verify
 *          the PIN when a device joins an existing Sync ID)
 *   kEnc — AES-GCM-256 payload key  (encrypts/decrypts every synced row)
 *
 * Encrypted row format:  "v1.<ivBase64>.<cipherBase64>"
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_INFO_ACC = 'ps-stock-sync:acc:v1';
const SALT_INFO_ENC = 'ps-stock-sync:enc:v1';

const textEnc = new TextEncoder();
const textDec = new TextDecoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function subtle(): SubtleCrypto {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('WebCrypto unavailable in this environment');
  }
  return crypto.subtle;
}

async function deriveBits(syncId: string, pin: string, info: string): Promise<Uint8Array> {
  const keyMaterial = await subtle().importKey(
    'raw',
    textEnc.encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const salt = textEnc.encode(`${info}:${syncId}`);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

/** New random account salt (hex, 16 bytes). */
export function randomSalt(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Hash the PIN for storage in the cloud `sync_accounts` table.
 * The salt is persisted next to the hash so any device can verify the PIN.
 */
export async function hashPinForAccount(
  pin: string,
  salt: string
): Promise<string> {
  const keyMaterial = await subtle().importKey('raw', textEnc.encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: textEnc.encode(`${SALT_INFO_ACC}:${salt}`), iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    256
  );
  return toHex(new Uint8Array(bits));
}

/** Constant-time string comparison (avoids timing leaks on PIN hashes). */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Derive the AES-GCM payload key for a shop account (cached by the caller). */
export async function deriveEncKey(syncId: string, pin: string): Promise<CryptoKey> {
  const bits = await deriveBits(syncId, pin, SALT_INFO_ENC);
  return subtle().importKey('raw', bits as unknown as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/** Encrypt a JSON-serialisable payload → "v1.<iv>.<cipher>". */
export async function encryptRow(key: CryptoKey, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = textEnc.encode(JSON.stringify(value ?? null));
  const cipher = await subtle().encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    plain as unknown as BufferSource
  );
  return `v1.${toB64(iv)}.${toB64(new Uint8Array(cipher))}`;
}

/**
 * Decrypt a row payload produced by encryptRow. Returns null for anything
 * that is not a valid v1 ciphertext or fails authentication — callers MUST
 * skip nulls (this is what makes attacker-forged rows inert).
 */
export async function decryptRow(
  key: CryptoKey,
  blob: string
): Promise<Record<string, unknown> | null> {
  try {
    if (typeof blob !== 'string' || !blob.startsWith('v1.')) return null;
    const parts = blob.split('.');
    if (parts.length !== 3) return null;
    const iv = fromB64(parts[1]);
    if (iv.length !== 12) return null;
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      fromB64(parts[2]) as unknown as BufferSource
    );
    const parsed = JSON.parse(textDec.decode(plain)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
