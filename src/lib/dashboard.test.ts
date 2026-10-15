import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildOnboarding } from "./dashboard";
import { formatRelative } from "./format";

try {
  process.loadEnvFile(".env.local");
} catch {}

describe("formatRelative", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const min = 60_000;

  it.each([
    [10_000, "just now"],
    [5 * min, "5 minutes ago"],
    [90 * min, "1 hour ago"],
    [5 * 60 * min, "5 hours ago"],
    [24 * 60 * min, "yesterday"],
    [3 * 24 * 60 * min, "3 days ago"],
  ])("%d ms ago -> %s", (ms, expected) => {
    expect(formatRelative(ago(ms), now)).toBe(expected);
  });

  it("falls back to a date after a week and accepts ISO strings", () => {
    expect(formatRelative(ago(10 * 24 * 60 * min), now)).toBe("5 Oct 2026");
    expect(formatRelative("2026-10-15T11:55:00Z", now)).toBe("5 minutes ago");
  });
});

describe("buildOnboarding", () => {
  const none = { github: false, ai: false, firstProjectId: null, hasLog: false };

  it("starts with GitHub and points the last step at the projects list", () => {
    const { steps, complete, next } = buildOnboarding(none);
    expect(steps.map((s) => s.id)).toEqual(["github", "ai", "project", "log"]);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(complete).toBe(false);
    expect(next?.id).toBe("github");
    expect(steps[3].href).toBe("/dashboard/projects");
  });

  it("advances to the first unfinished step", () => {
    expect(buildOnboarding({ ...none, github: true }).next?.id).toBe("ai");
    expect(buildOnboarding({ ...none, github: true, ai: true }).next?.id).toBe("project");
    const withProject = buildOnboarding({ github: true, ai: true, firstProjectId: "abc", hasLog: false });
    expect(withProject.next?.id).toBe("log");
    expect(withProject.next?.href).toBe("/dashboard/projects/abc");
  });

  it("is complete only when every step is done", () => {
    const all = buildOnboarding({ github: true, ai: true, firstProjectId: "abc", hasLog: true });
    expect(all.complete).toBe(true);
    expect(all.next).toBeNull();
    // Steps are independent: a log can exist before GitHub is reconnected.
    expect(buildOnboarding({ github: false, ai: true, firstProjectId: "abc", hasLog: true }).next?.id).toBe("github");
  });
});

describe.skipIf(!process.env.DATABASE_URL)("getDashboardData (database)", () => {
  const rand = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const owner = { userId: `test_u_${rand()}`, orgId: null, ownerId: `test_o_${rand()}`, orgRole: null };
  const other = { userId: `test_u_${rand()}`, orgId: null, ownerId: `test_o_${rand()}`, orgRole: null };
  const NOW = new Date("2026-10-15T12:00:00Z");
  let savedKey: string | undefined;

  async function insertLog(
    projectId: string,
    who: typeof owner,
    createdAt: string,
    over: Record<string, unknown> = {}
  ) {
    const { getDb } = await import("@/db");
    const { shipLogs } = await import("@/db/schema");
    const [row] = await getDb()
      .insert(shipLogs)
      .values({
        projectId,
        ownerId: who.ownerId,
        createdBy: who.userId,
        title: `Log ${createdAt}`,
        content: "x",
        periodStart: new Date(createdAt),
        periodEnd: new Date(createdAt),
        template: "weekly_update",
        status: "ready",
        createdAt: new Date(createdAt),
        ...over,
      })
      .returning();
    return row;
  }
  const data = async (who = owner) => (await import("./dashboard")).getDashboardData(who, NOW);

  beforeAll(() => {
    savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterAll(async () => {
    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
    const { inArray } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const { aiCredentials, billingAccounts, githubConnections, projects, usageCounters } = await import("@/db/schema");
    const db = getDb();
    const owners = [owner.ownerId, other.ownerId];
    await db.delete(projects).where(inArray(projects.ownerId, owners));
    await db.delete(usageCounters).where(inArray(usageCounters.ownerId, owners));
    await db.delete(aiCredentials).where(inArray(aiCredentials.ownerId, owners));
    await db.delete(billingAccounts).where(inArray(billingAccounts.ownerId, owners));
    await db.delete(githubConnections).where(inArray(githubConnections.userId, [owner.userId, other.userId]));
  });

  it("starts empty for a new account", async () => {
    const d = await data();
    expect(d.plan).toBe("free");
    expect(d.stats).toEqual({ logsThisMonth: 0, logsTotal: 0, projectCount: 0, lastGeneratedAt: null });
    expect(d.recentLogs).toEqual([]);
    expect(d.projects).toEqual([]);
    expect(d.onboarding.steps.map((s) => s.done)).toEqual([false, false, false, false]);
    expect(d.onboarding.next?.id).toBe("github");
    expect(d.usage).toEqual({ kind: "byok", used: 0, limit: 5 });
  });

  it("tracks onboarding progress from real state", async () => {
    const { getDb } = await import("@/db");
    const { aiCredentials, billingAccounts } = await import("@/db/schema");
    const { saveGithubConnection } = await import("./github");
    const { encrypt } = await import("./crypto");
    const { createProject } = await import("./projects");
    const { createProjectSchema } = await import("./validation");

    await saveGithubConnection(owner.userId, { login: "dev", token: "t", scopes: "repo" });
    expect((await data()).onboarding.next?.id).toBe("ai");

    // Pro without a key still needs one unless managed AI is configured on the server.
    await getDb().insert(billingAccounts).values({ ownerId: owner.ownerId, plan: "pro", status: "active" });
    expect((await data()).onboarding.next?.id).toBe("ai");
    process.env.OPENAI_API_KEY = "sk-managed";
    const managed = await data();
    expect(managed.onboarding.steps[1].done).toBe(true);
    expect(managed.usage).toEqual({ kind: "managed", used: 0, limit: 200 });
    delete process.env.OPENAI_API_KEY;

    await getDb().insert(aiCredentials).values({ ownerId: owner.ownerId, provider: "openai", encryptedKey: encrypt("sk"), last4: "x" });
    const withKey = await data();
    expect(withKey.onboarding.next?.id).toBe("project");
    expect(withKey.usage).toEqual({ kind: "byok", used: 0, limit: null });

    const project = await createProject(owner, createProjectSchema.parse({ name: "First" }), 5);
    const withProject = await data();
    expect(withProject.onboarding.next).toMatchObject({ id: "log", href: `/dashboard/projects/${project.id}` });
    expect(withProject.plan).toBe("pro");
  });

  it("counts this month's finished logs only, and reports the latest", async () => {
    const [project] = (await data()).projects;
    await insertLog(project.id, owner, "2026-10-02T09:00:00Z");
    await insertLog(project.id, owner, "2026-10-14T09:00:00Z");
    await insertLog(project.id, owner, "2026-09-30T23:59:59Z"); // last month (UTC)
    await insertLog(project.id, owner, "2026-10-10T09:00:00Z", { status: "failed" });
    await insertLog(project.id, owner, "2026-10-11T09:00:00Z", { status: "generating" });

    const d = await data();
    expect(d.stats.logsThisMonth).toBe(2);
    expect(d.stats.logsTotal).toBe(3);
    expect(d.stats.projectCount).toBe(1);
    expect(d.stats.lastGeneratedAt).toEqual(new Date("2026-10-14T09:00:00Z"));
    expect(d.onboarding.complete).toBe(true);
    expect(d.onboarding.next).toBeNull();
  });

  it("lists the five newest logs of active projects, any status", async () => {
    const { createProject, archiveProject } = await import("./projects");
    const { createProjectSchema } = await import("./validation");
    const d0 = await data();
    const [project] = d0.projects;
    const second = await createProject(owner, createProjectSchema.parse({ name: "Second" }), 5);
    for (const day of ["03", "04", "05", "06"]) await insertLog(second.id, owner, `2026-10-${day}T09:00:00Z`);

    let d = await data();
    expect(d.recentLogs).toHaveLength(5);
    const times = d.recentLogs.map((l) => l.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(d.recentLogs[0]).toMatchObject({ projectId: project.id, projectName: "First", status: "ready" });
    expect(d.recentLogs.map((l) => l.status)).toContain("generating");

    const archived = await createProject(owner, createProjectSchema.parse({ name: "Gone" }), 5);
    await insertLog(archived.id, owner, "2026-10-15T11:00:00Z", { title: "Newest but archived" });
    await archiveProject(owner.ownerId, archived.id);
    d = await data();
    expect(d.recentLogs.map((l) => l.title)).not.toContain("Newest but archived");
    expect(d.projects.map((p) => p.name)).toEqual(["First", "Second"]);
  });

  it("reflects the usage counter", async () => {
    const { getDb } = await import("@/db");
    const { usageCounters } = await import("@/db/schema");
    const { currentPeriod } = await import("./usage");
    await getDb().insert(usageCounters).values({ ownerId: owner.ownerId, period: currentPeriod(), kind: "byok", count: 7 });
    expect((await data()).usage).toEqual({ kind: "byok", used: 7, limit: null });
  });

  it("never mixes in other accounts' data", async () => {
    const { createProject } = await import("./projects");
    const { createProjectSchema } = await import("./validation");
    const theirs = await createProject(other, createProjectSchema.parse({ name: "Theirs" }), 5);
    await insertLog(theirs.id, other, "2026-10-14T10:00:00Z", { title: "Their secret log" });

    const mine = await data();
    expect(JSON.stringify(mine)).not.toContain("Their secret log");
    expect(mine.projects.map((p) => p.name)).not.toContain("Theirs");

    const hers = await data(other);
    expect(hers.stats).toMatchObject({ logsThisMonth: 1, projectCount: 1 });
    expect(hers.plan).toBe("free");
    expect(hers.onboarding.steps[0].done).toBe(false);
  });
});
