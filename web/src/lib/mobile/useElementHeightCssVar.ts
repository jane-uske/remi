"use client";

import { useEffect, type RefObject } from "react";

/**
 * Observe an element's height and publish it to a CSS custom property on
 * <html>. Used to expose the fixed composer's height as --remi-composer-height
 * so the message flow can reserve matching bottom padding.
 */
export function useElementHeightCssVar(
  ref: RefObject<HTMLElement | null>,
  varName: string,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const write = () => {
      root.style.setProperty(varName, `${Math.round(el.offsetHeight)}px`);
    };
    write();
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty(varName);
    };
  }, [ref, varName]);
}
