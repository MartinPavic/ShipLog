import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { projects } from "@/db/schema";
import type { Owner } from "@/lib/owner";

// Interim until Phase 4 adds real project management.
export async function getOrCreateDefaultProject(owner: Owner) {
  const db = getDb();
  const find = () =>
    db
      .select()
      .from(projects)
      .where(and(eq(projects.ownerId, owner.ownerId), isNull(projects.archivedAt)))
      .orderBy(asc(projects.createdAt))
      .limit(1);

  const [existing] = await find();
  if (existing) return existing;

  await db
    .insert(projects)
    .values({ ownerId: owner.ownerId, createdBy: owner.userId, name: "My project", slug: "default" })
    .onConflictDoNothing();
  const [created] = await find();
  return created;
}
