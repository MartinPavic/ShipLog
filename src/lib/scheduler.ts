import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { projectSchedules, projects, scheduledRuns, shipLogs } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { deliverLog } from "@/lib/delivery";
import { generateLog } from "@/lib/generation";
import { notifyProjectCreator } from "@/lib/notify";
import type { Owner } from "@/lib/owner";
import { isOrgMember } from "@/lib/orgs";
import { getPlanLimits } from "@/lib/plans";
import type { Project } from "@/lib/projects";
import { currentSlot } from "@/lib/schedule";
import { withChannels, type ProjectSchedule } from "@/lib/schedules";
import { getLog } from "@/lib/logs";

export const MAX_ATTEMPTS = 3;
const STALE_RUNNING_MS = 30 * 60 * 1000;
const CONCURRENCY = 3;

// The user has to fix these, so they get a notification; NO_ACTIVITY is just a quiet week.
const ACTIONABLE = new Set(["NO_GITHUB", "GITHUB_AUTH", "GITHUB_ACCESS", "NO_AI_KEY", "AI_AUTH", "AI_MODEL", "LIMIT_REACHED", "NO_SENTRY", "SENTRY_AUTH", "SENTRY_FORBIDDEN", "SENTRY_NOT_FOUND", "SENTRY_PROJECT_UNAVAILABLE", "SENTRY_REDIRECT", "SENTRY_PAGE_LIMIT"]);
// CREATOR_LEFT is skipped without a notification: the person who would receive it is no longer in the organization.
const SKIPPED = new Set([...ACTIONABLE, "NO_ACTIVITY", "CREATOR_LEFT"]);
const TRANSIENT = new Set(["AI_UNAVAILABLE", "AI_TIMEOUT", "AI_RATE_LIMIT", "GITHUB_UNAVAILABLE", "ORG_CHECK_FAILED", "SENTRY_UNAVAILABLE", "SENTRY_TIMEOUT", "SENTRY_RATE_LIMIT", "SENTRY_INVALID_RESPONSE"]);

// Takes the slot atomically: first claim, or a re-claim of a retryable / crashed run. Returns the attempt number.
export async function claimSlot(
  scheduleId: string,
  slot: string,
  now = new Date()
): Promise<{ attempts: number; logId: string | null } | null> {
  const stale = new Date(now.getTime() - STALE_RUNNING_MS);
  const rows = await getDb()
    .insert(scheduledRuns)
    .values({ scheduleId, slot, status: "running" })
    .onConflictDoUpdate({
      target: [scheduledRuns.scheduleId, scheduledRuns.slot],
      set: { status: "running", attempts: sql`${scheduledRuns.attempts} + 1`, updatedAt: now },
      setWhere: and(
        lt(scheduledRuns.attempts, MAX_ATTEMPTS),
        or(
          eq(scheduledRuns.status, "retry"),
          and(eq(scheduledRuns.status, "running"), lt(scheduledRuns.updatedAt, stale))
        )
      ),
    })
    .returning({ attempts: scheduledRuns.attempts, logId: scheduledRuns.logId });
  return rows[0] ?? null;
}

async function finishRun(
  scheduleId: string,
  slot: string,
  status: "done" | "failed" | "skipped" | "retry",
  extra: { logId?: string; error?: string | null } = {}
) {
  await getDb()
    .update(scheduledRuns)
    .set({ status, ...(extra.logId ? { logId: extra.logId } : {}), error: extra.error ?? null, updatedAt: new Date() })
    .where(and(eq(scheduledRuns.scheduleId, scheduleId), eq(scheduledRuns.slot, slot)));
}

async function saveRunLog(scheduleId: string, slot: string, logId: string): Promise<void> {
  await getDb()
    .update(scheduledRuns)
    .set({ logId, updatedAt: new Date() })
    .where(and(eq(scheduledRuns.scheduleId, scheduleId), eq(scheduledRuns.slot, slot)));
}

export type RunOutcome = "generated" | "skipped" | "failed" | "retry";

async function assertCreatorIsMember(orgId: string, userId: string) {
  let member: boolean;
  try {
    member = await isOrgMember(orgId, userId);
  } catch (err) {
    console.error("Could not verify organization membership:", err);
    throw new ApiError(502, "Could not verify organization membership. Will retry.", "ORG_CHECK_FAILED");
  }
  if (!member) {
    throw new ApiError(
      400,
      "The schedule's creator is no longer a member of this organization. An admin can take over the schedule in the project's Schedules tab.",
      "CREATOR_LEFT"
    );
  }
}

async function runSchedule(
  schedule: ProjectSchedule,
  project: Project,
  slot: string,
  attempt: number,
  existingLogId: string | null
): Promise<RunOutcome> {
  const owner: Owner = {
    userId: schedule.createdBy,
    orgId: project.ownerId.startsWith("org_") ? project.ownerId : null,
    ownerId: project.ownerId,
    orgRole: null,
  };

  const { limits } = await getPlanLimits(project.ownerId);
  if (!limits.scheduling) {
    await finishRun(schedule.id, slot, "skipped", { error: "Scheduled logs require the Pro plan." });
    return "skipped";
  }

  try {
    // A removed member's GitHub token must not keep acting on the organization's behalf.
    if (owner.orgId) await assertCreatorIsMember(owner.orgId, owner.userId);
    const scheduleKey = `${schedule.id}:${slot}`;
    const [savedRunLog] = existingLogId
      ? []
      : await getDb()
          .select({ id: shipLogs.id })
          .from(shipLogs)
          .where(and(eq(shipLogs.projectId, project.id), eq(shipLogs.scheduleKey, scheduleKey)))
          .limit(1);
    const savedLogId = existingLogId ?? savedRunLog?.id;
    const existingLog = savedLogId ? await getLog(project.ownerId, savedLogId) : null;
    const log = existingLog?.status === "ready"
      ? existingLog
      : await generateLog({
          owner,
          project,
          period: { days: schedule.periodDays },
          template: schedule.template,
          scheduleKey,
        });
    await saveRunLog(schedule.id, slot, log.id);

    // An empty selection means generate only; deliverLog would treat it as "every enabled channel".
    let note: string | null = null;
    if (schedule.channelIds.length > 0 && limits.delivery) {
      try {
        const results = await deliverLog(log, project.id, schedule.channelIds, scheduleKey);
        const failed = results.filter((r) => r.status !== "sent").length;
        if (failed) note = `${failed} of ${results.length} deliveries failed.`;
      } catch (err) {
        note = err instanceof ApiError ? err.message : "Delivery failed.";
      }
    }
    await finishRun(schedule.id, slot, "done", { logId: log.id, error: note });
    return "generated";
  } catch (err) {
    const code = err instanceof ApiError ? err.code : undefined;
    const message = err instanceof ApiError ? err.message : "Unexpected error while generating.";
    if (!(err instanceof ApiError)) console.error(`Scheduled run for schedule ${schedule.id} failed:`, err);

    if (code && SKIPPED.has(code)) {
      await finishRun(schedule.id, slot, "skipped", { error: message });
      if (ACTIONABLE.has(code)) await notifyProjectCreator(schedule.createdBy, project, message, schedule.name);
      return "skipped";
    }
    if (code && TRANSIENT.has(code) && attempt < MAX_ATTEMPTS) {
      await finishRun(schedule.id, slot, "retry", { error: message });
      return "retry";
    }
    await finishRun(schedule.id, slot, "failed", { error: message });
    return "failed";
  }
}

export type SchedulerSummary = { checked: number; due: number; generated: number; skipped: number; failed: number; retry: number };

// `only` limits the run to these schedule ids.
export async function runScheduled(
  now = new Date(),
  opts: { deadlineMs?: number; only?: string[] } = {}
): Promise<SchedulerSummary> {
  const { deadlineMs = 240_000, only } = opts;
  const started = Date.now();
  const rows = await getDb()
    .select({ schedule: projectSchedules, project: projects })
    .from(projectSchedules)
    .innerJoin(projects, eq(projects.id, projectSchedules.projectId))
    .where(
      and(
        eq(projectSchedules.enabled, true),
        isNull(projects.archivedAt),
        only ? inArray(projectSchedules.id, only) : undefined
      )
    );
  const withLinks = await withChannels(rows.map((r) => r.schedule));
  const candidates = rows.map((r, i) => ({ schedule: withLinks[i], project: r.project }));

  const summary: SchedulerSummary = { checked: candidates.length, due: 0, generated: 0, skipped: 0, failed: 0, retry: 0 };
  const retryBefore = new Date(now.getTime() - STALE_RUNNING_MS);
  const retryRows = candidates.length
    ? await getDb()
        .select({ scheduleId: scheduledRuns.scheduleId, slot: scheduledRuns.slot, logId: scheduledRuns.logId })
        .from(scheduledRuns)
        .where(
          and(
            inArray(scheduledRuns.scheduleId, candidates.map((c) => c.schedule.id)),
            lt(scheduledRuns.attempts, MAX_ATTEMPTS),
            or(
              eq(scheduledRuns.status, "retry"),
              and(eq(scheduledRuns.status, "running"), lt(scheduledRuns.updatedAt, retryBefore))
            )
          )
        )
    : [];
  const retries = new Map<string, Map<string, string | null>>();
  for (const row of retryRows) {
    const slots = retries.get(row.scheduleId) ?? new Map<string, string | null>();
    slots.set(row.slot, row.logId);
    retries.set(row.scheduleId, slots);
  }
  const due = candidates.flatMap(({ schedule, project }) => {
    const slots = new Map(retries.get(schedule.id) ?? []);
    const slot = currentSlot(schedule, now);
    if (slot && !slots.has(slot)) slots.set(slot, null);
    return [...slots].map(([dueSlot, logId]) => ({ schedule, project, slot: dueSlot, logId }));
  });
  summary.due = due.length;

  // Small worker pool; anything not started before the deadline stays due and is picked up next tick.
  const queue = [...due];
  const worker = async () => {
    while (queue.length && Date.now() - started < deadlineMs) {
      const { schedule, project, slot, logId } = queue.shift()!;
      const claim = await claimSlot(schedule.id, slot, now);
      if (claim === null) continue;
      try {
        summary[await runSchedule(schedule, project, slot, claim.attempts, claim.logId ?? logId)]++;
      } catch (err) {
        console.error(`Scheduled run for schedule ${schedule.id} crashed:`, err);
        await finishRun(schedule.id, slot, "failed", { error: "Unexpected error." }).catch(() => undefined);
        summary.failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  return summary;
}
