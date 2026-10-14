import { describe, expect, it } from "vitest";
import {
  createProjectSchema,
  generateSchema,
  logListQuerySchema,
  repoNameSchema,
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
