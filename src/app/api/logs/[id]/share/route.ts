import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { appUrl } from "@/lib/app-url";
import { assertLogVisible, disableShare, enableShare, requireLog } from "@/lib/logs";
import { getOwner } from "@/lib/owner";
import { getPlanLimits } from "@/lib/plans";
import { shareSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

async function loadLog(ctx: Ctx) {
  const owner = await getOwner();
  const log = await requireLog(owner.ownerId, (await ctx.params).id);
  await assertLogVisible(log, (await getPlanLimits(owner.ownerId)).limits);
  return log;
}

const describeShare = (log: { shareToken: string | null; hasSharePassword: boolean }) => ({
  shareToken: log.shareToken,
  url: log.shareToken ? `${appUrl()}/s/${log.shareToken}` : null,
  hasPassword: log.hasSharePassword,
});

// Creates the link on first call; later calls can change or clear the password, or rotate the token.
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const log = await loadLog(ctx);
  const body = await parseBody(req, shareSchema);
  return NextResponse.json(describeShare(await enableShare(log, body)));
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const log = await loadLog(ctx);
  await disableShare(log.id);
  return NextResponse.json({ shareToken: null, url: null, hasPassword: false });
});
