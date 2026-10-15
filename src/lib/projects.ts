import { and, asc, count, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { projects, scheduledRuns, shipLogs, type ProjectRepo } from "@/db/schema";
import { ApiError } from "@/lib/api";
import type { Owner } from "@/lib/owner";
import { slugify } from "@/lib/slug";
import { uuidSchema, type CreateProjectInput, type UpdateProjectInput } from "@/lib/validation";

export type Project = typeof projects.$inferSelect;

const active = (ownerId: string) => and(eq(projects.ownerId, ownerId), isNull(projects.archivedAt));

function dedupeRepos(repos: ProjectRepo[]): ProjectRepo[] {
  const seen = new Set<string>();
  return repos.filter((r) => {
    const key = r.fullName.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function listProjects(ownerId: string) {
  return getDb()
    .select({
      ...getTableColumns(projects),
      logCount: sql<number>`(select count(*)::int from ${shipLogs} where ${shipLogs.projectId} = ${projects.id})`,
      lastLogAt: sql<Date | null>`(select max(${shipLogs.createdAt}) from ${shipLogs} where ${shipLogs.projectId} = ${projects.id})`,
    })
    .from(projects)
    .where(active(ownerId))
    .orderBy(asc(projects.createdAt));
}

export async function getProject(ownerId: string, id: string): Promise<Project | null> {
  if (!uuidSchema.safeParse(id).success) return null;
  const [row] = await getDb()
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), active(ownerId)))
    .limit(1);
  return row ?? null;
}

export async function requireProject(ownerId: string, id: string): Promise<Project> {
  const project = await getProject(ownerId, id);
  if (!project) throw new ApiError(404, "Project not found", "NOT_FOUND");
  return project;
}

export async function createProject(owner: Owner, input: CreateProjectInput, maxProjects: number) {
  const db = getDb();
  return db.transaction(async (tx) => {
    // Serialise creates per owner so the plan limit can't be raced.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${owner.ownerId}))`);
    const [{ n }] = await tx.select({ n: count() }).from(projects).where(active(owner.ownerId));
    if (n >= maxProjects) {
      throw new ApiError(
        403,
        maxProjects <= 0
          ? "Upgrade this workspace to Pro to create projects."
          : `Your plan allows ${maxProjects} project${maxProjects === 1 ? "" : "s"}. Upgrade to Pro for more.`,
        "LIMIT_REACHED"
      );
    }

    const base = slugify(input.name);
    for (let attempt = 1; attempt <= 50; attempt++) {
      const [row] = await tx
        .insert(projects)
        .values({
          ownerId: owner.ownerId,
          createdBy: owner.userId,
          name: input.name,
          slug: attempt === 1 ? base : `${base}-${attempt}`,
          description: input.description ?? null,
          repos: dedupeRepos(input.repos),
          template: input.template,
          tone: input.tone ?? null,
          audience: input.audience ?? null,
          customPrompt: input.customPrompt ?? null,
          defaultPeriodDays: input.defaultPeriodDays,
          isPublicChangelog: input.isPublicChangelog,
        })
        .onConflictDoNothing()
        .returning();
      if (row) return row;
    }
    throw new ApiError(409, "Could not find a free project URL. Try a different name.");
  });
}

// The slug stays fixed on rename so public changelog URLs don't break.
export async function updateProject(ownerId: string, id: string, patch: UpdateProjectInput): Promise<Project> {
  await requireProject(ownerId, id);
  const [row] = await getDb()
    .update(projects)
    .set({
      ...patch,
      ...(patch.repos ? { repos: dedupeRepos(patch.repos) } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, id), active(ownerId)))
    .returning();
  if (!row) throw new ApiError(404, "Project not found", "NOT_FOUND");
  return row;
}

export async function archiveProject(ownerId: string, id: string): Promise<void> {
  const rows = await getDb()
    .update(projects)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(projects.id, id), active(ownerId)))
    .returning({ id: projects.id });
  if (rows.length === 0) throw new ApiError(404, "Project not found", "NOT_FOUND");
}

// Scheduled runs use the creator's GitHub connection, so handing a project over means changing the creator.
export async function takeOverProject(ownerId: string, id: string, userId: string): Promise<Project> {
  const db = getDb();
  const [row] = await db
    .update(projects)
    .set({ createdBy: userId, updatedAt: new Date() })
    .where(and(eq(projects.id, id), active(ownerId)))
    .returning();
  if (!row) throw new ApiError(404, "Project not found", "NOT_FOUND");

  // The newest run may have been skipped because of the previous creator; let it run again on the next tick.
  await db
    .update(scheduledRuns)
    .set({ status: "retry", attempts: 0, error: null, updatedAt: new Date() })
    .where(
      and(
        eq(scheduledRuns.projectId, id),
        inArray(scheduledRuns.status, ["skipped", "failed"]),
        sql`${scheduledRuns.slot} = (select max(slot) from scheduled_runs where project_id = ${id})`
      )
    );
  return row;
}
