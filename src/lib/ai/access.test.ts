import { afterAll, beforeAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env.local");
} catch {}

describe.skipIf(!process.env.DATABASE_URL)("resolveAiAccess (database)", () => {
  const rand = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const ids = {
    freeNone: `test_o_${rand()}`,
    freeKey: `test_o_${rand()}`,
    proByokNone: `test_o_${rand()}`,
    proByokKey: `test_o_${rand()}`,
    proManagedNone: `test_o_${rand()}`,
    proManagedKey: `test_o_${rand()}`,
    ultraByokKey: `test_o_${rand()}`,
    ultraManagedKey: `test_o_${rand()}`,
    freeOrg: `org_test_${rand()}`,
    freeOrgKey: `org_test_${rand()}`,
  };
  let savedKey: string | undefined;
  let savedProvider: string | undefined;
  let savedBillingEnabled: string | undefined;

  async function setCredential(ownerId: string, provider: "openai" | "anthropic" | "grok", key: string, model: string | null = null) {
    const { getDb } = await import("@/db");
    const { aiCredentials } = await import("@/db/schema");
    const { encrypt } = await import("@/lib/crypto");
    await getDb().insert(aiCredentials).values({ ownerId, provider, encryptedKey: encrypt(key), last4: key.slice(-4), model });
  }

  beforeAll(async () => {
    savedKey = process.env.OPENAI_API_KEY;
    savedProvider = process.env.AI_PROVIDER;
    savedBillingEnabled = process.env.BILLING_ENABLED;
    const { getDb } = await import("@/db");
    const { billingAccounts } = await import("@/db/schema");
    await getDb().insert(billingAccounts).values([
      { ownerId: ids.proByokNone, plan: "pro", aiMode: "byok", status: "active" },
      { ownerId: ids.proByokKey, plan: "pro", aiMode: "byok", status: "active" },
      { ownerId: ids.proManagedNone, plan: "pro", aiMode: "managed", status: "active" },
      { ownerId: ids.proManagedKey, plan: "pro", aiMode: "managed", status: "active" },
      { ownerId: ids.ultraByokKey, plan: "ultra", aiMode: "byok", status: "active" },
      { ownerId: ids.ultraManagedKey, plan: "ultra", aiMode: "managed", status: "active" },
    ]);
    await setCredential(ids.freeKey, "anthropic", "sk-ant-free-key");
    await setCredential(ids.proByokKey, "grok", "xai-own-key", "grok-custom");
    await setCredential(ids.proManagedKey, "anthropic", "sk-ant-ignore-me");
    await setCredential(ids.ultraByokKey, "openai", "sk-ultra-byok");
    await setCredential(ids.ultraManagedKey, "grok", "xai-ultra-ignore");
    await setCredential(ids.freeOrgKey, "openai", "sk-org-key");
  });

  afterAll(async () => {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
    if (savedProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = savedProvider;
    if (savedBillingEnabled === undefined) delete process.env.BILLING_ENABLED;
    else process.env.BILLING_ENABLED = savedBillingEnabled;
    const { inArray } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const { aiCredentials, billingAccounts } = await import("@/db/schema");
    const owners = Object.values(ids);
    await getDb().delete(aiCredentials).where(inArray(aiCredentials.ownerId, owners));
    await getDb().delete(billingAccounts).where(inArray(billingAccounts.ownerId, owners));
  });

  const resolve = async (ownerId: string) => (await import("@/lib/ai/access")).resolveAiAccess(ownerId);

  it("uses the owner's own key and the provider's default model", async () => {
    delete process.env.AI_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    const { DEFAULT_MODELS } = await import("@/lib/ai/models");
    const { PLAN_LIMITS } = await import("@/lib/plans");
    expect(await resolve(ids.freeKey)).toEqual({
      kind: "byok",
      provider: "anthropic",
      key: "sk-ant-free-key",
      model: DEFAULT_MODELS.anthropic,
      limits: PLAN_LIMITS.free,
    });
  });

  it("uses BYOK for Pro BYOK mode and honours a custom model", async () => {
    delete process.env.AI_PROVIDER;
    process.env.OPENAI_API_KEY = "sk-managed";
    const access = await resolve(ids.proByokKey);
    expect(access).toMatchObject({ kind: "byok", provider: "grok", key: "xai-own-key", model: "grok-custom" });
  });

  it("uses BYOK for Ultra BYOK mode", async () => {
    delete process.env.AI_PROVIDER;
    process.env.OPENAI_API_KEY = "sk-managed";
    const access = await resolve(ids.ultraByokKey);
    expect(access).toMatchObject({ kind: "byok", provider: "openai", key: "sk-ultra-byok" });
  });

  it("uses the managed server key on Pro Managed even when a workspace key exists", async () => {
    delete process.env.AI_PROVIDER;
    process.env.OPENAI_API_KEY = "sk-managed";
    const { DEFAULT_MODELS } = await import("@/lib/ai/models");
    expect(await resolve(ids.proManagedKey)).toMatchObject({
      kind: "managed",
      provider: "openai",
      key: "sk-managed",
      model: DEFAULT_MODELS.openai,
    });
  });

  it("uses the managed server key on Ultra Managed even when a workspace key exists", async () => {
    delete process.env.AI_PROVIDER;
    process.env.OPENAI_API_KEY = "sk-managed";
    const access = await resolve(ids.ultraManagedKey);
    expect(access).toMatchObject({ kind: "managed", provider: "openai", key: "sk-managed" });
  });

  it("requires a workspace key for paid BYOK mode", async () => {
    delete process.env.AI_PROVIDER;
    process.env.OPENAI_API_KEY = "sk-managed";
    await expect(resolve(ids.proByokNone)).rejects.toMatchObject({ code: "NO_AI_KEY", status: 400 });
  });

  it("fails clearly when managed mode is selected but the server key is unavailable", async () => {
    delete process.env.AI_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    await expect(resolve(ids.proManagedNone)).rejects.toMatchObject({ code: "MANAGED_AI_UNAVAILABLE", status: 503 });
  });

  it("never offers managed AI on Free, even if the server has a key", async () => {
    delete process.env.AI_PROVIDER;
    process.env.OPENAI_API_KEY = "sk-managed";
    await expect(resolve(ids.freeNone)).rejects.toMatchObject({ code: "NO_AI_KEY" });
    await expect(resolve(ids.freeOrg)).rejects.toMatchObject({ code: "NO_AI_KEY" });
  });

  it("uses deterministic mock AI while keeping the selected mode semantics", async () => {
    process.env.AI_PROVIDER = "mock";
    delete process.env.OPENAI_API_KEY;
    expect(await resolve(ids.proByokNone)).toMatchObject({ kind: "byok", provider: "mock", key: "mock", model: "mock" });
    expect(await resolve(ids.proManagedNone)).toMatchObject({ kind: "managed", provider: "mock", key: "mock", model: "mock" });
  });

  it("applies the workspace's limits, so a Free organization gets none", async () => {
    delete process.env.AI_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    const access = await resolve(ids.freeOrgKey);
    expect(access.kind).toBe("byok");
    expect(access.limits.byokGenerationsPerMonth).toBe(0);
  });

  it("decrypts keys without exposing the stored ciphertext", async () => {
    const { getAiCredential } = await import("@/lib/ai/access");
    const row = await getAiCredential(ids.freeKey);
    expect(row?.encryptedKey).not.toContain("sk-ant-free-key");
    expect(row?.last4).toBe("-key");
  });

  it("keeps billing-off behavior: prefer workspace BYOK key, otherwise use server-managed key", async () => {
    process.env.BILLING_ENABLED = "false";
    process.env.OPENAI_API_KEY = "sk-managed";
    delete process.env.AI_PROVIDER;

    const byokFirst = await resolve(ids.freeKey);
    expect(byokFirst).toMatchObject({
      kind: "byok",
      provider: "anthropic",
      key: "sk-ant-free-key",
    });

    const managedFallback = await resolve(ids.freeNone);
    expect(managedFallback).toMatchObject({
      kind: "managed",
      provider: "openai",
      key: "sk-managed",
    });
  });
});
