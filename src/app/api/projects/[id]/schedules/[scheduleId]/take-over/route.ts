import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { requireAdmin } from "@/lib/owner";
import { requireProject } from "@/lib/projects";
import { requireSchedule, takeOverSchedule } from "@/lib/schedules";

// Runs use the creator's connections; an admin can claim a schedule, e.g. after its creator left.
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string; scheduleId: string }> }) => {
  const owner = await requireAdmin();
  const { id, scheduleId } = await ctx.params;
  const project = await requireProject(owner.ownerId, id);
  const schedule = await requireSchedule(project.id, scheduleId);
  await takeOverSchedule(project.id, schedule.id, owner.userId);
  return NextResponse.json({ success: true });
});
