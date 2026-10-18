'use client';

/**
 * Admin UI kit — PS TELECOM Web Admin (Vyapar-style).
 *
 * A deliberately SEPARATE design system from the mobile app:
 *  - light gray canvas (#F4F6F8), white cards, 12px radius, hairline borders
 *  - Vyapar orange (#FA6E41) primary, green = money-in, red = money-out
 *  - business tables, dialogs and toasts (no shadcn theme coupling —
 *    the app's dark/gold theme variables must never leak into the admin)
 */

import { useEffect, useState, type ReactNode } from 'react';

// ── design tokens ───────────────────────────────────────────────
export const ADMIN_COLORS = {
  orange: '#FA6E41',
  orangeDark: '#E8552C',
  orangeSoft: '#FFF1EB',
  green: '#16A34A',
  greenSoft: '#F0FDF4',
  red: '#DC2626',
  redSoft: '#FEF2F2',
  amber: '#D97706',
  amberSoft: '#FFFBEB',
  ink: '#1F2937',
  muted: '#6B7280',
  border: '#E8EAED',
  canvas: '#F4F6F8',
} as const;

export function fmtMoney(n: number | undefined | null): string {
  const v = Number(n || 0);
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(dateStr: string | undefined): string {
  if (!dateStr) return '—';
  const d = dateStr.length > 10 ? new Date(dateStr) : new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS_EN[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtDateTime(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${fmtDate(iso)} · ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
}

export function relativeTime(ms: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return '< 1m';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

// ── cards ───────────────────────────────────────────────────────

export function AdminCard({
  title,
  action,
  children,
  className = '',
  bodyClass = '',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <div
      className={`bg-white rounded-xl border border-[#E8EAED] shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${className}`}
    >
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 pt-4 pb-1">
          {title && <h3 className="text-[15px] font-semibold text-[#1F2937]">{title}</h3>}
          {action}
        </div>
      )}
      <div className={`p-4 sm:p-5 ${bodyClass}`}>{children}</div>
    </div>
  );
}

const STAT_TONES = {
  orange: { bg: '#FFF1EB', fg: '#E8552C' },
  green: { bg: '#F0FDF4', fg: '#16A34A' },
  red: { bg: '#FEF2F2', fg: '#DC2626' },
  amber: { bg: '#FFFBEB', fg: '#D97706' },
  slate: { bg: '#F1F5F9', fg: '#475569' },
} as const;

export type StatTone = keyof typeof STAT_TONES;

export function StatCard({
  icon,
  label,
  value,
  tone = 'orange',
  sub,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  tone?: StatTone;
  sub?: ReactNode;
  onClick?: () => void;
}) {
  const t = STAT_TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left bg-white rounded-xl border border-[#E8EAED] shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-4 flex items-start gap-3 transition-all ${onClick ? 'hover:border-[#FA6E41]/40 hover:shadow-[0_4px_12px_rgba(250,110,65,0.12)] cursor-pointer' : 'cursor-default'}`}
    >
      <span
        aria-hidden
        className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
        style={{ background: t.bg, color: t.fg }}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-[#6B7280] truncate">{label}</span>
        <span className="block text-lg sm:text-xl font-bold text-[#1F2937] tabular-nums leading-tight mt-0.5">
          {value}
        </span>
        {sub && <span className="block text-[11px] text-[#6B7280] mt-0.5 truncate">{sub}</span>}
      </span>
    </button>
  );
}

export function PageHeader({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div>
        <h2 className="text-xl font-bold text-[#1F2937]">{title}</h2>
        {sub && <p className="text-sm text-[#6B7280] mt-0.5">{sub}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}

// ── buttons ─────────────────────────────────────────────────────

type BtnVariant = 'primary' | 'soft' | 'outline' | 'danger' | 'ghost' | 'green';

const BTN_STYLES: Record<BtnVariant, string> = {
  primary: 'bg-[#FA6E41] hover:bg-[#E8552C] text-white shadow-sm disabled:bg-[#FA6E41]/50',
  soft: 'bg-[#FFF1EB] hover:bg-[#FFE4D6] text-[#E8552C]',
  outline: 'border border-[#E8EAED] bg-white hover:bg-[#F9FAFB] text-[#374151]',
  danger: 'bg-[#DC2626] hover:bg-[#B91C1C] text-white',
  ghost: 'text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#1F2937]',
  green: 'bg-[#16A34A] hover:bg-[#15803D] text-white',
};

export function Btn({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  ...rest
}: {
  variant?: BtnVariant;
  size?: 'sm' | 'md';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const sz =
    size === 'sm'
      ? 'h-8 px-3 text-xs rounded-lg gap-1.5'
      : 'h-10 px-4 text-sm rounded-lg gap-2';
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none ${sz} ${BTN_STYLES[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

// ── form controls ───────────────────────────────────────────────

const FIELD_BASE =
  'w-full h-10 rounded-lg border border-[#E1E4E8] bg-white px-3 text-sm text-[#1F2937] placeholder:text-[#9CA3AF] outline-none focus:border-[#FA6E41] focus:ring-2 focus:ring-[#FA6E41]/15 transition-shadow';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props;
  return <input {...rest} className={`${FIELD_BASE} ${className}`} />;
}

export function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', children, ...rest } = props;
  return (
    <select
      {...rest}
      className={`${FIELD_BASE} pr-8 appearance-none bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")] bg-[right_0.6rem_center] bg-no-repeat ${className}`}
    >
      {children}
    </select>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-[#4B5563] mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-[#9CA3AF] mt-1">{hint}</span>}
    </label>
  );
}

// ── badges ──────────────────────────────────────────────────────

type BadgeTone = 'green' | 'red' | 'amber' | 'slate' | 'orange';

const BADGE_STYLES: Record<BadgeTone, string> = {
  green: 'bg-[#F0FDF4] text-[#16A34A]',
  red: 'bg-[#FEF2F2] text-[#DC2626]',
  amber: 'bg-[#FFFBEB] text-[#D97706]',
  slate: 'bg-[#F1F5F9] text-[#475569]',
  orange: 'bg-[#FFF1EB] text-[#E8552C]',
};

export function Badge({ tone = 'slate', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE_STYLES[tone]}`}>
      {children}
    </span>
  );
}

// ── modal ───────────────────────────────────────────────────────

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-[#0F172A]/45 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={`relative bg-white w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8EAED] shrink-0">
          <h3 className="text-base font-bold text-[#1F2937]">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6B7280] hover:bg-[#F3F4F6]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 grow">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-[#E8EAED] shrink-0">{footer}</div>}
      </div>
    </div>
  );
}

// ── misc ────────────────────────────────────────────────────────

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block w-5 h-5 rounded-full border-2 border-[#FA6E41]/25 border-t-[#FA6E41] animate-spin ${className}`}
      role="status"
      aria-label="loading"
    />
  );
}

export function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body?: string }) {
  return (
    <div className="py-10 text-center">
      <div className="mx-auto w-12 h-12 rounded-full bg-[#FFF1EB] text-[#FA6E41] flex items-center justify-center mb-3">
        {icon}
      </div>
      <p className="text-sm font-semibold text-[#374151]">{title}</p>
      {body && <p className="text-xs text-[#9CA3AF] mt-1">{body}</p>}
    </div>
  );
}

// ── toast (admin-private, light Vyapar styling) ─────────────────

type AdminToast = { id: number; msg: string; tone: 'ok' | 'err' | 'info' };
type ToastListener = (t: AdminToast) => void;

const toastListeners = new Set<ToastListener>();
let toastSeq = 0;

export function adminToast(msg: string, tone: AdminToast['tone'] = 'ok'): void {
  const t: AdminToast = { id: ++toastSeq, msg, tone };
  toastListeners.forEach((fn) => fn(t));
}

export function AdminToaster() {
  const [items, setItems] = useState<AdminToast[]>([]);

  useEffect(() => {
    const fn: ToastListener = (t) => {
      setItems((prev) => [...prev.slice(-2), t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 3200);
    };
    toastListeners.add(fn);
    return () => {
      toastListeners.delete(fn);
    };
  }, []);

  return (
    <div className="fixed z-[90] bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 sm:left-auto sm:right-6 sm:translate-x-0 flex flex-col gap-2 pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className="flex items-center gap-2.5 bg-white border border-[#E8EAED] shadow-[0_8px_24px_rgba(16,24,40,0.16)] rounded-xl px-4 py-2.5 text-sm font-medium text-[#1F2937]"
        >
          <span
            aria-hidden
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              background:
                t.tone === 'ok' ? ADMIN_COLORS.green : t.tone === 'err' ? ADMIN_COLORS.red : ADMIN_COLORS.orange,
            }}
          />
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ── table helpers ───────────────────────────────────────────────

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={`text-left text-[11px] font-bold uppercase tracking-wide text-[#6B7280] px-4 py-2.5 border-b border-[#E8EAED] whitespace-nowrap ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <td className={`px-4 py-3 text-sm text-[#1F2937] border-b border-[#F1F3F5] align-middle ${className}`}>{children}</td>
  );
}
