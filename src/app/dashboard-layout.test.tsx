import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Layout from "./dashboard/layout";

const state = vi.hoisted(() => ({ userId: "user", orgId: null as string | null, plan: "pro", admin: true, teams: true, listProjects: vi.fn(async () => []) }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: state.userId }) }));
vi.mock("@clerk/nextjs", () => ({
  UserButton: () => <span>Account controls</span>,
  OrganizationSwitcher: () => <span>Workspace controls</span>,
}));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("sign-in redirect"); } }));
vi.mock("@/components/brand", () => ({ Brand: () => <span>Shiplog</span> }));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => <span>Theme controls</span> }));
vi.mock("@/env", () => ({ features: () => ({ teams: state.teams }) }));
vi.mock("@/lib/owner", () => ({
  getOwner: async () => ({ ownerId: "owner", orgId: state.orgId }),
  isAdmin: () => state.admin,
}));
vi.mock("@/lib/plans", () => ({ getPlanLimits: async () => ({ plan: state.plan }) }));
vi.mock("@/lib/projects", () => ({ listProjects: state.listProjects }));

const render = async () => renderToStaticMarkup(await Layout({ children: <p>Dashboard content</p> }));
beforeEach(() => {
  Object.assign(state, { userId: "user", orgId: null, plan: "pro", admin: true, teams: true });
  vi.clearAllMocks();
});

describe("DashboardLayout", () => {
  it("removes the project picker while preserving navigation and account controls", async () => {
    const html = await render();
    expect(html).not.toContain('role="combobox"');
    expect(html).not.toContain("Select project");
    expect(state.listProjects).not.toHaveBeenCalled();
    for (const text of ["Dashboard", "Projects", "Templates", "Settings", "Workspace controls", "Theme controls", "Account controls"]) expect(html).toContain(text);
  });

  it("preserves free-organization notices and admin permissions", async () => {
    Object.assign(state, { orgId: "org", plan: "free", admin: false });
    expect(await render()).toContain("ask an admin to upgrade");
    state.admin = true;
    expect(await render()).toContain("upgrade in Settings");
  });

  it("hides workspace controls when teams are disabled", async () => {
    state.teams = false;
    expect(await render()).not.toContain("Workspace controls");
  });

  it("still redirects unauthenticated users", async () => {
    state.userId = "";
    await expect(render()).rejects.toThrow("sign-in redirect");
  });
});