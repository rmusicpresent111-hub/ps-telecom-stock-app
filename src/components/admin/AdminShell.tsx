'use client';

/**
 * Admin Shell — the Vyapar-style web console frame.
 *
 * COMPLETELY different from the mobile app shell:
 *  - light gray canvas, white fixed sidebar (orange active states)
 *  - sticky top bar with sync chip
 *  - mobile: hamburger drawer + 5-slot bottom nav
 * Shares ONLY the data layer (IndexedDB + D1 sync engine) with the app.
 */

import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Package,
  ReceiptText,
  Wallet,
  Coins,
  Users,
  UserCog,
  BarChart3,
  FileText,
  Cloud,
  Menu,
  X,
  Smartphone,
  Sun,
  Moon,
  Zap,
  Lock,
} from 'lucide-react';
import { ensureDefaultUser } from '@/lib/local-auth';
import { startD1Sync, getD1SyncStatus, subscribeD1Status } from '@/lib/d1-sync';
import { useAdminStore, type AdminSection } from '@/store/adminStore';
import { ta, type AdminLang } from '@/lib/admin-i18n';
import { AdminToaster, Badge, Btn } from './admin-ui';
import QuickSellModal from './QuickSellModal';
import AdminDashboard from './AdminDashboard';
import AdminProducts from './AdminProducts';
import AdminBills from './AdminBills';
import AdminDueBook from './AdminDueBook';
import AdminExpenses from './AdminExpenses';
import AdminParties from './AdminParties';
import AdminStaffPayments from './AdminStaffPayments';
import AdminReports from './AdminReports';
import AdminBillSettings from './AdminBillSettings';
import AdminSync from './AdminSync';
import AdminPinGate, { lockAdminPanel } from './AdminPinGate';

const NAV: { key: AdminSection; icon: React.ComponentType<{ size?: number | string }>; navKey: string }[] = [
  { key: 'dashboard', icon: LayoutDashboard, navKey: 'nav.dashboard' },
  { key: 'products', icon: Package, navKey: 'nav.products' },
  { key: 'bills', icon: ReceiptText, navKey: 'nav.bills' },
  { key: 'due', icon: Wallet, navKey: 'nav.due' },
  { key: 'parties', icon: Users, navKey: 'nav.parties' },
  { key: 'expenses', icon: Coins, navKey: 'nav.expenses' },
  { key: 'staff', icon: UserCog, navKey: 'nav.staff' },
  { key: 'reports', icon: BarChart3, navKey: 'nav.reports' },
  { key: 'billsettings', icon: FileText, navKey: 'nav.billSettings' },
  { key: 'sync', icon: Cloud, navKey: 'nav.sync' },
];

const MOBILE_NAV: AdminSection[] = ['dashboard', 'products', 'bills', 'due', 'reports'];

const SECTION_TITLE: Record<AdminSection, string> = {
  dashboard: 'nav.dashboard',
  products: 'nav.products',
  bills: 'nav.bills',
  due: 'nav.due',
  parties: 'nav.parties',
  expenses: 'nav.expenses',
  staff: 'nav.staff',
  reports: 'nav.reports',
  billsettings: 'nav.billSettings',
  sync: 'nav.sync',
};

function SyncChip() {
  const [status, setStatus] = useState(getD1SyncStatus());
  const lang = useAdminStore((s) => s.language);

  useEffect(() => {
    const off = subscribeD1Status(setStatus);
    return off;
  }, []);

  const color =
    status.state === 'idle' ? '#16A34A' : status.state === 'syncing' ? '#FA6E41' : status.state === 'error' ? '#DC2626' : '#9CA3AF';
  const label =
    status.state === 'idle'
      ? ta('sync.connected', lang)
      : status.state === 'syncing'
        ? ta('sync.syncing', lang)
        : status.state === 'error'
          ? ta('sync.error', lang)
          : status.state === 'offline'
            ? ta('sync.offline', lang)
            : ta('sync.off', lang);

  return (
    <span className="inline-flex items-center gap-1.5 bg-[var(--psa-card)] border border-[var(--psa-border)] rounded-full pl-2 pr-3 py-1 text-[11px] font-semibold text-[var(--psa-sub)]">
      <span className="relative flex w-2 h-2">
        <span className="absolute inline-flex w-full h-full rounded-full opacity-40 animate-ping" style={{ background: color }} />
        <span className="relative inline-flex w-2 h-2 rounded-full" style={{ background: color }} />
      </span>
      {label}
    </span>
  );
}

function LangSwitch({ compact = false }: { compact?: boolean }) {
  const lang = useAdminStore((s) => s.language);
  const setLanguage = useAdminStore((s) => s.setLanguage);
  const opts: { v: AdminLang; label: string }[] = [
    { v: 'bn', label: 'বাং' },
    { v: 'en', label: 'EN' },
    { v: 'hi', label: 'हिं' },
  ];
  return (
    <div className={`inline-flex bg-[var(--psa-card)] border border-[var(--psa-border)] rounded-full overflow-hidden ${compact ? '' : ''}`}>
      {opts.map((o) => (
        <button
          key={o.v}
          onClick={() => setLanguage(o.v)}
          className={`px-2.5 py-1 text-[11px] font-bold transition-colors ${lang === o.v ? 'bg-[var(--psa-soft-orange)] text-[#E8552C]' : 'text-[var(--psa-muted)] hover:bg-[var(--psa-hover)]'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const section = useAdminStore((s) => s.section);
  const setSection = useAdminStore((s) => s.setSection);
  const lang = useAdminStore((s) => s.language);

  return (
    <nav className="flex flex-col gap-0.5 px-3" aria-label="Admin sections">
      {NAV.map(({ key, icon: Icon, navKey }) => {
        const active = section === key;
        return (
          <button
            key={key}
            onClick={() => {
              setSection(key);
              onNavigate?.();
            }}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors text-left ${
              active ? 'bg-[var(--psa-soft-orange)] text-[#E8552C]' : 'text-[var(--psa-sub)] hover:bg-[var(--psa-hover2)]'
            }`}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={18} />
            <span className="truncate">{ta(navKey, lang)}</span>
          </button>
        );
      })}
    </nav>
  );
}

function ThemeToggle() {
  const theme = useAdminStore((s) => s.theme);
  const toggleTheme = useAdminStore((s) => s.toggleTheme);
  const lang = useAdminStore((s) => s.language);
  const dark = theme === 'dark';
  return (
    <button
      onClick={toggleTheme}
      title={dark ? ta('theme.toLight', lang) : ta('theme.toDark', lang)}
      aria-label={dark ? ta('theme.toLight', lang) : ta('theme.toDark', lang)}
      className="w-9 h-9 rounded-lg flex items-center justify-center border border-[var(--psa-border)] bg-[var(--psa-card)] text-[var(--psa-muted)] hover:text-[#E8552C] hover:border-[#FA6E41]/40 transition-colors"
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

function SidebarInner({ onNavigate }: { onNavigate?: () => void }) {
  const lang = useAdminStore((s) => s.language);
  return (
    <div className="flex flex-col h-full">
      {/* brand */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FA6E41] to-[#E8552C] text-white flex items-center justify-center font-black text-sm shadow-[0_4px_10px_rgba(250,110,65,0.35)]">
          PS
        </div>
        <div className="min-w-0">
          <p className="text-[15px] font-black text-[var(--psa-ink)] leading-tight tracking-tight">PS TELECOM</p>
          <p className="text-[11px] font-semibold text-[#FA6E41]">{ta('shell.title', lang)}</p>
        </div>
      </div>
      <div className="px-5 pb-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--psa-faint)]">{ta('shell.subtitle', lang)}</p>
      </div>
      <div className="grow overflow-y-auto py-2">
        <NavList onNavigate={onNavigate} />
      </div>
      {/* footer */}
      <div className="border-t border-[var(--psa-line)] p-3 space-y-2">
        <div className="flex items-center justify-between px-1">
          <LangSwitch />
        </div>
        <button
          onClick={() => {
            lockAdminPanel(); // clear the unlock flag…
            if (typeof window !== 'undefined') window.location.reload(); // …the gate then takes over
          }}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold text-[var(--psa-muted)] hover:bg-[var(--psa-hover2)] transition-colors"
        >
          <Lock size={17} />
          {ta('lock.relock', lang)}
        </button>
        <a
          href="./"
          className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold text-[var(--psa-muted)] hover:bg-[var(--psa-hover2)] transition-colors"
        >
          <Smartphone size={17} />
          {ta('shell.backToApp', lang)}
        </a>
      </div>
    </div>
  );
}

function AdminShellInner() {
  const section = useAdminStore((s) => s.section);
  const setSection = useAdminStore((s) => s.setSection);
  const drawerOpen = useAdminStore((s) => s.drawerOpen);
  const setDrawerOpen = useAdminStore((s) => s.setDrawerOpen);
  const theme = useAdminStore((s) => s.theme);
  const lang = useAdminStore((s) => s.language);
  const [shopName, setShopName] = useState('');
  const [qsOpen, setQsOpen] = useState(false);
  const [qsPrefill, setQsPrefill] = useState<import('@/lib/types').Product | null>(null);

  const openQuickSell = (product: import('@/lib/types').Product | null = null) => {
    setQsPrefill(product);
    setQsOpen(true);
  };

  // boot: local profile + D1 sync engine (shared with the app)
  useEffect(() => {
    (async () => {
      try {
        const user = await ensureDefaultUser();
        setShopName(user.shopName || 'PS TELECOM');
      } catch {
        /* offline-private mode — shell still renders */
      }
    })();
    startD1Sync();
  }, []);

  // deep-link: /admin#bills etc.
  useEffect(() => {
    const hash = window.location.hash.replace('#', '') as AdminSection;
    if (SECTION_TITLE[hash]) setSection(hash);
  }, []);

  const title = ta(SECTION_TITLE[section], lang);

  return (
    <div className={`psadmin ${theme === 'dark' ? 'admin-dark' : ''} min-h-screen bg-[var(--psa-canvas)] text-[var(--psa-ink)] flex`}>
      {/* desktop sidebar */}
      <aside className="hidden lg:flex flex-col fixed inset-y-0 left-0 w-60 bg-[var(--psa-card)] border-r border-[var(--psa-border)] z-30">
        <SidebarInner />
      </aside>

      {/* mobile drawer */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-[#0F172A]/45" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-[var(--psa-card)] shadow-2xl flex flex-col">
            <button
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="absolute top-4 right-4 w-8 h-8 rounded-lg flex items-center justify-center text-[var(--psa-muted)] hover:bg-[var(--psa-hover2)]"
            >
              <X size={16} />
            </button>
            <SidebarInner onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      {/* main column */}
      <div className="grow lg:pl-60 flex flex-col min-w-0">
        {/* top bar */}
        <header className="sticky top-0 z-20 bg-[var(--psa-card)]/90 backdrop-blur border-b border-[var(--psa-border)]">
          <div className="flex items-center gap-3 px-4 lg:px-6 h-14">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label={ta('shell.menu', lang)}
              className="lg:hidden w-9 h-9 rounded-lg flex items-center justify-center text-[var(--psa-sub)] hover:bg-[var(--psa-hover2)]"
            >
              <Menu size={19} />
            </button>
            <div className="min-w-0 grow">
              <h1 className="text-[15px] font-bold text-[var(--psa-ink)] leading-tight truncate">{title}</h1>
              <p className="text-[11px] text-[var(--psa-faint)] leading-tight truncate">
                {shopName} · {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </p>
            </div>
            <div className="hidden sm:block">
              <LangSwitch compact />
            </div>
            <ThemeToggle />
            <Btn size="sm" onClick={() => openQuickSell()} className="!h-9">
              <Zap size={15} />
              <span className="hidden sm:inline">{ta('shell.quickSell', lang)}</span>
            </Btn>
            <SyncChip />
          </div>
        </header>

        {/* content */}
        <main className="grow px-4 lg:px-6 py-4 lg:py-6 pb-24 lg:pb-10 w-full max-w-[1200px] mx-auto">
          {section === 'dashboard' && (
            <AdminDashboard
              goSection={(s) => {
                setSection(s);
                if (typeof window !== 'undefined') window.history.replaceState(null, '', `#${s}`);
              }}
              onQuickSell={() => openQuickSell()}
            />
          )}
          {section === 'products' && <AdminProducts onQuickSell={(p) => openQuickSell(p)} />}
          {section === 'bills' && <AdminBills />}
          {section === 'due' && <AdminDueBook />}
          {section === 'parties' && <AdminParties />}
          {section === 'expenses' && <AdminExpenses />}
          {section === 'staff' && <AdminStaffPayments />}
          {section === 'reports' && <AdminReports />}
          {section === 'billsettings' && <AdminBillSettings />}
          {section === 'sync' && <AdminSync />}
        </main>

        {/* footer (sticky bottom, Vyapar-style strip) */}
        <footer className="mt-auto hidden lg:block border-t border-[var(--psa-border)] bg-[var(--psa-card)]">
          <div className="max-w-[1200px] mx-auto px-6 py-3 flex items-center justify-between text-[11px] text-[var(--psa-faint)]">
            <span>PS TELECOM {ta('shell.title', lang)} · v2.11.3</span>
            <span className="flex items-center gap-2">
              <Badge tone="orange">Web Admin</Badge>
              <Badge tone="green">D1 encrypted</Badge>
            </span>
          </div>
        </footer>
      </div>

      {/* mobile bottom nav */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-[var(--psa-card)] border-t border-[var(--psa-border)] flex"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Admin mobile nav"
      >
        {MOBILE_NAV.map((key) => {
          const item = NAV.find((n) => n.key === key)!;
          const Icon = item.icon;
          const active = section === key;
          return (
            <button
              key={key}
              onClick={() => setSection(key)}
              className={`grow flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition-colors min-h-[56px] justify-center ${
                active ? 'text-[#E8552C]' : 'text-[var(--psa-faint)]'
              }`}
            >
              <Icon size={20} />
              <span className="truncate max-w-full px-0.5">{ta(item.navKey, lang)}</span>
            </button>
          );
        })}
        <button
          onClick={() => setDrawerOpen(true)}
          className="grow flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold text-[var(--psa-faint)] min-h-[56px] justify-center"
        >
          <Menu size={20} />
          <span>{ta('shell.menu', lang)}</span>
        </button>
      </nav>

      <AdminToaster />

      {/* global Quick Sell dialog (top-bar button, dashboard, per-product sell) */}
      <QuickSellModal
        open={qsOpen}
        onClose={() => setQsOpen(false)}
        prefill={qsPrefill}
        onGoBills={() => {
          setSection('bills');
          if (typeof window !== 'undefined') window.history.replaceState(null, '', '#bills');
        }}
      />
    </div>
  );
}

/**
 * Exported shell = the PIN gate wrapping the real console.
 * While locked, NOTHING below the gate mounts — AdminShellInner's boot
 * effects (default profile + D1 sync) only run after a successful unlock,
 * so a stranger's device never receives shop data.
 */
export default function AdminShell() {
  return (
    <AdminPinGate>
      <AdminShellInner />
    </AdminPinGate>
  );
}
