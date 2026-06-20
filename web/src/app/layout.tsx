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
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", type: "image/png" }],
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
  const darkSafariChromeColor = "#081822";
  const lightSafariChromeColor = "#e8f4f4";
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
        <RemiPwaRegister />
        {children}
      </body>
    </html>
  );
}
