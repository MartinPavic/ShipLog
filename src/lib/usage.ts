import { randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { usageCounters, usageReservations } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { resolveUsageKind } from "@/lib/ai/access";
import { getPlanLimits, type PlanLimits } from "@/lib/plans";

export type UsageKind = "managed" | "byok";
export type Reservation = { id: string; ownerId: string; period: string; kind: UsageKind };

const RESERVATION_TTL_MS = 15 * 60 * 1000;

export function currentPeriod(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

function limitFor(kind: UsageKind, limits: PlanLimits): number {
  return kind === "managed" ? limits.managedGenerationsPerMonth : limits.byokGenerationsPerMonth;
}

async function reapExpiredReservations(ownerId: string): Promise<void> {
  const expiredBefore = new Date(Date.now() - RESERVATION_TTL_MS);
  const db = getDb();
  await db.transaction(async (tx) => {
    const expired = await tx
      .delete(usageReservations)
      .where(and(eq(usageReservations.ownerId, ownerId), lt(usageReservations.createdAt, expiredBefore)))
      .returning({ period: usageReservations.period, kind: usageReservations.kind });
    for (const reservation of expired) {
      await tx
        .update(usageCounters)
        .set({ count: sql`greatest(${usageCounters.count} - 1, 0)` })
        .where(
          and(
            eq(usageCounters.ownerId, ownerId),
            eq(usageCounters.period, reservation.period),
            eq(usageCounters.kind, reservation.kind)
          )
        );
    }
  });
}

// One atomic upsert: the increment only happens while under the limit, so parallel requests can't overshoot.
export async function reserveGeneration(
  ownerId: string,
  kind: UsageKind,
  limits: PlanLimits
): Promise<Reservation> {
  const limit = limitFor(kind, limits);
  const period = currentPeriod();
  const reservation = { id: randomUUID(), ownerId, period, kind };

  if (limit <= 0) throw limitError(kind, limit);

  await reapExpiredReservations(ownerId);
  const rows = await getDb().transaction(async (tx) => {
    const granted = await tx
      .insert(usageCounters)
      .values({ ownerId, period, kind, count: 1 })
      .onConflictDoUpdate({
        target: [usageCounters.ownerId, usageCounters.period, usageCounters.kind],
        set: { count: sql`${usageCounters.count} + 1` },
        ...(Number.isFinite(limit) ? { setWhere: lt(usageCounters.count, limit) } : {}),
      })
      .returning({ count: usageCounters.count });
    if (granted.length) await tx.insert(usageReservations).values(reservation);
    return granted;
  });

  if (rows.length === 0) throw limitError(kind, limit);
  return reservation;
}

export async function finalizeGeneration({ id }: Reservation): Promise<void> {
  await getDb().delete(usageReservations).where(eq(usageReservations.id, id));
}

export async function releaseGeneration({ id, ownerId, period, kind }: Reservation): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [released] = await tx
      .delete(usageReservations)
      .where(and(eq(usageReservations.id, id), eq(usageReservations.ownerId, ownerId)))
      .returning({ id: usageReservations.id });
    if (!released) return;
    await tx
      .update(usageCounters)
      .set({ count: sql`greatest(${usageCounters.count} - 1, 0)` })
      .where(
        and(
          eq(usageCounters.ownerId, ownerId),
          eq(usageCounters.period, period),
          eq(usageCounters.kind, kind)
        )
      );
  });
}

export async function getUsage(ownerId: string): Promise<Record<UsageKind, number>> {
  await reapExpiredReservations(ownerId);
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
      ? "Managed AI isn't available for this workspace's current subscription mode."
      : limit <= 0
        ? "Upgrade this workspace to Pro to generate logs."
        : kind === "managed"
          ? `Monthly managed-AI limit reached (${limit} generations).`
          : `Monthly BYOK limit reached (${limit} generations).`;
  return new ApiError(403, message, "LIMIT_REACHED");
}

export type UsageMeter = { kind: UsageKind; used: number; limit: number | null };

// Mirrors resolveAiAccess: usage is tracked against the subscription-selected mode.
export async function getUsageMeter(ownerId: string): Promise<UsageMeter> {
  const [{ plan, aiMode, limits }, usage] = await Promise.all([
    getPlanLimits(ownerId),
    getUsage(ownerId),
  ]);
  const kind: UsageKind = resolveUsageKind(plan, aiMode, limits);
  const limit = limitFor(kind, limits);
  return { kind, used: usage[kind], limit: Number.isFinite(limit) ? limit : null };
}
