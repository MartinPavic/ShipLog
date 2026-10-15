import { describe, expect, it } from "vitest";
import {
  createChannelSchema,
  createProjectSchema,
  generateSchema,
  logListQuerySchema,
  repoNameSchema,
  updateChannelSchema,
  updateLogSchema,
  updateProjectSchema,
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
});

describe("updateProjectSchema", () => {
  it("is partial", () => {
    expect(updateProjectSchema.parse({ name: "New" })).toEqual({ name: "New" });
  });
});

describe("updateLogSchema", () => {
  it("requires at least one field", () => {
    expect(updateLogSchema.safeParse({}).success).toBe(false);
    expect(updateLogSchema.safeParse({ pinned: true }).success).toBe(true);
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
