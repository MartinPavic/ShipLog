import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// Next's loadEnvConfig skips .env.local when NODE_ENV=test.
try {
  process.loadEnvFile(".env.local");
} catch {}

// Runs against the real database with an isolated owner id; skipped when DATABASE_URL is missing.
describe.skipIf(!process.env.DATABASE_URL)("reserveGeneration (database)", () => {
  const ownerId = `test_${crypto.randomUUID()}`;
  const meterOwnerId = `test_${crypto.randomUUID()}`;
  const proByokOwnerId = `test_${crypto.randomUUID()}`;
  const proManagedOwnerId = `test_${crypto.randomUUID()}`;
  const ultraManagedOwnerId = `test_${crypto.randomUUID()}`;
  const ultraByokOwnerId = `test_${crypto.randomUUID()}`;
  const workspaceOwnerId = `test_${crypto.randomUUID()}`;
  const otherWorkspaceOwnerId = `test_${crypto.randomUUID()}`;

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    const { inArray } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const { aiCredentials, billingAccounts, usageCounters, usageReservations } = await import("@/db/schema");
    const owners = [
      ownerId,
      meterOwnerId,
      proByokOwnerId,
      proManagedOwnerId,
      ultraManagedOwnerId,
      ultraByokOwnerId,
      workspaceOwnerId,
      otherWorkspaceOwnerId,
    ];
    await getDb().delete(usageReservations).where(inArray(usageReservations.ownerId, owners));
    await getDb().delete(usageCounters).where(inArray(usageCounters.ownerId, owners));
    await getDb().delete(aiCredentials).where(inArray(aiCredentials.ownerId, owners));
    await getDb().delete(billingAccounts).where(inArray(billingAccounts.ownerId, owners));
  });

  it("lets exactly `limit` of 10 parallel reservations through", async () => {
    const { PLAN_LIMITS } = await import("./plans");
    const { finalizeGeneration, getUsage, releaseGeneration, reserveGeneration } = await import("./usage");

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => reserveGeneration(ownerId, "byok", PLAN_LIMITS.free))
    );
    const granted = results.filter((r) => r.status === "fulfilled");
    expect(granted).toHaveLength(5);
    await expect(reserveGeneration(ownerId, "byok", PLAN_LIMITS.free)).rejects.toMatchObject({ code: "LIMIT_REACHED" });
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

  it("enforces exact paid caps with no cross-mode fallback", async () => {
    const { limitsFor } = await import("./plans");
    const { getUsage, reserveGeneration } = await import("./usage");

    const proByok = limitsFor("pro", proByokOwnerId, "byok");
    const proManaged = limitsFor("pro", proManagedOwnerId, "managed");
    const ultraManaged = limitsFor("ultra", ultraManagedOwnerId, "managed");
    const ultraByok = limitsFor("ultra", ultraByokOwnerId, "byok");

    const proByokReservations = await Promise.all(
      Array.from({ length: 50 }, () => reserveGeneration(proByokOwnerId, "byok", proByok))
    );
    expect(proByokReservations).toHaveLength(50);
    await expect(reserveGeneration(proByokOwnerId, "byok", proByok)).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    expect((await getUsage(proByokOwnerId)).managed).toBe(0);

    const proManagedReservations = await Promise.all(
      Array.from({ length: 50 }, () => reserveGeneration(proManagedOwnerId, "managed", proManaged))
    );
    expect(proManagedReservations).toHaveLength(50);
    await expect(reserveGeneration(proManagedOwnerId, "managed", proManaged)).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    expect((await getUsage(proManagedOwnerId)).byok).toBe(0);

    const ultraManagedReservations = await Promise.all(
      Array.from({ length: 200 }, () => reserveGeneration(ultraManagedOwnerId, "managed", ultraManaged))
    );
    expect(ultraManagedReservations).toHaveLength(200);
    await expect(reserveGeneration(ultraManagedOwnerId, "managed", ultraManaged)).rejects.toMatchObject({ code: "LIMIT_REACHED" });

    const ultraByokReservations = await Promise.all(
      Array.from({ length: 220 }, () => reserveGeneration(ultraByokOwnerId, "byok", ultraByok))
    );
    expect(ultraByokReservations).toHaveLength(220);
    expect((await getUsage(ultraByokOwnerId)).byok).toBe(220);
    expect((await getUsage(ultraByokOwnerId)).managed).toBe(0);
  });

  it("is workspace-scoped and resets at the UTC month boundary", async () => {
    vi.useFakeTimers();
    const { getDb } = await import("@/db");
    const { usageCounters } = await import("@/db/schema");
    const { currentPeriod, getUsage } = await import("./usage");
    const { eq } = await import("drizzle-orm");

    vi.setSystemTime(new Date("2026-11-30T23:59:59.000Z"));
    const november = currentPeriod();
    const october = currentPeriod(new Date("2026-10-31T23:59:59.000Z"));

    await getDb().delete(usageCounters).where(eq(usageCounters.ownerId, workspaceOwnerId));
    await getDb().delete(usageCounters).where(eq(usageCounters.ownerId, otherWorkspaceOwnerId));

    await getDb().insert(usageCounters).values([
      { ownerId: workspaceOwnerId, period: october, kind: "byok", count: 9 },
      { ownerId: workspaceOwnerId, period: november, kind: "byok", count: 2 },
      { ownerId: otherWorkspaceOwnerId, period: november, kind: "byok", count: 1 },
    ]);

    expect(await getUsage(workspaceOwnerId)).toEqual({ byok: 2, managed: 0 });
    expect(await getUsage(otherWorkspaceOwnerId)).toEqual({ byok: 1, managed: 0 });

    vi.setSystemTime(new Date("2026-12-01T00:00:01.000Z"));
    const december = currentPeriod();
    expect(await getUsage(workspaceOwnerId)).toEqual({ byok: 0, managed: 0 });
    expect(await getUsage(otherWorkspaceOwnerId)).toEqual({ byok: 0, managed: 0 });

    await getDb().insert(usageCounters).values({ ownerId: workspaceOwnerId, period: december, kind: "byok", count: 1 });
    expect(await getUsage(workspaceOwnerId)).toEqual({ byok: 1, managed: 0 });
    expect(await getUsage(otherWorkspaceOwnerId)).toEqual({ byok: 0, managed: 0 });
  });

  it("reports usage for the persisted aiMode, not credential presence", async () => {
    const { getDb } = await import("@/db");
    const { aiCredentials, billingAccounts, usageCounters } = await import("@/db/schema");
    const { encrypt } = await import("./crypto");
    const { currentPeriod, getUsageMeter } = await import("./usage");

    await getDb().insert(billingAccounts).values({ ownerId: meterOwnerId, plan: "pro", aiMode: "managed", status: "active" });
    await getDb().insert(aiCredentials).values({ ownerId: meterOwnerId, provider: "openai", encryptedKey: encrypt("sk-test"), last4: "test" });
    await getDb().insert(usageCounters).values({ ownerId: meterOwnerId, period: currentPeriod(), kind: "managed", count: 7 });

    expect(await getUsageMeter(meterOwnerId)).toEqual({ kind: "managed", used: 7, limit: 50 });
  });
});
