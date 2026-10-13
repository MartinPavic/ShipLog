import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { deleteGithubConnection, getGithubConnection } from "@/lib/github";
import { revokeGrant } from "@/lib/github-oauth";
import { getOwner } from "@/lib/owner";

export const DELETE = handle(async () => {
  const { userId } = await getOwner();
  const connection = await getGithubConnection(userId);
  await deleteGithubConnection(userId);
  if (connection) await revokeGrant(connection.token);
  return NextResponse.json({ success: true });
});
