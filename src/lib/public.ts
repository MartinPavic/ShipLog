import { and, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { ownerProfiles, projects, shipLogs } from "@/db/schema";
import { isShareToken } from "@/lib/share";

const SLUG_RE = /^[a-z0-9-]{1,64}$/;
export const isSlug = (value: string) => SLUG_RE.test(value);

// Only what a public viewer may see; owner ids, sources and hashes stay out.
export async function getSharedLog(token: string) {
  if (!isShareToken(token)) return null;
  const [row] = await getDb()
    .select({
      id: shipLogs.id,
      title: shipLogs.title,
      content: shipLogs.content,
      periodStart: shipLogs.periodStart,
      periodEnd: shipLogs.periodEnd,
      createdAt: shipLogs.createdAt,
      passwordHash: shipLogs.sharePasswordHash,
      projectName: projects.name,
    })
    .from(shipLogs)
    .innerJoin(projects, eq(projects.id, shipLogs.projectId))
    .where(and(eq(shipLogs.shareToken, token), eq(shipLogs.status, "ready"), isNull(projects.archivedAt)))
    .limit(1);
  return row ?? null;
}

export const CHANGELOG_PAGE_SIZE = 20;

export async function getPublicChangelog(ownerSlug: string, projectSlug: string, page: number) {
  if (!isSlug(ownerSlug) || !isSlug(projectSlug)) return null;
  const db = getDb();

  const [project] = await db
    .select({ id: projects.id, name: projects.name, description: projects.description })
    .from(projects)
    .innerJoin(ownerProfiles, eq(ownerProfiles.ownerId, projects.ownerId))
    .where(
      and(
        eq(ownerProfiles.slug, ownerSlug),
        eq(projects.slug, projectSlug),
        eq(projects.isPublicChangelog, true),
        isNull(projects.archivedAt)
      )
    )
    .limit(1);
  if (!project) return null;

  const where = and(
    eq(shipLogs.projectId, project.id),
    eq(shipLogs.status, "ready"),
    isNotNull(shipLogs.publishedAt)
  );
  const [entries, [{ total }]] = await Promise.all([
    db
      .select({
        id: shipLogs.id,
        title: shipLogs.title,
        content: shipLogs.content,
        publishedAt: shipLogs.publishedAt,
        periodStart: shipLogs.periodStart,
        periodEnd: shipLogs.periodEnd,
      })
      .from(shipLogs)
      .where(where)
      .orderBy(desc(shipLogs.publishedAt))
      .limit(CHANGELOG_PAGE_SIZE)
      .offset((page - 1) * CHANGELOG_PAGE_SIZE),
    db.select({ total: count() }).from(shipLogs).where(where),
  ]);

  return { project, entries, total, pages: Math.max(1, Math.ceil(total / CHANGELOG_PAGE_SIZE)) };
}
