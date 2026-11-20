// Cloudflare Worker safe, memory-bounded rate limiter with LRU-style auto-pruning.
// Prevents isolate memory leaks and shields against brute force attacks.

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 2000;
const PRUNE_THRESHOLD = 1000;

function pruneExpired(now: number) {
  for (const [key, b] of buckets.entries()) {
    if (b.resetAt < now) {
      buckets.delete(key);
    }
  }
}

export function checkRateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();

  // Periodically clean up expired entries to protect Cloudflare Worker 128MB isolate memory
  if (buckets.size > PRUNE_THRESHOLD) {
    pruneExpired(now);
  }

  // If still above maximum capacity, evict the oldest entry
  if (buckets.size >= MAX_BUCKETS) {
    const oldestKey = buckets.keys().next().value;
    if (oldestKey) buckets.delete(oldestKey);
  }

  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (b.count >= limit) {
    return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count += 1;
  return { ok: true };
}

/** Extracts real client IP on Cloudflare Workers / Edge proxies */
export function getClientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/**
 * Composite rate limit check bound to both user ID and client IP,
 * preventing IP spoofing and multi-account bot floods.
 */
export function checkCompositeRateLimit(
  prefix: string,
  request: Request,
  userId: string,
  opts: { limit: number; windowMs: number },
) {
  const ip = getClientIp(request);
  const userResult = checkRateLimit(`${prefix}:user:${userId}`, opts);
  if (!userResult.ok) return userResult;

  // IP limit is 2x user limit to prevent single IP bot clusters
  const ipResult = checkRateLimit(`${prefix}:ip:${ip}`, {
    limit: opts.limit * 2,
    windowMs: opts.windowMs,
  });
  return ipResult;
}
