import { describe, expect, it } from "vitest";
import { asActivity, formatActivity, isActivityEmpty } from "../../src/lib/github-activity";
import { buildDemoLogs, DEMO_PROJECT, DEMO_WEEKS } from "./demo-data";

const now = new Date("2026-06-15T12:00:00Z");
const logs = buildDemoLogs(now);

describe("buildDemoLogs", () => {
  it("creates one log per week, oldest first, ending now", () => {
    expect(logs).toHaveLength(DEMO_WEEKS);
    expect(logs.at(-1)!.periodEnd).toEqual(now);
    for (let i = 1; i < logs.length; i++) {
      expect(logs[i].periodEnd.getTime() - logs[i - 1].periodEnd.getTime()).toBe(7 * 24 * 3600 * 1000);
    }
    for (const log of logs) expect(log.periodEnd.getTime() - log.periodStart.getTime()).toBe(7 * 24 * 3600 * 1000);
  });

  it("is deterministic for a given moment", () => {
    expect(buildDemoLogs(now)).toEqual(logs);
  });

  it("pins only the newest log and gives it an earlier draft", () => {
    expect(logs.filter((l) => l.pinned)).toEqual([logs.at(-1)]);
    expect(logs.filter((l) => l.previousContent)).toEqual([logs.at(-1)]);
  });

  it("produces readable titles and Markdown without placeholders", () => {
    for (const log of logs) {
      expect(log.title.length).toBeGreaterThan(5);
      expect(log.content).toMatch(/^## Shipped/);
      expect(log.content).not.toMatch(/undefined|\[object/);
    }
  });

  it("carries a valid source snapshot whose items fall inside the period and match the text", () => {
    for (const log of logs) {
      const activity = asActivity(log.snapshot);
      expect(activity).not.toBeNull();
      expect(isActivityEmpty(activity!)).toBe(false);
      expect(formatActivity(activity!)).toContain(activity!.repos[0].repo);
      for (const pr of activity!.repos[0].pullRequests) {
        const merged = new Date(pr.mergedAt).getTime();
        expect(merged).toBeGreaterThanOrEqual(log.periodStart.getTime());
        expect(merged).toBeLessThanOrEqual(log.periodEnd.getTime());
        expect(log.content).toContain(`#${pr.number}`);
      }
    }
  });

  it("uses issue and pull request numbers that never repeat across weeks", () => {
    const numbers = logs.flatMap((l) => asActivity(l.snapshot)!.repos[0].pullRequests.map((p) => p.number));
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe("DEMO_PROJECT", () => {
  it("is a plain weekly-update project on an obviously fictional repository", () => {
    expect(DEMO_PROJECT).toMatchObject({ template: "weekly_update", slug: "demo-project", repos: [{ fullName: "acme/web-app" }] });
  });
});
