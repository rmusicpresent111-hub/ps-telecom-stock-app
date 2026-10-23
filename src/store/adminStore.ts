/**
 * Admin Panel store — PS TELECOM Web Admin.
 *
 * Fully separate from the mobile app's zustand store (ps-telecom-store):
 * the admin panel is its own surface with its own persisted state.
 * Business DATA is shared through IndexedDB + the D1 cloud sync engine,
 * but UI state (section, language) is admin-private.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AdminLang } from '@/lib/admin-i18n';

export type AdminSection =
  | 'dashboard'
  | 'products'
  | 'bills'
  | 'due'
  | 'expenses'
  | 'parties'
  | 'staff'
  | 'reports'
  | 'billsettings'
  | 'sync';

export type AdminTheme = 'light' | 'dark';

interface AdminState {
  section: AdminSection;
  setSection: (s: AdminSection) => void;
  language: AdminLang;
  setLanguage: (l: AdminLang) => void;
  theme: AdminTheme;
  setTheme: (t: AdminTheme) => void;
  toggleTheme: () => void;
  drawerOpen: boolean;
  setDrawerOpen: (v: boolean) => void;
}

export const useAdminStore = create<AdminState>()(
  persist(
    (set) => ({
      section: 'dashboard',
      setSection: (section) => set({ section, drawerOpen: false }),
      language: 'bn',
      setLanguage: (language) => set({ language }),
      theme: 'light',
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })),
      drawerOpen: false,
      setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
    }),
    {
      name: 'ps-admin-store-v1',
      version: 1,
      // v2.16.0 removed the Database View section — a stale persisted
      // 'dataview' (or anything unknown) must fall back to the dashboard
      // instead of rendering a blank content area.
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<AdminState>;
        const valid: AdminSection[] = [
          'dashboard',
          'products',
          'bills',
          'due',
          'expenses',
          'parties',
          'staff',
          'reports',
          'billsettings',
          'sync',
        ];
        return {
          ...p,
          section: valid.includes(p.section as AdminSection) ? (p.section as AdminSection) : 'dashboard',
        } as AdminState;
      },
      partialize: (state) => ({ language: state.language, section: state.section, theme: state.theme }),
    }
  )
);
