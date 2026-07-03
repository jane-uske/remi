// Bump this on shell-strategy changes so the activate handler purges old caches.
// v7: purge caches poisoned by cross-origin interception (see the origin guard
// in the fetch handler) — v6 cached Clerk's GET /v1/client, pinning a stale
// signed-out auth state after OAuth logins.
const CACHE_NAME = "remi-shell-v7";
const SHELL_ASSETS = [
  "/assets/remi/brand/remi-favicon-32.png",
  "/assets/remi/brand/remi-icon-192.png",
  "/assets/remi/brand/remi-apple-icon-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

// Fix D: allow the app to clear all SW caches during sign-out, so stale
// assets don't outlive the user's session. Posted by forceSignOutNavigation()
// and clearSwCaches() in RemiAuthProvider.
self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_CACHES") {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(keys.map((key) => caches.delete(key))),
      ),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never intercept cross-origin requests. Caching third-party responses is
  // what broke auth: clerk-js's GET /v1/client (Clerk Frontend API) was cached
  // cache-first, so a pre-login signed-out snapshot kept being served after
  // OAuth sign-ins — the app stayed on the portal until a hard refresh
  // bypassed the SW.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/ws") || url.pathname.startsWith("/api/") || url.pathname === "/health") {
    return;
  }
  // Next.js RSC payload fetches (soft navigations / prefetches) are dynamic
  // page state, not shell assets — cache-first would pin stale pages.
  if (url.searchParams.has("_rsc") || request.headers.get("RSC") === "1") {
    return;
  }

  // Navigations (the HTML shell): NETWORK-FIRST. Cache-first here served a stale
  // shell after every redeploy — it referenced old JS chunks/Server-Action ids,
  // which surfaced as "signed out after refresh" until a hard refresh. Always
  // fetch fresh HTML; fall back to cache only when truly offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match("/")),
        ),
    );
    return;
  }

  // Other GET (Next content-hashed static assets, icons): cache-first is safe —
  // a new build ships new hashed URLs, so it just misses cache and fetches fresh.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (!response.ok || response.type === "opaque") return response;
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => cached);
    }),
  );
});
