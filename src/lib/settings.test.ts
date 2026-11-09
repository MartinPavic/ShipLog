import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

try {
  process.loadEnvFile(".env.local");
} catch {}

const rand = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

describe.skipIf(!process.env.DATABASE_URL)("getSetupStatus (database)", () => {
  const ownerIds = {
    free: `test_o_${rand()}`,
    proByok: `test_o_${rand()}`,
    proManaged: `test_o_${rand()}`,
    ultraByok: `test_o_${rand()}`,
    ultraManaged: `test_o_${rand()}`,
  };
  const userIds = {
    free: `test_u_${rand()}`,
    proByok: `test_u_${rand()}`,
    proManaged: `test_u_${rand()}`,
    ultraByok: `test_u_${rand()}`,
    ultraManaged: `test_u_${rand()}`,
  };

  const savedBilling = process.env.BILLING_ENABLED;
  const savedManagedFlag = process.env.MANAGED_AI_ENABLED;
  const savedManagedKey = process.env.OPENAI_API_KEY;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-03-15T12:00:00Z"));
    process.env.BILLING_ENABLED = "true";
    process.env.MANAGED_AI_ENABLED = "true";
    delete process.env.OPENAI_API_KEY;

    const { getDb } = await import("@/db");
    const { billingAccounts, usageCounters } = await import("@/db/schema");
    const { currentPeriod } = await import("@/lib/usage");
    const period = currentPeriod();

    await getDb().insert(billingAccounts).values([
      { ownerId: ownerIds.proByok, plan: "pro", aiMode: "byok", status: "active" },
      { ownerId: ownerIds.proManaged, plan: "pro", aiMode: "managed", status: "active" },
      { ownerId: ownerIds.ultraByok, plan: "ultra", aiMode: "byok", status: "active" },
      { ownerId: ownerIds.ultraManaged, plan: "ultra", aiMode: "managed", status: "active" },
    ]);

    await getDb().insert(usageCounters).values([
      { ownerId: ownerIds.free, period, kind: "byok", count: 2 },
      { ownerId: ownerIds.proByok, period, kind: "byok", count: 7 },
      { ownerId: ownerIds.proManaged, period, kind: "managed", count: 8 },
      { ownerId: ownerIds.ultraByok, period, kind: "byok", count: 15 },
      { ownerId: ownerIds.ultraManaged, period, kind: "managed", count: 23 },
    ]);
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (savedBilling === undefined) delete process.env.BILLING_ENABLED;
    else process.env.BILLING_ENABLED = savedBilling;

    if (savedManagedFlag === undefined) delete process.env.MANAGED_AI_ENABLED;
    else process.env.MANAGED_AI_ENABLED = savedManagedFlag;

    if (savedManagedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedManagedKey;

    const { inArray } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const { aiCredentials, billingAccounts, githubConnections, usageCounters } = await import("@/db/schema");
    const owners = Object.values(ownerIds);
    const users = Object.values(userIds);
    const db = getDb();

    await db.delete(usageCounters).where(inArray(usageCounters.ownerId, owners));
    await db.delete(aiCredentials).where(inArray(aiCredentials.ownerId, owners));
    await db.delete(billingAccounts).where(inArray(billingAccounts.ownerId, owners));
    await db.delete(githubConnections).where(inArray(githubConnections.userId, users));
  });

  it("returns safe billing status fields for Free/Pro/Ultra and BYOK/Managed variants", async () => {
    const { getSetupStatus } = await import("@/lib/settings");

    const free = await getSetupStatus({ ownerId: ownerIds.free, userId: userIds.free });
    expect(free.plan).toBe("free");
    expect(free.aiMode).toBe("byok");
    expect(free.usage).toEqual({ used: 2, limit: 5 });

    const proByok = await getSetupStatus({ ownerId: ownerIds.proByok, userId: userIds.proByok });
    expect(proByok.plan).toBe("pro");
    expect(proByok.aiMode).toBe("byok");
    expect(proByok.usage).toEqual({ used: 7, limit: 50 });

    const proManaged = await getSetupStatus({ ownerId: ownerIds.proManaged, userId: userIds.proManaged });
    expect(proManaged.plan).toBe("pro");
    expect(proManaged.aiMode).toBe("managed");
    expect(proManaged.usage).toEqual({ used: 8, limit: 50 });

    const ultraByok = await getSetupStatus({ ownerId: ownerIds.ultraByok, userId: userIds.ultraByok });
    expect(ultraByok.plan).toBe("ultra");
    expect(ultraByok.aiMode).toBe("byok");
    expect(ultraByok.usage).toEqual({ used: 15, limit: null });

    const ultraManaged = await getSetupStatus({ ownerId: ownerIds.ultraManaged, userId: userIds.ultraManaged });
    expect(ultraManaged.plan).toBe("ultra");
    expect(ultraManaged.aiMode).toBe("managed");
    expect(ultraManaged.usage).toEqual({ used: 23, limit: 200 });
  });

  it("marks managed subscriptions as not ready when the managed key is missing", async () => {
    const { getSetupStatus } = await import("@/lib/settings");

    delete process.env.OPENAI_API_KEY;
    const missing = await getSetupStatus({ ownerId: ownerIds.proManaged, userId: userIds.proManaged });
    expect(missing.aiMode).toBe("managed");
    expect(missing.aiReady).toBe(false);

    process.env.OPENAI_API_KEY = "sk-managed";
    const configured = await getSetupStatus({ ownerId: ownerIds.proManaged, userId: userIds.proManaged });
    expect(configured.aiReady).toBe(true);
  });

  it("keeps status safe and workspace-scoped when billing is disabled", async () => {
    const { getSetupStatus } = await import("@/lib/settings");

    process.env.BILLING_ENABLED = "false";
    process.env.OPENAI_API_KEY = "sk-managed";

    const status = await getSetupStatus({ ownerId: ownerIds.free, userId: userIds.free });
    expect(status.plan).toBe("pro");
    expect(status.aiMode).toBe("managed");
    expect(status.usage).toEqual({ used: 0, limit: null });

    delete process.env.OPENAI_API_KEY;
    const noManagedKey = await getSetupStatus({ ownerId: ownerIds.free, userId: userIds.free });
    expect(noManagedKey.aiMode).toBe("byok");
    expect(noManagedKey.usage).toEqual({ used: 2, limit: null });
  });

  it("shares billing-off source selection between the dashboard meter, setup status and AI access", async () => {
    const { getSetupStatus } = await import("./settings");
    const { currentPeriod, getUsageMeter } = await import("./usage");
    const { resolveAiAccess } = await import("./ai/access");
    const { getDb } = await import("@/db");
    const { aiCredentials, usageCounters } = await import("@/db/schema");
    const { encrypt } = await import("./crypto");
    const savedProvider = process.env.AI_PROVIDER;
    process.env.BILLING_ENABLED = "false";
    process.env.OPENAI_API_KEY = "sk-managed";
    delete process.env.AI_PROVIDER;
    try {
      await getDb().insert(usageCounters).values({ ownerId: ownerIds.free, period: currentPeriod(), kind: "managed", count: 4 });
      expect(await getUsageMeter(ownerIds.free)).toEqual({ kind: "managed", used: 4, limit: null });
      expect(await getSetupStatus({ ownerId: ownerIds.free, userId: userIds.free })).toMatchObject({ aiMode: "managed", usage: { used: 4, limit: null } });
      expect(await resolveAiAccess(ownerIds.free)).toMatchObject({ kind: "managed" });
      process.env.AI_PROVIDER = "mock";
      expect(await resolveAiAccess(ownerIds.free)).toMatchObject({ kind: "managed", provider: "mock" });
      await getDb().insert(aiCredentials).values({ ownerId: ownerIds.free, provider: "openai", encryptedKey: encrypt("sk-own"), last4: "-own" });
      expect(await getUsageMeter(ownerIds.free)).toEqual({ kind: "byok", used: 2, limit: null });
      expect(await getSetupStatus({ ownerId: ownerIds.free, userId: userIds.free })).toMatchObject({ aiMode: "byok", usage: { used: 2, limit: null } });
      expect(await resolveAiAccess(ownerIds.free)).toMatchObject({ kind: "byok", provider: "mock" });
    } finally {
      if (savedProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = savedProvider;
    }
  });
});
