import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it.each([
    ["My Cool Project", "my-cool-project"],
    ["  Ünïcode — Naïve  ", "unicode-naive"],
    ["a/b\\c?d", "a-b-c-d"],
    ["---", "project"],
    ["", "project"],
  ])("%j -> %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("caps length without trailing dash", () => {
    const slug = slugify(`${"a".repeat(47)} b`);
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith("-")).toBe(false);
  });
});
