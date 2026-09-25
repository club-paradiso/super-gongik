import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "pretendard/dist/web/variable/PretendardVariable-VF.css";

import { OfflineBanner } from "@/components/offline-banner";
import { PwaRegistrar } from "@/components/pwa-registrar";
import { environment } from "@/env";
import "./globals.css";

export const metadata: Metadata = {
  title: "슈퍼공익 | SUPER GONGIK",
  description: "사회복무요원을 위한 신뢰할 수 있는 개인 복무 관리 도구",
  applicationName: "슈퍼공익",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "슈퍼공익",
  },
};

export const viewport: Viewport = {
  themeColor: "#f2f4f7",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  void environment;

  return (
    <html lang="ko">
      <body>
        <PwaRegistrar />
        <OfflineBanner />
        {children}
      </body>
    </html>
  );
}
