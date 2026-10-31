import type { NextConfig } from "next";

// GitHub Pages project-pages base path (web mirror deploy). Empty for the
// APK/dev/Vercel builds — only scripts/build-web-pages.js sets WEB_BASE_PATH.
const WEB_BASE_PATH = process.env.WEB_BASE_PATH || "";

// Baseline security headers applied to every route (dev + prod responses).
const securityHeaders = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
];

// Static export ("output: export") is required for the Capacitor APK build
// (build-apk.js) but MUST NOT be used when a real server hosts the app —
// static export cannot include the POST /api/cloud/d1 proxy route, so
// `next build` would fail and Cloud Backup would break.
// Vercel sets VERCEL=1 automatically in its build environment, and
// `next dev` always runs as a full server (so the site password gate /
// proxy.ts is active in the sandbox preview too):
//   - Vercel, `next dev`, any `next start` hosting → full server
//   - Everywhere else (APK script, `next build` locally) → static export
// as before. No manual configuration needed on either side.
const nextConfig: NextConfig = {
  output: process.env.VERCEL || process.env.NODE_ENV === "development" ? undefined : "export",
  reactStrictMode: false,
  // GitHub Pages project pages serve the site under /<repo>/ — set only for
  // the web mirror build; APK (file serving) and servers keep the root path.
  basePath: WEB_BASE_PATH || undefined,
  // APK static export ships client-side JS only — a stray type error (e.g. a
  // leftover file importing an uninstalled package) must never block the
  // user's local `npm run build`. Runtime correctness is guarded by the dev
  // server + lint, and `npx tsc --noEmit` can always be run manually.
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
