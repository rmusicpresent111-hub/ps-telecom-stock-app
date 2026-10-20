/**
 * Admin panel security PIN — shared constants + helpers.
 *
 * The gate (src/components/admin/AdminPinGate.tsx) asks for this PIN before
 * the Vyapar-style /admin console renders ANY content. The PIN lives in
 * BillingSettings (synced through the same encrypted D1 as everything else),
 * so the owner can change it in Bill Settings on any device and every
 * connected device picks it up.
 *
 * THREAT MODEL: client-side gate — it stops casual snooping (staff/customers
 * picking up an unlocked phone or a shared browser), not a determined
 * attacker with devtools (any client-side check can be inspected). The real
 * data protection remains the AES-256-GCM encrypted D1 sync + the device's
 * own sandboxed storage.
 */

/** Factory default PIN — the owner should change it in Bill Settings. */
export const DEFAULT_ADMIN_PIN = '9732881732';

/** localStorage flag: this browser stays unlocked until "Lock" is pressed. */
export const ADMIN_UNLOCK_KEY = 'ps-admin-unlocked-v1';

/** Resolve the effective PIN from a (possibly missing/legacy) settings row. */
export function resolveAdminPin(raw?: string | null): string {
  const pin = (raw ?? '').trim();
  return pin || DEFAULT_ADMIN_PIN;
}

/** Normalize what the owner typed in Bill Settings to a storable PIN. */
export function normalizeAdminPin(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 12);
}

/** Best-effort localStorage flag read (private mode / disabled storage safe). */
export function adminPanelUnlocked(): boolean {
  try {
    return localStorage.getItem(ADMIN_UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persist (or clear) the "this device is unlocked" flag. */
export function setAdminPanelUnlocked(unlocked: boolean): void {
  try {
    if (unlocked) localStorage.setItem(ADMIN_UNLOCK_KEY, '1');
    else localStorage.removeItem(ADMIN_UNLOCK_KEY);
  } catch {
    /* storage unavailable — the gate simply re-asks after a reload */
  }
}
