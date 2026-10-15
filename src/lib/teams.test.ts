import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

try {
  process.loadEnvFile(".env.local");
} catch {}

const { isOrgMember } = vi.hoisted(() => ({
  isOrgMember: vi.fn<(orgId: string, userId: string) => Promise<boolean>>(async () => true),
}));
vi.mock("@/lib/orgs", () => ({ isOrgMember }));
vi.mock("@clerk/nextjs/server", () => ({
  currentUser: async () => ({ emailAddresses: [{ emailAddress: "x@example.com" }] }),
  auth: async () => ({}),
  clerkClient: async () => ({
    users: { getUser: async () => ({ primaryEmailAddress: { emailAddress: "creator@example.com" }, emailAddresses: [] }) },
  }),
}));

type Who = { userId: string; orgId: string | null; ownerId: string; orgRole: string | null };
let current: Who;

vi.mock("@/lib/owner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner")>();
  const { ApiError } = await import("@/lib/api");
  return {
    ...actual,
    getOwner: async () => current,
    requireAdmin: async () => {
      if (!actual.isAdmin(current)) throw new ApiError(403, "Only organization admins can do this");
      return current;
    },
  };
});

const rand = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const orgId = `org_test_${rand()}`;
const freeOrgId = `org_test_${rand()}`;
const mk = (userId: string, org: string | null, role: string | null): Who => ({ userId, orgId: org, ownerId: org ?? userId, orgRole: role });

const admin = mk(`test_u_${rand()}`, orgId, "org:admin");
const member = mk(`test_u_${rand()}`, orgId, "org:member");
const outsider = mk(`test_u_${rand()}`, null, null); // personal workspace of someone else
const adminPersonal = mk(admin.userId, null, null); // the admin's own personal workspace
const freeAdmin = mk(`test_u_${rand()}`, freeOrgId, "org:admin");

let calls: { url: string; auth: string | null }[];
let activity: unknown[];

function stubFetch() {
  calls = [];
  activity = [
    {
      sha: "abcdef1234567",
      html_url: "u",
      parents: [{}],
      author: { login: "dev", type: "User" },
      commit: { message: "Add search", author: { name: "d", date: new Date().toISOString() } },
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, auth: headers.Authorization ?? null });
      const u = new URL(url);
      if (u.hostname === "api.github.com") return new Response(JSON.stringify(u.pathname.endsWith("/commits") ? activity : []));
      if (u.hostname === "api.openai.com") return new Response(JSON.stringify({ choices: [{ message: { content: "Summary" } }] }));
      if (u.hostname === "api.resend.com") return new Response(JSON.stringify({ id: "em" }));
      throw new Error(`Unexpected request to ${url}`);
    })
  );
}

describe("workspace plan limits", () => {
  it("personal Free is unchanged, Free organizations cannot create or generate, Pro is unlimited", async () => {
    const { PLAN_LIMITS, isOrgOwner, limitsFor } = await import("./plans");
    expect(isOrgOwner("org_abc")).toBe(true);
    expect(isOrgOwner("user_abc")).toBe(false);

    expect(limitsFor("free", "user_abc")).toEqual(PLAN_LIMITS.free);
    const freeOrg = limitsFor("free", "org_abc");
    expect(freeOrg).toMatchObject({ maxProjects: 0, byokGenerationsPerMonth: 0, managedGenerationsPerMonth: 0 });
    expect(freeOrg.visibleLogs).toBe(PLAN_LIMITS.free.visibleLogs);
    expect(freeOrg.teams || freeOrg.delivery || freeOrg.scheduling).toBe(false);
    expect(limitsFor("pro", "org_abc")).toEqual(PLAN_LIMITS.pro);
    expect(limitsFor("pro", "user_abc")).toEqual(PLAN_LIMITS.pro);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("teams (database)", () => {
  const ids: Record<string, string> = {};
  let savedEnv: Record<string, string | undefined>;
  const req = (method: string, body?: unknown) =>
    new Request("http://x", { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const allOwners = [orgId, freeOrgId, admin.userId, member.userId, outsider.userId, freeAdmin.userId];

  async function newProject(who: Who, name: string, limit = 50) {
    const { createProject } = await import("./projects");
    const { createProjectSchema } = await import("./validation");
    return createProject(who, createProjectSchema.parse({ name, repos: [{ fullName: "o/r" }] }), limit);
  }
  async function newLog(projectId: string, who: Who, over: Record<string, unknown> = {}) {
    const { getDb } = await import("@/db");
    const { shipLogs } = await import("@/db/schema");
    const [row] = await getDb()
      .insert(shipLogs)
      .values({
        projectId,
        ownerId: who.ownerId,
        createdBy: who.userId,
        title: "Log",
        content: "body",
        periodStart: new Date("2026-10-06"),
        periodEnd: new Date("2026-10-13"),
        template: "weekly_update",
        status: "ready",
        ...over,
      })
      .returning();
    return row;
  }

  beforeAll(async () => {
    savedEnv = { RESEND_API_KEY: process.env.RESEND_API_KEY, RESEND_FROM: process.env.RESEND_FROM, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM = "ShipLog <noreply@example.com>";
    delete process.env.OPENAI_API_KEY;

    const { getDb } = await import("@/db");
    const { aiCredentials, billingAccounts } = await import("@/db/schema");
    const { encrypt } = await import("./crypto");
    const { saveGithubConnection } = await import("./github");
    const db = getDb();

    await db.insert(billingAccounts).values({ ownerId: orgId, plan: "pro", status: "active" });
    await db.insert(aiCredentials).values([
      { ownerId: orgId, provider: "openai", encryptedKey: encrypt("sk-org-key"), last4: "-key" },
      { ownerId: freeOrgId, provider: "openai", encryptedKey: encrypt("sk-free-org"), last4: "-org" },
    ]);
    // GitHub tokens are personal.
    await saveGithubConnection(admin.userId, { login: "admin-dev", token: "gh_admin", scopes: "repo" });
    await saveGithubConnection(freeAdmin.userId, { login: "free-dev", token: "gh_free", scopes: "repo" });
  });

  beforeEach(() => {
    current = admin;
    isOrgMember.mockReset();
    isOrgMember.mockResolvedValue(true);
    stubFetch();
  });
  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const { inArray } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const { aiCredentials, billingAccounts, githubConnections, projects, usageCounters, rateLimits } = await import("@/db/schema");
    const { like } = await import("drizzle-orm");
    const db = getDb();
    await db.delete(projects).where(inArray(projects.ownerId, allOwners));
    await db.delete(usageCounters).where(inArray(usageCounters.ownerId, allOwners));
    await db.delete(aiCredentials).where(inArray(aiCredentials.ownerId, allOwners));
    await db.delete(billingAccounts).where(inArray(billingAccounts.ownerId, allOwners));
    await db.delete(githubConnections).where(inArray(githubConnections.userId, allOwners));
    await db.delete(rateLimits).where(like(rateLimits.key, "deliver:org_test_%"));
  });

  describe("workspace isolation", () => {
    it("keeps personal and organization data separate for the same person", async () => {
      const { listProjects, getProject } = await import("./projects");
      const { getLog } = await import("./logs");
      const { getAiCredential } = await import("./ai/access");
      const { getPlan } = await import("./plans");

      const personal = await newProject(adminPersonal, "Admin personal");
      const team = await newProject(admin, "Team project");
      ids.team = team.id;
      const personalLog = await newLog(personal.id, adminPersonal, { title: "Personal log" });
      const teamLog = await newLog(team.id, admin, { title: "Team log" });
      ids.teamLog = teamLog.id;

      expect((await listProjects(adminPersonal.ownerId)).map((p) => p.name)).toEqual(["Admin personal"]);
      expect((await listProjects(admin.ownerId)).map((p) => p.name)).toEqual(["Team project"]);
      expect(await getProject(admin.ownerId, personal.id)).toBeNull();
      expect(await getProject(adminPersonal.ownerId, team.id)).toBeNull();
      expect(await getLog(admin.ownerId, personalLog.id)).toBeNull();
      expect(await getLog(adminPersonal.ownerId, teamLog.id)).toBeNull();

      // The organization's AI key and Pro plan don't leak into the personal workspace.
      expect(await getAiCredential(admin.ownerId)).not.toBeNull();
      expect(await getAiCredential(adminPersonal.ownerId)).toBeNull();
      expect(await getPlan(admin.ownerId)).toBe("pro");
      expect(await getPlan(adminPersonal.ownerId)).toBe("free");
    });

    it("hides a workspace from people outside it, through the API", async () => {
      current = outsider;
      const { GET } = await import("@/app/api/projects/[id]/route");
      expect((await GET(req("GET"), ctx(ids.team))).status).toBe(404);
      const { GET: GET_LOG } = await import("@/app/api/logs/[id]/route");
      expect((await GET_LOG(req("GET"), ctx(ids.teamLog))).status).toBe(404);
    });
  });

  describe("roles", () => {
    it("lets members work with projects and logs", async () => {
      current = member;
      const { POST: createProjectRoute } = await import("@/app/api/projects/route");
      const created = await createProjectRoute(req("POST", { name: "Member made" }));
      expect(created.status).toBe(201);

      const { PATCH } = await import("@/app/api/projects/[id]/route");
      expect((await PATCH(req("PATCH", { description: "edited by a member" }), ctx(ids.team))).status).toBe(200);

      const { PATCH: patchLog } = await import("@/app/api/logs/[id]/route");
      expect((await patchLog(req("PATCH", { content: "member edit", pinned: true }), ctx(ids.teamLog))).status).toBe(200);

      const { POST: share } = await import("@/app/api/logs/[id]/share/route");
      expect((await share(req("POST", {}), ctx(ids.teamLog))).status).toBe(200);

      const { GET: listChannels } = await import("@/app/api/projects/[id]/channels/route");
      expect((await listChannels(req("GET"), ctx(ids.team))).status).toBe(200);
    });

    it("keeps credentials, channels, billing, hand-over and deletion for admins", async () => {
      current = member;
      const denied = async (res: Response | Promise<Response>) => {
        const r = await res;
        expect(r.status).toBe(403);
        return r;
      };

      const ai = await import("@/app/api/settings/ai/route");
      await denied(ai.PUT(req("PUT", { provider: "openai", apiKey: "sk-member-attempt" })));
      await denied(ai.DELETE());

      const channels = await import("@/app/api/projects/[id]/channels/route");
      await denied(
        channels.POST(req("POST", { kind: "slack", webhookUrl: "https://hooks.slack.com/services/T1/B1/abc" }), ctx(ids.team))
      );

      const project = await import("@/app/api/projects/[id]/route");
      await denied(project.DELETE(req("DELETE"), ctx(ids.team)));

      const takeOver = await import("@/app/api/projects/[id]/take-over/route");
      await denied(takeOver.POST(req("POST"), ctx(ids.team)));

      await denied((await import("@/app/api/stripe/checkout/route")).POST());
      await denied((await import("@/app/api/stripe/portal/route")).POST());

      // The AI key is untouched.
      const { getAiCredential } = await import("./ai/access");
      expect((await getAiCredential(orgId))?.last4).toBe("-key");
    });

    it("lets members see which AI key is configured without revealing it", async () => {
      current = member;
      const { GET } = await import("@/app/api/settings/ai/route");
      const res = await GET();
      const text = await res.text();
      expect(JSON.parse(text)).toMatchObject({ configured: true, provider: "openai", last4: "-key" });
      expect(text).not.toContain("sk-org-key");
    });

    it("lets admins do all of it", async () => {
      current = admin;
      const ai = await import("@/app/api/settings/ai/route");
      expect((await ai.PUT(req("PUT", { provider: "openai", model: "gpt-test" }))).status).toBe(200);

      const doomed = await newProject(admin, "To archive");
      const project = await import("@/app/api/projects/[id]/route");
      expect((await project.DELETE(req("DELETE"), ctx(doomed.id))).status).toBe(200);
      expect((await project.GET(req("GET"), ctx(doomed.id))).status).toBe(404);
    });
  });

  describe("credentials and usage", () => {
    it("shares the AI key but keeps GitHub connections personal", async () => {
      const { getSetupStatus } = await import("./settings");
      const adminStatus = await getSetupStatus(admin);
      const memberStatus = await getSetupStatus(member);

      expect(adminStatus.github).toEqual({ login: "admin-dev" });
      expect(memberStatus.github).toBeNull();
      expect(memberStatus.ai).toMatchObject({ provider: "openai" }); // shared
      expect(adminStatus.canGenerate).toBe(true);
      expect(memberStatus.canGenerate).toBe(false);
    });

    it("generates with the current user's own GitHub token", async () => {
      const { startStreamingGeneration } = await import("./generation");
      const { getProject } = await import("./projects");
      const project = (await getProject(orgId, ids.team))!;

      // A member without a connection can't borrow the admin's.
      await expect(startStreamingGeneration({ owner: member, project, period: { days: 7 } })).rejects.toMatchObject({
        code: "NO_GITHUB",
      });

      const { saveGithubConnection, deleteGithubConnection } = await import("./github");
      await saveGithubConnection(member.userId, { login: "member-dev", token: "gh_member", scopes: "repo" });
      try {
        const gen = await startStreamingGeneration({ owner: member, project, period: { days: 7 } });
        await gen.fail("test cleanup");
        const githubCalls = calls.filter((c) => c.url.includes("api.github.com"));
        expect(githubCalls.length).toBeGreaterThan(0);
        expect(githubCalls.every((c) => c.auth === "Bearer gh_member")).toBe(true);

        calls.length = 0;
        const adminGen = await startStreamingGeneration({ owner: admin, project, period: { days: 7 } });
        await adminGen.fail("test cleanup");
        expect(calls.filter((c) => c.url.includes("api.github.com")).every((c) => c.auth === "Bearer gh_admin")).toBe(true);
      } finally {
        await deleteGithubConnection(member.userId);
      }
    });

    it("counts usage flat per organization, independent of who generates and of personal workspaces", async () => {
      const { PLAN_LIMITS } = await import("./plans");
      const { reserveGeneration, getUsage } = await import("./usage");
      const tight = { ...PLAN_LIMITS.pro, managedGenerationsPerMonth: 2 };

      await reserveGeneration(orgId, "managed", tight); // admin
      await reserveGeneration(orgId, "managed", tight); // member
      await expect(reserveGeneration(orgId, "managed", tight)).rejects.toMatchObject({ code: "LIMIT_REACHED" });

      expect((await getUsage(orgId)).managed).toBe(2);
      expect((await getUsage(admin.userId)).managed).toBe(0); // personal counter is separate
      await expect(reserveGeneration(admin.userId, "managed", tight)).resolves.toBeDefined();
    });
  });

  describe("Free organizations", () => {
    it("keep their data but cannot create projects or generate until upgraded", async () => {
      const { createProject, getProject } = await import("./projects");
      const { createProjectSchema } = await import("./validation");
      const { getUsageMeter } = await import("./usage");
      const { startStreamingGeneration } = await import("./generation");

      current = freeAdmin;
      const { POST } = await import("@/app/api/projects/route");
      const blocked = await POST(req("POST", { name: "New" }));
      expect(blocked.status).toBe(403);
      expect(await blocked.json()).toMatchObject({
        code: "LIMIT_REACHED",
        error: "Upgrade this workspace to Pro to create projects.",
      });

      // Existing data stays accessible and editable.
      const existing = await createProject(freeAdmin, createProjectSchema.parse({ name: "Existing", repos: [{ fullName: "o/r" }] }), 5);
      const { PATCH } = await import("@/app/api/projects/[id]/route");
      expect((await PATCH(req("PATCH", { description: "still editable" }), ctx(existing.id))).status).toBe(200);

      expect(await getUsageMeter(freeOrgId)).toEqual({ kind: "byok", used: 0, limit: 0 });

      calls.length = 0;
      const project = (await getProject(freeOrgId, existing.id))!;
      await expect(startStreamingGeneration({ owner: freeAdmin, project, period: { days: 7 } })).rejects.toMatchObject({
        code: "LIMIT_REACHED",
        message: "Upgrade this workspace to Pro to generate logs.",
      });
      expect(calls.filter((c) => c.url.includes("api.openai.com"))).toHaveLength(0);

      // Pro features stay off.
      const channels = await import("@/app/api/projects/[id]/channels/route");
      const res = await channels.POST(
        req("POST", { kind: "slack", webhookUrl: "https://hooks.slack.com/services/T1/B1/abc" }),
        ctx(existing.id)
      );
      expect(res.status).toBe(403);
    });

    it("work normally after upgrading", async () => {
      const { getDb } = await import("@/db");
      const { billingAccounts } = await import("@/db/schema");
      await getDb().insert(billingAccounts).values({ ownerId: freeOrgId, plan: "pro", status: "active" });
      current = freeAdmin;
      const { POST } = await import("@/app/api/projects/route");
      expect((await POST(req("POST", { name: "After upgrade" }))).status).toBe(201);
    });
  });

  describe("scheduled runs in organizations", () => {
    const NOW = new Date("2026-10-14T10:30:00Z"); // Wednesday
    const SLOT = "2026-10-14";
    const schedule = { enabled: true, dayOfWeek: 3, hour: 9, timezone: "UTC", periodDays: 7, autoDeliver: false };
    const newAdmin = mk(`test_u_${rand()}`, orgId, "org:admin");

    async function scheduledProject() {
      const { getDb } = await import("@/db");
      const { projects } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      const project = await newProject(admin, `Scheduled ${rand()}`);
      await getDb().update(projects).set({ schedule }).where(eq(projects.id, project.id));
      return project;
    }
    const run = async (projectId: string) => (await import("./scheduler")).runScheduled(NOW, { only: [projectId] });
    async function row(projectId: string) {
      const { getDb } = await import("@/db");
      const { scheduledRuns } = await import("@/db/schema");
      const { and, eq } = await import("drizzle-orm");
      const [r] = await getDb().select().from(scheduledRuns).where(and(eq(scheduledRuns.projectId, projectId), eq(scheduledRuns.slot, SLOT)));
      return r;
    }
    const logCount = async (projectId: string) => {
      const { getDb } = await import("@/db");
      const { shipLogs } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      return (await getDb().select().from(shipLogs).where(eq(shipLogs.projectId, projectId))).length;
    };

    beforeAll(async () => {
      const { saveGithubConnection } = await import("./github");
      await saveGithubConnection(newAdmin.userId, { login: "new-admin", token: "gh_new_admin", scopes: "repo" });
      allOwners.push(newAdmin.userId);
    });

    it("checks that the creator is still a member and uses their token", async () => {
      const project = await scheduledProject();
      expect(await run(project.id)).toMatchObject({ generated: 1 });
      expect(isOrgMember).toHaveBeenCalledWith(orgId, admin.userId);
      expect(calls.filter((c) => c.url.includes("api.github.com")).every((c) => c.auth === "Bearer gh_admin")).toBe(true);
      expect(await logCount(project.id)).toBe(1);
    });

    it("skips quietly when the creator has left, then recovers after an admin takes over", async () => {
      const project = await scheduledProject();
      isOrgMember.mockImplementation(async (_org, user) => user !== admin.userId);

      expect(await run(project.id)).toMatchObject({ skipped: 1, generated: 0 });
      expect(await row(project.id)).toMatchObject({ status: "skipped" });
      expect((await row(project.id)).error).toContain("no longer a member");
      expect(await logCount(project.id)).toBe(0);
      expect(calls.filter((c) => c.url.includes("api.github.com") || c.url.includes("api.openai.com"))).toHaveLength(0);
      expect(calls.filter((c) => c.url.includes("api.resend.com"))).toHaveLength(0); // nobody to tell

      // Still skipped on the next tick of the same day.
      expect(await run(project.id)).toMatchObject({ generated: 0 });

      current = newAdmin;
      const takeOver = await import("@/app/api/projects/[id]/take-over/route");
      expect((await takeOver.POST(req("POST"), ctx(project.id))).status).toBe(200);
      const { getProject } = await import("./projects");
      expect((await getProject(orgId, project.id))!.createdBy).toBe(newAdmin.userId);
      expect(await row(project.id)).toMatchObject({ status: "retry", attempts: 0 });

      calls.length = 0;
      expect(await run(project.id)).toMatchObject({ generated: 1 });
      expect(await row(project.id)).toMatchObject({ status: "done" });
      expect(calls.filter((c) => c.url.includes("api.github.com")).every((c) => c.auth === "Bearer gh_new_admin")).toBe(true);
      expect(await logCount(project.id)).toBe(1);
    });

    it("retries when membership can't be verified", async () => {
      const project = await scheduledProject();
      isOrgMember.mockRejectedValueOnce(new Error("clerk down"));
      expect(await run(project.id)).toMatchObject({ retry: 1, generated: 0 });
      expect(await row(project.id)).toMatchObject({ status: "retry", attempts: 1 });

      expect(await run(project.id)).toMatchObject({ generated: 1 });
      expect(await row(project.id)).toMatchObject({ status: "done", attempts: 2 });
    });

    it("does not consult Clerk for personal projects", async () => {
      const { getDb } = await import("@/db");
      const { aiCredentials, projects, billingAccounts } = await import("@/db/schema");
      const { encrypt } = await import("./crypto");
      const { saveGithubConnection } = await import("./github");
      const { eq } = await import("drizzle-orm");
      const solo = mk(`test_u_${rand()}`, null, null);
      allOwners.push(solo.userId);
      const db = getDb();
      await db.insert(billingAccounts).values({ ownerId: solo.ownerId, plan: "pro", status: "active" });
      await db.insert(aiCredentials).values({ ownerId: solo.ownerId, provider: "openai", encryptedKey: encrypt("sk"), last4: "x" });
      await saveGithubConnection(solo.userId, { login: "solo", token: "gh_solo", scopes: "repo" });
      const project = await newProject(solo, "Solo");
      await db.update(projects).set({ schedule }).where(eq(projects.id, project.id));

      expect(await run(project.id)).toMatchObject({ generated: 1 });
      expect(isOrgMember).not.toHaveBeenCalled();
    });
  });
});
