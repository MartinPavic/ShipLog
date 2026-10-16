import { afterAll, beforeAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env.local");
} catch {}

describe.skipIf(!process.env.DATABASE_URL)("seedDemo (database)", () => {
  const ownerId = `test_o_${crypto.randomUUID()}`;
  const otherId = `test_o_${crypto.randomUUID()}`;
  const userId = `test_u_${crypto.randomUUID()}`;
  const now = new Date("2026-06-15T12:00:00Z");

  const load = async () => ({
    seed: await import("./seed-demo"),
    schema: await import("../../src/db/schema"),
    db: (await import("../../src/db/index")).getDb(),
    orm: await import("drizzle-orm"),
  });

  async function logsOf(owner: string) {
    const { db, schema, orm } = await load();
    return db.select().from(schema.shipLogs).where(orm.eq(schema.shipLogs.ownerId, owner)).orderBy(schema.shipLogs.periodEnd);
  }

  beforeAll(async () => {
    const { seed } = await load();
    await seed.removeDemo(ownerId);
  });

  afterAll(async () => {
    const { seed, db, schema, orm } = await load();
    await seed.removeDemo(ownerId);
    await seed.removeDemo(otherId);
    await db.delete(schema.usageCounters).where(orm.inArray(schema.usageCounters.ownerId, [ownerId, otherId]));
  });

  it("creates a project with four ready logs, one pinned, with a snapshot and a version", async () => {
    const { seed, db, schema, orm } = await load();
    const result = await seed.seedDemo(ownerId, userId, { now });
    expect(result.status).toBe("created");

    const [project] = await db.select().from(schema.projects).where(orm.eq(schema.projects.id, result.projectId));
    expect(project).toMatchObject({ ownerId, createdBy: userId, slug: "demo-project", isPublicChangelog: false, archivedAt: null });

    const logs = await logsOf(ownerId);
    expect(logs).toHaveLength(4);
    expect(logs.every((l) => l.status === "ready" && l.createdBy === userId && l.projectId === project.id)).toBe(true);
    expect(logs.filter((l) => l.pinned)).toHaveLength(1);
    expect(logs.at(-1)!.pinned).toBe(true);
    expect(logs.every((l) => l.shareToken === null && l.sourceSnapshot)).toBe(true);

    const versions = await db.select().from(schema.shipLogVersions).where(orm.eq(schema.shipLogVersions.logId, logs.at(-1)!.id));
    expect(versions).toHaveLength(1);
  });

  it("is idempotent: a second run changes nothing", async () => {
    const { seed } = await load();
    const first = (await seed.seedDemo(ownerId, userId, { now })).projectId;
    const again = await seed.seedDemo(ownerId, userId, { now });
    expect(again).toEqual({ status: "exists", projectId: first });
    expect(await logsOf(ownerId)).toHaveLength(4);
  });

  it("recreates the project on --reset without leaving old logs behind", async () => {
    const { seed } = await load();
    const before = (await seed.seedDemo(ownerId, userId, { now })).projectId;
    const after = await seed.seedDemo(ownerId, userId, { now, reset: true });
    expect(after.status).toBe("created");
    expect(after.projectId).not.toBe(before);
    expect(await logsOf(ownerId)).toHaveLength(4);
  });

  it("never touches another workspace's data", async () => {
    const { seed } = await load();
    await seed.seedDemo(otherId, userId, { now });
    await seed.removeDemo(ownerId);
    expect(await logsOf(ownerId)).toHaveLength(0);
    expect(await logsOf(otherId)).toHaveLength(4);
  });

  it("removes the demo project and reports whether there was one", async () => {
    const { seed } = await load();
    await seed.seedDemo(ownerId, userId, { now });
    expect(await seed.removeDemo(ownerId)).toBe(true);
    expect(await seed.removeDemo(ownerId)).toBe(false);
    expect(await logsOf(ownerId)).toHaveLength(0);
  });

  it("only consumes usage when asked", async () => {
    const { seed, db, schema, orm } = await load();
    const usageOf = async () =>
      db.select().from(schema.usageCounters).where(orm.eq(schema.usageCounters.ownerId, ownerId));

    await seed.seedDemo(ownerId, userId, { now });
    expect(await usageOf()).toHaveLength(0);

    await seed.seedDemo(ownerId, userId, { now, reset: true, usage: true });
    expect(await usageOf()).toMatchObject([{ period: "2026-06", kind: "byok", count: 2 }]);
  });
});
