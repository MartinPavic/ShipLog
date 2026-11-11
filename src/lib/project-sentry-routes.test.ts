import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const testOwner = vi.hoisted(() => ({
  userId: "",
  orgId: null as string | null,
  ownerId: "",
  orgRole: null as string | null,
}));
vi.mock("@/lib/owner", () => ({
  getOwner: async () => testOwner,
}));

const isLocalDatabase = (() => {
  try {
    const host = new URL(process.env.DATABASE_URL ?? "").hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
})();

const TOKEN = "sntryu_" + "0123abcd".repeat(8);
const fetchMock = vi.fn();
const real = [
  { id: "11", slug: "web", name: "Web App" },
  { id: "22", slug: "api", name: "API" },
  { id: "33", slug: "worker", name: "Worker" },
];
const sentryPage = (projects: unknown[]) =>
  new Response(JSON.stringify(projects), { status: 200, headers: { "content-type": "application/json" } });
const json = (method: string, body: unknown) =>
  new Request("http://localhost/api/projects", { method, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe.skipIf(!isLocalDatabase)("project Sentry selection routes (local database)", () => {
  const created: string[] = [];
  let savedKey: string | undefined;
  let schema: typeof import("@/db/schema");
  let drizzle: typeof import("drizzle-orm");
  let getDb: typeof import("@/db").getDb;

  async function connect() {
    fetchMock.mockImplementation(async () => sentryPage(real));
    const { saveSentryConnection } = await import("@/lib/sentry-settings");
    await saveSentryConnection(testOwner.ownerId, "acme", TOKEN);
    fetchMock.mockClear();
  }
  const projectRows = () =>
    getDb().select().from(schema.projects).where(drizzle.eq(schema.projects.ownerId, testOwner.ownerId));
  const sentryProjectRateCount = async () => {
    const rows = await getDb()
      .select({ count: schema.rateLimits.count })
      .from(schema.rateLimits)
      .where(drizzle.eq(schema.rateLimits.key, `sentry-projects:${testOwner.ownerId}`));
    return rows.reduce((sum, row) => sum + row.count, 0);
  };
  async function createWith(sentryProjects?: unknown) {
    const { POST } = await import("@/app/api/projects/route");
    return POST(json("POST", { name: "Site", ...(sentryProjects === undefined ? {} : { sentryProjects }) }));
  }

  beforeAll(async () => {
    savedKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    schema = await import("@/db/schema");
    drizzle = await import("drizzle-orm");
    ({ getDb } = await import("@/db"));
  });

  beforeEach(() => {
    testOwner.ownerId = `test_o_${crypto.randomUUID()}`;
    testOwner.userId = `test_u_${crypto.randomUUID()}`;
    created.push(testOwner.ownerId);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    if (savedKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = savedKey;
    const db = getDb();
    await db.delete(schema.projects).where(drizzle.inArray(schema.projects.ownerId, created));
    await db.delete(schema.sentryConnections).where(drizzle.inArray(schema.sentryConnections.ownerId, created));
    await db
      .delete(schema.rateLimits)
      .where(drizzle.inArray(schema.rateLimits.key, created.map((ownerId) => `sentry-projects:${ownerId}`)));
  });

  describe("POST /api/projects", () => {
    it("persists API-derived records and ignores client-provided slug and name", async () => {
      await connect();
      const response = await createWith([
        { id: "22", slug: "forged-slug", name: "Forged name" },
        { id: "11", slug: "web", name: "<script>alert(1)</script>" },
      ]);
      expect(response.status).toBe(201);
      const { project } = await response.json();
      expect(project.sentryProjects).toEqual([real[1], real[0]]);
      expect((await projectRows())[0].sentryProjects).toEqual([real[1], real[0]]);
      expect(await sentryProjectRateCount()).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("rejects an id the connected workspace cannot access and creates nothing", async () => {
      await connect();
      const response = await createWith([{ id: "999", slug: "web", name: "Web App" }]);
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("SENTRY_PROJECT_UNAVAILABLE");
      expect(await projectRows()).toHaveLength(0);
    });

    it("does not accept a real slug or name under a different id", async () => {
      await connect();
      const response = await createWith([{ id: "999", slug: "api", name: "API" }]);
      expect(response.status).toBe(400);
      expect(await projectRows()).toHaveLength(0);
    });

    it("allows an empty selection without a Sentry connection and without calling Sentry", async () => {
      expect((await createWith([])).status).toBe(201);
      expect((await projectRows())[0].sentryProjects).toEqual([]);
      expect(await sentryProjectRateCount()).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("defaults an omitted selection to empty without calling Sentry", async () => {
      expect((await createWith()).status).toBe(201);
      expect((await projectRows())[0].sentryProjects).toEqual([]);
      expect(await sentryProjectRateCount()).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("checks plan limits before reconciling non-empty Sentry selections", async () => {
      const { getPlanLimits } = await import("@/lib/plans");
      const { limits } = await getPlanLimits(testOwner.ownerId);
      for (let i = 0; i < limits.maxProjects; i++) {
        expect((await createWith()).status).toBe(201);
      }
      await connect();
      const response = await createWith([real[0]]);
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("LIMIT_REACHED");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await sentryProjectRateCount()).toBe(0);
    });

    it("resolves ids against the caller's own workspace connection only", async () => {
      await connect();
      testOwner.ownerId = `test_o_${crypto.randomUUID()}`;
      created.push(testOwner.ownerId);
      const { saveSentryConnection } = await import("@/lib/sentry-settings");
      fetchMock.mockImplementation(async () => sentryPage([{ id: "77", slug: "mine", name: "Mine" }]));
      await saveSentryConnection(testOwner.ownerId, "other-org", TOKEN);

      expect((await createWith([real[0]])).status).toBe(400);
      const ok = await createWith([{ id: "77", slug: "x", name: "x" }]);
      expect(ok.status).toBe(201);
      expect((await ok.json()).project.sentryProjects).toEqual([{ id: "77", slug: "mine", name: "Mine" }]);
    });

    it("returns an actionable error for a selection without a connection and creates nothing", async () => {
      const response = await createWith([real[0]]);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "NO_SENTRY", error: "Connect Sentry in Settings first." });
      expect(await projectRows()).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("fails safely when Sentry is unavailable, without leaking the token", async () => {
      await connect();
      fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
      const response = await createWith([real[0]]);
      expect(response.status).toBe(502);
      expect(JSON.stringify(await response.json())).not.toContain(TOKEN);
      expect(await projectRows()).toHaveLength(0);
    });
  });

  describe("PATCH /api/projects/[id]", () => {
    async function seeded() {
      await connect();
      const { project } = await (await createWith([real[0], real[1]])).json();
      await getDb().delete(schema.rateLimits).where(drizzle.eq(schema.rateLimits.key, `sentry-projects:${testOwner.ownerId}`));
      fetchMock.mockClear();
      fetchMock.mockImplementation(async () => sentryPage(real));
      return project.id as string;
    }
    const patch = async (id: string, body: unknown) => {
      const { PATCH } = await import("@/app/api/projects/[id]/route");
      return PATCH(json("PATCH", body), ctx(id));
    };
    const stored = async (id: string) =>
      (await getDb().select().from(schema.projects).where(drizzle.eq(schema.projects.id, id)))[0].sentryProjects;

    it("replaces the selection with API-derived records and ignores client slug and name", async () => {
      const id = await seeded();
      const response = await patch(id, { sentryProjects: [{ id: "33", slug: "forged", name: "Forged" }] });
      expect(response.status).toBe(200);
      expect((await response.json()).project.sentryProjects).toEqual([real[2]]);
      expect(await sentryProjectRateCount()).toBe(1);
      expect(await stored(id)).toEqual([real[2]]);
    });

    it("rejects inaccessible ids and keeps the existing selection", async () => {
      const id = await seeded();
      const response = await patch(id, { sentryProjects: [real[0], { id: "999", slug: "web", name: "Web App" }] });
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("SENTRY_PROJECT_UNAVAILABLE");
      expect(await stored(id)).toEqual([real[0], real[1]]);
    });

    it("retains the existing selection when the field is omitted, without calling Sentry", async () => {
      const id = await seeded();
      const response = await patch(id, { name: "Renamed" });
      expect(response.status).toBe(200);
      expect(await stored(id)).toEqual([real[0], real[1]]);
      expect(await sentryProjectRateCount()).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("checks project ownership before reconciling non-empty Sentry selections", async () => {
      await connect();
      const response = await patch(crypto.randomUUID(), { sentryProjects: [real[0]] });
      expect(response.status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await sentryProjectRateCount()).toBe(0);
    });

    it("clears the selection with an empty list even after Sentry was disconnected", async () => {
      const id = await seeded();
      const { deleteSentryConnection } = await import("@/lib/sentry-settings");
      await deleteSentryConnection(testOwner.ownerId);
      const response = await patch(id, { sentryProjects: [] });
      expect(response.status).toBe(200);
      expect(await stored(id)).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("keeps selections when the connection is removed or replaced", async () => {
      const id = await seeded();
      const { deleteSentryConnection, saveSentryConnection } = await import("@/lib/sentry-settings");
      await deleteSentryConnection(testOwner.ownerId);
      expect(await stored(id)).toEqual([real[0], real[1]]);

      const response = await patch(id, { sentryProjects: [real[0]] });
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("NO_SENTRY");
      expect(await stored(id)).toEqual([real[0], real[1]]);

      await saveSentryConnection(testOwner.ownerId, "other", TOKEN);
      expect(await stored(id)).toEqual([real[0], real[1]]);
    });

    it("keeps a project untouched when Sentry is unavailable", async () => {
      const id = await seeded();
      fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
      const response = await patch(id, { name: "Renamed", sentryProjects: [real[0]] });
      expect(response.status).toBe(502);
      expect(await stored(id)).toEqual([real[0], real[1]]);
      const [row] = await getDb().select().from(schema.projects).where(drizzle.eq(schema.projects.id, id));
      expect(row.name).toBe("Site");
    });
  });
});
