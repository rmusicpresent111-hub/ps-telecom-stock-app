import type { NextConfig } from "next";

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
// Vercel sets VERCEL=1 automatically in its build environment, so:
//   - Vercel (and any normal `next build`/`next start` hosting) → full server
//   - Everywhere else (APK script, `next build` locally) → static export
// as before. No manual configuration needed on either side.
const nextConfig: NextConfig = {
  output: process.env.VERCEL ? undefined : "export",
  reactStrictMode: false,
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
