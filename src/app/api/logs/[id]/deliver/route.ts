import { NextResponse } from "next/server";
import { ApiError, handle, parseBody } from "@/lib/api";
import { deliverLog } from "@/lib/delivery";
import { assertLogVisible, requireLog } from "@/lib/logs";
import { getOwner } from "@/lib/owner";
import { getPlanLimits, requirePlanFeature } from "@/lib/plans";
import { enforceRateLimit } from "@/lib/rate-limit";
import { deliverSchema } from "@/lib/validation";

// "Send now": members may send, admins manage the channels.
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const owner = await getOwner();
  const log = await requireLog(owner.ownerId, (await ctx.params).id);
  await assertLogVisible(log, (await getPlanLimits(owner.ownerId)).limits);
  await requirePlanFeature(owner.ownerId, "delivery");
  if (log.status !== "ready") throw new ApiError(400, "Only finished logs can be sent.", "VALIDATION");
  const { channelIds } = await parseBody(req, deliverSchema);

  await enforceRateLimit(`deliver:${owner.ownerId}`, 30, 60 * 60 * 1000, "delivery attempts");
  return NextResponse.json({ results: await deliverLog(log, log.projectId, channelIds) });
});
