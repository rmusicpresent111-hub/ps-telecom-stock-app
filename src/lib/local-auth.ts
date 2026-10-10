/**
 * Local Profile Service — the app has NO login system.
 *
 * All data is keyed by a single device-local profile id (DEFAULT_USER_ID)
 * stored in the IndexedDB `users` store (see offline-db.ts). The profile is
 * created automatically on first boot (SplashScreen) and can be personalised
 * (name / shop name / language / theme) from the Profile screen.
 *
 * No passwords are used anywhere. The legacy `password` column still exists
 * in the IndexedDB schema (kept empty) so the database needs no migration —
 * old signup-era records simply stop being used for authentication.
 */

import { getOfflineDB, type LocalUserRecord } from './offline-db';

/**
 * Fixed id for the single device-local profile. Using a constant (instead of
 * a random uuid per signup) means data stays reachable even when the persisted
 * zustand store is cleared but IndexedDB is not.
 */
export const DEFAULT_USER_ID = 'local-owner';

/** Strip the (always empty) password field before handing a record to the UI. */
function toSafeUser(record: LocalUserRecord): Omit<LocalUserRecord, 'password'> {
  const { password: _pw, ...safe } = record;
  return safe;
}

/**
 * Guarantees the default device-local profile exists and returns it.
 * Called once during app boot. If the user previously signed up (an old
 * account exists) that record is left untouched in the DB — but the default
 * profile is what the app now uses, so old passwords are simply irrelevant.
 */
export async function ensureDefaultUser(): Promise<Omit<LocalUserRecord, 'password'>> {
  const db = await getOfflineDB();
  const existing = await db.get('users', DEFAULT_USER_ID);
  if (existing) return toSafeUser(existing);

  const now = new Date().toISOString();
  const record: LocalUserRecord = {
    id: DEFAULT_USER_ID,
    name: 'Owner',
    email: '',
    password: '', // login system removed — field kept so the DB schema is untouched
    shopName: 'PS TELECOM',
    role: 'owner',
    language: 'en',
    theme: 'dark',
    createdAt: now,
    updatedAt: now,
  };
  await db.put('users', record);
  return toSafeUser(record);
}

export async function getLocalUser(userId: string): Promise<Omit<LocalUserRecord, 'password'> | null> {
  if (!userId) return null;
  const db = await getOfflineDB();
  const record = await db.get('users', userId);
  return record ? toSafeUser(record) : null;
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
