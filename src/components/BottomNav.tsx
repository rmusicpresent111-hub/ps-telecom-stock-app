'use client';

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

export default function BottomNav() {
  const { currentScreen, navigateTo, language } = useAppStore();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 glass-card-strong border-t border-white/10 border-b-0 rounded-b-none">
      <div className="max-w-md mx-auto flex items-center justify-around px-2 py-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentScreen === item.screen;
          return (
            <button
              key={item.screen}
              onClick={() => navigateTo(item.screen)}
              className={`bottom-nav-item ${isActive ? 'active' : ''}`}
              aria-label={t(item.labelKey, language)}
            >
              <Icon size={20} />
              <span className="text-[10px] font-medium">{t(item.labelKey, language)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
