import type { IncomingMessage, ServerResponse } from "http";

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  maxBuckets?: number;
}

const DEFAULT_HTTP: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 100,
  maxBuckets: 1000
};
const DEFAULT_WS: RateLimitConfig = {
  windowMs: 10_000,
  maxRequests: 30,
  maxBuckets: 500
};

interface Bucket {
  count: number;
  windowStart: number;
}

const httpBuckets = new Map<string, Bucket>();

function pruneStale(buckets: Map<string, Bucket>, now: number, windowMs: number): void {
  const stale = windowMs * 2;
  for (const [key, b] of buckets) {
    if (now - b.windowStart > stale) {
      buckets.delete(key);
    }
  }
}

function ensureBucketLimit(buckets: Map<string, Bucket>, maxBuckets: number): void {
  if (maxBuckets && buckets.size > maxBuckets) {
    const oldestKeys = Array.from(buckets.entries())
      .sort((a, b) => a[1].windowStart - b[1].windowStart)
      .slice(0, buckets.size - maxBuckets)
      .map(entry => entry[0]);
    oldestKeys.forEach(key => buckets.delete(key));
  }
}

let httpCleanup: ReturnType<typeof setInterval> | undefined;
let httpCleanupRefCount = 0;

function startHttpCleanup(windowMs: number): void {
  httpCleanupRefCount += 1;
  if (httpCleanup) {
    return;
  }
  httpCleanup = setInterval(() => {
    pruneStale(httpBuckets, Date.now(), windowMs);
    ensureBucketLimit(httpBuckets, DEFAULT_HTTP.maxBuckets!);
  }, Math.max(windowMs, 5_000));
  if (typeof httpCleanup.unref === "function") {
    httpCleanup.unref();
  }
}

function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

export function createRateLimiter(
  config?: Partial<RateLimitConfig>,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  const windowMs = config?.windowMs ?? DEFAULT_HTTP.windowMs;
  const maxRequests = config?.maxRequests ?? DEFAULT_HTTP.maxRequests;
  const maxBuckets = config?.maxBuckets ?? DEFAULT_HTTP.maxBuckets;
  startHttpCleanup(windowMs);

  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const key = clientIp(req);
    const now = Date.now();
    let b = httpBuckets.get(key);
    if (!b || now - b.windowStart >= windowMs) {
      b = { count: 0, windowStart: now };
      httpBuckets.set(key, b);
      ensureBucketLimit(httpBuckets, maxBuckets!);
    }
    if (b.count >= maxRequests) {
      res.statusCode = 429;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Too many requests" }));
      return;
    }
    b.count += 1;
    next();
  };
}

export function createWsRateLimiter(
  config?: Partial<RateLimitConfig>,
): { check(key: string): boolean } {
  const windowMs = config?.windowMs ?? DEFAULT_WS.windowMs;
  const maxRequests = config?.maxRequests ?? DEFAULT_WS.maxRequests;
  const maxBuckets = config?.maxBuckets ?? DEFAULT_WS.maxBuckets;
  const store = new Map<string, Bucket>();

  const interval = setInterval(() => {
    const now = Date.now();
    pruneStale(store, now, windowMs);
    ensureBucketLimit(store, maxBuckets!);
  }, Math.max(windowMs, 5_000));
  if (typeof interval.unref === "function") {
    interval.unref();
  }

  return {
    check(key: string): boolean {
      const now = Date.now();
      let b = store.get(key);
      if (!b || now - b.windowStart >= windowMs) {
        b = { count: 0, windowStart: now };
        store.set(key, b);
        ensureBucketLimit(store, maxBuckets!);
      }
      if (b.count >= maxRequests) {
        return false;
      }
      b.count += 1;
      return true;
    },
  };
}
