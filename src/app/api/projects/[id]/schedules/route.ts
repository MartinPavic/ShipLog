import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { getOwner, requireAdmin } from "@/lib/owner";
import { requirePlanFeature } from "@/lib/plans";
import { requireProject } from "@/lib/projects";
import { createSchedule, listSchedules } from "@/lib/schedules";
import { scheduleInputSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const owner = await getOwner();
  const project = await requireProject(owner.ownerId, (await ctx.params).id);
  return NextResponse.json({ schedules: await listSchedules(project.id) });
});

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const owner = await requireAdmin();
  const project = await requireProject(owner.ownerId, (await ctx.params).id);
  const input = await parseBody(req, scheduleInputSchema);
  if (input.enabled) await requirePlanFeature(owner.ownerId, "scheduling");
  return NextResponse.json({ schedule: await createSchedule(owner, project.id, input) }, { status: 201 });
});
