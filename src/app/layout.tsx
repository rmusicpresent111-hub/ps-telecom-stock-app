import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PS TELECOM - Stock Management",
  description: "Premium stock management app for telecom shops. Track products, manage inventory, calculate profits, and generate reports.",
  keywords: ["PS TELECOM", "Stock Management", "Inventory", "Telecom Shop"],
  icons: {
    icon: "/logo.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#091413",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Fonts are self-hosted via next/font (no external hosts needed).
            connect-src allows: same-origin, dev/HMR + socket.io websockets,
            and api.cloudflare.com for the native (APK) D1 backup path. */}
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self' ws: wss: https://api.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster
          position="top-center"
          richColors
          theme="dark"
          toastOptions={{
            style: {
              background: 'rgba(20, 20, 40, 0.9)',
              border: '1px solid rgba(212, 168, 83, 0.2)',
              backdropFilter: 'blur(12px)',
              color: '#fff',
            },
          }}
        />
      </body>
    </html>
  );
}
