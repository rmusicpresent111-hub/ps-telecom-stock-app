/**
 * In-memory cache with TTL for Supabase query results
 * Prevents redundant network calls when navigating between screens
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

// ✅ OPTIMIZED TTLs: Increased to reduce API calls during normal navigation
// Dashboard rarely changes in seconds - 60s is plenty for real-time feel
const DEFAULT_TTL = 60_000;       // 30s → 60s
const DASHBOARD_TTL = 60_000;     // 20s → 60s (biggest win - most loaded screen)
const PRODUCTS_TTL = 60_000;      // 25s → 60s (products don't change every second)
const CATEGORIES_TTL = 120_000;   // 60s → 120s (categories rarely change)
const TRANSACTIONS_TTL = 30_000;  // 15s → 30s (needs reasonable freshness)
const REPORTS_TTL = 60_000;       // 30s → 60s (reports are historical)

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttl) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setCache<T>(key: string, data: T, ttl: number = DEFAULT_TTL): void {
  cache.set(key, { data, timestamp: Date.now(), ttl });
}

export function invalidateCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

// Specific cache key generators
export const cacheKeys = {
  dashboard: (userId: string) => `dashboard:${userId}`,
  products: (userId: string, opts?: string) => `products:${userId}:${opts || 'all'}`,
  categories: (userId: string) => `categories:${userId}`,
  transactions: (userId: string, opts?: string) => `transactions:${userId}:${opts || 'all'}`,
  reports: (userId: string, type: string, opts?: string) => `reports:${userId}:${type}:${opts || ''}`,
  profile: (userId: string) => `profile:${userId}`,
  expenses: (userId: string, opts?: string) => `expenses:${userId}:${opts || ''}`,
  cashEntries: (userId: string, opts?: string) => `cashEntries:${userId}:${opts || ''}`,
};

export const cacheTTL = {
  dashboard: DASHBOARD_TTL,
  products: PRODUCTS_TTL,
  categories: CATEGORIES_TTL,
  transactions: TRANSACTIONS_TTL,
  reports: REPORTS_TTL,
};
