import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { projects, scheduledRuns } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { deliverLog } from "@/lib/delivery";
import { generateLog } from "@/lib/generation";
import { notifyProjectCreator } from "@/lib/notify";
import type { Owner } from "@/lib/owner";
import { getPlanLimits } from "@/lib/plans";
import type { Project } from "@/lib/projects";
import { currentSlot } from "@/lib/schedule";

export const MAX_ATTEMPTS = 3;
const STALE_RUNNING_MS = 30 * 60 * 1000;
const CONCURRENCY = 3;

// The user has to fix these, so they get a notification; NO_ACTIVITY is just a quiet week.
const ACTIONABLE = new Set(["NO_GITHUB", "GITHUB_AUTH", "GITHUB_ACCESS", "NO_AI_KEY", "AI_AUTH", "AI_MODEL", "LIMIT_REACHED"]);
const SKIPPED = new Set([...ACTIONABLE, "NO_ACTIVITY"]);
const TRANSIENT = new Set(["AI_UNAVAILABLE", "AI_TIMEOUT", "AI_RATE_LIMIT", "GITHUB_UNAVAILABLE"]);

// Takes the slot atomically: first claim, or a re-claim of a retryable / crashed run. Returns the attempt number.
export async function claimSlot(projectId: string, slot: string, now = new Date()): Promise<number | null> {
  const stale = new Date(now.getTime() - STALE_RUNNING_MS);
  const rows = await getDb()
    .insert(scheduledRuns)
    .values({ projectId, slot, status: "running" })
    .onConflictDoUpdate({
      target: [scheduledRuns.projectId, scheduledRuns.slot],
      set: { status: "running", attempts: sql`${scheduledRuns.attempts} + 1`, updatedAt: now },
      setWhere: and(
        lt(scheduledRuns.attempts, MAX_ATTEMPTS),
        or(
          eq(scheduledRuns.status, "retry"),
          and(eq(scheduledRuns.status, "running"), lt(scheduledRuns.updatedAt, stale))
        )
      ),
    })
    .returning({ attempts: scheduledRuns.attempts });
  return rows[0]?.attempts ?? null;
}

async function finishRun(
  projectId: string,
  slot: string,
  status: "done" | "failed" | "skipped" | "retry",
  extra: { logId?: string; error?: string | null } = {}
) {
  await getDb()
    .update(scheduledRuns)
    .set({ status, logId: extra.logId ?? null, error: extra.error ?? null, updatedAt: new Date() })
    .where(and(eq(scheduledRuns.projectId, projectId), eq(scheduledRuns.slot, slot)));
}

export type RunOutcome = "generated" | "skipped" | "failed" | "retry";

async function runProject(project: Project, slot: string, attempt: number): Promise<RunOutcome> {
  const schedule = project.schedule!;
  const owner: Owner = {
    userId: project.createdBy,
    orgId: project.ownerId.startsWith("org_") ? project.ownerId : null,
    ownerId: project.ownerId,
    orgRole: null,
  };

  const { limits } = await getPlanLimits(project.ownerId);
  if (!limits.scheduling) {
    await finishRun(project.id, slot, "skipped", { error: "Scheduled logs require the Pro plan." });
    return "skipped";
  }

  try {
    const log = await generateLog({ owner, project, period: { days: schedule.periodDays } });

    let note: string | null = null;
    if (schedule.autoDeliver && limits.delivery) {
      try {
        const results = await deliverLog(log, project.id);
        const failed = results.filter((r) => r.status === "failed").length;
        if (failed) note = `${failed} of ${results.length} deliveries failed.`;
      } catch (err) {
        note = err instanceof ApiError ? err.message : "Delivery failed.";
      }
    }
    await finishRun(project.id, slot, "done", { logId: log.id, error: note });
    return "generated";
  } catch (err) {
    const code = err instanceof ApiError ? err.code : undefined;
    const message = err instanceof ApiError ? err.message : "Unexpected error while generating.";
    if (!(err instanceof ApiError)) console.error(`Scheduled run for ${project.id} failed:`, err);

    if (code && SKIPPED.has(code)) {
      await finishRun(project.id, slot, "skipped", { error: message });
      if (ACTIONABLE.has(code)) await notifyProjectCreator(project.createdBy, project, message);
      return "skipped";
    }
    if (code && TRANSIENT.has(code) && attempt < MAX_ATTEMPTS) {
      await finishRun(project.id, slot, "retry", { error: message });
      return "retry";
    }
    await finishRun(project.id, slot, "failed", { error: message });
    return "failed";
  }
}

export type SchedulerSummary = { checked: number; due: number; generated: number; skipped: number; failed: number; retry: number };

export async function runScheduled(
  now = new Date(),
  opts: { deadlineMs?: number; only?: string[] } = {}
): Promise<SchedulerSummary> {
  const { deadlineMs = 240_000, only } = opts;
  const started = Date.now();
  const candidates = await getDb()
    .select()
    .from(projects)
    .where(
      and(
        sql`${projects.archivedAt} is null and (${projects.schedule}->>'enabled') = 'true'`,
        only ? inArray(projects.id, only) : undefined
      )
    );

  const summary: SchedulerSummary = { checked: candidates.length, due: 0, generated: 0, skipped: 0, failed: 0, retry: 0 };
  const due = candidates.flatMap((p) => {
    const slot = p.schedule ? currentSlot(p.schedule, now) : null;
    return slot ? [{ project: p, slot }] : [];
  });
  summary.due = due.length;

  // Small worker pool; anything not started before the deadline stays due and is picked up next tick.
  const queue = [...due];
  const worker = async () => {
    while (queue.length && Date.now() - started < deadlineMs) {
      const { project, slot } = queue.shift()!;
      const attempt = await claimSlot(project.id, slot, now);
      if (attempt === null) continue;
      try {
        summary[await runProject(project, slot, attempt)]++;
      } catch (err) {
        console.error(`Scheduled run for ${project.id} crashed:`, err);
        await finishRun(project.id, slot, "failed", { error: "Unexpected error." }).catch(() => undefined);
        summary.failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  return summary;
}

export async function getLastRun(projectId: string) {
  const [row] = await getDb()
    .select()
    .from(scheduledRuns)
    .where(eq(scheduledRuns.projectId, projectId))
    .orderBy(sql`${scheduledRuns.slot} desc`)
    .limit(1);
  return row ?? null;
}
