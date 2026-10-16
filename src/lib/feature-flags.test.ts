import { afterEach, describe, expect, it, vi } from "vitest";
import { PLAN_LIMITS, assertFeatureEnabled, getPlan, limitsFor, planHighlights, requirePlanFeature } from "./plans";


const FLAGS = ["BILLING_ENABLED", "MANAGED_AI_ENABLED", "TEAMS_ENABLED", "SCHEDULING_ENABLED", "DELIVERY_ENABLED", "AI_PROVIDER"];
afterEach(() => {
  for (const name of FLAGS) delete process.env[name];
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
const set = (name: string, value: string) => {
  process.env[name] = value;
};

describe("limitsFor with feature flags", () => {
  it("returns the plan's limits untouched when everything is on", () => {
    expect(limitsFor("free", "user_1")).toBe(PLAN_LIMITS.free);
    expect(limitsFor("pro", "user_1")).toBe(PLAN_LIMITS.pro);
  });

  it("gives everyone unlimited use when billing is off, including organizations", () => {
    set("BILLING_ENABLED", "false");
    for (const owner of ["user_1", "org_1"]) {
      expect(limitsFor("free", owner)).toMatchObject({
        maxProjects: Infinity,
        byokGenerationsPerMonth: Infinity,
        managedGenerationsPerMonth: Infinity,
        visibleLogs: Infinity,
        pdfExport: true,
        teams: true,
      });
    }
  });

  it("switches individual capabilities off without touching the rest", () => {
    set("SCHEDULING_ENABLED", "false");
    set("DELIVERY_ENABLED", "false");
    expect(limitsFor("pro", "user_1")).toEqual({ ...PLAN_LIMITS.pro, scheduling: false, delivery: false });
    set("MANAGED_AI_ENABLED", "false");
    set("TEAMS_ENABLED", "false");
    expect(limitsFor("pro", "user_1")).toMatchObject({ managedAi: false, teams: false, pdfExport: true });
  });

  it("never grants a capability the plan doesn't have", () => {
    set("TEAMS_ENABLED", "true");
    expect(limitsFor("free", "user_1")).toMatchObject({ teams: false, scheduling: false, delivery: false, managedAi: false });
  });

  it("keeps the Free organization lockout while billing is on", () => {
    expect(limitsFor("free", "org_1")).toMatchObject({ maxProjects: 0, byokGenerationsPerMonth: 0 });
  });
});

describe("getPlan", () => {
  it("is pro without a database lookup when billing is off", async () => {
    set("BILLING_ENABLED", "false");
    await expect(getPlan("anything")).resolves.toBe("pro");
  });
});

describe("assertFeatureEnabled and requirePlanFeature", () => {
  it("throw a FEATURE_DISABLED error for a feature that is off", async () => {
    set("BILLING_ENABLED", "false");
    set("DELIVERY_ENABLED", "false");
    expect(() => assertFeatureEnabled("delivery")).toThrowError(expect.objectContaining({ status: 404, code: "FEATURE_DISABLED" }));
    expect(() => assertFeatureEnabled("scheduling")).not.toThrow();
    await expect(requirePlanFeature("u", "delivery")).rejects.toMatchObject({
      status: 403,
      code: "FEATURE_DISABLED",
      message: expect.stringContaining("isn't enabled on this deployment"),
    });
  });

  it("let every plan feature through when billing is off", async () => {
    set("BILLING_ENABLED", "false");
    for (const feature of ["delivery", "scheduling", "pdfExport", "teams"] as const) {
      await expect(requirePlanFeature("u", feature)).resolves.toBeUndefined();
    }
  });
});

describe("planHighlights", () => {
  it("is derived from the enforced limits", () => {
    expect(planHighlights("free")).toEqual([
      "1 project",
      "5 generations / month with your own AI key",
      "10 newest logs per project",
      "Share links and public changelog",
    ]);
    const pro = planHighlights("pro");
    expect(pro).toContain("200 managed-AI generations / month");
    expect(pro).toContain("Teams with organizations");
    expect(pro).toContain("PDF export");
  });

  it("stops advertising features that are switched off", () => {
    set("MANAGED_AI_ENABLED", "false");
    set("TEAMS_ENABLED", "false");
    set("SCHEDULING_ENABLED", "false");
    set("DELIVERY_ENABLED", "false");
    const pro = planHighlights("pro").join("\n");
    expect(pro).not.toMatch(/managed|Teams|Scheduled/);
    expect(pro).toContain("Full history");
  });
});
