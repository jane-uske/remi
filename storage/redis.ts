import Redis from 'ioredis';
import { resolveConnectionString } from './connection_resolver';

let client: Redis | null = null;

export async function initRedis(url?: string): Promise<boolean> {
  const rawRedisUrl = url ?? process.env.REDIS_URL;
  if (!rawRedisUrl) {
    const err = new Error('REDIS_URL is not set');
    console.log('[Storage] initRedis failed:', err.message);
    return false;
  }
  const redisUrl = await resolveConnectionString(rawRedisUrl, {
    serviceHost: "redis",
    fallbackHost: "127.0.0.1",
    fallbackPort: 6379,
    fallbackLabel: "Redis",
  });
  const nextClient = new Redis(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    retryStrategy: () => null,
  });
  const onError = (err: unknown): void => {
    console.log('[Storage] Redis client error:', err);
  };
  nextClient.on('error', onError);
  try {
    await nextClient.connect();
    client = nextClient;
    console.log('[Storage] Redis client initialized');
    return true;
  } catch (e) {
    console.log('[Storage] initRedis failed:', e);
    nextClient.disconnect();
    return false;
  } finally {
    nextClient.off('error', onError);
  }
}

export function getRedis(): Redis {
  if (!client) {
    throw new Error('Redis is not initialized; call initRedis first');
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (!client) {
    return;
  }
  try {
    await client.quit();
    console.log('[Storage] Redis connection closed');
  } catch (e) {
    console.log('[Storage] closeRedis error:', e);
    throw e;
  } finally {
    client = null;
  }
}

export async function cacheGet(key: string): Promise<string | null> {
  if (!client) {
    return null;
  }
  try {
    const value = await getRedis().get(key);
    return value;
  } catch (e) {
    console.log('[Storage] cacheGet error:', e);
    throw e;
  }
}

export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds?: number
): Promise<void> {
  if (!client) {
    return;
  }
  try {
    const r = getRedis();
    if (ttlSeconds !== undefined && ttlSeconds > 0) {
      await r.set(key, value, 'EX', ttlSeconds);
    } else {
      await r.set(key, value);
    }
  } catch (e) {
    console.log('[Storage] cacheSet error:', e);
    throw e;
  }
}

export async function cacheDel(key: string): Promise<void> {
  if (!client) {
    return;
  }
  try {
    await getRedis().del(key);
  } catch (e) {
    console.log('[Storage] cacheDel error:', e);
    throw e;
  }
}
