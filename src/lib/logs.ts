import { and, count, desc, eq, getTableColumns, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { shipLogVersions, shipLogs } from "@/db/schema";
import { ApiError } from "@/lib/api";
import type { PlanLimits } from "@/lib/plans";
import { createShareToken, hashPassword } from "@/lib/share";
import { uuidSchema, type LogListQuery } from "@/lib/validation";

const { sharePasswordHash: _omit, ...columns } = getTableColumns(shipLogs);
void _omit;

// The password hash never leaves the server; callers only learn whether one is set.
const publicColumns = {
  ...columns,
  hasSharePassword: sql<boolean>`${shipLogs.sharePasswordHash} is not null`,
};

export type ShipLog = Omit<typeof shipLogs.$inferSelect, "sharePasswordHash"> & { hasSharePassword: boolean };

const DAY_MS = 24 * 60 * 60 * 1000;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listLogs(
  ownerId: string,
  projectId: string,
  filters: LogListQuery,
  limits: Pick<PlanLimits, "visibleLogs">
) {
  const db = getDb();
  const base = and(eq(shipLogs.ownerId, ownerId), eq(shipLogs.projectId, projectId));
  const conditions = [base];

  if (Number.isFinite(limits.visibleLogs)) {
    const newest = db
      .select({ id: shipLogs.id })
      .from(shipLogs)
      .where(base)
      .orderBy(desc(shipLogs.createdAt))
      .limit(limits.visibleLogs);
    conditions.push(inArray(shipLogs.id, newest));
  }
  if (filters.q) {
    const pattern = `%${escapeLike(filters.q)}%`;
    conditions.push(or(ilike(shipLogs.title, pattern), ilike(shipLogs.content, pattern)));
  }
  if (filters.from) conditions.push(gte(shipLogs.createdAt, filters.from));
  if (filters.to) conditions.push(lt(shipLogs.createdAt, new Date(filters.to.getTime() + DAY_MS)));
  if (filters.pinned) conditions.push(eq(shipLogs.pinned, true));
  const where = and(...conditions);

  const [items, [{ total }], [{ projectTotal }]] = await Promise.all([
    db
      .select({
        id: shipLogs.id,
        title: shipLogs.title,
        status: shipLogs.status,
        pinned: shipLogs.pinned,
        template: shipLogs.template,
        periodStart: shipLogs.periodStart,
        periodEnd: shipLogs.periodEnd,
        createdAt: shipLogs.createdAt,
        excerpt: sql<string>`left(${shipLogs.content}, 240)`,
      })
      .from(shipLogs)
      .where(where)
      .orderBy(desc(shipLogs.pinned), desc(shipLogs.createdAt))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize),
    db.select({ total: count() }).from(shipLogs).where(where),
    db.select({ projectTotal: count() }).from(shipLogs).where(base),
  ]);

  const hidden = Number.isFinite(limits.visibleLogs) ? Math.max(0, projectTotal - limits.visibleLogs) : 0;
  return { items, total, page: filters.page, pageSize: filters.pageSize, hidden };
}

export async function getLog(ownerId: string, id: string): Promise<ShipLog | null> {
  if (!uuidSchema.safeParse(id).success) return null;
  const [row] = await getDb()
    .select(publicColumns)
    .from(shipLogs)
    .where(and(eq(shipLogs.id, id), eq(shipLogs.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}

export async function requireLog(ownerId: string, id: string): Promise<ShipLog> {
  const log = await getLog(ownerId, id);
  if (!log) throw new ApiError(404, "Log not found", "NOT_FOUND");
  return log;
}

// Free plans only see their newest N logs per project.
export async function assertLogVisible(log: ShipLog, limits: Pick<PlanLimits, "visibleLogs">) {
  if (!Number.isFinite(limits.visibleLogs)) return;
  const [{ newer }] = await getDb()
    .select({ newer: count() })
    .from(shipLogs)
    .where(and(eq(shipLogs.projectId, log.projectId), sql`${shipLogs.createdAt} > ${log.createdAt}`));
  if (newer >= limits.visibleLogs) {
    throw new ApiError(403, "This log is older than your plan's history. Upgrade to Pro to see it.", "LIMIT_REACHED");
  }
}

export async function updateLog(
  userId: string,
  log: ShipLog,
  patch: { title?: string; content?: string; pinned?: boolean; published?: boolean }
): Promise<ShipLog> {
  const { published, ...fields } = patch;
  if (published && log.status !== "ready") {
    throw new ApiError(400, "Only finished logs can be published.", "VALIDATION");
  }
  // Re-publishing keeps the original publish date.
  const publishedAt = published === undefined ? undefined : published ? (log.publishedAt ?? new Date()) : null;

  return getDb().transaction(async (tx) => {
    if (patch.content !== undefined && patch.content !== log.content) {
      await tx.insert(shipLogVersions).values({ logId: log.id, content: log.content, createdBy: userId });
    }
    const [row] = await tx
      .update(shipLogs)
      .set({ ...fields, ...(publishedAt !== undefined ? { publishedAt } : {}) })
      .where(eq(shipLogs.id, log.id))
      .returning(publicColumns);
    return row;
  });
}

// `password`: undefined keeps the current one, null/"" removes it, a string sets it.
export async function enableShare(
  log: ShipLog,
  opts: { password?: string | null; rotate?: boolean }
): Promise<ShipLog> {
  if (log.status !== "ready") throw new ApiError(400, "Only finished logs can be shared.", "VALIDATION");

  const set: { shareToken?: string; sharePasswordHash?: string | null } = {};
  if (!log.shareToken || opts.rotate) set.shareToken = createShareToken();
  if (opts.password !== undefined) set.sharePasswordHash = opts.password ? await hashPassword(opts.password) : null;
  if (Object.keys(set).length === 0) return log;

  const [row] = await getDb().update(shipLogs).set(set).where(eq(shipLogs.id, log.id)).returning(publicColumns);
  return row;
}

export async function disableShare(logId: string): Promise<void> {
  await getDb().update(shipLogs).set({ shareToken: null, sharePasswordHash: null }).where(eq(shipLogs.id, logId));
}

export async function deleteLog(ownerId: string, id: string): Promise<void> {
  const rows = await getDb()
    .delete(shipLogs)
    .where(and(eq(shipLogs.id, id), eq(shipLogs.ownerId, ownerId)))
    .returning({ id: shipLogs.id });
  if (rows.length === 0) throw new ApiError(404, "Log not found", "NOT_FOUND");
}

export async function listVersions(logId: string, limit = 20) {
  return getDb()
    .select()
    .from(shipLogVersions)
    .where(eq(shipLogVersions.logId, logId))
    .orderBy(desc(shipLogVersions.createdAt))
    .limit(limit);
}
