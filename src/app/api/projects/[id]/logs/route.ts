import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { listLogs } from "@/lib/logs";
import { getOwner } from "@/lib/owner";
import { getPlanLimits } from "@/lib/plans";
import { requireProject } from "@/lib/projects";
import { logListQuerySchema } from "@/lib/validation";

export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const owner = await getOwner();
  const { id } = await ctx.params;
  const project = await requireProject(owner.ownerId, id);
  const query = logListQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { limits } = await getPlanLimits(owner.ownerId);
  return NextResponse.json(await listLogs(owner.ownerId, project.id, query, limits));
});
