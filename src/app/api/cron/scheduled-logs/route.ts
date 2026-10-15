import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { runScheduled } from "@/lib/scheduler";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Comparing digests keeps the comparison constant-time regardless of length.
function safeEqual(a: string, b: string) {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on its own.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return jsonError(503, "CRON_SECRET is not configured.");
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return jsonError(401, "Unauthorized");
  }
  return NextResponse.json(await runScheduled());
}
