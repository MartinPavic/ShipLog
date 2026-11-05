import { afterAll, describe, expect, it } from "vitest";

// Next's loadEnvConfig skips .env.local when NODE_ENV=test.
try {
  process.loadEnvFile(".env.local");
} catch {}

// Runs against the real database with an isolated owner id; skipped when DATABASE_URL is missing.
describe.skipIf(!process.env.DATABASE_URL)("reserveGeneration (database)", () => {
  const ownerId = `test_${crypto.randomUUID()}`;

  afterAll(async () => {
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const { usageCounters, usageReservations } = await import("@/db/schema");
    await getDb().delete(usageReservations).where(eq(usageReservations.ownerId, ownerId));
    await getDb().delete(usageCounters).where(eq(usageCounters.ownerId, ownerId));
  });

  it("lets exactly `limit` of 10 parallel reservations through", async () => {
    const { PLAN_LIMITS } = await import("./plans");
    const { finalizeGeneration, getUsage, releaseGeneration, reserveGeneration } = await import("./usage");

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => reserveGeneration(ownerId, "byok", PLAN_LIMITS.free))
    );
    const granted = results.filter((r) => r.status === "fulfilled");
    expect(granted).toHaveLength(5);
    expect((await getUsage(ownerId)).byok).toBe(5);

    await releaseGeneration(granted[0].value);
    expect((await getUsage(ownerId)).byok).toBe(4);
    await finalizeGeneration(granted[1].value);
    expect((await getUsage(ownerId)).byok).toBe(4);
  });

  it("denies managed AI on free and never goes negative on release", async () => {
    const { PLAN_LIMITS } = await import("./plans");
    const { getUsage, releaseGeneration, reserveGeneration } = await import("./usage");

    await expect(reserveGeneration(ownerId, "managed", PLAN_LIMITS.free)).rejects.toMatchObject({
      code: "LIMIT_REACHED",
    });

    const reservation = await reserveGeneration(ownerId, "managed", PLAN_LIMITS.pro);
    await releaseGeneration(reservation);
    await releaseGeneration(reservation);
    expect((await getUsage(ownerId)).managed).toBe(0);
  });

  it("reclaims expired reservations after a process dies before cleanup", async () => {
    const { currentPeriod, getUsage } = await import("./usage");
    const { getDb } = await import("@/db");
    const { usageCounters, usageReservations } = await import("@/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const id = crypto.randomUUID();
    const period = currentPeriod();
    const expired = new Date(Date.now() - 60 * 60 * 1000);

    await getDb().delete(usageReservations).where(eq(usageReservations.ownerId, ownerId));
    await getDb().delete(usageCounters).where(eq(usageCounters.ownerId, ownerId));
    await getDb().insert(usageCounters).values({ ownerId, period, kind: "byok", count: 1 });
    await getDb().insert(usageReservations).values({ id, ownerId, period, kind: "byok", createdAt: expired });

    expect((await getUsage(ownerId)).byok).toBe(0);
    expect(await getDb().select().from(usageReservations).where(and(eq(usageReservations.id, id), eq(usageReservations.ownerId, ownerId)))).toHaveLength(0);
  });
});
