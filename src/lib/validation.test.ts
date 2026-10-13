import { describe, expect, it } from "vitest";
import { generateSchema, repoNameSchema } from "./validation";

describe("repoNameSchema", () => {
  it("accepts owner/repo", () => {
    expect(repoNameSchema.parse("vercel/next.js")).toBe("vercel/next.js");
  });

  it.each(["../etc/passwd", "owner", "a/b/c", "owner/repo?x=1", "owner/re po"])("rejects %s", (value) => {
    expect(repoNameSchema.safeParse(value).success).toBe(false);
  });
});

describe("generateSchema", () => {
  it("defaults days to 7 and allows no repo", () => {
    expect(generateSchema.parse({})).toEqual({ days: 7 });
  });

  it.each([0, 91, 1.5, -3])("rejects days=%s", (days) => {
    expect(generateSchema.safeParse({ days }).success).toBe(false);
  });
});
