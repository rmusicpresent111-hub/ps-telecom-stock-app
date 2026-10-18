import type { Metadata } from 'next';
import AdminShell from '@/components/admin/AdminShell';

export const metadata: Metadata = {
  title: 'PS TELECOM — Admin Panel',
  description: 'Web admin console for PS TELECOM stock management — same encrypted database as the mobile app.',
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
