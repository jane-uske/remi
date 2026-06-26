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

    // Self-heal: when a NEW service worker takes control of a page that was
    // ALREADY controlled (a SW update via skipWaiting + clients.claim, not the
    // first install), reload once so the user immediately gets the fresh shell
    // instead of being stuck on a stale cached page until a second manual
    // refresh. Guarded two ways: skip when there's no prior controller (first
    // install would otherwise reload spuriously), and a one-shot flag prevents
    // any reload loop.
    if (!navigator.serviceWorker.controller) return;
    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );
    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
    };
  }, []);

  return null;
}