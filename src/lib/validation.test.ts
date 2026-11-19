import { describe, expect, it } from "vitest";
import {
  createChannelSchema,
  createProjectSchema,
  generateSchema,
  logListQuerySchema,
  repoNameSchema,
  sentryProjectsSchema,
  sentrySettingsSchema,
  templateInputSchema,
  updateChannelSchema,
  updateLogSchema,
  updateProjectSchema,
  updateTemplateSchema,
} from "./validation";

describe("repoNameSchema", () => {
  it("accepts owner/repo", () => {
    expect(repoNameSchema.parse("vercel/next.js")).toBe("vercel/next.js");
  });

  it.each(["../etc/passwd", "owner", "a/b/c", "owner/repo?x=1", "owner/re po"])("rejects %s", (value) => {
    expect(repoNameSchema.safeParse(value).success).toBe(false);
  });
});

describe("generateSchema", () => {
  it("allows an empty body", () => {
    expect(generateSchema.parse({})).toEqual({});
  });

  it.each([0, 91, 1.5, -3])("rejects days=%s", (days) => {
    expect(generateSchema.safeParse({ days }).success).toBe(false);
  });

  it("rejects unknown templates and malformed log ids", () => {
    expect(generateSchema.safeParse({ template: "nope" }).success).toBe(false);
    expect(generateSchema.safeParse({ regenerateLogId: "not-a-uuid" }).success).toBe(false);
  });

  it("accepts built-in template ids and custom template uuids", () => {
    expect(generateSchema.safeParse({ template: "changelog" }).success).toBe(true);
    expect(generateSchema.safeParse({ template: "3f1c2a52-0000-4000-8000-000000000000" }).success).toBe(true);
  });
});

describe("templateInputSchema", () => {
  const instructions = "Write a short monthly update for customers.";

  it("trims, defaults the description and requires meaningful instructions", () => {
    expect(templateInputSchema.parse({ name: "  Monthly ", instructions })).toEqual({
      name: "Monthly",
      description: "",
      instructions,
    });
    expect(templateInputSchema.safeParse({ name: "", instructions }).success).toBe(false);
    expect(templateInputSchema.safeParse({ name: "x", instructions: "too short" }).success).toBe(false);
    expect(templateInputSchema.safeParse({ name: "x", instructions: "y".repeat(3001) }).success).toBe(false);
  });

  it("needs at least one field to update", () => {
    expect(updateTemplateSchema.safeParse({}).success).toBe(false);
    expect(updateTemplateSchema.safeParse({ name: "New name" }).success).toBe(true);
    // Omitted fields must stay undefined so an update never clears them.
    expect(updateTemplateSchema.parse({ name: "New name" })).toEqual({ name: "New name" });
  });
});

describe("createProjectSchema", () => {
  it("applies defaults", () => {
    expect(createProjectSchema.parse({ name: "  Site  " })).toMatchObject({
      name: "Site",
      repos: [],
      template: "weekly_update",
      defaultPeriodDays: 7,
      isPublicChangelog: false,
    });
  });

  it("turns empty optional text into null", () => {
    const parsed = createProjectSchema.parse({ name: "x", tone: "", audience: "  ", customPrompt: "" });
    expect(parsed.tone).toBeNull();
    expect(parsed.audience).toBeNull();
    expect(parsed.customPrompt).toBeNull();
  });

  it("rejects bad names, repos and branches", () => {
    expect(createProjectSchema.safeParse({ name: "" }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: "x", repos: [{ fullName: "nope" }] }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: "x", repos: [{ fullName: "o/r", branch: "a b" }] }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: "x", repos: Array(21).fill({ fullName: "o/r" }) }).success).toBe(false);
  });

  it("keeps legacy repositories as GitHub and accepts explicit GitLab repositories", () => {
    expect(createProjectSchema.parse({ name: "Legacy", repos: [{ fullName: "group/project" }] }).repos).toEqual([
      { fullName: "group/project" },
    ]);
    expect(createProjectSchema.parse({
      name: "Mixed",
      repos: [
        { provider: "github", fullName: "group/project" },
        { provider: "gitlab", fullName: "group/project" },
      ],
    }).repos).toEqual([
      { provider: "github", fullName: "group/project" },
      { provider: "gitlab", fullName: "group/project" },
    ]);
    expect(createProjectSchema.safeParse({ name: "Unknown", repos: [{ provider: "bitbucket", fullName: "g/p" }] }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: "Malformed", repos: [{ provider: "gitlab", fullName: "not-a-project-path" }] }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: "Traversal", repos: [{ provider: "gitlab", fullName: "group/../project" }] }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: "Dot path", repos: [{ provider: "gitlab", fullName: "group/./project" }] }).success).toBe(false);
  });
});

describe("updateProjectSchema", () => {
  it("is partial", () => {
    expect(updateProjectSchema.parse({ name: "New" })).toEqual({ name: "New" });
  });

  it("accepts bounded Sentry project selections on update without defaulting omitted ones", () => {
    expect(updateProjectSchema.parse({ sentryProjects: [{ id: "42", slug: "web", name: "Web" }] })).toEqual({
      sentryProjects: [{ id: "42", slug: "web", name: "Web" }],
    });
    expect(updateProjectSchema.safeParse({ sentryProjects: Array.from({ length: 21 }, (_, i) => ({ id: String(i), slug: `p${i}`, name: `P${i}` })) }).success).toBe(false);
  });
});

describe("Sentry project selections", () => {
  const project = { id: "123", slug: "web-app", name: "Web App" };

  it("defaults to none on create and keeps up to 20 canonical entries", () => {
    expect(createProjectSchema.parse({ name: "x" }).sentryProjects).toEqual([]);
    const twenty = Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), slug: `p${i}`, name: `P${i}` }));
    expect(createProjectSchema.parse({ name: "x", sentryProjects: twenty }).sentryProjects).toHaveLength(20);
    expect(createProjectSchema.safeParse({ name: "x", sentryProjects: [...twenty, { id: "99", slug: "p99", name: "P99" }] }).success).toBe(false);
  });

  it("strips extra fields and rejects malformed or duplicate entries", () => {
    expect(sentryProjectsSchema.parse([{ ...project, extra: "ignored" }])).toEqual([project]);
    expect(
      sentryProjectsSchema.parse([
        { id: "201", slug: "_internal", name: "Internal" },
        { id: "202", slug: "-ops", name: "Ops" },
      ])
    ).toEqual([
      { id: "201", slug: "_internal", name: "Internal" },
      { id: "202", slug: "-ops", name: "Ops" },
    ]);
    for (const bad of [
      { ...project, id: "" },
      { ...project, id: "12 3" },
      { ...project, id: "../x" },
      { ...project, slug: "Web App" },
      { ...project, slug: "" },
      { ...project, slug: "ops/service" },
      { ...project, name: "" },
      { ...project, name: "x".repeat(201) },
      { id: 123, slug: "web", name: "Web" },
    ]) {
      expect(sentryProjectsSchema.safeParse([bad]).success).toBe(false);
    }
    expect(sentryProjectsSchema.safeParse([project, { ...project, slug: "other" }]).success).toBe(false);
  });
});

describe("sentrySettingsSchema", () => {
  const token = "sntryu_" + "a1b2c3d4".repeat(8);

  it("normalizes the organization slug and trims the token", () => {
    expect(sentrySettingsSchema.parse({ organizationSlug: "  My-Org_1 ", token: ` ${token} ` })).toEqual({
      organizationSlug: "my-org_1",
      token,
    });
  });

  it("rejects slugs that could change the request path and malformed tokens", () => {
    for (const organizationSlug of ["", "a/b", "..", "org?x=1", "org#x", "-org", "a b", "x".repeat(51), "https://evil.test"]) {
      expect(sentrySettingsSchema.safeParse({ organizationSlug, token }).success).toBe(false);
    }
    for (const bad of ["", "short", "has space inside-a-long-enough-token", `${token}\nX`, "x".repeat(501), "tökén".repeat(10)]) {
      expect(sentrySettingsSchema.safeParse({ organizationSlug: "org", token: bad }).success).toBe(false);
    }
  });

  it("does not echo the token in validation messages", () => {
    const secret = "secret token with spaces that is long";
    const result = sentrySettingsSchema.safeParse({ organizationSlug: "org", token: secret });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain(secret);
  });
});

describe("updateLogSchema", () => {
  it("requires at least one field", () => {
    expect(updateLogSchema.safeParse({}).success).toBe(false);
    expect(updateLogSchema.safeParse({ pinned: true }).success).toBe(true);
  });

  it("requires the editor's original content when saving changed content", () => {
    expect(updateLogSchema.safeParse({ content: "updated" }).success).toBe(false);
    expect(updateLogSchema.safeParse({ content: "updated", expectedContent: "original" }).success).toBe(true);
    expect(updateLogSchema.safeParse({ title: "renamed" }).success).toBe(true);
  });
});

describe("logListQuerySchema", () => {
  it("treats form-style empty strings as unset and applies defaults", () => {
    expect(logListQuerySchema.parse({ q: "", from: "", to: "", page: "" })).toEqual({
      pinned: false,
      page: 1,
      pageSize: 20,
    });
  });

  it("parses filters", () => {
    const parsed = logListQuerySchema.parse({ q: "api", from: "2026-10-01", pinned: "1", page: "2" });
    expect(parsed.q).toBe("api");
    expect(parsed.from).toEqual(new Date("2026-10-01"));
    expect(parsed.pinned).toBe(true);
    expect(parsed.page).toBe(2);
  });

  it("caps page size", () => {
    expect(logListQuerySchema.safeParse({ pageSize: "500" }).success).toBe(false);
  });
});

describe("generateSchema date range", () => {
  it("accepts a valid range", () => {
    const parsed = generateSchema.parse({ from: "2026-10-01", to: "2026-10-07" });
    expect(parsed.from).toEqual(new Date("2026-10-01"));
  });

  it("requires both ends, in order, within 90 days", () => {
    expect(generateSchema.safeParse({ from: "2026-10-01" }).success).toBe(false);
    expect(generateSchema.safeParse({ from: "2026-10-07", to: "2026-10-01" }).success).toBe(false);
    expect(generateSchema.safeParse({ from: "2026-01-01", to: "2026-06-01" }).success).toBe(false);
    expect(generateSchema.safeParse({ from: "garbage", to: "2026-10-01" }).success).toBe(false);
  });
});

describe("scheduleSchema", () => {
  const valid = { enabled: true, dayOfWeek: 1, hour: 9, timezone: "Europe/Zagreb", periodDays: 7, autoDeliver: false };

  it("accepts a valid schedule on project updates, including clearing it", () => {
    expect(updateProjectSchema.parse({ schedule: valid }).schedule).toEqual(valid);
    expect(updateProjectSchema.parse({ schedule: null }).schedule).toBeNull();
  });

  it.each([
    { dayOfWeek: 7 },
    { dayOfWeek: -1 },
    { hour: 24 },
    { hour: 1.5 },
    { periodDays: 0 },
    { periodDays: 91 },
    { timezone: "Mars/Base" },
  ])("rejects %j", (override) => {
    expect(updateProjectSchema.safeParse({ schedule: { ...valid, ...override } }).success).toBe(false);
  });
});

describe("channel schemas", () => {
  it("accepts valid channels and normalises recipients", () => {
    expect(
      createChannelSchema.parse({ kind: "slack", webhookUrl: " https://hooks.slack.com/services/T1/B1/x " })
    ).toMatchObject({ kind: "slack", webhookUrl: "https://hooks.slack.com/services/T1/B1/x" });
    expect(createChannelSchema.parse({ kind: "email", recipients: [" A@Example.com "] })).toMatchObject({
      recipients: ["a@example.com"],
    });
  });

  it("accepts a Teams Workflows webhook and rejects other hosts", () => {
    const url = "https://prod-12.westus.logic.azure.com:443/xxxxxxxxx?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=SECRETSIG_abc-123";
    const parsed = createChannelSchema.parse({ kind: "teams", webhookUrl: ` ${url} ` });
    expect(parsed).toEqual({ kind: "teams", webhookUrl: url });

    const failure = createChannelSchema.safeParse({ kind: "teams", webhookUrl: "https://evil.example.com/workflows/x?sig=SECRETSIG_abc-123" });
    expect(failure.success).toBe(false);
    expect(JSON.stringify(failure.error?.issues)).not.toContain("SECRETSIG");
    expect(createChannelSchema.safeParse({ kind: "teams", webhookUrl: "https://prod-12.westus.logic.azure.com/?sig=SECRETSIG_abc-123" }).success).toBe(false);
    expect(createChannelSchema.safeParse({ kind: "teams", webhookUrl: "https://prod-12.westus.logic.azure.com/xxxxxxxxx?sig=" }).success).toBe(false);
    expect(createChannelSchema.safeParse({ kind: "teams", webhookUrl: "https://hooks.slack.com/services/T1/B1/x" }).success).toBe(false);
    expect(createChannelSchema.safeParse({ kind: "slack", webhookUrl: url }).success).toBe(false);
  });

  it("rejects wrong hosts, kinds and recipient lists", () => {
    const bad = (v: unknown) => createChannelSchema.safeParse(v).success;
    expect(bad({ kind: "slack", webhookUrl: "https://discord.com/api/webhooks/1/a" })).toBe(false);
    expect(bad({ kind: "discord", webhookUrl: "http://169.254.169.254/" })).toBe(false);
    expect(bad({ kind: "sms", webhookUrl: "x" })).toBe(false);
    expect(bad({ kind: "email", recipients: [] })).toBe(false);
    expect(bad({ kind: "email", recipients: ["not-an-email"] })).toBe(false);
    expect(bad({ kind: "email", recipients: Array(11).fill("a@b.co") })).toBe(false);
  });

  it("requires something to update", () => {
    expect(updateChannelSchema.safeParse({}).success).toBe(false);
    expect(updateChannelSchema.safeParse({ enabled: false }).success).toBe(true);
  });
});
