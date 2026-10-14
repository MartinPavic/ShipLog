import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { getOwner } from "@/lib/owner";
import { getPlanLimits } from "@/lib/plans";
import { createProject, listProjects } from "@/lib/projects";
import { createProjectSchema } from "@/lib/validation";

export const GET = handle(async () => {
  const owner = await getOwner();
  return NextResponse.json({ projects: await listProjects(owner.ownerId) });
});

export const POST = handle(async (req: Request) => {
  const owner = await getOwner();
  const input = await parseBody(req, createProjectSchema);
  const { limits } = await getPlanLimits(owner.ownerId);
  const project = await createProject(owner, input, limits.maxProjects);
  return NextResponse.json({ project }, { status: 201 });
});
