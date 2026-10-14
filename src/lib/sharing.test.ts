import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

try {
  process.loadEnvFile(".env.local");
} catch {}

const rand = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const runId = rand();
const owner = { userId: `test_u_${rand()}`, orgId: null, ownerId: `test_o_${rand()}`, orgRole: null };
const stranger = { userId: "test_u_x", orgId: null, ownerId: `test_o_${rand()}`, orgRole: null };
let current = owner;

vi.mock("@/lib/owner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/owner")>()),
  getOwner: async () => current,
}));

type Project = Awaited<ReturnType<typeof import("./projects").createProject>>;

describe.skipIf(!process.env.DATABASE_URL)("sharing, exports and public changelog (database)", () => {
  let project: Project;
  const tokens = new Set<string>();
  let ownerSlug: string;

  async function insertLog(over: Record<string, unknown> = {}) {
    const { getDb } = await import("@/db");
    const { shipLogs } = await import("@/db/schema");
    const [row] = await getDb()
      .insert(shipLogs)
      .values({
        projectId: project.id,
        ownerId: owner.ownerId,
        createdBy: owner.userId,
        title: "Weekly update: Oct 6 – Oct 13, 2026",
        content: "# Shipped\n\n- **Search** is live\n- [PR](https://github.com/o/r/pull/1)",
        periodStart: new Date("2026-10-06"),
        periodEnd: new Date("2026-10-13"),
        template: "weekly_update",
        status: "ready",
        ...over,
      })
      .returning();
    return row;
  }

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

  async function share(id: string, body: unknown = {}) {
    const { POST } = await import("@/app/api/logs/[id]/share/route");
    return POST(new Request("http://x", json(body)), ctx(id));
  }
  async function unlock(token: string, password: string, ip = "198.51.100.1") {
    const { POST } = await import("@/app/api/share/[token]/unlock/route");
    return POST(
      new Request("http://x", { ...json({ password }), headers: { "x-forwarded-for": ip } }),
      { params: Promise.resolve({ token }) }
    );
  }
  async function exportLog(id: string, query = "") {
    const { GET } = await import("@/app/api/logs/[id]/export/route");
    return GET(new Request(`http://x/api/logs/${id}/export${query}`), ctx(id));
  }

  beforeAll(async () => {
    const { createProject } = await import("./projects");
    const { createProjectSchema } = await import("./validation");
    const { ensureOwnerSlug } = await import("./owner-profile");
    project = await createProject(owner, createProjectSchema.parse({ name: "Public", isPublicChangelog: true }), 5);
    ownerSlug = await ensureOwnerSlug(owner, `t${rand()}`);
  });

  afterAll(async () => {
    const { eq, like, inArray, or } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const { ownerProfiles, projects, rateLimits } = await import("@/db/schema");
    const db = getDb();
    await db.delete(projects).where(inArray(projects.ownerId, [owner.ownerId, stranger.ownerId]));
    await db.delete(ownerProfiles).where(eq(ownerProfiles.ownerId, owner.ownerId));
    const keys = [...tokens].map((t) => like(rateLimits.key, `unlock:${t}%`));
    await db.delete(rateLimits).where(or(like(rateLimits.key, `test:${runId}:%`), ...keys));
  });

  describe("share links", () => {
    it("creates, updates, rotates and removes a link without leaking the password hash", async () => {
      const { getLog } = await import("./logs");
      const { getSharedLog } = await import("./public");
      const log = await insertLog();

      const created = await (await share(log.id)).json();
      expect(created.shareToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(created.url).toBe(`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/s/${created.shareToken}`);
      expect(created.hasPassword).toBe(false);
      tokens.add(created.shareToken);

      // Calling again keeps the same token.
      expect((await (await share(log.id)).json()).shareToken).toBe(created.shareToken);

      const withPassword = await (await share(log.id, { password: "x".repeat(8) })).json();
      expect(withPassword).toMatchObject({ shareToken: created.shareToken, hasPassword: true });
      const stored = await getLog(owner.ownerId, log.id);
      expect(stored).not.toHaveProperty("sharePasswordHash");
      expect(stored?.hasSharePassword).toBe(true);
      expect(JSON.stringify(withPassword)).not.toContain("scrypt");

      const row = await getSharedLog(created.shareToken);
      expect(row?.passwordHash).toMatch(/^scrypt\$/);
      expect(row?.passwordHash).not.toContain("x".repeat(8));

      // Omitting the password keeps it; null removes it.
      expect((await (await share(log.id, { rotate: false })).json()).hasPassword).toBe(true);
      expect((await (await share(log.id, { password: null })).json()).hasPassword).toBe(false);

      const rotated = await (await share(log.id, { rotate: true })).json();
      expect(rotated.shareToken).not.toBe(created.shareToken);
      tokens.add(rotated.shareToken);
      expect(await getSharedLog(created.shareToken)).toBeNull();
      expect(await getSharedLog(rotated.shareToken)).toMatchObject({ id: log.id, projectName: "Public" });

      const { DELETE } = await import("@/app/api/logs/[id]/share/route");
      expect((await (await DELETE(new Request("http://x", { method: "DELETE" }), ctx(log.id))).json()).url).toBeNull();
      expect(await getSharedLog(rotated.shareToken)).toBeNull();
    });

    it("only exposes public fields", async () => {
      const { getSharedLog } = await import("./public");
      const log = await insertLog({ sourceSnapshot: { secret: "internal" } });
      const { shareToken } = await (await share(log.id)).json();
      tokens.add(shareToken);
      const shared = await getSharedLog(shareToken);
      expect(Object.keys(shared!).sort()).toEqual(
        ["content", "createdAt", "id", "passwordHash", "periodEnd", "periodStart", "projectName", "title"].sort()
      );
    });

    it("validates input, only shares finished logs and enforces tenancy", async () => {
      const generating = await insertLog({ status: "generating" });
      expect((await share(generating.id)).status).toBe(400);

      const log = await insertLog();
      const short = await share(log.id, { password: "abc" });
      expect(short.status).toBe(400);
      expect(await short.json()).toMatchObject({ code: "VALIDATION" });

      current = stranger;
      expect((await share(log.id)).status).toBe(404);
      expect((await share("not-a-uuid")).status).toBe(404);
      current = owner;
    });

    it("hides shared logs of archived projects and malformed tokens", async () => {
      const { getSharedLog } = await import("./public");
      const { createProject, archiveProject } = await import("./projects");
      const { createProjectSchema } = await import("./validation");
      const other = await createProject(owner, createProjectSchema.parse({ name: "Soon archived" }), 10);
      const log = await insertLog({ projectId: other.id });
      const { shareToken } = await (await share(log.id)).json();
      tokens.add(shareToken);
      expect(await getSharedLog(shareToken)).not.toBeNull();
      await archiveProject(owner.ownerId, other.id);
      expect(await getSharedLog(shareToken)).toBeNull();
      expect(await getSharedLog("short")).toBeNull();
    });
  });

  describe("password unlock", () => {
    it("sets a scoped, signed cookie for the right password only", async () => {
      const { verifyAccess, ACCESS_COOKIE } = await import("./share");
      const { getSharedLog } = await import("./public");
      const log = await insertLog();
      const { shareToken } = await (await share(log.id, { password: "open sesame" })).json();
      tokens.add(shareToken);

      const bad = await unlock(shareToken, "nope", "203.0.113.10");
      expect(bad.status).toBe(401);
      expect(await bad.json()).toMatchObject({ code: "BAD_PASSWORD" });
      expect(bad.headers.get("set-cookie")).toBeNull();

      const ok = await unlock(shareToken, "open sesame", "203.0.113.11");
      expect(ok.status).toBe(200);
      const setCookie = ok.headers.get("set-cookie")!;
      expect(setCookie).toContain(`${ACCESS_COOKIE}=`);
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=lax/i);
      expect(setCookie).toContain(`Path=/s/${shareToken}`);

      const value = decodeURIComponent(new RegExp(`${ACCESS_COOKIE}=([^;]+)`).exec(setCookie)![1]);
      const row = (await getSharedLog(shareToken))!;
      expect(verifyAccess(value, shareToken, row.passwordHash!)).toBe(true);

      // Changing the password revokes cookies issued earlier.
      await share(log.id, { password: "a new password" });
      const changed = (await getSharedLog(shareToken))!;
      expect(verifyAccess(value, shareToken, changed.passwordHash!)).toBe(false);
    });

    it("returns 404 for unprotected, unknown and malformed links", async () => {
      const log = await insertLog();
      const { shareToken } = await (await share(log.id)).json();
      tokens.add(shareToken);
      expect((await unlock(shareToken, "anything", "203.0.113.20")).status).toBe(404);
      expect((await unlock("a".repeat(43), "anything", "203.0.113.21")).status).toBe(404);
      tokens.add("a".repeat(43));
      expect((await unlock("bad-token", "anything", "203.0.113.22")).status).toBe(404);
    });

    it("rate limits repeated guesses per link and address", async () => {
      const log = await insertLog();
      const { shareToken } = await (await share(log.id, { password: "correct password" })).json();
      tokens.add(shareToken);

      for (let i = 0; i < 10; i++) {
        expect((await unlock(shareToken, `guess-${i}`, "192.0.2.77")).status).toBe(401);
      }
      const blocked = await unlock(shareToken, "correct password", "192.0.2.77");
      expect(blocked.status).toBe(429);
      expect(await blocked.json()).toMatchObject({ code: "RATE_LIMITED" });

      // Another address is unaffected.
      expect((await unlock(shareToken, "correct password", "192.0.2.78")).status).toBe(200);
    });
  });

  describe("exports", () => {
    it("serves markdown, html and slack as plain text", async () => {
      const log = await insertLog();

      const md = await exportLog(log.id, "?format=markdown");
      expect(md.headers.get("content-type")).toContain("text/plain");
      expect(md.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await md.text()).toBe(log.content);

      const html = await exportLog(log.id, "?format=html");
      expect(html.headers.get("content-type")).toContain("text/plain");
      const htmlBody = await html.text();
      expect(htmlBody).toContain("<h1>Shipped</h1>");
      expect(htmlBody).toContain("<strong>Search</strong>");

      const slack = await (await exportLog(log.id, "?format=slack")).text();
      expect(slack).toBe("*Shipped*\n\n• *Search* is live\n• <https://github.com/o/r/pull/1|PR>");
    });

    it("downloads with a safe filename and defaults to markdown", async () => {
      const log = await insertLog();
      const res = await exportLog(log.id, "?download=1");
      expect(res.headers.get("content-disposition")).toBe(
        'attachment; filename="weekly-update-oct-6-oct-13-2026.md"'
      );
      const slack = await exportLog(log.id, "?format=slack&download=1");
      expect(slack.headers.get("content-disposition")).toContain(".txt");
    });

    it("rejects unknown formats and other tenants", async () => {
      const log = await insertLog();
      expect((await exportLog(log.id, "?format=docx")).status).toBe(400);
      current = stranger;
      expect((await exportLog(log.id)).status).toBe(404);
      current = owner;
    });
  });

  describe("public changelog", () => {
    it("lists only published, finished logs newest first", async () => {
      const { getPublicChangelog } = await import("./public");
      const { getLog, updateLog } = await import("./logs");
      const { createProject } = await import("./projects");
      const { createProjectSchema } = await import("./validation");
      const fresh = await createProject(owner, createProjectSchema.parse({ name: "Changelog", isPublicChangelog: true }), 10);

      const older = await insertLog({ projectId: fresh.id, title: "Older" });
      const newer = await insertLog({ projectId: fresh.id, title: "Newer" });
      const draft = await insertLog({ projectId: fresh.id, title: "Unpublished" });
      const failed = await insertLog({ projectId: fresh.id, title: "Failed", status: "failed" });

      await updateLog(owner.userId, (await getLog(owner.ownerId, older.id))!, { published: true });
      await new Promise((r) => setTimeout(r, 15));
      await updateLog(owner.userId, (await getLog(owner.ownerId, newer.id))!, { published: true });
      await expect(
        updateLog(owner.userId, (await getLog(owner.ownerId, failed.id))!, { published: true })
      ).rejects.toMatchObject({ status: 400 });

      const result = await getPublicChangelog(ownerSlug, fresh.slug, 1);
      expect(result?.project.name).toBe("Changelog");
      expect(result?.entries.map((e) => e.title)).toEqual(["Newer", "Older"]);
      expect(result?.total).toBe(2);
      expect(JSON.stringify(result)).not.toContain(draft.id);
      expect(Object.keys(result!.entries[0]).sort()).toEqual(
        ["content", "id", "periodEnd", "periodStart", "publishedAt", "title"].sort()
      );

      // Re-publishing keeps the original date; unpublishing removes the entry.
      const before = (await getLog(owner.ownerId, older.id))!.publishedAt;
      await updateLog(owner.userId, (await getLog(owner.ownerId, older.id))!, { published: true });
      expect((await getLog(owner.ownerId, older.id))!.publishedAt).toEqual(before);
      await updateLog(owner.userId, (await getLog(owner.ownerId, older.id))!, { published: false });
      expect((await getPublicChangelog(ownerSlug, fresh.slug, 1))?.entries.map((e) => e.title)).toEqual(["Newer"]);
    });

    it("is unavailable for private, archived, unknown and malformed addresses", async () => {
      const { getPublicChangelog } = await import("./public");
      const { createProject, updateProject, archiveProject } = await import("./projects");
      const { createProjectSchema } = await import("./validation");

      const priv = await createProject(owner, createProjectSchema.parse({ name: "Private one" }), 10);
      expect(await getPublicChangelog(ownerSlug, priv.slug, 1)).toBeNull();
      await updateProject(owner.ownerId, priv.id, { isPublicChangelog: true });
      expect(await getPublicChangelog(ownerSlug, priv.slug, 1)).not.toBeNull();
      await archiveProject(owner.ownerId, priv.id);
      expect(await getPublicChangelog(ownerSlug, priv.slug, 1)).toBeNull();

      expect(await getPublicChangelog("nobody", "public", 1)).toBeNull();
      expect(await getPublicChangelog("../etc", "passwd", 1)).toBeNull();
      expect(await getPublicChangelog("UPPER", "case", 1)).toBeNull();
    });

    it("creates one stable, unique owner handle", async () => {
      const { ensureOwnerSlug, getOwnerSlug } = await import("./owner-profile");
      expect(await ensureOwnerSlug(owner, "something else")).toBe(ownerSlug);
      expect(await getOwnerSlug(owner.ownerId)).toBe(ownerSlug);

      const other = await ensureOwnerSlug(stranger, ownerSlug);
      expect(other).not.toBe(ownerSlug);
      expect(other.startsWith(ownerSlug)).toBe(true);
      const { getDb } = await import("@/db");
      const { ownerProfiles } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      await getDb().delete(ownerProfiles).where(eq(ownerProfiles.ownerId, stranger.ownerId));
    });
  });

  describe("rate limiter", () => {
    it("allows up to the limit per key and window", async () => {
      const { hitRateLimit } = await import("./rate-limit");
      const key = `test:${runId}:${rand()}`;
      const results = [];
      for (let i = 0; i < 4; i++) results.push(await hitRateLimit(key, 3, 60_000));
      expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
      expect(results[0].remaining).toBe(2);
      expect(results[3].retryAfterSec).toBeGreaterThan(0);
      expect((await hitRateLimit(`test:${runId}:${rand()}`, 3, 60_000)).allowed).toBe(true);
    });

    it("is atomic under parallel hits", async () => {
      const { hitRateLimit } = await import("./rate-limit");
      const key = `test:${runId}:${rand()}`;
      const results = await Promise.all(Array.from({ length: 20 }, () => hitRateLimit(key, 5, 60_000)));
      expect(results.filter((r) => r.allowed)).toHaveLength(5);
    });
  });
});
