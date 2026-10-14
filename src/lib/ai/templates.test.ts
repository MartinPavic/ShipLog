import { describe, expect, it } from "vitest";
import {
  TEMPLATES,
  TEMPLATE_IDS,
  buildSystemPrompt,
  buildUserPrompt,
  defaultLogTitle,
  formatPeriod,
} from "./templates";

const start = new Date("2026-10-06T00:00:00Z");
const end = new Date("2026-10-13T00:00:00Z");

describe("templates", () => {
  it("defines instructions for every id", () => {
    for (const id of TEMPLATE_IDS) {
      expect(TEMPLATES[id].label).toBeTruthy();
      expect(TEMPLATES[id].instructions.length).toBeGreaterThan(40);
    }
  });
});

describe("buildSystemPrompt", () => {
  const base = { name: "Site", template: "changelog" as const };

  it("composes template, tone, audience and custom prompt", () => {
    const prompt = buildSystemPrompt({
      ...base,
      tone: "upbeat",
      audience: "customers",
      customPrompt: "Mention the roadmap.",
    });
    expect(prompt).toContain(TEMPLATES.changelog.instructions);
    expect(prompt).toContain("Tone: upbeat.");
    expect(prompt).toContain("Audience: customers.");
    expect(prompt).toContain("Mention the roadmap.");
    expect(prompt).toContain("untrusted data");
  });

  it("omits unset options", () => {
    const prompt = buildSystemPrompt(base);
    expect(prompt).not.toContain("Tone:");
    expect(prompt).not.toContain("Audience:");
    expect(prompt).not.toContain("Additional instructions");
  });
});

describe("prompts and titles", () => {
  it("formats the period", () => {
    expect(formatPeriod(start, end)).toBe("Oct 6 – Oct 13, 2026");
  });

  it("builds the user prompt with project context and activity", () => {
    const prompt = buildUserPrompt({ name: "Site", description: "Marketing site", template: "standup" }, "## o/r", start, end);
    expect(prompt).toContain("Project: Site");
    expect(prompt).toContain("About: Marketing site");
    expect(prompt).toContain("Period: Oct 6 – Oct 13, 2026");
    expect(prompt.endsWith("## o/r")).toBe(true);
  });

  it("titles logs by template and period", () => {
    expect(defaultLogTitle("weekly_update", start, end)).toBe("Weekly update: Oct 6 – Oct 13, 2026");
  });
});
