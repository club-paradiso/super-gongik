import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "pretendard/dist/web/variable/PretendardVariable-VF.css";

import { OfflineBanner } from "@/components/offline-banner";
import { PwaRegistrar } from "@/components/pwa-registrar";
import { environment } from "@/env";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "슈퍼공익 | SUPER GONGIK",
  description: "사회복무요원을 위한 신뢰할 수 있는 개인 복무 관리 도구",
  applicationName: "슈퍼공익",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "슈퍼공익",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f4f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0d20" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  void environment;

  return (
    // `data-theme` is set before paint by the boot script from a per-browser
    // preference, so the server-rendered attribute may differ on hydration.
    <html data-theme="standard" lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <PwaRegistrar />
        <OfflineBanner />
        {children}
      </body>
    </html>
  );
}
