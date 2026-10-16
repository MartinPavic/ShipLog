import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { usageCounters } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { isMockAi } from "@/env";
import { getAiCredential } from "@/lib/ai/access";
import { getPlanLimits, type PlanLimits } from "@/lib/plans";

export type UsageKind = "managed" | "byok";
export type Reservation = { ownerId: string; period: string; kind: UsageKind };

export function currentPeriod(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

function limitFor(kind: UsageKind, limits: PlanLimits): number {
  return kind === "managed" ? limits.managedGenerationsPerMonth : limits.byokGenerationsPerMonth;
}

// One atomic upsert: the increment only happens while under the limit, so parallel requests can't overshoot.
export async function reserveGeneration(
  ownerId: string,
  kind: UsageKind,
  limits: PlanLimits
): Promise<Reservation> {
  const limit = limitFor(kind, limits);
  const period = currentPeriod();
  const reservation = { ownerId, period, kind };

  if (limit <= 0) throw limitError(kind, limit);

  const rows = await getDb()
    .insert(usageCounters)
    .values({ ownerId, period, kind, count: 1 })
    .onConflictDoUpdate({
      target: [usageCounters.ownerId, usageCounters.period, usageCounters.kind],
      set: { count: sql`${usageCounters.count} + 1` },
      ...(Number.isFinite(limit) ? { setWhere: lt(usageCounters.count, limit) } : {}),
    })
    .returning({ count: usageCounters.count });

  if (rows.length === 0) throw limitError(kind, limit);
  return reservation;
}

export async function releaseGeneration({ ownerId, period, kind }: Reservation): Promise<void> {
  await getDb()
    .update(usageCounters)
    .set({ count: sql`greatest(${usageCounters.count} - 1, 0)` })
    .where(
      and(
        eq(usageCounters.ownerId, ownerId),
        eq(usageCounters.period, period),
        eq(usageCounters.kind, kind)
      )
    );
}

export async function getUsage(ownerId: string): Promise<Record<UsageKind, number>> {
  const rows = await getDb()
    .select({ kind: usageCounters.kind, count: usageCounters.count })
    .from(usageCounters)
    .where(and(eq(usageCounters.ownerId, ownerId), eq(usageCounters.period, currentPeriod())));
  const usage = { managed: 0, byok: 0 };
  for (const row of rows) usage[row.kind] = row.count;
  return usage;
}

function limitError(kind: UsageKind, limit: number) {
  const message =
    kind === "managed" && limit <= 0
      ? "Managed AI is a Pro feature. Add your own API key in Settings or upgrade to Pro."
      : limit <= 0
        ? "Upgrade this workspace to Pro to generate logs."
        : `Monthly limit reached (${limit} generations). Upgrade to Pro for more.`;
  return new ApiError(403, message, "LIMIT_REACHED");
}

export type UsageMeter = { kind: UsageKind; used: number; limit: number | null };

// Mirrors resolveAiAccess: an own key counts as BYOK, otherwise Pro uses the managed counter.
export async function getUsageMeter(ownerId: string): Promise<UsageMeter> {
  const [credential, { limits }, usage] = await Promise.all([
    getAiCredential(ownerId),
    getPlanLimits(ownerId),
    getUsage(ownerId),
  ]);
  const kind: UsageKind = (credential && !isMockAi()) || !limits.managedAi ? "byok" : "managed";
  const limit = limitFor(kind, limits);
  return { kind, used: usage[kind], limit: Number.isFinite(limit) ? limit : null };
}
