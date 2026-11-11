import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { getOwner } from "@/lib/owner";
import { enforceRateLimit } from "@/lib/rate-limit";
import { listSentryProjects } from "@/lib/sentry-settings";

export const GET = handle(async () => {
  const owner = await getOwner();
  await enforceRateLimit(`sentry-projects:${owner.ownerId}`, 120, 60 * 60 * 1000, "Sentry project requests");
  return NextResponse.json({ projects: await listSentryProjects(owner.ownerId) });
});
