import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { requireAdmin } from "@/lib/owner";
import { requirePlanFeature } from "@/lib/plans";
import { requireProject } from "@/lib/projects";
import { deleteSchedule, updateSchedule } from "@/lib/schedules";
import { updateScheduleSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string; scheduleId: string }> };

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const owner = await requireAdmin();
  const { id, scheduleId } = await ctx.params;
  const project = await requireProject(owner.ownerId, id);
  const patch = await parseBody(req, updateScheduleSchema);
  if (patch.enabled) await requirePlanFeature(owner.ownerId, "scheduling");
  return NextResponse.json({ schedule: await updateSchedule(owner, project.id, scheduleId, patch) });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const owner = await requireAdmin();
  const { id, scheduleId } = await ctx.params;
  const project = await requireProject(owner.ownerId, id);
  await deleteSchedule(project.id, scheduleId);
  return NextResponse.json({ success: true });
});
