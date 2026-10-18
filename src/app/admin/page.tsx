'use client';

/**
 * PS TELECOM — Web Admin Panel (/admin)
 *
 * A SEPARATE Vyapar-style management console for the shop owner:
 * its own light/orange design system, sidebar structure and language —
 * sharing the same offline-first IndexedDB data layer and the same
 * encrypted Cloudflare D1 database as the mobile app.
 */

import dynamic from 'next/dynamic';
import { Spinner } from '@/components/admin/admin-ui';

const AdminShell = dynamic(() => import('@/components/admin/AdminShell'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-[#F4F6F8] flex items-center justify-center">
      <Spinner />
    </div>
  ),
});

export default function AdminPage() {
  return <AdminShell />;
}
