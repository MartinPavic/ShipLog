import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { deleteGithubConnection, saveGithubConnection, verifyGithubToken } from "@/lib/github";
import { getOwner } from "@/lib/owner";
import { githubTokenSchema } from "@/lib/validation";

// Interim personal-access-token flow; Phase 3 replaces it with OAuth.
export const PUT = handle(async (req: Request) => {
  const { userId } = await getOwner();
  const { token } = await parseBody(req, githubTokenSchema);
  const { login, scopes } = await verifyGithubToken(token);
  await saveGithubConnection(userId, { login, token, scopes });
  return NextResponse.json({ connected: true, login });
});

export const DELETE = handle(async () => {
  const { userId } = await getOwner();
  await deleteGithubConnection(userId);
  return NextResponse.json({ success: true });
});
