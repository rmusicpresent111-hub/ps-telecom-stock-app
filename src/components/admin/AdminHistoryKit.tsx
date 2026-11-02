'use client';

/**
 * Admin History Kit — shared building blocks for the section histories
 * (Cash v2.26, Due Book + Expenses v2.27):
 *
 *  - PeriodToggle: 7d / 30d / all-time pill group
 *  - windowPoints: tail-slice ascending daily points by period
 *  - niceTicks: round 1/2/2.5/5×10^k Y-axis ticks
 *  - DailyTallyChart: recharts ComposedChart — per-day bars (color per
 *    point) + a running line, localized tooltip, blue-free palette
 *  - collapseFlat: newest-first history rows where no-activity day runs
 *    collapse into ONE flat row (balance still shown)
 */

import { useMemo } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { fmtMoney, fmtDate } from './admin-ui';

export type Period = '7' | '30' | 'all';

export function PeriodToggle({
  value,
  onChange,
  labels,
}: {
  value: Period;
  onChange: (p: Period) => void;
  labels: { d7: string; d30: string; all: string };
}) {
  const opts: [Period, string][] = [
    ['7', labels.d7],
    ['30', labels.d30],
    ['all', labels.all],
  ];
  return (
    <div className="flex items-center gap-1.5" role="group">
      {opts.map(([p, label]) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          aria-pressed={value === p}
          className={`h-8 px-2.5 rounded-lg text-xs font-bold transition-colors ${
            value === p
              ? 'bg-[#16A34A] text-white shadow-sm'
              : 'border border-[var(--psa-border)] text-[var(--psa-sub)] hover:bg-[var(--psa-hover)]'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function windowPoints<T extends { date: string }>(points: T[], period: Period): T[] {
  if (period === 'all') return points;
  return points.slice(-1 * (period === '7' ? 7 : 30));
}

/** Round ticks (1/2/2.5/5 × 10^k) covering 0..max or lo..hi of the values. */
export function niceTicks(vals: number[]): number[] {
  if (vals.length === 0) return [];
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const span = Math.max(hi - lo, 100);
  const mag = Math.pow(10, Math.floor(Math.log10(span / 4)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= 5) ?? span / 4;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.999; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  if (ticks[ticks.length - 1] < hi) ticks.push(Math.ceil(hi / step) * step);
  return ticks;
}

export interface ChartPoint {
  date: string; // YYYY-MM-DD
  bar: number; // per-day value (sign/color set by barFill)
  line: number; // running value
}

/**
 * The shared growth chart. `barFill` colors each bar; legend shows
 * whichever labels are provided (green/red dots + the running line).
 */
export function DailyTallyChart({
  data,
  period,
  barFill,
  lineColor,
  formatBar,
  barSeriesName,
  legend,
  testId,
}: {
  data: ChartPoint[];
  period: Period;
  barFill: (p: ChartPoint) => string;
  lineColor: string;
  formatBar: (v: number) => string;
  barSeriesName: (p: ChartPoint) => string;
  legend: { green?: string; red?: string; line: string };
  testId?: string;
}) {
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const tickFill = dark ? '#8E9AAB' : '#6B7280';
  const gridStroke = dark ? 'rgba(142,154,171,0.15)' : 'rgba(107,114,128,0.18)';
  const tooltipStyle = {
    borderRadius: 10,
    border: '1px solid var(--psa-border)',
    background: 'var(--psa-card)',
    color: 'var(--psa-ink)',
    fontSize: 12,
  } as const;

  const ticks = useMemo(
    () => niceTicks(data.flatMap((p) => [p.bar, p.line, 0])),
    [data]
  );

  const shortDate = (date: string) => {
    const d = new Date(date + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return date;
    return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(d);
  };

  return (
    <>
      <div className="h-56 w-full" data-testid={testId}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: -2, bottom: 0 }}>
            <CartesianGrid stroke={gridStroke} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              tick={{ fontSize: 10, fill: tickFill }}
              axisLine={false}
              tickLine={false}
              interval={data.length <= 10 ? 0 : period === '30' ? 4 : 'equidistantPreserveStart'}
            />
            <YAxis
              tick={{ fontSize: 11, fill: tickFill }}
              axisLine={false}
              tickLine={false}
              width={60}
              domain={ticks.length ? [ticks[0], ticks[ticks.length - 1]] : [0, 100]}
              ticks={ticks.length ? ticks : undefined}
              tickFormatter={(v: number) => Math.round(v).toLocaleString('en-IN')}
            />
            <RTooltip
              formatter={(
                v: number,
                name: string,
                _item: unknown,
                _index: number,
                payload: { payload?: ChartPoint }[] | undefined
              ) => [
                name === 'bar' ? formatBar(v) : fmtMoney(v),
                name === 'bar'
                  ? barSeriesName(payload?.[0]?.payload ?? { date: '', bar: v, line: 0 })
                  : legend.line,
              ]}
              labelFormatter={(date: string) => fmtDate(date)}
              contentStyle={tooltipStyle}
              cursor={{ fill: dark ? 'rgba(142,154,171,0.08)' : 'rgba(250,110,65,0.06)' }}
            />
            <Bar dataKey="bar" radius={[3, 3, 0, 0]} maxBarSize={26}>
              {data.map((p) => (
                <Cell key={p.date} fill={barFill(p)} />
              ))}
            </Bar>
            <Line
              type="monotone"
              dataKey="line"
              stroke={lineColor}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3.5, fill: lineColor }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center gap-4 mt-2 text-[11px] font-medium text-[var(--psa-muted)]">
        {legend.green && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="w-2.5 h-2.5 rounded-sm bg-[#16A34A]" /> {legend.green}
          </span>
        )}
        {legend.red && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="w-2.5 h-2.5 rounded-sm bg-[#DC2626]" /> {legend.red}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="w-4 h-0.5 rounded" style={{ background: lineColor }} /> {legend.line}
        </span>
      </div>
    </>
  );
}

// ── flat-run collapse (shared by cash/due/expense history rows) ──

export type TallyRow<T> = { type: 'active'; p: T } | { type: 'flat'; from: string; to: string; lineValue: number };

/** Newest-first rows; consecutive no-activity days become ONE flat row. */
export function collapseFlat<T extends { date: string }>(
  points: T[],
  isActive: (p: T) => boolean,
  getLine: (p: T) => number
): TallyRow<T>[] {
  const rows: TallyRow<T>[] = [];
  let flat: { from: string; to: string; lineValue: number } | null = null;
  for (const p of [...points].reverse()) {
    if (isActive(p)) {
      if (flat) {
        rows.push({ type: 'flat', ...flat });
        flat = null;
      }
      rows.push({ type: 'active', p });
    } else if (flat) {
      flat.from = p.date; // walking newest → oldest, extend the run older
    } else {
      flat = { from: p.date, to: p.date, lineValue: getLine(p) };
    }
  }
  if (flat) rows.push({ type: 'flat', ...flat });
  return rows;
}
