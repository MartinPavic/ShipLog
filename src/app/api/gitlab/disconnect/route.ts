import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { deleteGitLabConnection } from "@/lib/gitlab-settings";
import { getOwner } from "@/lib/owner";

export const DELETE = handle(async () => {
  const owner = await getOwner();
  await deleteGitLabConnection(owner.ownerId, owner.userId);
  return NextResponse.json({ success: true });
});