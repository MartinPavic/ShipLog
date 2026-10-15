import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

try {
  process.loadEnvFile(".env.local");
} catch {}

type Who = { userId: string; orgId: string | null; ownerId: string; orgRole: string | null };
let current: Who;

vi.mock("@clerk/nextjs", () => ({
  UserButton: () => <i data-test="user-button" />,
  OrganizationSwitcher: (props: Record<string, unknown>) => (
    <i
      data-test="org-switcher"
      data-hide-personal={String(props.hidePersonal)}
      data-after-select={String(props.afterSelectOrganizationUrl)}
      data-after-personal={String(props.afterSelectPersonalUrl)}
      data-after-create={String(props.afterCreateOrganizationUrl)}
    />
  ),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: current.userId }),
  currentUser: async () => ({ firstName: "Pat" }),
  clerkClient: async () => ({}),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
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

const rand = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const mk = (userId: string, orgId: string | null, role: string | null): Who => ({ userId, orgId, ownerId: orgId ?? userId, orgRole: role });
const proOrg = `org_test_${rand()}`;
const freeOrg = `org_test_${rand()}`;
const personal = mk(`test_u_${rand()}`, null, null);
const proAdmin = mk(`test_u_${rand()}`, proOrg, "org:admin");
const freeAdmin = mk(`test_u_${rand()}`, freeOrg, "org:admin");
const freeMember = mk(`test_u_${rand()}`, freeOrg, "org:member");
const proMember = mk(`test_u_${rand()}`, proOrg, "org:member");

describe.skipIf(!process.env.DATABASE_URL)("team workspace UI (database)", () => {
  async function layout(who: Who) {
    current = who;
    const { default: Layout } = await import("@/app/dashboard/layout");
    return renderToStaticMarkup(await Layout({ children: <p>page content</p> }));
  }
  async function settings(who: Who) {
    current = who;
    const { default: Page } = await import("@/app/dashboard/settings/page");
    return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  }
  async function projects(who: Who) {
    current = who;
    const { default: Page } = await import("@/app/dashboard/projects/page");
    return renderToStaticMarkup(await Page());
  }

  beforeAll(async () => {
    const { getDb } = await import("@/db");
    const { billingAccounts } = await import("@/db/schema");
    await getDb().insert(billingAccounts).values({ ownerId: proOrg, plan: "pro", status: "active" });
  });

  afterAll(async () => {
    const { inArray } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const { billingAccounts, projects } = await import("@/db/schema");
    await getDb().delete(billingAccounts).where(inArray(billingAccounts.ownerId, [proOrg, freeOrg]));
    await getDb().delete(projects).where(inArray(projects.ownerId, [proOrg, freeOrg, personal.ownerId]));
  });

  describe("header", () => {
    it("offers the organization switcher with the personal workspace as an option", async () => {
      const html = await layout(personal);
      expect(html).toContain('data-test="org-switcher"');
      expect(html).toContain('data-hide-personal="false"');
      expect(html).toContain('data-after-select="/dashboard"');
      expect(html).toContain('data-after-personal="/dashboard"');
      expect(html).toContain('data-after-create="/dashboard"');
      expect(html).toContain("page content");
    });

    it("hides the chrome when printing", async () => {
      expect(await layout(personal)).toContain("print:hidden");
    });

    it("shows no plan notice in personal or Pro workspaces", async () => {
      expect(await layout(personal)).not.toContain("Teams are a Pro feature");
      expect(await layout(proAdmin)).not.toContain("Teams are a Pro feature");
    });

    it("tells Free organizations what is missing, with an upgrade path for admins only", async () => {
      const adminHtml = await layout(freeAdmin);
      expect(adminHtml).toContain("This organization is on the Free plan");
      expect(adminHtml).toContain("upgrade in Settings");
      expect(adminHtml).toContain('href="/dashboard/settings"');

      const memberHtml = await layout(freeMember);
      expect(memberHtml).toContain("This organization is on the Free plan");
      expect(memberHtml).toContain("ask an admin to upgrade");
      expect(memberHtml).not.toContain("upgrade in Settings");
    });
  });

  describe("settings", () => {
    it("explains shared and personal settings in organization workspaces only", async () => {
      const org = await settings(proAdmin);
      expect(org).toContain("You are in an organization workspace");
      expect(org).toContain("flat per organization, not per member");
      expect(org).toContain("each member connects their own");
      expect(await settings(personal)).not.toContain("organization workspace");
    });

    it("lets admins manage billing and credentials, and members only view them", async () => {
      const admin = await settings(freeAdmin);
      expect(admin).toContain("Upgrade to Pro");
      expect(admin).not.toContain("Only organization admins can");

      const member = await settings(proMember);
      expect(member).toContain("Only organization admins can manage billing.");
      expect(member).toContain("Only organization admins can change AI credentials.");
      expect(member).not.toContain("Manage billing");
      expect(member).not.toContain("Upgrade to Pro");
    });
  });

  describe("projects page", () => {
    it("explains that Free organizations need Pro, and who can upgrade", async () => {
      const admin = await projects(freeAdmin);
      expect(admin).toContain("Teams are a Pro feature");
      expect(admin).toContain("Upgrade to Pro");
      expect(admin).not.toContain("New project");

      const member = await projects(freeMember);
      expect(member).toContain("Teams are a Pro feature");
      expect(member).toContain("Ask an organization admin to upgrade.");
      expect(member).not.toContain("Upgrade to Pro —");
    });

    it("lets Pro organizations and personal workspaces create projects", async () => {
      expect(await projects(proMember)).toContain("New project");
      expect(await projects(personal)).toContain("New project");
    });
  });
});
