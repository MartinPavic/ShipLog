import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  billing: true,
  admin: true,
  status: {
    plan: "free" as "free" | "pro" | "ultra",
    aiMode: "byok" as "byok" | "managed",
    usage: { used: 0, limit: 5 as number | null },
    github: null as { login: string } | null,
    gitlab: { instance: null as string | null, connection: null as { username: string } | null },
    ai: null as { provider: string; last4: string; model: string | null } | null,
    managedAi: false,
    demoAi: false,
    aiReady: true,
    canGenerate: true,
  },
}));

vi.mock("@/lib/owner", () => ({
  getOwner: async () => ({ ownerId: "test_owner", userId: "test_user", orgId: null, orgRole: null }),
  isAdmin: () => state.admin,
}));

vi.mock("@/lib/settings", () => ({
  getSetupStatus: async () => state.status,
}));

vi.mock("@/env", () => ({
  features: () => ({ billing: state.billing }),
}));

vi.mock("@/config/site", () => ({
  siteConfig: { name: "ShipLog" },
}));

vi.mock("@/components/settings-form", () => ({
  GithubCard: ({ login }: { login: string | null }) => <div>github:{login ?? "none"}</div>,
  GitLabCard: ({ username }: { username: string | null }) => <div>gitlab:{username ?? "none"}</div>,
  AiCard: () => <div>ai-card</div>,
}));

vi.mock("@/components/upgrade-button", () => ({
  UpgradeButton: () => <button>Upgrade button</button>,
  ManageBillingButton: () => <button>Manage billing button</button>,
}));

beforeEach(() => {
  state.billing = true;
  state.admin = true;
  state.status = {
    plan: "free",
    aiMode: "byok",
    usage: { used: 0, limit: 5 },
    github: null,
    gitlab: { instance: null, connection: null },
    ai: null,
    managedAi: false,
    demoAi: false,
    aiReady: true,
    canGenerate: true,
  };
});

async function render() {
  const { default: Page } = await import("@/app/dashboard/settings/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
}

describe("settings billing card", () => {
  it("shows Free/Pro/Ultra labels with locked AI mode and allowance", async () => {
    state.status = { ...state.status, plan: "free", aiMode: "byok", usage: { used: 2, limit: 5 } };
    const free = await render();
    expect(free).toContain("Billing");
    expect(free).toContain(">Free<");
    expect(free).toContain("AI mode: BYOK");
    expect(free).toContain("Allowance: 2 / 5 generations this month");

    state.status = { ...state.status, plan: "pro", aiMode: "managed", usage: { used: 8, limit: 50 } };
    const pro = await render();
    expect(pro).toContain(">Pro<");
    expect(pro).toContain("AI mode: Managed AI");
    expect(pro).toContain("Allowance: 8 / 50 generations this month");

    state.status = { ...state.status, plan: "ultra", aiMode: "byok", usage: { used: 13, limit: null } };
    const ultra = await render();
    expect(ultra).toContain(">Ultra<");
    expect(ultra).toContain("AI mode: BYOK");
    expect(ultra).toContain("Allowance: 13 / Unlimited generations this month");
  });

  it("warns when a managed subscription has no configured managed AI key", async () => {
    state.status = { ...state.status, plan: "pro", aiMode: "managed", usage: { used: 1, limit: 50 }, aiReady: false, managedAi: false };
    const html = await render();
    expect(html).toContain("Managed AI is unavailable on this deployment");
  });

  it("hides billing UI when billing is disabled", async () => {
    state.billing = false;
    const html = await render();
    expect(html).not.toContain("<h3 class=\"text-2xl font-semibold leading-none tracking-tight flex items-center gap-2\">Billing");
    expect(html).not.toContain("Manage billing button");
    expect(html).not.toContain("Upgrade button");
  });
});
