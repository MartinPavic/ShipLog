import { eq } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getDb } from "@/db";
import { ownerProfiles } from "@/db/schema";
import type { Owner } from "@/lib/owner";
import { slugify } from "@/lib/slug";

export async function getOwnerSlug(ownerId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ slug: ownerProfiles.slug })
    .from(ownerProfiles)
    .where(eq(ownerProfiles.ownerId, ownerId))
    .limit(1);
  return row?.slug ?? null;
}

async function suggestedName(owner: Owner): Promise<string> {
  if (owner.orgId) {
    const { orgSlug } = await auth();
    if (orgSlug) return orgSlug;
  }
  const user = await currentUser();
  return user?.username ?? user?.firstName ?? "workspace";
}

// Created the first time a public changelog is enabled; the handle is derived from the Clerk org or user name.
export async function ensureOwnerSlug(owner: Owner, name?: string): Promise<string> {
  const existing = await getOwnerSlug(owner.ownerId);
  if (existing) return existing;

  const base = slugify(name ?? (await suggestedName(owner)));
  const db = getDb();
  for (let attempt = 1; attempt <= 50; attempt++) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`;
    const [row] = await db
      .insert(ownerProfiles)
      .values({ ownerId: owner.ownerId, slug })
      .onConflictDoNothing()
      .returning({ slug: ownerProfiles.slug });
    if (row) return row.slug;
    // Either the slug is taken or a parallel request created this owner's profile.
    const mine = await getOwnerSlug(owner.ownerId);
    if (mine) return mine;
  }
  throw new Error("Could not allocate a public handle");
}
