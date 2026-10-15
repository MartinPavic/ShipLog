import { afterAll, beforeAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env.local");
} catch {}

describe.skipIf(!process.env.DATABASE_URL)("resolveAiAccess (database)", () => {
  const rand = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const ids = {
    freeNone: `test_o_${rand()}`,
    freeKey: `test_o_${rand()}`,
    proNone: `test_o_${rand()}`,
    proKey: `test_o_${rand()}`,
    freeOrg: `org_test_${rand()}`,
    freeOrgKey: `org_test_${rand()}`,
  };
  let savedKey: string | undefined;

  async function setCredential(ownerId: string, provider: "openai" | "anthropic" | "grok", key: string, model: string | null = null) {
    const { getDb } = await import("@/db");
    const { aiCredentials } = await import("@/db/schema");
    const { encrypt } = await import("@/lib/crypto");
    await getDb().insert(aiCredentials).values({ ownerId, provider, encryptedKey: encrypt(key), last4: key.slice(-4), model });
  }

  beforeAll(async () => {
    savedKey = process.env.OPENAI_API_KEY;
    const { getDb } = await import("@/db");
    const { billingAccounts } = await import("@/db/schema");
    await getDb().insert(billingAccounts).values([
      { ownerId: ids.proNone, plan: "pro", status: "active" },
      { ownerId: ids.proKey, plan: "pro", status: "active" },
    ]);
    await setCredential(ids.freeKey, "anthropic", "sk-ant-free-key");
    await setCredential(ids.proKey, "grok", "xai-own-key", "grok-custom");
    await setCredential(ids.freeOrgKey, "openai", "sk-org-key");
  });

  afterAll(async () => {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
    const { inArray } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const { aiCredentials, billingAccounts } = await import("@/db/schema");
    const owners = Object.values(ids);
    await getDb().delete(aiCredentials).where(inArray(aiCredentials.ownerId, owners));
    await getDb().delete(billingAccounts).where(inArray(billingAccounts.ownerId, owners));
  });

  const resolve = async (ownerId: string) => (await import("@/lib/ai/access")).resolveAiAccess(ownerId);

  it("uses the owner's own key and the provider's default model", async () => {
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

  it("honours a custom model and prefers the owner's key over the managed one on Pro", async () => {
    process.env.OPENAI_API_KEY = "sk-managed";
    const access = await resolve(ids.proKey);
    expect(access).toMatchObject({ kind: "byok", provider: "grok", key: "xai-own-key", model: "grok-custom" });
  });

  it("falls back to the managed key on Pro when the owner has none", async () => {
    process.env.OPENAI_API_KEY = "sk-managed";
    const { DEFAULT_MODELS } = await import("@/lib/ai/models");
    expect(await resolve(ids.proNone)).toMatchObject({
      kind: "managed",
      provider: "openai",
      key: "sk-managed",
      model: DEFAULT_MODELS.openai,
    });
  });

  it("requires a key when nothing is available", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(resolve(ids.proNone)).rejects.toMatchObject({ code: "NO_AI_KEY", status: 400 });
  });

  it("never offers managed AI on Free, even if the server has a key", async () => {
    process.env.OPENAI_API_KEY = "sk-managed";
    await expect(resolve(ids.freeNone)).rejects.toMatchObject({ code: "NO_AI_KEY" });
    await expect(resolve(ids.freeOrg)).rejects.toMatchObject({ code: "NO_AI_KEY" });
  });

  it("applies the workspace's limits, so a Free organization gets none", async () => {
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
});
