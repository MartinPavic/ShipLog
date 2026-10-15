import { lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { rateLimits } from "@/db/schema";
import { ApiError } from "@/lib/api";

// Fixed-window counter shared across serverless instances via the database.
// Per-owner cap on generation requests, on top of the monthly plan limits; it also stops retry loops.
export const GENERATE_RATE = { limit: 30, windowMs: 60 * 60 * 1000 } as const;

export async function hitRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const db = getDb();

  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  // Opportunistic cleanup keeps the table small without a cron job.
  if (Math.random() < 0.02) {
    await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now - 2 * 24 * 60 * 60 * 1000)));
  }

  return {
    allowed: row.count <= limit,
    remaining: Math.max(0, limit - row.count),
    retryAfterSec: Math.ceil((windowStart.getTime() + windowMs - now) / 1000),
  };
}

export async function enforceRateLimit(key: string, limit: number, windowMs: number, what = "requests") {
  const result = await hitRateLimit(key, limit, windowMs);
  if (!result.allowed) {
    const minutes = Math.max(1, Math.ceil(result.retryAfterSec / 60));
    throw new ApiError(429, `Too many ${what}. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, "RATE_LIMITED");
  }
}
