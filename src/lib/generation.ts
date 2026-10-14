import { and, eq, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { shipLogVersions, shipLogs } from "@/db/schema";
import { resolveAiAccess, type AiAccess } from "@/lib/ai/access";
import { complete, openCompletionStream } from "@/lib/ai/providers";
import { buildSystemPrompt, buildUserPrompt, defaultLogTitle, type TemplateId } from "@/lib/ai/templates";
import { ApiError } from "@/lib/api";
import { fetchActivity, getGithubConnection, listRecentlyPushedRepos } from "@/lib/github";
import { formatActivity, isActivityEmpty, type Activity } from "@/lib/github-activity";
import type { ShipLog } from "@/lib/logs";
import type { Owner } from "@/lib/owner";
import type { Project } from "@/lib/projects";
import { releaseGeneration, reserveGeneration, type Reservation } from "@/lib/usage";

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_GENERATION_MS = 10 * 60 * 1000;

export type PeriodInput = { days?: number; from?: Date; to?: Date };

export function resolvePeriod(input: PeriodInput, defaultDays: number, now = new Date()) {
  const range = input.from && input.to;
  const start = range ? input.from! : new Date(now.getTime() - (input.days ?? defaultDays) * DAY_MS);
  // An inclusive "to" date covers the whole day, but never extends into the future.
  const end = range ? new Date(Math.min(input.to!.getTime() + DAY_MS - 1, now.getTime())) : now;
  if (end <= start) throw new ApiError(400, "The period must end after it starts and not be in the future.", "VALIDATION");
  return { start, end };
}

type GenerateInput = {
  owner: Owner;
  project: Project;
  period?: PeriodInput;
  template?: TemplateId;
  // Regenerating keeps the log's period and saves the previous text as a version.
  existing?: ShipLog;
};

type Prepared = {
  input: GenerateInput;
  ai: AiAccess;
  reservation: Reservation;
  period: { start: Date; end: Date };
  templateId: TemplateId;
  activity: Activity;
  system: string;
  prompt: string;
};

// Reserves usage and gathers everything needed for the AI call; releases the usage on failure.
async function prepare(input: GenerateInput): Promise<Prepared> {
  const { owner, project, existing } = input;
  const github = await getGithubConnection(owner.userId);
  if (!github) throw new ApiError(400, "Connect GitHub in Settings first.", "NO_GITHUB");
  const ai = await resolveAiAccess(owner.ownerId);

  // Reserve before doing work so parallel requests can't bypass the limit.
  const reservation = await reserveGeneration(owner.ownerId, ai.kind, ai.limits);

  try {
    const period = existing
      ? { start: existing.periodStart, end: existing.periodEnd }
      : resolvePeriod(input.period ?? {}, project.defaultPeriodDays);
    const templateId = input.template ?? (existing?.template as TemplateId | undefined) ?? (project.template as TemplateId);

    const repos = project.repos.length ? project.repos : await listRecentlyPushedRepos(github.token, period.start);
    const activity = await fetchActivity(github.token, repos, period.start, period.end);
    if (isActivityEmpty(activity)) {
      throw new ApiError(
        400,
        "No activity found in this period. Check the project's repositories and try a longer period.",
        "NO_ACTIVITY"
      );
    }

    const ctx = { ...project, template: templateId };
    return {
      input,
      ai,
      reservation,
      period,
      templateId,
      activity,
      system: buildSystemPrompt(ctx),
      prompt: buildUserPrompt(ctx, formatActivity(activity), period.start, period.end),
    };
  } catch (err) {
    await releaseGeneration(reservation);
    throw err;
  }
}

async function saveGenerated(p: Prepared, content: string, logId?: string) {
  const { owner, project, existing } = p.input;
  const generated = {
    content,
    template: p.templateId,
    provider: p.ai.provider,
    model: p.ai.model,
    status: "ready" as const,
    error: null,
    sourceSnapshot: p.activity,
  };
  const db = getDb();

  if (existing) {
    return db.transaction(async (tx) => {
      await tx.insert(shipLogVersions).values({ logId: existing.id, content: existing.content, createdBy: owner.userId });
      const [row] = await tx.update(shipLogs).set(generated).where(eq(shipLogs.id, existing.id)).returning();
      return row;
    });
  }
  if (logId) {
    const [row] = await db.update(shipLogs).set(generated).where(eq(shipLogs.id, logId)).returning();
    return row;
  }
  const [row] = await db
    .insert(shipLogs)
    .values({
      ...generated,
      projectId: project.id,
      ownerId: owner.ownerId,
      createdBy: owner.userId,
      title: defaultLogTitle(p.templateId, p.period.start, p.period.end),
      periodStart: p.period.start,
      periodEnd: p.period.end,
    })
    .returning();
  return row;
}

// Non-streaming path, used by scheduled runs.
export async function generateLog(input: GenerateInput) {
  const p = await prepare(input);
  try {
    const content = await complete({
      provider: p.ai.provider,
      key: p.ai.key,
      model: p.ai.model,
      system: p.system,
      prompt: p.prompt,
    });
    return await saveGenerated(p, content);
  } catch (err) {
    await releaseGeneration(p.reservation);
    throw err;
  }
}

export type StreamingGeneration = {
  logId: string;
  stream: AsyncIterable<string>;
  abort: () => void;
  finish: (content: string) => Promise<void>;
  // Refunds the reserved usage unless `refund` is false (e.g. a cancel after text was produced).
  fail: (message: string, opts?: { refund?: boolean }) => Promise<void>;
};

export async function startStreamingGeneration(input: GenerateInput): Promise<StreamingGeneration> {
  const { project, existing } = input;
  const db = getDb();

  // A crashed request can leave a log stuck in "generating".
  await db
    .update(shipLogs)
    .set({ status: "failed", error: "Generation did not finish." })
    .where(
      and(
        eq(shipLogs.projectId, project.id),
        eq(shipLogs.status, "generating"),
        lt(shipLogs.createdAt, new Date(Date.now() - STALE_GENERATION_MS))
      )
    );

  const p = await prepare(input);
  const controller = new AbortController();

  try {
    const stream = await openCompletionStream({
      provider: p.ai.provider,
      key: p.ai.key,
      model: p.ai.model,
      system: p.system,
      prompt: p.prompt,
      signal: controller.signal,
    });

    let logId = existing?.id;
    if (!logId) {
      const [row] = await db
        .insert(shipLogs)
        .values({
          projectId: project.id,
          ownerId: input.owner.ownerId,
          createdBy: input.owner.userId,
          title: defaultLogTitle(p.templateId, p.period.start, p.period.end),
          periodStart: p.period.start,
          periodEnd: p.period.end,
          template: p.templateId,
          provider: p.ai.provider,
          model: p.ai.model,
          status: "generating",
        })
        .returning({ id: shipLogs.id });
      logId = row.id;
    }
    const id = logId;

    let settled = false;
    return {
      logId: id,
      stream,
      abort: () => controller.abort(),
      finish: async (content) => {
        if (settled) return;
        await saveGenerated(p, content, existing ? undefined : id);
        settled = true;
      },
      fail: async (message, { refund = true } = {}) => {
        if (settled) return;
        settled = true;
        if (!existing) {
          await db.update(shipLogs).set({ status: "failed", error: message }).where(eq(shipLogs.id, id));
        }
        if (refund) await releaseGeneration(p.reservation);
      },
    };
  } catch (err) {
    controller.abort();
    await releaseGeneration(p.reservation);
    throw err;
  }
}
