'use client';

import SiteLockForm from '@/components/SiteLockForm';

/**
 * /site-lock — the site-wide password screen. middleware.ts redirects every
 * locked visitor here; after a successful unlock the httpOnly gate cookie
 * is set and the visitor is sent back to the app.
 */
export default function SiteLockPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(1200px_600px_at_50%_-10%,rgba(250,110,65,0.14),transparent),linear-gradient(180deg,#0a1210,#070d0c)] p-4">
      <SiteLockForm
        onUnlock={() => {
          window.location.replace('/');
        }}
      />
    </main>
  );
}
