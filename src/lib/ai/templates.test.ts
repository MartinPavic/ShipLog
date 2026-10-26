import { describe, expect, it } from "vitest";
import {
  TEMPLATES,
  TEMPLATE_IDS,
  builtInTemplates,
  buildSystemPrompt,
  buildUserPrompt,
  defaultLogTitle,
  formatPeriod,
  isBuiltInTemplate,
  templateLabel,
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

  it("asks for plain-language, feature-level descriptions instead of commit titles", () => {
    const prompt = buildSystemPrompt(base);
    expect(prompt).toContain("plain language");
    expect(prompt).toContain("Never paste commit messages, pull request titles");
    expect(prompt).toContain("changed files and code excerpts");
  });

  it("uses the instructions of a custom template instead of a built-in one", () => {
    const prompt = buildSystemPrompt({ name: "Site", template: "3f1c2a52-0000-4000-8000-000000000000", instructions: "Write a haiku." });
    expect(prompt).toContain("Write a haiku.");
    expect(prompt).not.toContain(TEMPLATES.changelog.instructions);
  });
});

describe("template helpers", () => {
  it("lists every built-in template and recognises their ids", () => {
    expect(builtInTemplates().map((t) => t.id)).toEqual([...TEMPLATE_IDS]);
    expect(builtInTemplates().every((t) => t.builtIn)).toBe(true);
    expect(isBuiltInTemplate("standup")).toBe(true);
    expect(isBuiltInTemplate("3f1c2a52-0000-4000-8000-000000000000")).toBe(false);
  });

  it("labels deleted custom templates generically", () => {
    const custom = { id: "c1", label: "Monthly", description: "", instructions: "x", builtIn: false };
    expect(templateLabel([...builtInTemplates(), custom], "c1")).toBe("Monthly");
    expect(templateLabel(builtInTemplates(), "c1")).toBe("Custom template");
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
    expect(defaultLogTitle("Weekly update", start, end)).toBe("Weekly update: Oct 6 – Oct 13, 2026");
  });
});
