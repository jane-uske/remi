"use client";

import { useEffect } from "react";

/**
 * Pin the iOS Safari chrome — the status-bar / Dynamic Island area and the
 * bottom Liquid Glass toolbar — plus the page's deep background to a single
 * color for the lifetime of the calling route, regardless of the global
 * light/dark theme.
 *
 * Why this exists: routes like the portal (`RemiLanding`) are designed
 * dark-only (full-bleed aurora). The Safari chrome tint, however, follows the
 * global theme via the `theme-color` meta tags and the `--remi-body-bg` token
 * that the fixed `.remi-safari-tint-*` sentinels read. On a light-mode device
 * that token resolves to a pale value (`#e8f4f4` / `#f3ecfb`), so the status
 * bar renders as a light band above the dark hero. Forcing the chrome color
 * per route removes that seam.
 *
 * Overrides (and restores on unmount) on `<html>`:
 *  - `--remi-route-bg` and `--remi-body-bg` — the latter is what the html
 *    background, the fixed aurora canvas, and both safe-area tint sentinels
 *    consume, so both viewport edges follow `color`.
 *  - every `<meta name="theme-color">` content, stripping its `media`
 *    attribute so it applies in any system color scheme (mirrors the theme
 *    bootstrap in `app/layout.tsx`).
 *
 * Restoring on unmount keeps other routes (e.g. the chat page) on their
 * theme-driven chrome instead of inheriting this route's override.
 */
export function useRouteChromeColor(color: string): void {
  useEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    const prevRouteBg = root.style.getPropertyValue("--remi-route-bg");
    const prevBodyBg = root.style.getPropertyValue("--remi-body-bg");

    root.style.setProperty("--remi-route-bg", color);
    root.style.setProperty("--remi-body-bg", color);

    const metas = Array.from(
      document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
    );
    const prevMetas = metas.map((el) => ({
      el,
      content: el.getAttribute("content"),
      media: el.getAttribute("media"),
    }));

    let injected: HTMLMetaElement | null = null;
    if (metas.length === 0) {
      injected = document.createElement("meta");
      injected.setAttribute("name", "theme-color");
      injected.setAttribute("content", color);
      document.head.appendChild(injected);
    } else {
      for (const el of metas) {
        el.setAttribute("content", color);
        el.removeAttribute("media");
      }
    }

    return () => {
      if (prevRouteBg) root.style.setProperty("--remi-route-bg", prevRouteBg);
      else root.style.removeProperty("--remi-route-bg");
      if (prevBodyBg) root.style.setProperty("--remi-body-bg", prevBodyBg);
      else root.style.removeProperty("--remi-body-bg");

      if (injected) {
        injected.remove();
        return;
      }
      for (const prev of prevMetas) {
        if (prev.content != null) prev.el.setAttribute("content", prev.content);
        if (prev.media != null) prev.el.setAttribute("media", prev.media);
        else prev.el.removeAttribute("media");
      }
    };
  }, [color]);
}
