import { describe, expect, it } from "vitest";
import { isAllowed, normalizeLicense, renderNotices, reviewedException } from "./licenses";

describe("isAllowed", () => {
  it("accepts permissive licenses", () => {
    for (const id of ["MIT", "ISC", "Apache-2.0", "BSD-3-Clause", "0BSD", "BlueOak-1.0.0", "MPL-2.0"]) {
      expect(isAllowed(id), id).toBe(true);
    }
  });

  it("rejects copyleft, proprietary and unknown licenses", () => {
    for (const id of ["GPL-3.0-only", "AGPL-3.0-or-later", "LGPL-3.0-or-later", "SSPL-1.0", "UNLICENSED", "UNKNOWN", "SEE LICENSE IN FILE", ""]) {
      expect(isAllowed(id), id).toBe(false);
    }
  });

  it("lets an OR expression through when one alternative is allowed", () => {
    expect(isAllowed("(MIT OR GPL-3.0-only)")).toBe(true);
    expect(isAllowed("GPL-3.0-only OR AGPL-3.0-only")).toBe(false);
  });

  it("requires every part of an AND expression to be allowed", () => {
    expect(isAllowed("MIT AND ISC")).toBe(true);
    expect(isAllowed("Apache-2.0 AND LGPL-3.0-or-later")).toBe(false);
    expect(isAllowed("(MIT AND Zlib) OR GPL-2.0-only")).toBe(false);
  });
});

describe("reviewedException", () => {
  it("covers only the reviewed packages", () => {
    expect(reviewedException("@img/sharp-libvips-linux-x64")).toContain("LGPL");
    expect(reviewedException("@img/sharp-win32-x64")).toContain("LGPL");
    expect(reviewedException("left-pad")).toBeNull();
    expect(reviewedException("some-gpl-package")).toBeNull();
  });
});

describe("normalizeLicense", () => {
  it("reads strings, objects, legacy arrays and missing values", () => {
    expect(normalizeLicense(" MIT ")).toBe("MIT");
    expect(normalizeLicense({ type: "ISC" })).toBe("ISC");
    expect(normalizeLicense(undefined, [{ type: "MIT" }, { type: "Apache-2.0" }])).toBe("(MIT OR Apache-2.0)");
    expect(normalizeLicense(undefined)).toBe("UNKNOWN");
    expect(normalizeLicense("")).toBe("UNKNOWN");
  });
});

describe("renderNotices", () => {
  const deps = [
    { name: "b", version: "1.0.0", license: "MIT", url: "https://b" },
    { name: "a", version: "2.0.0", license: "ISC", url: "https://a" },
    { name: "a", version: "1.0.0", license: "ISC", url: "https://a" },
  ];

  it("is sorted and deterministic, so the committed file can be checked", () => {
    const out = renderNotices(deps);
    expect(renderNotices([...deps].reverse())).toBe(out);
    expect(out.indexOf("| a | 1.0.0")).toBeLessThan(out.indexOf("| a | 2.0.0"));
    expect(out.indexOf("| a | 2.0.0")).toBeLessThan(out.indexOf("| b |"));
  });

  it("escapes pipes so a license can't break the table", () => {
    expect(renderNotices([{ name: "x", version: "1", license: "A|B", url: "u" }])).toContain("| A/B |");
  });
});
