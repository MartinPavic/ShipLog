import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../src/db/index";
import { projects, shipLogVersions, shipLogs, usageCounters } from "../../src/db/schema";
import { buildDemoLogs, DEMO_PROJECT, DEMO_SLUG } from "./demo-data";

export type SeedResult = { status: "created" | "exists"; projectId: string };

async function findDemo(ownerId: string) {
  const [row] = await getDb()
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.ownerId, ownerId), eq(projects.slug, DEMO_SLUG)))
    .limit(1);
  return row ?? null;
}

// Logs and versions go with the project (cascade).
export async function removeDemo(ownerId: string): Promise<boolean> {
  const existing = await findDemo(ownerId);
  if (!existing) return false;
  await getDb().delete(projects).where(eq(projects.id, existing.id));
  return true;
}

export async function seedDemo(
  ownerId: string,
  userId: string,
  { reset = false, usage = false, now = new Date() }: { reset?: boolean; usage?: boolean; now?: Date } = {}
): Promise<SeedResult> {
  if (reset) await removeDemo(ownerId);
  const existing = await findDemo(ownerId);
  if (existing) return { status: "exists", projectId: existing.id };

  const logs = buildDemoLogs(now);
  const projectId = await getDb().transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({ ...DEMO_PROJECT, ownerId, createdBy: userId })
      .returning({ id: projects.id });

    for (const log of logs) {
      const [row] = await tx
        .insert(shipLogs)
        .values({
          projectId: project.id,
          ownerId,
          createdBy: userId,
          title: log.title,
          content: log.content,
          periodStart: log.periodStart,
          periodEnd: log.periodEnd,
          template: DEMO_PROJECT.template,
          provider: "demo",
          model: "demo",
          status: "ready",
          sourceSnapshot: log.snapshot,
          pinned: log.pinned,
          createdAt: log.createdAt,
        })
        .returning({ id: shipLogs.id });
      if (log.previousContent) {
        await tx.insert(shipLogVersions).values({ logId: row.id, content: log.previousContent, createdBy: userId });
      }
    }

    // Counts against the monthly limit, so it is opt-in.
    if (usage) {
      await tx
        .insert(usageCounters)
        .values({ ownerId, period: now.toISOString().slice(0, 7), kind: "byok", count: 2 })
        .onConflictDoUpdate({
          target: [usageCounters.ownerId, usageCounters.period, usageCounters.kind],
          set: { count: sql`${usageCounters.count} + 2` },
        });
    }
    return project.id;
  });
  return { status: "created", projectId };
}
