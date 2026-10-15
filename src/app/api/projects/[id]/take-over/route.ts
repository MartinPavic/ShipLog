import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { requireAdmin } from "@/lib/owner";
import { requireProject, takeOverProject } from "@/lib/projects";

// Scheduled runs use the creator's GitHub connection; an admin can claim a project, e.g. after its creator left.
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const owner = await requireAdmin();
  const project = await requireProject(owner.ownerId, (await ctx.params).id);
  await takeOverProject(owner.ownerId, project.id, owner.userId);
  return NextResponse.json({ success: true });
});
