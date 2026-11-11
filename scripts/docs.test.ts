import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEnv } from "./lib/env-file";

const root = resolve(__dirname, "..");
const markdownFiles = (directory: string): string[] =>
  readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? markdownFiles(path) : entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
const docFiles = ["README.md", "CHANGELOG.md", ...markdownFiles("docs")];
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
    expect(docFiles).toContain("docs/superpowers/specs/2026-10-30-dashboard-workflow-design.md");
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

  it("documents four Stripe price IDs and tax-inclusive setup", () => {
    const configuration = read("docs/configuration.md");
    const services = read("docs/services.md");
    const setup = read("scripts/setup.ts");
    const envExample = read(".env.example");

    for (const name of [
      "STRIPE_PRICE_PRO_BYOK_ID",
      "STRIPE_PRICE_PRO_MANAGED_ID",
      "STRIPE_PRICE_ULTRA_BYOK_ID",
      "STRIPE_PRICE_ULTRA_MANAGED_ID",
    ]) {
      expect(configuration).toContain(name);
      expect(services).toContain(name);
      expect(setup).toContain(name);
      expect(envExample).toContain(name);
    }

    expect(configuration).not.toContain("STRIPE_PRICE_ID");
    expect(services).not.toContain("STRIPE_PRICE_ID");
    expect(setup).not.toContain("STRIPE_PRICE_ID");
    expect(services.toLowerCase()).toContain("vat-inclusive");
    expect(services.toLowerCase()).toContain("inclusive");
    expect(services.toLowerCase()).toContain("automatic tax");
  });

  it("documents every environment variable the validator and flags know about", () => {
    const documented = read("docs/configuration.md");
    const source = read("src/env.ts");
    const names = new Set([...source.matchAll(/["'`]([A-Z][A-Z0-9_]{3,})["'`]/g)].map((m) => m[1]));
    names.delete("NODE_ENV");
    const missing = [...names].filter((name) => /_(KEY|SECRET|URL|ID|ENABLED|PROVIDER|FROM)$|^ENCRYPTION_KEY$|^DATABASE_URL$/.test(name) && !documented.includes(name));
    expect(missing).toEqual([]);
  });

  it("describes locked AI modes and unavailable managed AI without promising BYOK fallback", () => {
    expect(read("src/config/site.ts")).not.toContain("included managed AI on Pro");
    expect(read("src/config/site.ts")).not.toContain("Pro workspaces can also use");
    expect(read("docs/configuration.md")).not.toContain("everyone brings their own key");
    expect(read("docs/services.md")).not.toContain("workspaces without their own key");
    expect(read("docs/troubleshooting.md")).toContain("Managed AI is unavailable");
    expect(read("src/env.ts")).not.toContain("Pro workspaces will have to bring their own AI key");
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

  it("documents Microsoft Teams delivery via Workflows, separate from Clerk Organizations", () => {
    const services = read("docs/services.md");
    const section = services.slice(services.indexOf("## Microsoft Teams delivery")).split(/\n## /)[0];
    expect(section.startsWith("## Microsoft Teams delivery")).toBe(true);
    expect(section).toContain("Workflows");
    expect(section).toContain("When a Teams webhook request is received");
    expect(section).toMatch(/authentication[^\n]*Anyone/i);
    expect(section.toLowerCase()).toContain("co-owner");
    expect(section).toContain("28 KB");
    expect(section).toContain("24 KB");
    expect(section).toMatch(/Office 365 connector[^.]*retired/i);
    expect(section).toContain("Clerk Organizations");
    expect(section).toContain("`TEAMS_ENABLED`");
    expect(section).toContain("`DELIVERY_ENABLED`");
    expect(section).not.toMatch(/outlook\.office\.com\/webhook|webhook\.office\.com/);

    for (const file of ["README.md", "docs/configuration.md", "docs/architecture.md", "docs/upgrading.md"]) {
      expect(read(file), file).toContain("Microsoft Teams");
    }
    expect(read("docs/configuration.md")).toContain("not Microsoft Teams");

    const customization = read("docs/customization.md");
    expect(customization).toContain("src/db/schema.ts");
    expect(customization).toMatch(/ChannelKind[^\n]*src\/lib\/delivery\.ts/);
    expect(customization).not.toMatch(/ChannelKind[^\n]*src\/db\/schema\.ts/);
    expect(customization).toContain("isAllowedWebhook");
    expect(customization.toLowerCase()).toContain("validation");
    expect(customization.toLowerCase()).toContain("sender");
    expect(customization.toLowerCase()).toContain("form");
    expect(customization).toContain("delivery_channels.kind");
    expect(customization.toLowerCase()).toContain("plain text");
    expect(customization.toLowerCase()).toContain("no sql enum migration");
  });

  it("documents Teams as a paid delivery channel with no SQL migration or new variable", () => {
    const services = read("docs/services.md");
    const section = services.slice(services.indexOf("## Microsoft Teams delivery")).split(/\n## /)[0];
    expect(section).toMatch(/paid/i);
    expect(section).toMatch(/delivery limits/i);
    expect(section).toMatch(/channel-(specific|scoped)/i);
    expect(section).toMatch(/encrypted/i);
    expect(read("docs/upgrading.md")).toMatch(/no SQL (enum )?migration/i);
    expect(read("CHANGELOG.md")).toMatch(/Microsoft Teams/);
  });

  it("documents Sentry as a supplemental, read-only, report-window source", () => {
    const services = read("docs/services.md");
    const section = services.slice(services.indexOf("## Sentry")).split(/\n## /)[0];
    expect(section.startsWith("## Sentry")).toBe(true);
    expect(section).toContain("`project:read`");
    expect(section).toContain("`event:read`");
    expect(section.toLowerCase()).toContain("organization slug");
    expect(section.toLowerCase()).toContain("admin");
    expect(section.toLowerCase()).toContain("read-only");
    expect(section.toLowerCase()).toMatch(/personal token|internal integration/);
    expect(section.toLowerCase()).not.toMatch(/organization auth token/);
    expect(section.toLowerCase()).toMatch(/selected (sentry )?projects?/);
    expect(section.toLowerCase()).toMatch(/report window|reporting window/);
    expect(section.toLowerCase()).toMatch(/lifetime/);
    expect(section.toLowerCase()).toMatch(/lower bound|capped|bounded/);
    expect(section).toMatch(/1,000 projects|1000 projects/);
    expect(section.toLowerCase()).toMatch(/disconnect[^.]*(keep|preserv|retain)/);
    expect(section.toLowerCase()).toContain("repository");
    expect(section.toLowerCase()).toContain("reconnect");
    expect(section.toLowerCase()).toMatch(/re-?check|re-?validat|re-?canonical/);
    expect(section.toLowerCase()).toMatch(/generation|run time|before fetching/);
    expect(section.toLowerCase()).toMatch(/inaccessible|no longer accessible|removed access/);
    expect(section).toMatch(/not (supported|a Sentry-only)|does not (support|send|deliver)/i);
    expect(section.toLowerCase()).toContain("oauth");
    expect(section.toLowerCase()).toContain("self-hosted");
    expect(section.toLowerCase()).toContain("alert");

    for (const file of ["README.md", "docs/architecture.md", "docs/configuration.md", "docs/upgrading.md"]) {
      expect(read(file), file).toContain("Sentry");
    }
    expect(read("docs/architecture.md")).toContain("sentry_connections");
    expect(read("docs/configuration.md")).toMatch(/no (new|Sentry)[^\n]*(variable|environment)/i);
    expect(read("docs/upgrading.md")).toMatch(/sentry_connections/);
    expect(read("CHANGELOG.md")).toMatch(/Sentry/);
    const troubleshooting = read("docs/troubleshooting.md");
    expect(troubleshooting).toMatch(/Sentry/);
    expect(troubleshooting.toLowerCase()).toMatch(/selected sentry project/);
    expect(troubleshooting.toLowerCase()).toMatch(/remove|reconnect/);
  });
});
