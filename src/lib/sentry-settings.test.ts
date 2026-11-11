import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";

const testOwner = vi.hoisted(() => ({
  userId: `sentry_user_${crypto.randomUUID()}`,
  orgId: null as string | null,
  ownerId: `sentry_owner_${crypto.randomUUID()}`,
  orgRole: null as string | null,
  admin: true,
}));
vi.mock("@/lib/owner", () => ({
  getOwner: async () => testOwner,
  requireAdmin: async () => {
    if (!testOwner.admin) throw new ApiError(403, "Only organization admins can do this");
    return testOwner;
  },
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
const API = "https://sentry.io/api/0/";
const fetchMock = vi.fn();

function sentryPage(projects: unknown[], nextCursor?: string) {
  const link = nextCursor
    ? `<https://evil.example/steal>; rel="previous"; results="false"; cursor="0:0:1", <https://evil.example/steal?cursor=${nextCursor}>; rel="next"; results="true"; cursor="${nextCursor}"`
    : `<https://sentry.io/api/0/x>; rel="previous"; results="true"; cursor="0:0:1", <https://sentry.io/api/0/x>; rel="next"; results="false"; cursor="0:200:0"`;
  return new Response(JSON.stringify(projects), { status: 200, headers: { link, "content-type": "application/json" } });
}

const project = (id: number, extra: object = {}) => ({ id: String(id), slug: `proj-${id}`, name: `Project ${id}`, ...extra });
const putRequest = (body: unknown) => new Request("http://localhost/api/settings/sentry", { method: "PUT", body: JSON.stringify(body) });

describe.skipIf(!isLocalDatabase)("Sentry connection (local database)", () => {
  const otherOwnerId = `sentry_other_${crypto.randomUUID()}`;
  let savedKey: string | undefined;
  let getDb: typeof import("@/db").getDb;
  let schema: typeof import("@/db/schema");
  let drizzle: typeof import("drizzle-orm");

  const rows = async (ownerId = testOwner.ownerId) =>
    getDb().select().from(schema.sentryConnections).where(drizzle.eq(schema.sentryConnections.ownerId, ownerId));

  beforeAll(async () => {
    savedKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    schema = await import("@/db/schema");
    drizzle = await import("drizzle-orm");
    ({ getDb } = await import("@/db"));
  });

  beforeEach(() => {
    testOwner.admin = true;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    const owners = [testOwner.ownerId, otherOwnerId];
    await getDb().delete(schema.sentryConnections).where(drizzle.inArray(schema.sentryConnections.ownerId, owners));
    await getDb().delete(schema.projects).where(drizzle.inArray(schema.projects.ownerId, owners));
    await getDb().delete(schema.rateLimits).where(drizzle.like(schema.rateLimits.key, "sentry-%"));
  });

  afterAll(() => {
    if (savedKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = savedKey;
  });

  describe("settings route", () => {
    it("verifies the credentials against the fixed Sentry API and stores only encrypted token material", async () => {
      fetchMock.mockImplementation(async () => sentryPage([project(1)]));
      const { PUT, GET } = await import("@/app/api/settings/sentry/route");

      const put = await PUT(putRequest({ organizationSlug: " Acme-Org ", token: ` ${TOKEN} ` }));
      expect(put.status).toBe(200);
      expect(await put.json()).toEqual({ configured: true, organizationSlug: "acme-org", last4: TOKEN.slice(-4) });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url).startsWith(`${API}organizations/acme-org/projects/`)).toBe(true);
      expect(new URL(String(url)).origin).toBe("https://sentry.io");
      expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(init.redirect).toBe("manual");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.method ?? "GET").toBe("GET");

      const [row] = await rows();
      expect(row.organizationSlug).toBe("acme-org");
      expect(row.encryptedToken).not.toContain(TOKEN);
      expect(row.encryptedToken.startsWith("v1.")).toBe(true);
      const { decrypt } = await import("@/lib/crypto");
      expect(decrypt(row.encryptedToken)).toBe(TOKEN);

      const get = await GET();
      const body = await get.json();
      expect(body).toEqual({ configured: true, organizationSlug: "acme-org", last4: TOKEN.slice(-4) });
      expect(JSON.stringify(body)).not.toContain(TOKEN);
    });

    it("reports an unconfigured workspace", async () => {
      const { GET } = await import("@/app/api/settings/sentry/route");
      expect(await (await GET()).json()).toEqual({ configured: false, organizationSlug: null, last4: null });
    });

    it("rejects invalid slugs and tokens before calling Sentry", async () => {
      const { PUT } = await import("@/app/api/settings/sentry/route");
      for (const body of [
        { organizationSlug: "a/b", token: TOKEN },
        { organizationSlug: "..", token: TOKEN },
        { organizationSlug: "acme", token: "short" },
        { organizationSlug: "acme" },
      ]) {
        const res = await PUT(putRequest(body));
        expect(res.status).toBe(400);
      }
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await rows()).toHaveLength(0);
    });

    it("ignores a client-supplied API base URL", async () => {
      fetchMock.mockImplementation(async () => sentryPage([]));
      const { PUT } = await import("@/app/api/settings/sentry/route");
      const res = await PUT(putRequest({ organizationSlug: "acme", token: TOKEN, baseUrl: "https://evil.example", apiUrl: "http://127.0.0.1" }));
      expect(res.status).toBe(200);
      expect(String(fetchMock.mock.calls[0][0]).startsWith(API)).toBe(true);
      expect(Object.keys((await rows())[0]).sort()).toEqual(["encryptedToken", "organizationSlug", "ownerId", "updatedAt"]);
    });

    it.each([
      [401, 400, "SENTRY_AUTH"],
      [403, 400, "SENTRY_FORBIDDEN"],
      [404, 400, "SENTRY_NOT_FOUND"],
      [429, 429, "SENTRY_RATE_LIMIT"],
      [500, 502, "SENTRY_UNAVAILABLE"],
      [302, 502, "SENTRY_REDIRECT"],
    ])("maps Sentry %i to a safe %i %s error and saves nothing", async (upstream, status, code) => {
      fetchMock.mockResolvedValue(new Response(`upstream says ${TOKEN}`, { status: upstream, headers: upstream === 302 ? { location: "https://evil.example" } : {} }));
      const { PUT } = await import("@/app/api/settings/sentry/route");
      const res = await PUT(putRequest({ organizationSlug: "acme", token: TOKEN }));
      const text = await res.text();
      expect(res.status).toBe(status);
      expect(JSON.parse(text).code).toBe(code);
      expect(text).not.toContain(TOKEN);
      expect(await rows()).toHaveLength(0);
    });

    it("mentions both required read scopes in auth/forbidden responses", async () => {
      const { PUT } = await import("@/app/api/settings/sentry/route");

      fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
      const auth = await PUT(putRequest({ organizationSlug: "acme", token: TOKEN }));
      const authBody = await auth.json();
      expect(authBody.code).toBe("SENTRY_AUTH");
      expect(authBody.error).toContain("project:read");
      expect(authBody.error).toContain("event:read");

      fetchMock.mockResolvedValueOnce(new Response("", { status: 403 }));
      const forbidden = await PUT(putRequest({ organizationSlug: "acme", token: TOKEN }));
      const forbiddenBody = await forbidden.json();
      expect(forbiddenBody.code).toBe("SENTRY_FORBIDDEN");
      expect(forbiddenBody.error).toContain("project:read");
      expect(forbiddenBody.error).toContain("event:read");
    });

    it("maps timeouts, network failures and malformed payloads without leaking the token", async () => {
      const { PUT } = await import("@/app/api/settings/sentry/route");
      const attempts: [() => void, number, string][] = [
        [() => fetchMock.mockRejectedValue(Object.assign(new Error(`slow ${TOKEN}`), { name: "TimeoutError" })), 504, "SENTRY_TIMEOUT"],
        [() => fetchMock.mockRejectedValue(new Error(`connect failed for ${TOKEN}`)), 502, "SENTRY_UNAVAILABLE"],
        [() => fetchMock.mockResolvedValue(new Response("not json", { status: 200 })), 502, "SENTRY_INVALID_RESPONSE"],
        [() => fetchMock.mockResolvedValue(new Response(JSON.stringify({ projects: [] }), { status: 200 })), 502, "SENTRY_INVALID_RESPONSE"],
        [
          () =>
            fetchMock.mockResolvedValue(
              new Response(JSON.stringify(Array.from({ length: 101 }, (_, i) => project(i + 1))), { status: 200 })
            ),
          502,
          "SENTRY_INVALID_RESPONSE",
        ],
      ];
      for (const [arrange, status, code] of attempts) {
        arrange();
        const res = await PUT(putRequest({ organizationSlug: "acme", token: TOKEN }));
        const text = await res.text();
        expect(res.status).toBe(status);
        expect(JSON.parse(text).code).toBe(code);
        expect(text).not.toContain(TOKEN);
      }
      expect(await rows()).toHaveLength(0);
      for (const call of vi.mocked(console.error).mock.calls) expect(JSON.stringify(call)).not.toContain(TOKEN);
    });

    it("keeps the existing connection when a replacement fails verification, and replaces it when it succeeds", async () => {
      const { PUT, GET } = await import("@/app/api/settings/sentry/route");
      fetchMock.mockImplementation(async () => sentryPage([]));
      await PUT(putRequest({ organizationSlug: "first", token: TOKEN }));

      fetchMock.mockResolvedValue(new Response("", { status: 401 }));
      const failed = await PUT(putRequest({ organizationSlug: "second", token: "x".repeat(40) }));
      expect(failed.status).toBe(400);
      expect((await GET().then((r) => r.json())).organizationSlug).toBe("first");

      const replacement = "sntryu_" + "feedbeef".repeat(8);
      fetchMock.mockImplementation(async () => sentryPage([]));
      await PUT(putRequest({ organizationSlug: "second", token: replacement }));
      const stored = await rows();
      expect(stored).toHaveLength(1);
      expect(stored[0].organizationSlug).toBe("second");
      const { decrypt } = await import("@/lib/crypto");
      expect(decrypt(stored[0].encryptedToken)).toBe(replacement);
    });

    it("limits saving and removing the connection to admins while members can read the safe status", async () => {
      fetchMock.mockImplementation(async () => sentryPage([]));
      const { PUT, GET, DELETE } = await import("@/app/api/settings/sentry/route");
      await PUT(putRequest({ organizationSlug: "acme", token: TOKEN }));
      fetchMock.mockClear();

      testOwner.admin = false;
      expect((await PUT(putRequest({ organizationSlug: "evil", token: TOKEN }))).status).toBe(403);
      expect((await DELETE()).status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await (await GET()).json()).toEqual({ configured: true, organizationSlug: "acme", last4: TOKEN.slice(-4) });
      expect(await rows()).toHaveLength(1);
    });

    it("disconnects idempotently", async () => {
      fetchMock.mockImplementation(async () => sentryPage([]));
      const { PUT, DELETE, GET } = await import("@/app/api/settings/sentry/route");
      await PUT(putRequest({ organizationSlug: "acme", token: TOKEN }));
      expect(await (await DELETE()).json()).toEqual({ success: true });
      expect(await (await DELETE()).json()).toEqual({ success: true });
      expect((await (await GET()).json()).configured).toBe(false);
    });
  });

  describe("helpers", () => {
    it("returns the decrypted connection only to server callers and isolates workspaces", async () => {
      fetchMock.mockImplementation(async () => sentryPage([]));
      const { saveSentryConnection, getSentryConnection } = await import("@/lib/sentry-settings");
      await saveSentryConnection(testOwner.ownerId, "acme", TOKEN);
      expect(await getSentryConnection(testOwner.ownerId)).toMatchObject({ organizationSlug: "acme", token: TOKEN, last4: TOKEN.slice(-4) });
      expect(await getSentryConnection(otherOwnerId)).toBeNull();
    });

    it("lists safe project summaries across pages using only fixed URLs and validated cursors", async () => {
      const { saveSentryConnection, listSentryProjects } = await import("@/lib/sentry-settings");
      fetchMock.mockResolvedValueOnce(sentryPage([project(1)]));
      await saveSentryConnection(testOwner.ownerId, "acme", TOKEN);
      fetchMock.mockReset();

      fetchMock
        .mockResolvedValueOnce(sentryPage([
          project(1, { slug: "_internal", organization: { secret: "x" }, access: ["project:admin"], teams: [{ id: "9" }] }),
          project(2, { slug: "-ops" }),
        ], "0:100:0"))
        .mockResolvedValueOnce(sentryPage([project(3)]));
      expect(await listSentryProjects(testOwner.ownerId)).toEqual([
        { id: "1", slug: "_internal", name: "Project 1" },
        { id: "2", slug: "-ops", name: "Project 2" },
        { id: "3", slug: "proj-3", name: "Project 3" },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      for (const [url, init] of fetchMock.mock.calls) {
        expect(String(url).startsWith(`${API}organizations/acme/projects/`)).toBe(true);
        expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
        expect(init.redirect).toBe("manual");
      }
      expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("cursor")).toBeNull();
      expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get("cursor")).toBe("0:100:0");
    });

    it("keeps valid siblings when a page includes malformed rows and bounds overlong display names", async () => {
      const { saveSentryConnection, listSentryProjects } = await import("@/lib/sentry-settings");
      fetchMock.mockResolvedValueOnce(sentryPage([project(1)]));
      await saveSentryConnection(testOwner.ownerId, "acme", TOKEN);
      fetchMock.mockReset();

      const longName = "N".repeat(250);
      fetchMock.mockResolvedValueOnce(
        sentryPage([
          { id: "1", slug: "_internal", name: "Internal" },
          { id: "2", slug: "-ops", name: longName },
          { id: "oops", slug: "bad slug!", name: "bad" },
          { id: "3", slug: "api", name: "API" },
        ])
      );

      expect(await listSentryProjects(testOwner.ownerId)).toEqual([
        { id: "1", slug: "_internal", name: "Internal" },
        { id: "2", slug: "-ops", name: "N".repeat(200) },
        { id: "3", slug: "api", name: "API" },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("fails clearly when page budget is exhausted and rejects unsafe cursors", async () => {
      const { saveSentryConnection, listSentryProjects } = await import("@/lib/sentry-settings");
      fetchMock.mockResolvedValueOnce(sentryPage([]));
      await saveSentryConnection(testOwner.ownerId, "acme", TOKEN);
      fetchMock.mockReset();

      let n = 0;
      fetchMock.mockImplementation(async () => sentryPage([project(++n)], `0:${n * 100}:0`));
      await expect(listSentryProjects(testOwner.ownerId)).rejects.toMatchObject({ status: 502, code: "SENTRY_PAGE_LIMIT" });
      expect(fetchMock).toHaveBeenCalledTimes(10);

      fetchMock.mockReset();
      fetchMock.mockImplementation(async () => sentryPage([project(1)], "../../evil?x=1"));
      await expect(listSentryProjects(testOwner.ownerId)).rejects.toMatchObject({ code: "SENTRY_INVALID_RESPONSE" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("requires a connection to list projects and never calls Sentry for another workspace", async () => {
      const { saveSentryConnection, listSentryProjects } = await import("@/lib/sentry-settings");
      fetchMock.mockResolvedValueOnce(sentryPage([]));
      await saveSentryConnection(testOwner.ownerId, "acme", TOKEN);
      fetchMock.mockReset();
      await expect(listSentryProjects(otherOwnerId)).rejects.toMatchObject({ status: 400, code: "NO_SENTRY" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("keeps selected projects when the connection is replaced or removed", async () => {
      const { saveSentryConnection, deleteSentryConnection, getSentryConnection } = await import("@/lib/sentry-settings");
      const { createProject, getProject } = await import("@/lib/projects");
      const { createProjectSchema } = await import("@/lib/validation");
      const selection = [{ id: "7", slug: "web", name: "Web" }, { id: "8", slug: "api", name: "API" }];
      const created = await createProject(
        { ...testOwner, orgId: null, orgRole: null },
        createProjectSchema.parse({ name: "Keeps selection", sentryProjects: selection }),
        5
      );

      fetchMock.mockImplementation(async () => sentryPage([]));
      await saveSentryConnection(testOwner.ownerId, "first", TOKEN);
      await saveSentryConnection(testOwner.ownerId, "second", "sntryu_" + "feedbeef".repeat(8));
      expect((await getProject(testOwner.ownerId, created.id))?.sentryProjects).toEqual(selection);

      await deleteSentryConnection(testOwner.ownerId);
      expect(await getSentryConnection(testOwner.ownerId)).toBeNull();
      expect((await getProject(testOwner.ownerId, created.id))?.sentryProjects).toEqual(selection);
    });
  });

  describe("project list route", () => {
    it("lets any workspace member read safe project summaries", async () => {
      fetchMock.mockResolvedValueOnce(sentryPage([]));
      const { saveSentryConnection } = await import("@/lib/sentry-settings");
      await saveSentryConnection(testOwner.ownerId, "acme", TOKEN);
      fetchMock.mockReset();
      fetchMock.mockImplementation(async () => sentryPage([project(1, { organization: { id: "z" }, platform: "node" })]));

      testOwner.admin = false;
      const { GET } = await import("@/app/api/sentry/projects/route");
      const res = await GET();
      const text = await res.text();
      expect(res.status).toBe(200);
      expect(JSON.parse(text)).toEqual({ projects: [{ id: "1", slug: "proj-1", name: "Project 1" }] });
      expect(text).not.toContain(TOKEN);
    });

    it("returns an actionable error when Sentry is not connected", async () => {
      const { GET } = await import("@/app/api/sentry/projects/route");
      const res = await GET();
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("NO_SENTRY");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("maps upstream failures to safe errors", async () => {
      fetchMock.mockResolvedValueOnce(sentryPage([]));
      const { saveSentryConnection } = await import("@/lib/sentry-settings");
      await saveSentryConnection(testOwner.ownerId, "acme", TOKEN);
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(new Response(`bad ${TOKEN}`, { status: 401 }));

      const { GET } = await import("@/app/api/sentry/projects/route");
      const res = await GET();
      const text = await res.text();
      expect(res.status).toBe(400);
      expect(JSON.parse(text).code).toBe("SENTRY_AUTH");
      expect(text).not.toContain(TOKEN);
    });
  });
});
