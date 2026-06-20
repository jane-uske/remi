"use client";

import { useEffect } from "react";

export function RemiPwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // PWA installability should not block the main chat shell.
    });
  }, []);

  return null;
}