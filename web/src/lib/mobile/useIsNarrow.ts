"use client";

import { useEffect, useState } from "react";

/** Tailwind's `md` breakpoint is 768px; narrow = below it (phones). */
const NARROW_QUERY = "(max-width: 767px)";

/**
 * SSR-safe narrow-screen test. Returns false during SSR / first paint so the
 * desktop (element-scroll) path renders deterministically, then updates on the
 * client. Used to gate the mobile document-scroll chat behavior.
 */
export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(NARROW_QUERY);
    const update = () => setNarrow(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return narrow;
}
