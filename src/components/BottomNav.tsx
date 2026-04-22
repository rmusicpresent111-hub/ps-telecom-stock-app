'use client';

import { memo } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { House, Package, TrendingUp, Clock, User } from 'lucide-react';
import { Screen } from '@/lib/types';

const navItems: { icon: React.ElementType; screen: Screen; labelKey: 'dashboard' | 'products' | 'profit' | 'history' | 'profile' }[] = [
  { icon: House, screen: 'dashboard', labelKey: 'dashboard' },
  { icon: Package, screen: 'product-list', labelKey: 'products' },
  { icon: TrendingUp, screen: 'profit', labelKey: 'profit' },
  { icon: Clock, screen: 'history', labelKey: 'history' },
  { icon: User, screen: 'profile', labelKey: 'profile' },
];

// ✅ Memoized nav item to prevent re-rendering all items when only one changes
const NavItem = memo(function NavItem({ icon: Icon, screen, label, isActive, onTap }: {
  icon: React.ElementType;
  screen: Screen;
  label: string;
  isActive: boolean;
  onTap: () => void;
}) {
  return (
    <button
      onClick={onTap}
      className={`bottom-nav-item ${isActive ? 'active' : ''}`}
      aria-label={label}
    >
      <Icon size={20} />
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
});

export default function BottomNav() {
  // ✅ Use individual selectors to prevent re-renders from unrelated state changes
  const currentScreen = useAppStore(s => s.currentScreen);
  const navigateToTab = useAppStore(s => s.navigateToTab);
  const language = useAppStore(s => s.language);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 glass-card-strong border-t border-white/10 border-b-0 rounded-b-none">
      <div className="max-w-md mx-auto flex items-center justify-around px-2 py-1">
        {navItems.map((item) => (
          <NavItem
            key={item.screen}
            icon={item.icon}
            screen={item.screen}
            label={t(item.labelKey, language)}
            isActive={currentScreen === item.screen}
            onTap={() => navigateToTab(item.screen)}
          />
        ))}
      </div>
    </nav>
  );
}
