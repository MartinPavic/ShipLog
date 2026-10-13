import { describe, expect, it } from "vitest";
import { PLAN_LIMITS, planFromStatus } from "./plans";

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
