import { afterAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env.local");
} catch {}

const rand = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const SLACK = "https://hooks.slack.com/services/T0AAAA/B0BBBB/secretslacktoken1234";

describe.skipIf(!process.env.DATABASE_URL)("schedules store (database)", () => {
  const owners: string[] = [];

  async function setup() {
    const { getDb } = await import("@/db");
    const { deliveryChannels } = await import("@/db/schema");
    const { encrypt } = await import("./crypto");
    const { createProject } = await import("./projects");
    const { createProjectSchema } = await import("./validation");
    const owner = { userId: `test_u_${rand()}`, orgId: null, ownerId: `test_o_${rand()}`, orgRole: null };
    owners.push(owner.ownerId);
    const project = await createProject(owner, createProjectSchema.parse({ name: "P", repos: [{ fullName: "o/r" }] }), 5);
    const other = await createProject(owner, createProjectSchema.parse({ name: "Q", repos: [{ fullName: "o/r" }] }), 5);
    const channel = async (projectId: string) => {
      const [row] = await getDb()
        .insert(deliveryChannels)
        .values({ projectId, kind: "slack", encryptedConfig: encrypt(JSON.stringify({ webhookUrl: SLACK })) })
        .returning();
      return row;
    };
    const input = (over: object = {}) => ({
      name: "Weekly",
      template: "weekly_update",
      weekdays: [5],
      hour: 9,
      timezone: "UTC",
      periodDays: 7,
      enabled: true,
      channelIds: [] as string[],
      ...over,
    });
    return { owner, project, other, channel, input };
  }

  afterAll(async () => {
    const { inArray } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const { projects } = await import("@/db/schema");
    await getDb().delete(projects).where(inArray(projects.ownerId, owners));
  });

  it("creates a schedule and lists schedules oldest first with their channels", async () => {
    const { owner, project, channel, input } = await setup();
    const { createSchedule, listSchedules } = await import("./schedules");
    const c = await channel(project.id);
    const a = await createSchedule(owner, project.id, input({ name: "A", channelIds: [c.id] }));
    const b = await createSchedule(owner, project.id, input({ name: "B", weekdays: [1, 3] }));
    expect(a).toMatchObject({ name: "A", weekdays: [5], hour: 9, createdBy: owner.userId, channelIds: [c.id] });
    expect((await listSchedules(project.id)).map((s) => s.id)).toEqual([a.id, b.id]);
    expect((await listSchedules(project.id))[1]).toMatchObject({ weekdays: [1, 3], channelIds: [] });
  });

  it("caps schedules per project", async () => {
    const { owner, project, other, input } = await setup();
    const { createSchedule, MAX_SCHEDULES } = await import("./schedules");
    for (let i = 0; i < MAX_SCHEDULES; i++) await createSchedule(owner, project.id, input({ name: `S${i}` }));
    await expect(createSchedule(owner, project.id, input())).rejects.toMatchObject({ status: 400, code: "VALIDATION" });
    await expect(createSchedule(owner, other.id, input())).resolves.toBeDefined();
  });

  it("keeps the cap when concurrent creates compete for the last slots", async () => {
    const { owner, project, input } = await setup();
    const { createSchedule, listSchedules, MAX_SCHEDULES } = await import("./schedules");
    const results = await Promise.allSettled(
      Array.from({ length: MAX_SCHEDULES + 2 }, (_, i) => createSchedule(owner, project.id, input({ name: `C${i}` })))
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(MAX_SCHEDULES);
    expect(await listSchedules(project.id)).toHaveLength(MAX_SCHEDULES);
  });

  it("rejects an update of a schedule that was deleted in the meantime with a 404", async () => {
    const { owner, project, channel, input } = await setup();
    const { createSchedule, deleteSchedule, updateSchedule } = await import("./schedules");
    const c = await channel(project.id);
    const s = await createSchedule(owner, project.id, input());
    // Settle immediately: an early 404 would otherwise be reported as an unhandled rejection while the delete runs.
    const racing = updateSchedule(owner, project.id, s.id, { channelIds: [c.id] }).then(
      () => "ok",
      (e: { status?: number }) => e.status
    );
    await deleteSchedule(project.id, s.id).catch(() => undefined);
    expect([await racing]).toSatisfy(([v]: unknown[]) => v === "ok" || v === 404);
  });

  it("rejects an unknown custom template", async () => {
    const { owner, project, input } = await setup();
    const { createSchedule } = await import("./schedules");
    await expect(
      createSchedule(owner, project.id, input({ template: "3f1c2a52-0000-4000-8000-000000000000" }))
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("rejects channels of another project on create and update, linking nothing", async () => {
    const { owner, project, other, channel, input } = await setup();
    const { createSchedule, listSchedules, updateSchedule } = await import("./schedules");
    const foreign = await channel(other.id);
    await expect(createSchedule(owner, project.id, input({ channelIds: [foreign.id] }))).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION",
    });
    expect(await listSchedules(project.id)).toHaveLength(0);

    const s = await createSchedule(owner, project.id, input());
    await expect(updateSchedule(owner, project.id, s.id, { channelIds: [foreign.id] })).rejects.toMatchObject({ status: 400 });
    expect((await listSchedules(project.id))[0].channelIds).toEqual([]);
  });

  it("replaces channels only when channelIds is given", async () => {
    const { owner, project, channel, input } = await setup();
    const { createSchedule, updateSchedule } = await import("./schedules");
    const a = await channel(project.id);
    const b = await channel(project.id);
    const s = await createSchedule(owner, project.id, input({ channelIds: [a.id] }));
    expect((await updateSchedule(owner, project.id, s.id, { name: "Renamed" })).channelIds).toEqual([a.id]);
    const swapped = await updateSchedule(owner, project.id, s.id, { channelIds: [b.id] });
    expect(swapped.channelIds).toEqual([b.id]);
    expect(swapped.name).toBe("Renamed");
    expect((await updateSchedule(owner, project.id, s.id, { channelIds: [] })).channelIds).toEqual([]);
  });

  it("returns 404 for a schedule of another project", async () => {
    const { owner, project, other, input } = await setup();
    const { createSchedule, requireSchedule, updateSchedule } = await import("./schedules");
    const s = await createSchedule(owner, project.id, input());
    await expect(requireSchedule(other.id, s.id)).rejects.toMatchObject({ status: 404 });
    await expect(updateSchedule(owner, other.id, s.id, { name: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(requireSchedule(project.id, "not-a-uuid")).rejects.toMatchObject({ status: 404 });
  });

  it("drops a deleted channel from every schedule", async () => {
    const { owner, project, channel, input } = await setup();
    const { getDb } = await import("@/db");
    const { deliveryChannels } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { createSchedule, listSchedules } = await import("./schedules");
    const c = await channel(project.id);
    await createSchedule(owner, project.id, input({ name: "A", channelIds: [c.id] }));
    await createSchedule(owner, project.id, input({ name: "B", channelIds: [c.id] }));
    await getDb().delete(deliveryChannels).where(eq(deliveryChannels.id, c.id));
    expect((await listSchedules(project.id)).map((s) => s.channelIds)).toEqual([[], []]);
  });

  it("deletes a schedule together with its runs", async () => {
    const { owner, project, input } = await setup();
    const { getDb } = await import("@/db");
    const { scheduledRuns } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { createSchedule, deleteSchedule, listSchedules } = await import("./schedules");
    const s = await createSchedule(owner, project.id, input());
    await getDb().insert(scheduledRuns).values({ scheduleId: s.id, slot: "2026-10-14", status: "done" });
    await deleteSchedule(project.id, s.id);
    expect(await listSchedules(project.id)).toHaveLength(0);
    expect(await getDb().select().from(scheduledRuns).where(eq(scheduledRuns.scheduleId, s.id))).toHaveLength(0);
  });

  it("takes a schedule over and re-queues only its newest skipped or failed run", async () => {
    const { owner, project, input } = await setup();
    const { getDb } = await import("@/db");
    const { scheduledRuns } = await import("@/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const { createSchedule, takeOverSchedule } = await import("./schedules");
    const a = await createSchedule(owner, project.id, input({ name: "A" }));
    const b = await createSchedule(owner, project.id, input({ name: "B" }));
    const db = getDb();
    await db.insert(scheduledRuns).values([
      { scheduleId: a.id, slot: "2026-10-07", status: "failed", attempts: 3, error: "old" },
      { scheduleId: a.id, slot: "2026-10-14", status: "skipped", attempts: 1, error: "creator left" },
      { scheduleId: b.id, slot: "2026-10-14", status: "skipped", attempts: 1, error: "other" },
    ]);
    const taken = await takeOverSchedule(project.id, a.id, "test_u_new");
    expect(taken.createdBy).toBe("test_u_new");
    const row = (id: string, slot: string) =>
      db.select().from(scheduledRuns).where(and(eq(scheduledRuns.scheduleId, id), eq(scheduledRuns.slot, slot))).then((r) => r[0]);
    expect(await row(a.id, "2026-10-14")).toMatchObject({ status: "retry", attempts: 0, error: null });
    expect(await row(a.id, "2026-10-07")).toMatchObject({ status: "failed", attempts: 3 });
    expect(await row(b.id, "2026-10-14")).toMatchObject({ status: "skipped" });

    await db.update(scheduledRuns).set({ status: "done" }).where(eq(scheduledRuns.scheduleId, a.id));
    await takeOverSchedule(project.id, a.id, "test_u_other");
    expect(await row(a.id, "2026-10-14")).toMatchObject({ status: "done" });
  });

  it("reports the run with the greatest slot per schedule", async () => {
    const { owner, project, input } = await setup();
    const { getDb } = await import("@/db");
    const { scheduledRuns } = await import("@/db/schema");
    const { createSchedule, getLastRuns } = await import("./schedules");
    const a = await createSchedule(owner, project.id, input({ name: "A" }));
    const b = await createSchedule(owner, project.id, input({ name: "B" }));
    await getDb().insert(scheduledRuns).values([
      { scheduleId: a.id, slot: "2026-10-07", status: "done" },
      { scheduleId: a.id, slot: "2026-10-14", status: "skipped", error: "no key" },
    ]);
    const runs = await getLastRuns([a.id, b.id]);
    expect(runs.get(a.id)).toEqual({ slot: "2026-10-14", status: "skipped", error: "no key" });
    expect(runs.has(b.id)).toBe(false);
    expect((await getLastRuns([])).size).toBe(0);
  });
});
