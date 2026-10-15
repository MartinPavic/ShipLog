import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("security headers", () => {
  it("apply the baseline to every route and never to nothing", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*")!;
    const byKey = Object.fromEntries(all.headers.map((h) => [h.key, h.value]));
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(byKey["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(byKey["Permissions-Policy"]).toContain("camera=()");
  });

  it("stop share links leaking their token through Referer, listed after the baseline so it wins", async () => {
    const rules = await nextConfig.headers!();
    const baseline = rules.findIndex((r) => r.source === "/:path*");
    const share = rules.findIndex((r) => r.source === "/s/:path*");
    expect(share).toBeGreaterThan(baseline);
    expect(rules[share].headers).toEqual([{ key: "Referrer-Policy", value: "no-referrer" }]);
  });
});
