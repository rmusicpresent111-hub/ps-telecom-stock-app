/**
 * Shared ID generator — produces cuid-like unique ids
 * (timestamp base36 + random suffix), safe for IndexedDB keys.
 */
export function generateId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `c${timestamp}${randomPart}`;
}

/**
 * Extra-unique id for records that may be created within the same millisecond
 * (bulk imports, rapid taps).
 */
export function generateRecordId(): string {
  return `${generateId()}${Math.random().toString(36).substring(2, 6)}`;
}
