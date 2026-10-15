import { NextResponse } from "next/server";
import { ApiError, handle } from "@/lib/api";
import { sendTestMessage } from "@/lib/delivery";
import { requireAdmin } from "@/lib/owner";
import { requirePlanFeature } from "@/lib/plans";
import { requireProject } from "@/lib/projects";
import { enforceRateLimit } from "@/lib/rate-limit";
import { uuidSchema } from "@/lib/validation";

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string; channelId: string }> }) => {
  const owner = await requireAdmin();
  const { id, channelId } = await ctx.params;
  const project = await requireProject(owner.ownerId, id);
  if (!uuidSchema.safeParse(channelId).success) throw new ApiError(404, "Channel not found", "NOT_FOUND");
  await requirePlanFeature(owner.ownerId, "delivery");
  await enforceRateLimit(`deliver:${owner.ownerId}`, 30, 60 * 60 * 1000, "delivery attempts");

  await sendTestMessage(project.id, channelId);
  return NextResponse.json({ success: true });
});
