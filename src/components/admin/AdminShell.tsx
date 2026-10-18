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
  BarChart3,
  Cloud,
  Menu,
  X,
  Smartphone,
} from 'lucide-react';
import { ensureDefaultUser } from '@/lib/local-auth';
import { startD1Sync, getD1SyncStatus, subscribeD1Status } from '@/lib/d1-sync';
import { useAdminStore, type AdminSection } from '@/store/adminStore';
import { ta, type AdminLang } from '@/lib/admin-i18n';
import { AdminToaster, Badge } from './admin-ui';
import AdminDashboard from './AdminDashboard';
import AdminProducts from './AdminProducts';
import AdminBills from './AdminBills';
import AdminDueBook from './AdminDueBook';
import AdminExpenses from './AdminExpenses';
import AdminReports from './AdminReports';
import AdminSync from './AdminSync';

const NAV: { key: AdminSection; icon: React.ComponentType<{ size?: number | string }>; navKey: string }[] = [
  { key: 'dashboard', icon: LayoutDashboard, navKey: 'nav.dashboard' },
  { key: 'products', icon: Package, navKey: 'nav.products' },
  { key: 'bills', icon: ReceiptText, navKey: 'nav.bills' },
  { key: 'due', icon: Wallet, navKey: 'nav.due' },
  { key: 'expenses', icon: Coins, navKey: 'nav.expenses' },
  { key: 'reports', icon: BarChart3, navKey: 'nav.reports' },
  { key: 'sync', icon: Cloud, navKey: 'nav.sync' },
];

const MOBILE_NAV: AdminSection[] = ['dashboard', 'products', 'bills', 'due', 'reports'];

const SECTION_TITLE: Record<AdminSection, string> = {
  dashboard: 'nav.dashboard',
  products: 'nav.products',
  bills: 'nav.bills',
  due: 'nav.due',
  expenses: 'nav.expenses',
  reports: 'nav.reports',
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
    <span className="inline-flex items-center gap-1.5 bg-white border border-[#E8EAED] rounded-full pl-2 pr-3 py-1 text-[11px] font-semibold text-[#4B5563]">
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
    <div className={`inline-flex bg-white border border-[#E8EAED] rounded-full overflow-hidden ${compact ? '' : ''}`}>
      {opts.map((o) => (
        <button
          key={o.v}
          onClick={() => setLanguage(o.v)}
          className={`px-2.5 py-1 text-[11px] font-bold transition-colors ${lang === o.v ? 'bg-[#FFF1EB] text-[#E8552C]' : 'text-[#6B7280] hover:bg-[#F9FAFB]'}`}
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
              active ? 'bg-[#FFF1EB] text-[#E8552C]' : 'text-[#4B5563] hover:bg-[#F3F4F6]'
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
          <p className="text-[15px] font-black text-[#1F2937] leading-tight tracking-tight">PS TELECOM</p>
          <p className="text-[11px] font-semibold text-[#FA6E41]">{ta('shell.title', lang)}</p>
        </div>
      </div>
      <div className="px-5 pb-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#B0B7C3]">{ta('shell.subtitle', lang)}</p>
      </div>
      <div className="grow overflow-y-auto py-2">
        <NavList onNavigate={onNavigate} />
      </div>
      {/* footer */}
      <div className="border-t border-[#F1F3F5] p-3 space-y-2">
        <div className="flex items-center justify-between px-1">
          <LangSwitch />
        </div>
        <a
          href="./"
          className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold text-[#6B7280] hover:bg-[#F3F4F6] transition-colors"
        >
          <Smartphone size={17} />
          {ta('shell.backToApp', lang)}
        </a>
      </div>
    </div>
  );
}

export default function AdminShell() {
  const section = useAdminStore((s) => s.section);
  const setSection = useAdminStore((s) => s.setSection);
  const drawerOpen = useAdminStore((s) => s.drawerOpen);
  const setDrawerOpen = useAdminStore((s) => s.setDrawerOpen);
  const lang = useAdminStore((s) => s.language);
  const [shopName, setShopName] = useState('');

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
    <div className="min-h-screen bg-[#F4F6F8] text-[#1F2937] flex">
      {/* desktop sidebar */}
      <aside className="hidden lg:flex flex-col fixed inset-y-0 left-0 w-60 bg-white border-r border-[#E8EAED] z-30">
        <SidebarInner />
      </aside>

      {/* mobile drawer */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-[#0F172A]/45" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-2xl flex flex-col">
            <button
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="absolute top-4 right-4 w-8 h-8 rounded-lg flex items-center justify-center text-[#6B7280] hover:bg-[#F3F4F6]"
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
        <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-[#E8EAED]">
          <div className="flex items-center gap-3 px-4 lg:px-6 h-14">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label={ta('shell.menu', lang)}
              className="lg:hidden w-9 h-9 rounded-lg flex items-center justify-center text-[#374151] hover:bg-[#F3F4F6]"
            >
              <Menu size={19} />
            </button>
            <div className="min-w-0 grow">
              <h1 className="text-[15px] font-bold text-[#1F2937] leading-tight truncate">{title}</h1>
              <p className="text-[11px] text-[#9CA3AF] leading-tight truncate">
                {shopName} · {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </p>
            </div>
            <div className="hidden sm:block">
              <LangSwitch compact />
            </div>
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
            />
          )}
          {section === 'products' && <AdminProducts />}
          {section === 'bills' && <AdminBills />}
          {section === 'due' && <AdminDueBook />}
          {section === 'expenses' && <AdminExpenses />}
          {section === 'reports' && <AdminReports />}
          {section === 'sync' && <AdminSync />}
        </main>

        {/* footer (sticky bottom, Vyapar-style strip) */}
        <footer className="mt-auto hidden lg:block border-t border-[#E8EAED] bg-white">
          <div className="max-w-[1200px] mx-auto px-6 py-3 flex items-center justify-between text-[11px] text-[#9CA3AF]">
            <span>PS TELECOM {ta('shell.title', lang)} · v2.9.0</span>
            <span className="flex items-center gap-2">
              <Badge tone="orange">Web Admin</Badge>
              <Badge tone="green">D1 encrypted</Badge>
            </span>
          </div>
        </footer>
      </div>

      {/* mobile bottom nav */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-[#E8EAED] flex"
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
                active ? 'text-[#E8552C]' : 'text-[#9CA3AF]'
              }`}
            >
              <Icon size={20} />
              <span className="truncate max-w-full px-0.5">{ta(item.navKey, lang)}</span>
            </button>
          );
        })}
        <button
          onClick={() => setDrawerOpen(true)}
          className="grow flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold text-[#9CA3AF] min-h-[56px] justify-center"
        >
          <Menu size={20} />
          <span>{ta('shell.menu', lang)}</span>
        </button>
      </nav>

      <AdminToaster />
    </div>
  );
}
