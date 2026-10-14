import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

try {
  process.loadEnvFile(".env.local");
} catch {}

import { resolvePeriod } from "./generation";

describe("resolvePeriod", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  const day = 24 * 60 * 60 * 1000;

  it("uses the default days ending now", () => {
    const { start, end } = resolvePeriod({}, 7, now);
    expect(end).toEqual(now);
    expect(now.getTime() - start.getTime()).toBe(7 * day);
  });

  it("prefers explicit days", () => {
    expect(now.getTime() - resolvePeriod({ days: 30 }, 7, now).start.getTime()).toBe(30 * day);
  });

  it("covers the whole last day of an inclusive range", () => {
    const { start, end } = resolvePeriod(
      { from: new Date("2026-10-01"), to: new Date("2026-10-03") },
      7,
      now
    );
    expect(start).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(end).toEqual(new Date("2026-10-03T23:59:59.999Z"));
  });

  it("never extends into the future", () => {
    const { end } = resolvePeriod({ from: new Date("2026-10-10"), to: new Date("2026-10-14") }, 7, now);
    expect(end).toEqual(now);
  });

  it("rejects ranges that start in the future", () => {
    expect(() => resolvePeriod({ from: new Date("2026-11-01"), to: new Date("2026-11-05") }, 7, now)).toThrow(
      expect.objectContaining({ status: 400 })
    );
  });
});

const encoder = new TextEncoder();
const sse = (...texts: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const t of texts) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

const commit = {
  sha: "abcdef1234567",
  html_url: "https://github.com/o/r/commit/abcdef1",
  parents: [{}],
  author: { login: "dev", type: "User" },
  commit: { message: "Add search", author: { name: "dev", date: new Date().toISOString() } },
};

async function collect(stream: AsyncIterable<string>) {
  let text = "";
  for await (const chunk of stream) text += chunk;
  return text;
}

// Real database, stubbed GitHub and AI APIs, isolated ids.
describe.skipIf(!process.env.DATABASE_URL)("streaming generation lifecycle (database)", () => {
  const owner = {
    userId: `test_u_${crypto.randomUUID()}`,
    orgId: null,
    ownerId: `test_o_${crypto.randomUUID()}`,
    orgRole: null,
  };
  let github: { commits: unknown[] };
  let ai: { status: number; chunks: string[] };
  let project: Awaited<ReturnType<typeof import("./projects").createProject>>;

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
      .values({ ownerId: owner.ownerId, provider: "openai", encryptedKey: encrypt("sk-test-key"), last4: "-key" });
    project = await createProject(
      owner,
      createProjectSchema.parse({ name: "Gen", repos: [{ fullName: "o/r" }] }),
      5
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  beforeEach(async () => {
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const { usageCounters } = await import("@/db/schema");
    await getDb().delete(usageCounters).where(eq(usageCounters.ownerId, owner.ownerId));
  });

  afterAll(async () => {
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const { aiCredentials, githubConnections, projects, usageCounters } = await import("@/db/schema");
    const db = getDb();
    await db.delete(projects).where(eq(projects.ownerId, owner.ownerId));
    await db.delete(usageCounters).where(eq(usageCounters.ownerId, owner.ownerId));
    await db.delete(aiCredentials).where(eq(aiCredentials.ownerId, owner.ownerId));
    await db.delete(githubConnections).where(eq(githubConnections.userId, owner.userId));
  });

  function stubApis() {
    github = { commits: [commit] };
    ai = { status: 200, chunks: ["Shipped ", "search."] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        if (url.hostname === "api.openai.com") {
          return ai.status === 200 ? new Response(sse(...ai.chunks)) : new Response("err", { status: ai.status });
        }
        if (url.hostname === "api.github.com") {
          return new Response(JSON.stringify(url.pathname.endsWith("/commits") ? github.commits : []));
        }
        throw new Error(`Unexpected request to ${url}`);
      })
    );
  }

  const usage = async () => (await (await import("./usage")).getUsage(owner.ownerId)).byok;
  const logRow = async (id: string) => {
    const { getLog } = await import("./logs");
    return (await getLog(owner.ownerId, id))!;
  };

  it("streams, persists the log with its source snapshot, and counts usage", async () => {
    stubApis();
    const { startStreamingGeneration } = await import("./generation");
    const gen = await startStreamingGeneration({ owner, project, period: { days: 7 } });

    expect((await logRow(gen.logId)).status).toBe("generating");
    const text = await collect(gen.stream);
    expect(text).toBe("Shipped search.");
    await gen.finish(text);

    const log = await logRow(gen.logId);
    expect(log).toMatchObject({ status: "ready", content: "Shipped search.", provider: "openai", error: null });
    const { asActivity } = await import("./github-activity");
    expect(asActivity(log.sourceSnapshot)?.repos[0].commits[0].message).toBe("Add search");
    expect(await usage()).toBe(1);
  });

  it("marks the log failed and refunds usage when the stream fails", async () => {
    stubApis();
    const { startStreamingGeneration } = await import("./generation");
    const before = await usage();
    const gen = await startStreamingGeneration({ owner, project, period: { days: 7 } });
    expect(await usage()).toBe(before + 1);

    await gen.fail("Provider exploded");
    const log = await logRow(gen.logId);
    expect(log).toMatchObject({ status: "failed", error: "Provider exploded" });
    expect(await usage()).toBe(before);
  });

  it("keeps the usage when a cancel happens after text was produced", async () => {
    stubApis();
    const { startStreamingGeneration } = await import("./generation");
    const before = await usage();
    const gen = await startStreamingGeneration({ owner, project, period: { days: 7 } });
    await gen.fail("Cancelled.", { refund: false });
    expect(await usage()).toBe(before + 1);
    // Settled once: a later failure must not refund again.
    await gen.fail("again");
    expect(await usage()).toBe(before + 1);
  });

  it("rejects before streaming on provider errors and refunds without leaving a log", async () => {
    stubApis();
    ai.status = 401;
    const { startStreamingGeneration } = await import("./generation");
    const { listLogs } = await import("./logs");
    const { logListQuerySchema } = await import("./validation");
    const { PLAN_LIMITS } = await import("./plans");
    const before = await usage();
    const logsBefore = (await listLogs(owner.ownerId, project.id, logListQuerySchema.parse({}), PLAN_LIMITS.pro)).total;

    await expect(startStreamingGeneration({ owner, project, period: { days: 7 } })).rejects.toMatchObject({
      code: "AI_AUTH",
    });
    expect(await usage()).toBe(before);
    expect((await listLogs(owner.ownerId, project.id, logListQuerySchema.parse({}), PLAN_LIMITS.pro)).total).toBe(logsBefore);
  });

  it("rejects an empty period without charging usage", async () => {
    stubApis();
    github.commits = [];
    const { startStreamingGeneration } = await import("./generation");
    const before = await usage();
    await expect(startStreamingGeneration({ owner, project, period: { days: 7 } })).rejects.toMatchObject({
      code: "NO_ACTIVITY",
    });
    expect(await usage()).toBe(before);
  });

  it("regenerates in place, keeping id and period, and versions the old text", async () => {
    stubApis();
    const { startStreamingGeneration } = await import("./generation");
    const { listVersions } = await import("./logs");

    const first = await startStreamingGeneration({ owner, project, period: { days: 7 } });
    await first.finish(await collect(first.stream));
    const original = await logRow(first.logId);

    ai.chunks = ["Second ", "take."];
    const second = await startStreamingGeneration({ owner, project, existing: original });
    expect(second.logId).toBe(original.id);
    await second.finish(await collect(second.stream));

    const updated = await logRow(original.id);
    expect(updated.content).toBe("Second take.");
    expect(updated.periodStart).toEqual(original.periodStart);
    expect(updated.periodEnd).toEqual(original.periodEnd);
    expect((await listVersions(original.id)).map((v) => v.content)).toEqual(["Shipped search."]);
  });

  it("does not touch the log when a regeneration fails", async () => {
    stubApis();
    const { startStreamingGeneration } = await import("./generation");
    const first = await startStreamingGeneration({ owner, project, period: { days: 7 } });
    await first.finish(await collect(first.stream));
    const original = await logRow(first.logId);

    const second = await startStreamingGeneration({ owner, project, existing: original });
    await second.fail("nope");
    const after = await logRow(original.id);
    expect(after.status).toBe("ready");
    expect(after.content).toBe(original.content);
  });

  it("enforces the monthly limit before any provider call", async () => {
    stubApis();
    const { startStreamingGeneration } = await import("./generation");
    const { getDb } = await import("@/db");
    const { usageCounters } = await import("@/db/schema");
    const { currentPeriod } = await import("./usage");
    await getDb()
      .insert(usageCounters)
      .values({ ownerId: owner.ownerId, period: currentPeriod(), kind: "byok", count: 5 })
      .onConflictDoUpdate({
        target: [usageCounters.ownerId, usageCounters.period, usageCounters.kind],
        set: { count: 5 },
      });

    const fetchFn = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchFn.mockClear();
    await expect(startStreamingGeneration({ owner, project, period: { days: 7 } })).rejects.toMatchObject({
      code: "LIMIT_REACHED",
    });
    expect(fetchFn).not.toHaveBeenCalled();

    const { getUsageMeter } = await import("./usage");
    expect(await getUsageMeter(owner.ownerId)).toEqual({ kind: "byok", used: 5, limit: 5 });
  });
});
