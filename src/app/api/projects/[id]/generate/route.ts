import { NextResponse } from "next/server";
import { ApiError, handle, parseBody } from "@/lib/api";
import { generateLog } from "@/lib/generation";
import { assertLogVisible, requireLog } from "@/lib/logs";
import { getOwner } from "@/lib/owner";
import { getPlanLimits } from "@/lib/plans";
import { requireProject } from "@/lib/projects";
import { generateSchema } from "@/lib/validation";

export const maxDuration = 90;

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const owner = await getOwner();
  const { id } = await ctx.params;
  const project = await requireProject(owner.ownerId, id);
  const body = await parseBody(req, generateSchema);

  let existing;
  if (body.regenerateLogId) {
    existing = await requireLog(owner.ownerId, body.regenerateLogId);
    if (existing.projectId !== project.id) throw new ApiError(404, "Log not found", "NOT_FOUND");
    await assertLogVisible(existing, (await getPlanLimits(owner.ownerId)).limits);
  }

  const log = await generateLog({ owner, project, days: body.days, template: body.template, existing });
  return NextResponse.json({
    log: { id: log.id, title: log.title, content: log.content, createdAt: log.createdAt },
  });
});
