import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

try {
  process.loadEnvFile(".env.local");
} catch {}

const owner = {
  userId: `test_u_${crypto.randomUUID()}`,
  orgId: null,
  ownerId: `test_o_${crypto.randomUUID()}`,
  orgRole: null,
};
const stranger = { ...owner, userId: "test_u_stranger", ownerId: `test_o_${crypto.randomUUID()}` };
let current = owner;

vi.mock("@/lib/owner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/owner")>()),
  getOwner: async () => current,
}));

const encoder = new TextEncoder();
const body = (...events: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(e));
      controller.close();
    },
  });
const delta = (t: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;

let aiResponse: () => Response;

describe.skipIf(!process.env.DATABASE_URL)("POST /api/projects/[id]/generate (database)", () => {
  let projectId: string;

  beforeAll(async () => {
    const { getDb } = await import("@/db");
    const { aiCredentials } = await import("@/db/schema");
    const { encrypt } = await import("./crypto");
    const { saveGithubConnection } = await import("./github");
    const { createProject } = await import("./projects");
    const { createProjectSchema } = await import("./validation");

    await saveGithubConnection(owner.userId, { login: "dev", token: "gh_token", scopes: "repo" });
    await getDb()
      .insert(aiCredentials)
      .values({ ownerId: owner.ownerId, provider: "openai", encryptedKey: encrypt("sk-test"), last4: "test" });
    projectId = (
      await createProject(owner, createProjectSchema.parse({ name: "Route", repos: [{ fullName: "o/r" }] }), 5)
    ).id;
  });

  beforeEach(async () => {
    current = owner;
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const { usageCounters } = await import("@/db/schema");
    await getDb().delete(usageCounters).where(eq(usageCounters.ownerId, owner.ownerId));

    aiResponse = () => new Response(body(delta("Hello "), delta("world"), "data: [DONE]\n\n"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        if (url.hostname === "api.openai.com") return aiResponse();
        if (url.hostname === "api.github.com") {
          return new Response(
            JSON.stringify(
              url.pathname.endsWith("/commits")
                ? [
                    {
                      sha: "abcdef1234567",
                      html_url: "u",
                      parents: [{}],
                      author: { login: "dev", type: "User" },
                      commit: { message: "Add search", author: { name: "d", date: new Date().toISOString() } },
                    },
                  ]
                : []
            )
          );
        }
        throw new Error(`Unexpected request to ${url}`);
      })
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const { aiCredentials, githubConnections, projects, rateLimits, usageCounters } = await import("@/db/schema");
    const { inArray } = await import("drizzle-orm");
    const db = getDb();
    await db.delete(rateLimits).where(inArray(rateLimits.key, [owner.ownerId, stranger.ownerId].map((id) => `generate:${id}`)));
    await db.delete(projects).where(eq(projects.ownerId, owner.ownerId));
    await db.delete(usageCounters).where(eq(usageCounters.ownerId, owner.ownerId));
    await db.delete(aiCredentials).where(eq(aiCredentials.ownerId, owner.ownerId));
    await db.delete(githubConnections).where(eq(githubConnections.userId, owner.userId));
  });

  async function post(payload: unknown, id = projectId) {
    const { POST } = await import("@/app/api/projects/[id]/generate/route");
    return POST(
      new Request("http://localhost/api/x", { method: "POST", body: JSON.stringify(payload) }),
      { params: Promise.resolve({ id }) }
    );
  }
  const usage = async () => (await (await import("./usage")).getUsage(owner.ownerId)).byok;
  const status = async (logId: string) => {
    const { getLog } = await import("./logs");
    return (await getLog(owner.ownerId, logId))!;
  };

  it("streams plain text with the log id header and saves the result", async () => {
    const res = await post({ days: 7 });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("cache-control")).toContain("no-store");

    const text = await res.text();
    expect(text).toBe("Hello world");
    const log = await status(res.headers.get("x-ship-log-id")!);
    expect(log).toMatchObject({ status: "ready", content: "Hello world" });
    expect(await usage()).toBe(1);
  });

  it("accepts a date range and a template override", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const res = await post({ from: day, to: day, template: "changelog" });
    expect(await res.text()).toBe("Hello world");
    expect((await status(res.headers.get("x-ship-log-id")!)).template).toBe("changelog");
  });

  it("ends a failed stream with the error marker, marks the log failed and refunds", async () => {
    aiResponse = () =>
      new Response(body(delta("Partial"), `data: ${JSON.stringify({ error: { message: "boom" } })}\n\n`));
    const res = await post({ days: 7 });
    expect(res.status).toBe(200);

    const { STREAM_ERROR_MARKER } = await import("./constants");
    const text = await res.text();
    const [content, message] = text.split(STREAM_ERROR_MARKER);
    expect(content).toBe("Partial");
    expect(message).toContain("stopped responding");

    const log = await status(res.headers.get("x-ship-log-id")!);
    expect(log.status).toBe("failed");
    expect(log.error).toBe(message);
    expect(await usage()).toBe(0);
  });

  it("treats an empty answer as a failure", async () => {
    aiResponse = () => new Response(body("data: [DONE]\n\n"));
    const res = await post({ days: 7 });
    const { STREAM_ERROR_MARKER } = await import("./constants");
    expect(await res.text()).toContain(STREAM_ERROR_MARKER);
    expect((await status(res.headers.get("x-ship-log-id")!)).status).toBe("failed");
    expect(await usage()).toBe(0);
  });

  it("returns a normal JSON error before streaming starts", async () => {
    aiResponse = () => new Response("nope", { status: 401 });
    const res = await post({ days: 7 });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toMatchObject({ code: "AI_AUTH" });
    expect(await usage()).toBe(0);
  });

  it("validates the body", async () => {
    const res = await post({ days: 500 });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION" });
  });

  it("returns 404 for another tenant's project and malformed ids", async () => {
    current = stranger;
    expect((await post({ days: 7 })).status).toBe(404);
    current = owner;
    expect((await post({ days: 7 }, "not-a-uuid")).status).toBe(404);
  });

  it("returns 403 with LIMIT_REACHED once the monthly limit is used", async () => {
    const { getDb } = await import("@/db");
    const { usageCounters } = await import("@/db/schema");
    const { currentPeriod } = await import("./usage");
    await getDb()
      .insert(usageCounters)
      .values({ ownerId: owner.ownerId, period: currentPeriod(), kind: "byok", count: 5 });

    const res = await post({ days: 7 });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "LIMIT_REACHED" });
  });

  it("regenerates an existing log in place via regenerateLogId", async () => {
    const first = await post({ days: 7 });
    await first.text();
    const logId = first.headers.get("x-ship-log-id")!;

    aiResponse = () => new Response(body(delta("Rewritten"), "data: [DONE]\n\n"));
    const second = await post({ regenerateLogId: logId });
    expect(second.headers.get("x-ship-log-id")).toBe(logId);
    expect(await second.text()).toBe("Rewritten");
    expect((await status(logId)).content).toBe("Rewritten");

    const { listVersions } = await import("./logs");
    expect((await listVersions(logId)).map((v) => v.content)).toEqual(["Hello world"]);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("POST /api/projects/[id]/generate rate limit (database)", () => {
  it("stops an owner after the hourly cap, before reserving usage or calling anything", async () => {
    const { GENERATE_RATE, hitRateLimit } = await import("./rate-limit");
    const rateOwner = { userId: `test_u_${crypto.randomUUID()}`, orgId: null, ownerId: `test_o_${crypto.randomUUID()}`, orgRole: null };
    const { createProject } = await import("./projects");
    const { createProjectSchema } = await import("./validation");
    const project = await createProject(rateOwner, createProjectSchema.parse({ name: "Rate" }), 5);

    const key = `generate:${rateOwner.ownerId}`;
    try {
      for (let i = 0; i < GENERATE_RATE.limit; i++) await hitRateLimit(key, GENERATE_RATE.limit, GENERATE_RATE.windowMs);

      current = rateOwner;
      const fetchFn = vi.fn();
      vi.stubGlobal("fetch", fetchFn);
      const { POST } = await import("@/app/api/projects/[id]/generate/route");
      const res = await POST(new Request("http://x", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: project.id }) });

      expect(res.status).toBe(429);
      expect(await res.json()).toMatchObject({ code: "RATE_LIMITED" });
      expect(fetchFn).not.toHaveBeenCalled();
      expect((await (await import("./usage")).getUsage(rateOwner.ownerId)).byok).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      const { getDb } = await import("@/db");
      const { projects, rateLimits } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      await getDb().delete(projects).where(eq(projects.id, project.id));
      await getDb().delete(rateLimits).where(eq(rateLimits.key, key));
    }
  });
});
