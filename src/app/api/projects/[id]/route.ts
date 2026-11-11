import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { getOwner, requireAdmin } from "@/lib/owner";
import { ensureOwnerSlug } from "@/lib/owner-profile";
import { requirePlanFeature } from "@/lib/plans";
import { archiveProject, requireProject, updateProject } from "@/lib/projects";
import { enforceRateLimit } from "@/lib/rate-limit";
import { canonicalizeSentryProjects } from "@/lib/sentry-settings";
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
  await requireProject(owner.ownerId, id);
  const patch = await parseBody(req, updateProjectSchema);
  if (patch.schedule?.enabled) await requirePlanFeature(owner.ownerId, "scheduling");
  // An omitted field keeps the stored selection and never contacts Sentry.
  if (patch.sentryProjects && patch.sentryProjects.length > 0) {
    await enforceRateLimit(`sentry-projects:${owner.ownerId}`, 120, 60 * 60 * 1000, "Sentry project requests");
    patch.sentryProjects = await canonicalizeSentryProjects(owner.ownerId, patch.sentryProjects);
  }
  const project = await updateProject(owner.ownerId, id, patch);
  if (project.isPublicChangelog) await ensureOwnerSlug(owner);
  return NextResponse.json({ project });
});

// Archives rather than deletes, so logs and public links stay recoverable.
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const owner = await requireAdmin();
  const { id } = await ctx.params;
  await archiveProject(owner.ownerId, id);
  return NextResponse.json({ success: true });
});
