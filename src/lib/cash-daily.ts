/**
 * Cash daily aggregation — PURE, dependency-free.
 *
 * Turns cash-ledger entries into day-by-day points:
 *  - cashIn / cashOut per day
 *  - net = cashIn − cashOut (did cash grow or shrink that day)
 *  - endBalance = running "cash in hand at day end" (koto tarikhe koto taka chilo)
 *
 * Missing calendar days between the first entry and today are FILLED with
 * flat points (net 0, carried balance) so the growth graph shows honest
 * flat stretches instead of skipping days.
 *
 * No IndexedDB / React imports here on purpose — this module can be unit-
 * exercised with demo data fully in memory without touching any store.
 */

export interface CashDailyInput {
  date: string; // YYYY-MM-DD
  cashIn: number;
  cashOut: number;
}

export interface CashDailyPoint {
  date: string; // YYYY-MM-DD
  cashIn: number;
  cashOut: number;
  net: number; // cashIn − cashOut
  endBalance: number; // running day-end cash in hand
}

/** Local-timezone YYYY-MM-DD (mirrors offline-service localDateStr). */
export function dailyLocalDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function nextDay(date: string): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return dailyLocalDateStr(d);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Build ascending daily points from ANY order of ledger entries.
 * Accumulates the balance forward from the first entry day (starts at 0),
 * fills gap days up to today, and always ends on today.
 */
export function buildCashDaily(entries: CashDailyInput[]): CashDailyPoint[] {
  if (entries.length === 0) return [];

  // 1) group by date
  const byDay = new Map<string, { in: number; out: number }>();
  for (const e of entries) {
    if (!e.date) continue;
    const day = byDay.get(e.date) ?? { in: 0, out: 0 };
    day.in += Number(e.cashIn) || 0;
    day.out += Number(e.cashOut) || 0;
    byDay.set(e.date, day);
  }
  if (byDay.size === 0) return [];

  // 2) walk from first activity day to today, accumulating
  const today = dailyLocalDateStr();
  const firstDay = [...byDay.keys()].sort()[0];
  if (firstDay > today) return []; // clock anomaly — refuse to project future

  const points: CashDailyPoint[] = [];
  let balance = 0;
  let cursor = firstDay;
  // hard ceiling — ~10 years of days, protects against bad dates
  for (let i = 0; i < 4000 && cursor <= today; i++) {
    const day = byDay.get(cursor);
    const cashIn = r2(day?.in ?? 0);
    const cashOut = r2(day?.out ?? 0);
    balance = r2(balance + cashIn - cashOut);
    points.push({ date: cursor, cashIn, cashOut, net: r2(cashIn - cashOut), endBalance: balance });
    cursor = nextDay(cursor);
  }
  return points;
}
