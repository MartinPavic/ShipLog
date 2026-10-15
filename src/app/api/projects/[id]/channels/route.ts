import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { createChannel, listChannels } from "@/lib/delivery";
import { getOwner, requireAdmin } from "@/lib/owner";
import { requirePlanFeature } from "@/lib/plans";
import { requireProject } from "@/lib/projects";
import { createChannelSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const owner = await getOwner();
  const project = await requireProject(owner.ownerId, (await ctx.params).id);
  return NextResponse.json({ channels: await listChannels(project.id) });
});

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const owner = await requireAdmin();
  const project = await requireProject(owner.ownerId, (await ctx.params).id);
  await requirePlanFeature(owner.ownerId, "delivery");
  const input = await parseBody(req, createChannelSchema);
  return NextResponse.json({ channel: await createChannel(project.id, input) }, { status: 201 });
});
