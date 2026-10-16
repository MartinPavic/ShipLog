import { auth } from "@clerk/nextjs/server";
import { features } from "@/env";
import { ApiError } from "@/lib/api";

export type Owner = {
  userId: string;
  orgId: string | null;
  ownerId: string;
  orgRole: string | null;
};

export async function getOwner(): Promise<Owner> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) throw new ApiError(401, "Unauthorized");
  // With teams off, everyone stays in their personal workspace even if Clerk reports an organization.
  const org = features().teams ? (orgId ?? null) : null;
  return { userId, orgId: org, ownerId: org ?? userId, orgRole: org ? (orgRole ?? null) : null };
}

// Personal workspaces have no org role and are always admin of themselves.
export function isAdmin(owner: Owner): boolean {
  return owner.orgId === null || owner.orgRole === "org:admin";
}

export async function requireAdmin(): Promise<Owner> {
  const owner = await getOwner();
  if (!isAdmin(owner)) throw new ApiError(403, "Only organization admins can do this");
  return owner;
}
