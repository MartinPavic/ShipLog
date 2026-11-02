import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "./dashboard/page";

const state = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  billing: true,
  admin: true,
  plan: "pro" as "free" | "pro",
  projects: [
    { id: "alpha", name: "Alpha", defaultPeriodDays: 7, template: "weekly_update" },
    { id: "beta", name: "Beta", defaultPeriodDays: 14, template: "client_report" },
  ],
  github: true,
  canGenerate: true,
  complete: true,
}));
vi.mock("@clerk/nextjs/server", () => ({ currentUser: async () => ({ firstName: "Alex" }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined }) }));
vi.mock("@/env", () => ({ features: () => ({ billing: state.billing }) }));
vi.mock("@/lib/owner", () => ({ getOwner: async () => ({ ownerId: "owner" }), isAdmin: () => state.admin }));
vi.mock("@/lib/plans", () => ({ limitsFor: () => ({ maxProjects: 5 }) }));
vi.mock("@/lib/templates", () => ({ listTemplates: async () => [] }));
vi.mock("@/components/quick-generate", () => ({
  QuickGenerate: ({ initialProjectId, setupMessage }: { initialProjectId: string; setupMessage: string | null }) => <div data-generator={initialProjectId}>{setupMessage}</div>,
}));
vi.mock("@/components/onboarding-checklist", () => ({ OnboardingChecklist: () => <div>Get started</div> }));
vi.mock("@/components/upgrade-button", () => ({
  ManageBillingButton: () => <button>Manage billing</button>,
  UpgradeButton: () => <button>Upgrade to Pro</button>,
}));
vi.mock("@/lib/dashboard", () => ({ getDashboardData: async () => ({
  plan: state.plan,
  projects: state.projects,
  stats: { logsThisMonth: 3, projectCount: state.projects.length, lastGeneratedAt: null },
  usage: { used: 3, limit: 50 },
  setup: { github: state.github, canGenerate: state.canGenerate },
  onboarding: { complete: state.complete, steps: [], next: null },
  recentLogs: [
    { id: "ready", projectId: "alpha", title: "Ready update", projectName: "Alpha", status: "ready", createdAt: new Date("2026-10-29T10:00:00Z") },
    { id: "failed", projectId: "beta", title: "Failed update", projectName: "Beta", status: "failed", createdAt: new Date("2026-10-28T10:00:00Z") },
    { id: "running", projectId: "alpha", title: "Running update", projectName: "Alpha", status: "generating", createdAt: new Date("2026-10-27T10:00:00Z") },
  ],
}) }));

const render = async (search: { success?: string; canceled?: string } = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(search) }));
beforeEach(() => Object.assign(state, {
  cookie: undefined, billing: true, admin: true, plan: "pro", github: true, canGenerate: true, complete: true,
  projects: [
    { id: "alpha", name: "Alpha", defaultPeriodDays: 7, template: "weekly_update" },
    { id: "beta", name: "Beta", defaultPeriodDays: 14, template: "client_report" },
  ],
}));

describe("dashboard workflow", () => {
  it("puts generation first, recent reports second, and compact account information last", async () => {
    const html = await render();
    expect(html).toContain("Your reporting workspace");
    expect(html.indexOf("Quick generate")).toBeLessThan(html.indexOf("Recent reports"));
    expect(html.indexOf("Recent reports")).toBeLessThan(html.indexOf('aria-label="Account usage"'));
    expect(html).not.toContain("Last generated");
    expect(html.match(/generations this month/g)).toHaveLength(1);
  });

  it("selects only available projects from the remembered cookie", async () => {
    state.cookie = "beta";
    expect(await render()).toContain('data-generator="beta"');
    state.cookie = "unavailable";
    expect(await render()).toContain('data-generator="alpha"');
  });

  it("preserves onboarding and a project creation path with no projects", async () => {
    state.projects = [];
    state.complete = false;
    const html = await render();
    expect(html).toContain("Get started");
    expect(html).toContain('href="/dashboard/projects"');
    expect(html).not.toContain("data-generator");
  });

  it("preserves GitHub and AI setup blockers", async () => {
    state.github = false;
    expect(await render()).toContain("Connect GitHub first.");
    state.github = true;
    state.canGenerate = false;
    expect(await render()).toContain("Add an AI API key first.");
  });

  it("preserves checkout feedback and admin-only billing actions", async () => {
    expect(await render({ success: "true" })).toContain("Thanks for subscribing!");
    expect(await render({ canceled: "true" })).toContain("Checkout was canceled");
    expect(await render({ success: "true", canceled: "true" })).not.toContain("Checkout was canceled");
    state.plan = "free";
    expect(await render({ success: "true" })).toContain("Your Pro plan activates in a moment");
    expect(await render()).toContain("Upgrade to Pro");
    state.admin = false;
    expect(await render()).not.toContain("Upgrade to Pro");
    state.billing = false;
    expect(await render()).not.toContain(">Free<");
  });

  it("only offers review and sharing for successful recent reports", async () => {
    const html = await render();
    expect(html.match(/Review and share/g)).toHaveLength(1);
    expect(html).toContain('href="/dashboard/projects/alpha/logs/ready"');
    expect(html).toContain('href="/dashboard/projects/beta/logs/failed"');
    expect(html).toContain("Failed");
    expect(html).toContain("Generating");
  });
});