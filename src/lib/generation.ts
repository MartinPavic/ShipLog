import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { shipLogVersions, shipLogs } from "@/db/schema";
import { resolveAiAccess } from "@/lib/ai/access";
import { complete } from "@/lib/ai/providers";
import { buildSystemPrompt, buildUserPrompt, defaultLogTitle, type TemplateId } from "@/lib/ai/templates";
import { ApiError } from "@/lib/api";
import { fetchActivity, getGithubConnection, listRecentlyPushedRepos } from "@/lib/github";
import { formatActivity, isActivityEmpty } from "@/lib/github-activity";
import type { ShipLog } from "@/lib/logs";
import type { Owner } from "@/lib/owner";
import type { Project } from "@/lib/projects";
import { releaseGeneration, reserveGeneration } from "@/lib/usage";

const DAY_MS = 24 * 60 * 60 * 1000;

type GenerateInput = {
  owner: Owner;
  project: Project;
  days?: number;
  template?: TemplateId;
  // Regenerating keeps the log's period and saves the previous text as a version.
  existing?: ShipLog;
};

export async function generateLog({ owner, project, days, template, existing }: GenerateInput) {
  const github = await getGithubConnection(owner.userId);
  if (!github) throw new ApiError(400, "Connect GitHub in Settings first.", "NO_GITHUB");
  const ai = await resolveAiAccess(owner.ownerId);

  // Reserve before doing work so parallel requests can't bypass the limit.
  const reservation = await reserveGeneration(owner.ownerId, ai.kind, ai.limits);

  try {
    const periodEnd = existing?.periodEnd ?? new Date();
    const periodStart =
      existing?.periodStart ?? new Date(periodEnd.getTime() - (days ?? project.defaultPeriodDays) * DAY_MS);
    const templateId = template ?? (existing?.template as TemplateId | undefined) ?? (project.template as TemplateId);

    const repos = project.repos.length
      ? project.repos
      : await listRecentlyPushedRepos(github.token, periodStart);
    const activity = await fetchActivity(github.token, repos, periodStart, periodEnd);
    if (isActivityEmpty(activity)) {
      throw new ApiError(
        400,
        "No activity found in this period. Check the project's repositories and try a longer period.",
        "NO_ACTIVITY"
      );
    }

    const ctx = { ...project, template: templateId };
    const content = await complete({
      provider: ai.provider,
      key: ai.key,
      model: ai.model,
      system: buildSystemPrompt(ctx),
      prompt: buildUserPrompt(ctx, formatActivity(activity), periodStart, periodEnd),
    });

    const generated = {
      content,
      template: templateId,
      provider: ai.provider,
      model: ai.model,
      status: "ready" as const,
      error: null,
      sourceSnapshot: activity,
    };

    if (existing) {
      return await getDb().transaction(async (tx) => {
        await tx
          .insert(shipLogVersions)
          .values({ logId: existing.id, content: existing.content, createdBy: owner.userId });
        const [row] = await tx.update(shipLogs).set(generated).where(eq(shipLogs.id, existing.id)).returning();
        return row;
      });
    }

    const [row] = await getDb()
      .insert(shipLogs)
      .values({
        ...generated,
        projectId: project.id,
        ownerId: owner.ownerId,
        createdBy: owner.userId,
        title: defaultLogTitle(templateId, periodStart, periodEnd),
        periodStart,
        periodEnd,
      })
      .returning();
    return row;
  } catch (err) {
    await releaseGeneration(reservation);
    throw err;
  }
}
