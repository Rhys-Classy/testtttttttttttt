/**
 * Small in-memory fixed-window limiter (per process). Enough to blunt brute force and
 * form spam on a single-server self-host; put a shared store behind it if you scale out.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
    return false;
  }
  b.count++;
  return b.count > limit;
}
