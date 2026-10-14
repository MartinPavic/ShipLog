import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { assertLogVisible, deleteLog, listVersions, requireLog, updateLog } from "@/lib/logs";
import { getOwner } from "@/lib/owner";
import { getPlanLimits } from "@/lib/plans";
import { updateLogSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

async function loadVisibleLog(ownerId: string, id: string) {
  const log = await requireLog(ownerId, id);
  await assertLogVisible(log, (await getPlanLimits(ownerId)).limits);
  return log;
}

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const owner = await getOwner();
  const log = await loadVisibleLog(owner.ownerId, (await ctx.params).id);
  return NextResponse.json({ log, versions: await listVersions(log.id) });
});

// Content edits snapshot the previous text into ship_log_versions.
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const owner = await getOwner();
  const log = await loadVisibleLog(owner.ownerId, (await ctx.params).id);
  const patch = await parseBody(req, updateLogSchema);
  return NextResponse.json({ log: await updateLog(owner.userId, log, patch) });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const owner = await getOwner();
  await deleteLog(owner.ownerId, (await ctx.params).id);
  return NextResponse.json({ success: true });
});
