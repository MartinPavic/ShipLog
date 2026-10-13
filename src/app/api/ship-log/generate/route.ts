import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { shipLogs } from "@/db/schema";
import { resolveAiAccess } from "@/lib/ai/access";
import { complete } from "@/lib/ai/providers";
import { ApiError, handle, parseBody } from "@/lib/api";
import { fetchActivity, getGithubConnection, listRecentlyPushedRepos } from "@/lib/github";
import { formatActivity, isActivityEmpty } from "@/lib/github-activity";
import { getOwner } from "@/lib/owner";
import { getOrCreateDefaultProject } from "@/lib/projects";
import { releaseGeneration, reserveGeneration } from "@/lib/usage";
import { generateSchema } from "@/lib/validation";

export const maxDuration = 90;

const SYSTEM_PROMPT = `You are an expert engineering manager. Turn GitHub activity (releases, merged pull requests, closed issues and commits) into a clean, professional ship log / progress report.

Rules:
- Group related work into 3-7 bullet points
- Use clear, non-technical language when possible
- Highlight what was shipped / finished
- Mention anything that looks like work-in-progress or blockers if obvious
- Keep it concise (max ~250 words)
- Output only the report, no extra commentary`;

export const POST = handle(async (req: Request) => {
  const owner = await getOwner();
  const { repo, days } = await parseBody(req, generateSchema);

  const github = await getGithubConnection(owner.userId);
  if (!github) throw new ApiError(400, "Connect GitHub in Settings first.", "NO_GITHUB");
  const ai = await resolveAiAccess(owner.ownerId);

  // Reserve before doing work so parallel requests can't bypass the limit.
  const reservation = await reserveGeneration(owner.ownerId, ai.kind, ai.limits);

  try {
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - days * 24 * 60 * 60 * 1000);

    const repos = repo ? [{ fullName: repo }] : await listRecentlyPushedRepos(github.token, periodStart);
    const activity = await fetchActivity(github.token, repos, periodStart, periodEnd);
    if (isActivityEmpty(activity)) {
      throw new ApiError(400, "No activity found in the selected period.", "NO_ACTIVITY");
    }

    const content = await complete({
      provider: ai.provider,
      key: ai.key,
      model: ai.model,
      system: SYSTEM_PROMPT,
      prompt: `GitHub activity:\n\n${formatActivity(activity)}`,
    });

    const project = await getOrCreateDefaultProject(owner);
    const [log] = await getDb()
      .insert(shipLogs)
      .values({
        projectId: project.id,
        ownerId: owner.ownerId,
        createdBy: owner.userId,
        title: `Last ${days} days`,
        content,
        periodStart,
        periodEnd,
        template: "weekly_update",
        provider: ai.provider,
        model: ai.model,
        status: "ready",
        sourceSnapshot: activity,
      })
      .returning();

    return NextResponse.json({
      content,
      log: { id: log.id, createdAt: log.createdAt.toISOString(), content, title: log.title },
    });
  } catch (err) {
    await releaseGeneration(reservation);
    throw err;
  }
});
