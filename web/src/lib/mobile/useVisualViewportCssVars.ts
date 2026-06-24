"use client";

import { useEffect } from "react";

/**
 * Mirror the iOS Safari VisualViewport geometry into CSS custom properties on
 * <html> so a fixed composer can ride above the on-screen keyboard.
 *
 * Exposes (px), rAF-throttled and reset on unmount:
 *  - --remi-vv-bottom-offset: window.innerHeight - vv.height - vv.offsetTop
 *      (the keyboard height; 0 when no keyboard). The composer translates up
 *      by this amount.
 *  - --remi-vv-height / --remi-vv-offset-top: raw visual-viewport metrics.
 *
 * Only active on narrow screens; desktop is left untouched.
 */
export function useVisualViewportCssVars(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
    if (window.matchMedia && !window.matchMedia("(max-width: 767px)").matches) {
      return;
    }

    const root = document.documentElement;
    let raf = 0;

    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const bottomOffset = Math.max(
          0,
          window.innerHeight - vv.height - vv.offsetTop,
        );
        root.style.setProperty("--remi-vv-bottom-offset", `${bottomOffset}px`);
        root.style.setProperty("--remi-vv-height", `${vv.height}px`);
        root.style.setProperty("--remi-vv-offset-top", `${vv.offsetTop}px`);
      });
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("orientationchange", update);

    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("orientationchange", update);
      root.style.removeProperty("--remi-vv-bottom-offset");
      root.style.removeProperty("--remi-vv-height");
      root.style.removeProperty("--remi-vv-offset-top");
    };
  }, []);
}
