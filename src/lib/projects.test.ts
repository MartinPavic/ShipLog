import { afterAll, describe, expect, it } from "vitest";
import { logListQuerySchema } from "./validation";

try {
  process.loadEnvFile(".env.local");
} catch {}

// Runs against the real database with isolated owner ids; skipped when DATABASE_URL is missing.
describe.skipIf(!process.env.DATABASE_URL)("projects and logs (database)", () => {
  const ownerA = { userId: `test_u_${crypto.randomUUID()}`, orgId: null, ownerId: `test_o_${crypto.randomUUID()}`, orgRole: null };
  const ownerB = { userId: "test_u_b", orgId: null, ownerId: `test_o_${crypto.randomUUID()}`, orgRole: null };
  const query = (over: object = {}) => logListQuerySchema.parse(over);

  afterAll(async () => {
    const { inArray } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const { gitlabConnections, gitlabInstances, projects } = await import("@/db/schema");
    // Logs and versions cascade from projects.
    await getDb().delete(gitlabConnections).where(inArray(gitlabConnections.ownerId, [ownerA.ownerId, ownerB.ownerId]));
    await getDb().delete(gitlabInstances).where(inArray(gitlabInstances.ownerId, [ownerA.ownerId, ownerB.ownerId]));
    await getDb().delete(projects).where(inArray(projects.ownerId, [ownerA.ownerId, ownerB.ownerId]));
  });

  it("enforces the plan project limit even under parallel creates", async () => {
    const { createProject } = await import("./projects");
    const { createProjectSchema } = await import("./validation");
    const input = createProjectSchema.parse({ name: "Race" });

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => createProject(ownerA, input, 2)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected).toMatchObject({ reason: { code: "LIMIT_REACHED" } });
  });

  it("gives colliding names unique slugs and isolates tenants", async () => {
    const { createProject, getProject, listProjects, archiveProject } = await import("./projects");
    const { createProjectSchema } = await import("./validation");

    const mine = await listProjects(ownerA.ownerId);
    expect(new Set(mine.map((p) => p.slug)).size).toBe(mine.length);
    expect(mine.map((p) => p.slug)).toEqual(expect.arrayContaining(["race", "race-2"]));

    const theirs = await createProject(ownerB, createProjectSchema.parse({ name: "Theirs" }), 5);
    expect(await getProject(ownerA.ownerId, theirs.id)).toBeNull();
    expect(await getProject(ownerA.ownerId, "not-a-uuid")).toBeNull();
    await expect(archiveProject(ownerA.ownerId, theirs.id)).rejects.toMatchObject({ status: 404 });
  });

  it("dedupes repos and keeps the slug on rename", async () => {
    const { createProject, updateProject } = await import("./projects");
    const { createProjectSchema } = await import("./validation");
    const project = await createProject(
      ownerB,
      createProjectSchema.parse({ name: "Dedupe", repos: [{ fullName: "o/r" }, { fullName: "O/R" }] }),
      5
    );
    expect(project.repos).toHaveLength(1);

    const renamed = await updateProject(ownerB.ownerId, project.id, { name: "Renamed", repos: [{ fullName: "a/b" }] });
    expect(renamed.slug).toBe(project.slug);
    expect(renamed.repos).toEqual([{ fullName: "a/b" }]);
  });

  it("keeps the same repository path on different providers and legacy entries as GitHub", async () => {
    const { createProject, getProject, updateProject } = await import("./projects");
    const { createProjectSchema } = await import("./validation");
    const project = await createProject(ownerA, createProjectSchema.parse({
      name: "Mixed repositories",
      repos: [
        { fullName: "group/project" },
        { provider: "gitlab", fullName: "group/subgroup/project" },
        { provider: "gitlab", fullName: "GROUP/SUBGROUP/PROJECT" },
      ],
    }), 5);

    expect(project.repos).toEqual([
      { fullName: "group/project" },
      { provider: "gitlab", fullName: "group/subgroup/project" },
    ]);
    expect((await getProject(ownerA.ownerId, project.id))?.repos).toEqual(project.repos);

    const updated = await updateProject(ownerA.ownerId, project.id, {
      repos: [{ provider: "gitlab", fullName: "group/subgroup/other" }, { fullName: "group/other" }],
    });
    expect(updated.repos).toEqual([{ provider: "gitlab", fullName: "group/subgroup/other" }, { fullName: "group/other" }]);
  });

  it("stores workspace GitLab configuration separately from each member connection", async () => {
    const { getDb } = await import("@/db");
    const { gitlabConnections, gitlabInstances } = await import("@/db/schema");
    const instance = { ownerId: ownerA.ownerId, baseUrl: "https://gitlab.example.test", clientId: "client-a", encryptedClientSecret: "ciphertext" };
    const connection = { ownerId: ownerA.ownerId, userId: ownerA.userId, username: "dev", encryptedAccessToken: "access-cipher", encryptedRefreshToken: "refresh-cipher", scopes: "read_api", expiresAt: new Date("2026-11-06T12:00:00Z") };
    const db = getDb();
    await db.insert(gitlabInstances).values(instance);
    await db.insert(gitlabConnections).values([
      connection,
      { ...connection, userId: "test_u_other", username: "other" },
      { ...connection, ownerId: ownerB.ownerId, userId: ownerB.userId, username: "other workspace" },
    ]);

    const { eq, and } = await import("drizzle-orm");
    const instances = await db.select().from(gitlabInstances).where(eq(gitlabInstances.ownerId, ownerA.ownerId));
    const connections = await db.select().from(gitlabConnections).where(eq(gitlabConnections.ownerId, ownerA.ownerId));
    expect(instances).toMatchObject([instance]);
    expect(connections).toHaveLength(2);
    expect(connections.map((row) => row.userId)).toEqual(expect.arrayContaining([ownerA.userId, "test_u_other"]));
    const ownConnection = await db.select().from(gitlabConnections).where(and(eq(gitlabConnections.ownerId, ownerA.ownerId), eq(gitlabConnections.userId, ownerA.userId)));
    expect(ownConnection).toMatchObject([connection]);
  });

  it("lists, searches, filters and caps history; versions content edits", async () => {
    const { getDb } = await import("@/db");
    const { shipLogs } = await import("@/db/schema");
    const { createProject } = await import("./projects");
    const { createProjectSchema } = await import("./validation");
    const { assertLogVisible, getLog, listLogs, listVersions, updateLog } = await import("./logs");
    const { PLAN_LIMITS } = await import("./plans");

    const project = await createProject(ownerB, createProjectSchema.parse({ name: "History" }), 10);
    const day = 24 * 60 * 60 * 1000;
    const base = Date.now() - 20 * day;
    const rows = Array.from({ length: 12 }, (_, i) => ({
      projectId: project.id,
      ownerId: ownerB.ownerId,
      createdBy: ownerB.userId,
      title: i === 3 ? "Special 100%_done" : `Log ${i}`,
      content: i === 5 ? "contains needle text" : `body ${i}`,
      periodStart: new Date(base + i * day),
      periodEnd: new Date(base + i * day),
      template: "weekly_update",
      status: "ready" as const,
      pinned: i === 7,
      createdAt: new Date(base + i * day),
    }));
    const inserted = await getDb().insert(shipLogs).values(rows).returning();
    const byTitle = (t: string) => inserted.find((r) => r.title === t)!;

    const free = PLAN_LIMITS.free;
    const pro = PLAN_LIMITS.pro;

    const freeList = await listLogs(ownerB.ownerId, project.id, query(), free);
    expect(freeList.total).toBe(10);
    expect(freeList.hidden).toBe(2);
    expect(freeList.items[0].title).toBe("Log 7"); // pinned first

    const proList = await listLogs(ownerB.ownerId, project.id, query(), pro);
    expect(proList.total).toBe(12);
    expect(proList.hidden).toBe(0);

    const page2 = await listLogs(ownerB.ownerId, project.id, query({ page: 2, pageSize: 5 }), pro);
    expect(page2.items).toHaveLength(5);

    expect((await listLogs(ownerB.ownerId, project.id, query({ q: "NEEDLE" }), pro)).items.map((i) => i.title)).toEqual(["Log 5"]);
    // LIKE wildcards in the query are literal.
    expect((await listLogs(ownerB.ownerId, project.id, query({ q: "100%_" }), pro)).total).toBe(1);
    expect((await listLogs(ownerB.ownerId, project.id, query({ q: "%" }), pro)).total).toBe(1);
    expect((await listLogs(ownerB.ownerId, project.id, query({ pinned: "1" }), pro)).total).toBe(1);

    const from = new Date(base + 8 * day).toISOString().slice(0, 10);
    expect((await listLogs(ownerB.ownerId, project.id, query({ from }), pro)).total).toBe(4);
    const to = new Date(base + 1 * day).toISOString().slice(0, 10);
    expect((await listLogs(ownerB.ownerId, project.id, query({ to }), pro)).total).toBe(2);

    // The two oldest are beyond the Free window.
    await expect(assertLogVisible((await getLog(ownerB.ownerId, byTitle("Log 1").id))!, free)).rejects.toMatchObject({ status: 403 });
    await expect(assertLogVisible((await getLog(ownerB.ownerId, byTitle("Log 11").id))!, free)).resolves.toBeUndefined();

    // Tenant isolation.
    expect(await getLog(ownerA.ownerId, byTitle("Log 5").id)).toBeNull();

    // Only content changes create versions, and they hold the previous text.
    const log = (await getLog(ownerB.ownerId, byTitle("Log 5").id))!;
    const pinnedOnly = await updateLog(ownerB.userId, log, { pinned: true });
    expect(await listVersions(log.id)).toHaveLength(0);
    await updateLog(ownerB.userId, pinnedOnly, { content: "rewritten" });
    const versions = await listVersions(log.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].content).toBe("contains needle text");
    expect((await getLog(ownerB.ownerId, log.id))!.content).toBe("rewritten");
  });

  it("rejects one of two edits based on the same saved content", async () => {
    const { getDb } = await import("@/db");
    const { shipLogs } = await import("@/db/schema");
    const { createProject } = await import("./projects");
    const { createProjectSchema } = await import("./validation");
    const { getLog, listVersions, updateLog } = await import("./logs");
    const project = await createProject(ownerA, createProjectSchema.parse({ name: "Concurrent edits" }), 5);
    const [row] = await getDb().insert(shipLogs).values({
      projectId: project.id,
      ownerId: ownerA.ownerId,
      createdBy: ownerA.userId,
      title: "Shared draft",
      content: "original",
      periodStart: new Date("2026-10-01"),
      periodEnd: new Date("2026-10-07"),
      template: "weekly_update",
      status: "ready",
    }).returning();
    const original = (await getLog(ownerA.ownerId, row.id))!;

    const results = await Promise.allSettled([
      updateLog(ownerA.userId, original, { content: "edit one" }, original.content),
      updateLog(ownerA.userId, original, { content: "edit two" }, original.content),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toMatchObject([
      { reason: { code: "CONFLICT" } },
    ]);
    expect((await listVersions(row.id)).map((version) => version.content)).toEqual(["original"]);
    const saved = (await getLog(ownerA.ownerId, row.id))!;
    expect(["edit one", "edit two"]).toContain(saved.content);
    await expect(updateLog(ownerA.userId, saved, { content: "stale browser value" }, original.content)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});
