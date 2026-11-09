import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { getGitLabConnectionStatus, getGitLabInstanceStatus, configureGitLabInstance, deleteGitLabInstance } from "@/lib/gitlab-settings";
import { getOwner, requireAdmin } from "@/lib/owner";
import { z } from "zod";

const configSchema = z.object({
  baseUrl: z.string().trim().min(1).max(2048),
  clientId: z.string().trim().min(1).max(500),
  clientSecret: z.string().min(8).max(500).optional(),
});

export const GET = handle(async () => {
  const owner = await getOwner();
  const [instance, connection] = await Promise.all([
    getGitLabInstanceStatus(owner.ownerId),
    getGitLabConnectionStatus(owner.ownerId, owner.userId),
  ]);
  return NextResponse.json({
    instance,
    connection,
  });
});

export const PUT = handle(async (req: Request) => {
  const owner = await requireAdmin();
  const body = await parseBody(req, configSchema);
  await configureGitLabInstance(owner.ownerId, body);
  const instance = await getGitLabInstanceStatus(owner.ownerId);
  return NextResponse.json({ instance });
});

export const DELETE = handle(async () => {
  const owner = await requireAdmin();
  await deleteGitLabInstance(owner.ownerId);
  return NextResponse.json({ success: true });
});