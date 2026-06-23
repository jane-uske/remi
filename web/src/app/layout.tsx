import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RemiPwaRegister } from "@/components/RemiPwaRegister";
import {
  buildSafariFocusZoomPatchScript,
} from "@/lib/mobile/safariFocusZoom";
import { THEME_PREFERENCE_STORAGE_KEY } from "@/lib/theme/themePreference";

export const metadata: Metadata = {
  title: "Remi AI",
  description: "实时 AI 陪伴 — 对话、记忆与情绪",
  applicationName: "Remi",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Remi",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/assets/remi/brand/remi-favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/assets/remi/brand/remi-icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/assets/remi/brand/remi-apple-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

/** 允许浏览器缩放（无障碍与移动端 pinch），布局随视口变化 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const darkSafariChromeColor = "#0f0a18";
  const lightSafariChromeColor = "#f3ecfb";
  const themeBootstrap = `
    try {
      var pref = localStorage.getItem('${THEME_PREFERENCE_STORAGE_KEY}');
      if (pref === 'light' || pref === 'dark') {
        document.documentElement.dataset.theme = pref;
        document.documentElement.style.colorScheme = pref;
        var themeColor = pref === 'light' ? '${lightSafariChromeColor}' : '${darkSafariChromeColor}';
        document.querySelectorAll('meta[name="theme-color"]').forEach(function (meta) {
          meta.setAttribute('content', themeColor);
          meta.removeAttribute('media');
        });
      } else {
        delete document.documentElement.dataset.theme;
        document.documentElement.style.colorScheme = '';
      }
    } catch (_) {}
  `;
  const safariFocusZoomPatch = buildSafariFocusZoomPatchScript();

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <meta
          name="theme-color"
          content={darkSafariChromeColor}
          media="(prefers-color-scheme: dark)"
        />
        <meta
          name="theme-color"
          content={lightSafariChromeColor}
          media="(prefers-color-scheme: light)"
        />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <script dangerouslySetInnerHTML={{ __html: safariFocusZoomPatch }} />
      </head>
      <body className="min-h-dvh overflow-x-hidden antialiased">
        {/* Safari 26+ Liquid Glass toolbar tinting sentinels.
            Safari derives toolbar chrome color from fixed elements near
            viewport edges; these invisible sentinels carry --remi-body-bg
            so the status bar / bottom toolbar match our page background. */}
        <div className="remi-safari-tint-top" aria-hidden="true" />
        <div className="remi-safari-tint-bottom" aria-hidden="true" />
        <RemiPwaRegister />
        {children}
      </body>
    </html>
  );
}
