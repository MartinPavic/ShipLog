import { describe, expect, it } from "vitest";
import { exportFilename, toHtml, toSlackMrkdwn } from "./export";

describe("toSlackMrkdwn", () => {
  it("converts headings, bold, italic and strikethrough", () => {
    const out = toSlackMrkdwn("# Title\n## Sub **bold**\nText with **bold**, *italic* and ~~gone~~.");
    expect(out).toBe("*Title*\n*Sub bold*\nText with *bold*, _italic_ and ~gone~.");
  });

  it("converts bullets and keeps numbered lists", () => {
    expect(toSlackMrkdwn("- one **x**\n* two\n  - nested\n1. first")).toBe("• one *x*\n• two\n  • nested\n1. first");
  });

  it("converts links without mangling underscores in the URL", () => {
    expect(toSlackMrkdwn("See [the **PR**](https://github.com/o/r/pull/1_2) now")).toBe(
      "See <https://github.com/o/r/pull/1_2|the PR> now"
    );
  });

  it("leaves inline code and fenced blocks untouched", () => {
    const md = "Use `a **b** *c*` here\n```\n# not a heading\n- not a bullet **x**\n```\nafter **y**";
    expect(toSlackMrkdwn(md)).toBe("Use `a **b** *c*` here\n```\n# not a heading\n- not a bullet **x**\n```\nafter *y*");
  });

  it("does not treat a lone asterisk or bold-led line as a bullet", () => {
    expect(toSlackMrkdwn("**Done**: shipped")).toBe("*Done*: shipped");
    expect(toSlackMrkdwn("2 * 3 * 4")).toBe("2 * 3 * 4");
  });
});

describe("toHtml", () => {
  it("renders GitHub-flavoured Markdown", async () => {
    const html = await toHtml("# Hi\n\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[ok](https://a.com)");
    expect(html).toContain("<h1>Hi</h1>");
    expect(html).toContain("<table>");
    expect(html).toContain('href="https://a.com"');
  });

  it("drops raw HTML, scripts and unsafe URLs", async () => {
    const html = await toHtml(
      '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[bad](javascript:alert(1)) ![i](data:text/html;base64,AAAA)'
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onerror/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/data:text/i);
  });
});

describe("exportFilename", () => {
  it("slugifies titles and applies the extension", () => {
    expect(exportFilename("Weekly update: Oct 6 – Oct 13, 2026")).toBe("weekly-update-oct-6-oct-13-2026.md");
    expect(exportFilename("../../etc/passwd", "html")).toBe("etc-passwd.html");
    expect(exportFilename("")).toBe("project.md");
  });
});
