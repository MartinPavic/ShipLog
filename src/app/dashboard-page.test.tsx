import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

try {
  process.loadEnvFile(".env.local");
} catch {}

const rand = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
type Who = { userId: string; orgId: string | null; ownerId: string; orgRole: string | null };
const fresh: Who = { userId: `test_u_${rand()}`, orgId: null, ownerId: `test_o_${rand()}`, orgRole: null };
const pro: Who = { userId: `test_u_${rand()}`, orgId: null, ownerId: `test_o_${rand()}`, orgRole: null };
const member: Who = { userId: `test_u_${rand()}`, orgId: "org_x", ownerId: `org_test_${rand()}`, orgRole: "org:member" };
let current: Who = fresh;
let cookieProject: string | undefined;

vi.mock("@clerk/nextjs/server", () => ({
  currentUser: async () => ({ firstName: "Martin" }),
  auth: async () => ({}),
  clerkClient: async () => ({}),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "shiplog_project" && cookieProject ? { value: cookieProject } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => "/dashboard",
  redirect: () => {
    throw new Error("unexpected redirect");
  },
}));
vi.mock("@/lib/owner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/owner")>()),
  getOwner: async () => current,
}));

describe.skipIf(!process.env.DATABASE_URL)("dashboard page (database)", () => {
  const ids: Record<string, string> = {};
  let savedKey: string | undefined;

  async function render(search: { success?: string; canceled?: string } = {}) {
    const { default: Page } = await import("@/app/dashboard/page");
    return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(search) }));
  }

  beforeAll(async () => {
    savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const { getDb } = await import("@/db");
    const { aiCredentials, billingAccounts, shipLogs } = await import("@/db/schema");
    const { saveGithubConnection } = await import("@/lib/github");
    const { encrypt } = await import("@/lib/crypto");
    const { createProject } = await import("@/lib/projects");
    const { createProjectSchema } = await import("@/lib/validation");
    const db = getDb();

    await saveGithubConnection(pro.userId, { login: "dev", token: "t", scopes: "repo" });
    await db.insert(billingAccounts).values({ ownerId: pro.ownerId, plan: "pro", status: "active" });
    await db.insert(aiCredentials).values({ ownerId: pro.ownerId, provider: "openai", encryptedKey: encrypt("sk"), last4: "x" });
    const alpha = await createProject(pro, createProjectSchema.parse({ name: "Alpha site" }), 5);
    const beta = await createProject(pro, createProjectSchema.parse({ name: "Beta api" }), 5);
    ids.alpha = alpha.id;
    ids.beta = beta.id;
    const now = Date.now();
    await db.insert(shipLogs).values(
      [
        [alpha.id, "Alpha weekly", 2 * 60 * 60 * 1000, "ready"],
        [beta.id, "Beta weekly", 3 * 24 * 60 * 60 * 1000, "ready"],
        [beta.id, "Broken run", 4 * 60 * 60 * 1000, "failed"],
      ].map(([projectId, title, age, status]) => ({
        projectId: projectId as string,
        ownerId: pro.ownerId,
        createdBy: pro.userId,
        title: title as string,
        content: "x",
        periodStart: new Date(now - (age as number)),
        periodEnd: new Date(now - (age as number)),
        template: "weekly_update",
        status: status as "ready" | "failed",
        createdAt: new Date(now - (age as number)),
      }))
    );

    await createProject(member, createProjectSchema.parse({ name: "Org project" }), 5);
  });

  afterAll(async () => {
    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
    const { inArray } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const { aiCredentials, billingAccounts, githubConnections, projects } = await import("@/db/schema");
    const db = getDb();
    const owners = [fresh.ownerId, pro.ownerId, member.ownerId];
    await db.delete(projects).where(inArray(projects.ownerId, owners));
    await db.delete(aiCredentials).where(inArray(aiCredentials.ownerId, owners));
    await db.delete(billingAccounts).where(inArray(billingAccounts.ownerId, owners));
    await db.delete(githubConnections).where(inArray(githubConnections.userId, [pro.userId]));
  });

  it("guides a brand-new free account through setup", async () => {
    current = fresh;
    const html = await render();
    expect(html).toContain("Welcome back, Martin");
    expect(html).toContain(">Free<");
    expect(html).toContain("Upgrade to Pro");
    expect(html).toContain("Get started");
    expect(html).toContain("0 of 4 steps done");
    expect(html).toContain('href="/dashboard/settings"');
    expect(html).toContain("Nothing generated yet.");
    expect(html).not.toContain("Quick generate");
    expect(html).toContain("Never");
    expect(html).toContain("0 / 5 generations this month");
    expect(html).toContain("of 1 on your plan");
  });

  it("shows stats, recent logs, plan and a quick generator for an active Pro account", async () => {
    current = pro;
    const html = await render();
    expect(html).toContain(">Pro<");
    expect(html).toContain("Manage billing");
    expect(html).not.toContain("Upgrade to Pro");
    expect(html).not.toContain("Get started"); // onboarding is complete

    expect(html).toContain("Logs this month");
    expect(html).toContain("0 generations this month"); // BYOK on Pro is unlimited; nothing used yet
    expect(html).toContain("Quick generate");
    expect(html).toContain("Alpha site");

    // Newest first, with project names, statuses and relative times.
    const order = ["Alpha weekly", "Broken run", "Beta weekly"].map((t) => html.indexOf(t));
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain("Failed");
    expect(html).toContain("2 hours ago");
    expect(html).toContain("3 days ago");
    expect(html).toContain(`/dashboard/projects/${ids.alpha}/logs/`);
  });

  it("preselects the project remembered in the cookie", async () => {
    current = pro;
    cookieProject = ids.beta;
    const html = await render();
    cookieProject = undefined;
    // The selected project's name is the picker's value; the generator belongs to it.
    expect(html).toMatch(/Project<\/span>[\s\S]*Beta api/);
  });

  it("shows checkout return messages", async () => {
    current = pro;
    expect(await render({ success: "true" })).toContain("You&#x27;re on Pro. Thanks for subscribing!");

    current = fresh;
    const pending = await render({ success: "true" });
    expect(pending).toContain("Your Pro plan activates in a moment");

    const canceled = await render({ canceled: "true" });
    expect(canceled).toContain("Checkout was canceled");
    expect(await render({ success: "true", canceled: "true" })).not.toContain("Checkout was canceled");
  });

  it("hides billing actions from non-admin members of an organization", async () => {
    current = member;
    const html = await render();
    expect(html).toContain("Quick generate");
    expect(html).not.toContain("Upgrade to Pro");
    expect(html).not.toContain("Manage billing");
  });
});
