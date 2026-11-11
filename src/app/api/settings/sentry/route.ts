import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { getOwner, requireAdmin } from "@/lib/owner";
import { enforceRateLimit } from "@/lib/rate-limit";
import { deleteSentryConnection, getSentryStatus, saveSentryConnection } from "@/lib/sentry-settings";
import { sentrySettingsSchema } from "@/lib/validation";

// The token is never returned; the response only reports whether one is stored.
export const GET = handle(async () => {
  const owner = await getOwner();
  return NextResponse.json(await getSentryStatus(owner.ownerId));
});

export const PUT = handle(async (req: Request) => {
  const owner = await requireAdmin();
  const body = await parseBody(req, sentrySettingsSchema);
  await enforceRateLimit(`sentry-connect:${owner.ownerId}`, 20, 60 * 60 * 1000, "Sentry connection attempts");
  await saveSentryConnection(owner.ownerId, body.organizationSlug, body.token);
  return NextResponse.json(await getSentryStatus(owner.ownerId));
});

// Project selections are kept so reconnecting restores them.
export const DELETE = handle(async () => {
  const owner = await requireAdmin();
  await deleteSentryConnection(owner.ownerId);
  return NextResponse.json({ success: true });
});
