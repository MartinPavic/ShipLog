import { NextResponse } from "next/server";
import { ApiError, handle, parseBody } from "@/lib/api";
import { deleteChannel, updateChannel } from "@/lib/delivery";
import { requireAdmin } from "@/lib/owner";
import { requireProject } from "@/lib/projects";
import { updateChannelSchema, uuidSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string; channelId: string }> };

async function load(ctx: Ctx) {
  const owner = await requireAdmin();
  const { id, channelId } = await ctx.params;
  const project = await requireProject(owner.ownerId, id);
  if (!uuidSchema.safeParse(channelId).success) throw new ApiError(404, "Channel not found", "NOT_FOUND");
  return { project, channelId };
}

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const { project, channelId } = await load(ctx);
  const patch = await parseBody(req, updateChannelSchema);
  return NextResponse.json({ channel: await updateChannel(project.id, channelId, patch) });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const { project, channelId } = await load(ctx);
  await deleteChannel(project.id, channelId);
  return NextResponse.json({ success: true });
});
