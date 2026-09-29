import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number; // epoch ms
}

interface Bucket {
  count: number;
  resetAt: number;
}

// In-memory fallback for dev / when Upstash is not configured.
// NOT suitable for multi-instance production — configure Upstash there.
const buckets = new Map<string, Bucket>();

function memoryCheck(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, remaining: limit - 1, reset: now + windowMs };
  }
  if (b.count >= limit) return { success: false, remaining: 0, reset: b.resetAt };
  b.count += 1;
  return { success: true, remaining: limit - b.count, reset: b.resetAt };
}

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

function upstashLimiter(limit: number, windowMs: number) {
  const windowSecs = Math.max(1, Math.round(windowMs / 1000));
  return new Ratelimit({ redis: redis!, limiter: Ratelimit.slidingWindow(limit, `${windowSecs} s`) });
}

export async function checkRateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  if (redis) {
    try {
      const r = await upstashLimiter(opts.limit, opts.windowMs).limit(key);
      return { success: r.success, remaining: r.remaining, reset: r.reset };
    } catch (err) {
      console.error("[ratelimit] upstash error, failing open to memory", err);
    }
  }
  return memoryCheck(key, opts.limit, opts.windowMs);
}

// Presets — tune per plan tier later.
export const LIMITS = {
  auth: { limit: 10, windowMs: 15 * 60_000 }, // login/signup/reset per IP
  api: { limit: 300, windowMs: 60_000 }, // general API per user
  discovery: { limit: 20, windowMs: 60_000 },
  websiteInspect: { limit: 10, windowMs: 60_000 },
  aiIntelligence: { limit: 5, windowMs: 60_000 },
  leadScore: { limit: 10, windowMs: 60_000 },
  ai: { limit: 30, windowMs: 60_000 },
  send: { limit: 60, windowMs: 60_000 },
  webhook: { limit: 600, windowMs: 60_000 },
} as const;
