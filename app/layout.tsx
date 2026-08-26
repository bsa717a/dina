import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import { requireSession } from "@/lib/auth/session";
import { pwaIdentityForKey, type PwaIdentity } from "@/lib/pwa/identity";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

async function pwaIdentityFromSession(): Promise<PwaIdentity> {
  try {
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
      return pwaIdentityForKey("dina");
    }
    const user = await requireSession();
    return pwaIdentityForKey(user?.assistantKey);
  } catch {
    return pwaIdentityForKey("dina");
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const identity = await pwaIdentityFromSession();
  return {
    title: identity.name,
    description: identity.description,
    applicationName: identity.name,
    manifest: identity.manifestUrl,
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: identity.name,
    },
    icons: {
      icon: [
        { url: identity.icon192, sizes: "192x192", type: "image/png" },
        { url: identity.icon512, sizes: "512x512", type: "image/png" },
      ],
      apple: [
        { url: identity.appleTouchIcon, sizes: "180x180", type: "image/png" },
      ],
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#121211" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Must run before React so drops never navigate to the file URL. */}
        <Script src="/file-drop-guard.js" strategy="beforeInteractive" />
        {/* Capture Chrome's install event before React hydrates. */}
        <Script src="/pwa-install-capture.js" strategy="beforeInteractive" />
      </head>
      <body className="min-h-full bg-[var(--background)] text-[var(--foreground)]">
        {children}
      </body>
    </html>
  );
}
