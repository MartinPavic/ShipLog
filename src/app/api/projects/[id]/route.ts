import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { getOwner, requireAdmin } from "@/lib/owner";
import { archiveProject, requireProject, updateProject } from "@/lib/projects";
import { updateProjectSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const owner = await getOwner();
  const { id } = await ctx.params;
  return NextResponse.json({ project: await requireProject(owner.ownerId, id) });
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const owner = await getOwner();
  const { id } = await ctx.params;
  const patch = await parseBody(req, updateProjectSchema);
  return NextResponse.json({ project: await updateProject(owner.ownerId, id, patch) });
});

// Archives rather than deletes, so logs and public links stay recoverable.
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const owner = await requireAdmin();
  const { id } = await ctx.params;
  await archiveProject(owner.ownerId, id);
  return NextResponse.json({ success: true });
});
