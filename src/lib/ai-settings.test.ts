import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

try {
  process.loadEnvFile(".env.local");
} catch {}

const owner = { userId: `test_u_${crypto.randomUUID()}`, orgId: null, ownerId: `test_o_${crypto.randomUUID()}`, orgRole: null };
vi.mock("@/lib/owner", () => ({ requireAdmin: async () => owner, getOwner: async () => owner }));

describe.skipIf(!process.env.DATABASE_URL)("AI credential settings (database)", () => {
  let savedKey: string | undefined;

  beforeAll(() => {
    savedKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  afterAll(async () => {
    if (savedKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = savedKey;
    const { getDb } = await import("@/db");
    const { aiCredentials } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await getDb().delete(aiCredentials).where(eq(aiCredentials.ownerId, owner.ownerId));
  });

  it("keeps one active provider when admins save different providers concurrently", async () => {
    const { getDb } = await import("@/db");
    const { aiCredentials } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await getDb().delete(aiCredentials).where(eq(aiCredentials.ownerId, owner.ownerId));
    const { PUT } = await import("@/app/api/settings/ai/route");
    const put = (provider: string, apiKey: string) =>
      PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ provider, apiKey }) }));

    const responses = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      index % 2 === 0 ? put("openai", `openai-test-key-${index}`) : put("anthropic", `anthropic-test-key-${index}`)
    ));

    expect(responses.every((response) => response.status === 200)).toBe(true);
    const rows = await getDb().select().from(aiCredentials).where(eq(aiCredentials.ownerId, owner.ownerId));
    expect(rows).toHaveLength(1);
    expect(["openai", "anthropic"]).toContain(rows[0].provider);
  });
});