import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { deliveryChannels, projectSchedules, scheduleChannels, scheduledRuns } from "@/db/schema";
import { ApiError } from "@/lib/api";
import type { Owner } from "@/lib/owner";
import { requireTemplate } from "@/lib/templates";
import { uuidSchema, type ScheduleInput } from "@/lib/validation";

export const MAX_SCHEDULES = 10;

export type ProjectSchedule = typeof projectSchedules.$inferSelect & { channelIds: string[] };

type Db = Pick<ReturnType<typeof getDb>, "select">;

export async function withChannels(rows: (typeof projectSchedules.$inferSelect)[]): Promise<ProjectSchedule[]> {
  if (rows.length === 0) return [];
  const links = await getDb()
    .select()
    .from(scheduleChannels)
    .where(inArray(scheduleChannels.scheduleId, rows.map((r) => r.id)));
  return rows.map((row) => ({
    ...row,
    channelIds: links.filter((l) => l.scheduleId === row.id).map((l) => l.channelId),
  }));
}

// Selected channels must belong to the project; anything else is rejected rather than silently dropped.
async function assertProjectChannels(db: Db, projectId: string, channelIds: string[]) {
  if (channelIds.length === 0) return;
  const found = await db
    .select({ id: deliveryChannels.id })
    .from(deliveryChannels)
    .where(and(eq(deliveryChannels.projectId, projectId), inArray(deliveryChannels.id, channelIds)));
  if (found.length !== channelIds.length) {
    throw new ApiError(400, "One or more selected channels don't belong to this project.", "VALIDATION");
  }
}

export async function listSchedules(projectId: string): Promise<ProjectSchedule[]> {
  const rows = await getDb()
    .select()
    .from(projectSchedules)
    .where(eq(projectSchedules.projectId, projectId))
    .orderBy(asc(projectSchedules.createdAt), asc(projectSchedules.id));
  return withChannels(rows);
}

export async function requireSchedule(projectId: string, scheduleId: string): Promise<ProjectSchedule> {
  if (!uuidSchema.safeParse(scheduleId).success) throw new ApiError(404, "Schedule not found", "NOT_FOUND");
  const [row] = await getDb()
    .select()
    .from(projectSchedules)
    .where(and(eq(projectSchedules.id, scheduleId), eq(projectSchedules.projectId, projectId)))
    .limit(1);
  if (!row) throw new ApiError(404, "Schedule not found", "NOT_FOUND");
  return (await withChannels([row]))[0];
}

export async function createSchedule(owner: Owner, projectId: string, input: ScheduleInput): Promise<ProjectSchedule> {
  await requireTemplate(owner.ownerId, input.template);
  const { channelIds, ...fields } = input;
  const selected = [...new Set(channelIds)];
  const id = await getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"schedules:" + projectId}))`);
    const [{ n }] = await tx.select({ n: count() }).from(projectSchedules).where(eq(projectSchedules.projectId, projectId));
    if (n >= MAX_SCHEDULES) {
      throw new ApiError(400, `A project can have at most ${MAX_SCHEDULES} schedules.`, "VALIDATION");
    }
    await assertProjectChannels(tx, projectId, selected);
    const [row] = await tx
      .insert(projectSchedules)
      .values({ ...fields, projectId, createdBy: owner.userId })
      .returning({ id: projectSchedules.id });
    if (selected.length) {
      await tx.insert(scheduleChannels).values(selected.map((channelId) => ({ scheduleId: row.id, channelId })));
    }
    return row.id;
  });
  return requireSchedule(projectId, id);
}

export async function updateSchedule(
  owner: Owner,
  projectId: string,
  scheduleId: string,
  patch: Partial<ScheduleInput>
): Promise<ProjectSchedule> {
  await requireSchedule(projectId, scheduleId);
  if (patch.template) await requireTemplate(owner.ownerId, patch.template);
  const { channelIds, ...fields } = patch;
  await getDb().transaction(async (tx) => {
    if (channelIds) await assertProjectChannels(tx, projectId, [...new Set(channelIds)]);
    // The row lock also serializes concurrent edits of the same schedule's channel set.
    const updated = await tx
      .update(projectSchedules)
      .set({ ...fields, updatedAt: new Date() })
      .where(and(eq(projectSchedules.id, scheduleId), eq(projectSchedules.projectId, projectId)))
      .returning({ id: projectSchedules.id });
    if (updated.length === 0) throw new ApiError(404, "Schedule not found", "NOT_FOUND");
    if (channelIds) {
      const selected = [...new Set(channelIds)];
      await tx.delete(scheduleChannels).where(eq(scheduleChannels.scheduleId, scheduleId));
      if (selected.length) {
        await tx.insert(scheduleChannels).values(selected.map((channelId) => ({ scheduleId, channelId })));
      }
    }
  });
  return requireSchedule(projectId, scheduleId);
}

export async function deleteSchedule(projectId: string, scheduleId: string): Promise<void> {
  await requireSchedule(projectId, scheduleId);
  await getDb()
    .delete(projectSchedules)
    .where(and(eq(projectSchedules.id, scheduleId), eq(projectSchedules.projectId, projectId)));
}

// Runs use the creator's provider connections, so handing a schedule over means changing the creator.
export async function takeOverSchedule(projectId: string, scheduleId: string, userId: string): Promise<ProjectSchedule> {
  await requireSchedule(projectId, scheduleId);
  const db = getDb();
  await db
    .update(projectSchedules)
    .set({ createdBy: userId, updatedAt: new Date() })
    .where(eq(projectSchedules.id, scheduleId));

  // The newest run may have been skipped because of the previous creator; let it run again on the next tick.
  await db
    .update(scheduledRuns)
    .set({ status: "retry", attempts: 0, error: null, updatedAt: new Date() })
    .where(
      and(
        eq(scheduledRuns.scheduleId, scheduleId),
        inArray(scheduledRuns.status, ["skipped", "failed"]),
        sql`${scheduledRuns.slot} = (select max(slot) from scheduled_runs where schedule_id = ${scheduleId})`
      )
    );
  return requireSchedule(projectId, scheduleId);
}

export type LastRun = { slot: string; status: string; error: string | null };

export async function getLastRuns(scheduleIds: string[]): Promise<Map<string, LastRun>> {
  if (scheduleIds.length === 0) return new Map();
  const rows = await getDb()
    .selectDistinctOn([scheduledRuns.scheduleId], {
      scheduleId: scheduledRuns.scheduleId,
      slot: scheduledRuns.slot,
      status: scheduledRuns.status,
      error: scheduledRuns.error,
    })
    .from(scheduledRuns)
    .where(inArray(scheduledRuns.scheduleId, scheduleIds))
    .orderBy(scheduledRuns.scheduleId, desc(scheduledRuns.slot));
  return new Map(rows.map((r) => [r.scheduleId, { slot: r.slot, status: r.status, error: r.error }]));
}
