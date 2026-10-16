import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEnv } from "./lib/env-file";

const root = resolve(__dirname, "..");
const docFiles = ["README.md", "CHANGELOG.md", ...readdirSync(resolve(root, "docs")).map((f) => `docs/${f}`)];
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

// GitHub's heading anchors: lowercase, punctuation dropped, spaces to hyphens.
const slug = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");

const headingsOf = (file: string) =>
  [...read(file).matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1]));

describe("documentation", () => {
  it("only links to files and headings that exist", () => {
    const problems: string[] = [];
    for (const file of docFiles) {
      const text = read(file).replace(/```[\s\S]*?```/g, "");
      for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^(https?:|mailto:)/.test(target)) continue;
        const [path, anchor] = target.split("#");
        const resolved = path ? resolve(root, dirname(file), path) : resolve(root, file);
        if (!existsSync(resolved)) {
          problems.push(`${file}: missing file ${target}`);
          continue;
        }
        if (anchor && resolved.endsWith(".md") && !headingsOf(resolved.slice(root.length + 1)).includes(anchor)) {
          problems.push(`${file}: missing heading #${anchor} in ${path || file}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("documents every variable in .env.example", () => {
    const documented = read("docs/configuration.md");
    const missing = Object.keys(parseEnv(read(".env.example"))).filter((name) => !documented.includes(`\`${name}\``));
    expect(missing).toEqual([]);
  });

  it("documents every environment variable the validator and flags know about", () => {
    const documented = read("docs/configuration.md");
    const source = read("src/env.ts");
    const names = new Set([...source.matchAll(/["'`]([A-Z][A-Z0-9_]{3,})["'`]/g)].map((m) => m[1]));
    names.delete("NODE_ENV");
    const missing = [...names].filter((name) => /_(KEY|SECRET|URL|ID|ENABLED|PROVIDER|FROM)$|^ENCRYPTION_KEY$|^DATABASE_URL$/.test(name) && !documented.includes(name));
    expect(missing).toEqual([]);
  });

  it("lists every npm script in the README", () => {
    const scripts = Object.keys((JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts);
    const readme = read("README.md");
    // dev/build/start are grouped in one row; lint/typecheck/test too.
    const undocumented = scripts.filter((s) => !readme.includes(s.split(":")[0]));
    expect(undocumented).toEqual([]);
  });

  it("keeps the changelog's first release section", () => {
    expect(read("CHANGELOG.md")).toMatch(/^## \[Unreleased\]/m);
  });
});
