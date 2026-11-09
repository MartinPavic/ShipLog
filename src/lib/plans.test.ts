import { describe, expect, it } from "vitest";
import { PLAN_LIMITS, limitsFor, planFromStatus } from "./plans";

describe("planFromStatus", () => {
  it.each(["active", "trialing"])("%s is pro", (status) => {
    expect(planFromStatus(status)).toBe("pro");
  });

  it.each(["canceled", "past_due", "unpaid", "incomplete", null, undefined])("%s is free", (status) => {
    expect(planFromStatus(status)).toBe("free");
  });
});

describe("PLAN_LIMITS", () => {
  it("free is BYOK only", () => {
    expect(PLAN_LIMITS.free.managedGenerationsPerMonth).toBe(0);
    expect(PLAN_LIMITS.free.byokGenerationsPerMonth).toBe(5);
  });
});

describe("limitsFor paid variants", () => {
  it("enforces the exact generation and project caps for each paid tier/mode", () => {
    expect(limitsFor("pro", "user_1", "byok")).toMatchObject({
      maxProjects: 5,
      byokGenerationsPerMonth: 50,
      managedGenerationsPerMonth: 0,
    });

    expect(limitsFor("pro", "user_1", "managed")).toMatchObject({
      maxProjects: 5,
      byokGenerationsPerMonth: 0,
      managedGenerationsPerMonth: 50,
    });

    expect(limitsFor("ultra", "user_1", "byok")).toMatchObject({
      maxProjects: Infinity,
      byokGenerationsPerMonth: Infinity,
      managedGenerationsPerMonth: 0,
    });

    expect(limitsFor("ultra", "user_1", "managed")).toMatchObject({
      maxProjects: Infinity,
      byokGenerationsPerMonth: 0,
      managedGenerationsPerMonth: 200,
    });
  });

  it("keeps paid feature booleans enabled for all paid variants", () => {
    for (const [plan, mode] of [
      ["pro", "byok"],
      ["pro", "managed"],
      ["ultra", "byok"],
      ["ultra", "managed"],
    ] as const) {
      expect(limitsFor(plan, "user_1", mode)).toMatchObject({
        managedAi: true,
        scheduling: true,
        delivery: true,
        pdfExport: true,
        teams: true,
      });
    }
  });
});
