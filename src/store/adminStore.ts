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
  | 'reports'
  | 'sync';

interface AdminState {
  section: AdminSection;
  setSection: (s: AdminSection) => void;
  language: AdminLang;
  setLanguage: (l: AdminLang) => void;
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
      drawerOpen: false,
      setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
    }),
    {
      name: 'ps-admin-store-v1',
      partialize: (state) => ({ language: state.language, section: state.section }),
    }
  )
);
