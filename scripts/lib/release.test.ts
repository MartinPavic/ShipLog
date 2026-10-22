import { describe, expect, it } from "vitest";
import {
  checksumLine,
  fillLicense,
  findBrandLeaks,
  isExcluded,
  looksBinary,
  scanText,
  secretLiterals,
  stripMigrateClerk,
  transformPackageJson,
} from "./release";

// Assembled at runtime so this file contains nothing that looks like a real credential.
const fake = (prefix: string, length: number) => prefix + "a1B2c3D4e5".repeat(Math.ceil(length / 10)).slice(0, length);

describe("isExcluded", () => {
  it("drops internal files, build output and every env file except the template", () => {
    for (const path of [
      ".git/config", ".next/server/x.js", "node_modules/x/index.js", "dist/a.zip", "release/config.json", "PLAN.md",
      "scripts/package-release.ts", "scripts/lib/release.ts", "scripts/lib/release.test.ts", "scripts/migrate-clerk-metadata.ts",
      "scripts/scan-secrets.ts", ".githooks/pre-commit",
      ".env", ".env.local", ".env.production", "sub/.env.local", ".DS_Store", "tsconfig.tsbuildinfo", "./PLAN.md",
    ]) {
      expect(isExcluded(path), path).toBe(true);
    }
  });

  it("keeps what buyers need", () => {
    for (const path of [
      ".env.example", "README.md", "docs/README.md", "src/app/page.tsx", "scripts/setup.ts", "scripts/seed.ts",
      "scripts/lib/env-file.ts", "neon.ts", ".github/workflows/ci.yml", "AGENTS.md", "THIRD_PARTY_NOTICES.md", "src/release-notes.ts",
    ]) {
      expect(isExcluded(path), path).toBe(false);
    }
  });
});

describe("scanText", () => {
  it("flags real-looking credentials by rule and line, never echoing them", () => {
    const secret = fake("sk_live_", 24);
    const findings = scanText("a.ts", `ok\nconst k = "${secret}";\n`);
    expect(findings).toEqual([{ file: "a.ts", line: 2, rule: "Stripe live key" }]);
    expect(JSON.stringify(findings)).not.toContain(secret);
  });

  it("recognizes the common token formats", () => {
    const samples: [string, string][] = [
      ["Stripe webhook secret", fake("whsec_", 24)],
      ["Stripe test secret key", fake("sk_test_", 30)],
      ["GitHub token", fake("ghp_", 36)],
      ["GitHub token", fake("github_pat_", 40)],
      ["AWS access key id", "AKIA" + "ABCDEFGHIJKLMNOP"],
      ["Private key", "-----BEGIN RSA PRIVATE KEY-----"],
      ["Slack token", fake("xoxb-", 20)],
      ["OpenAI or Anthropic key", fake("sk-ant-", 40)],
      ["Resend key", fake("re_", 28)],
    ];
    for (const [rule, value] of samples) {
      expect(scanText("f", `x = ${value}`).map((f) => f.rule), rule).toContain(rule);
    }
  });

  it("lets documentation placeholders through", () => {
    const text = [
      "STRIPE_SECRET_KEY=sk_test_dummy",
      "STRIPE_WEBHOOK_SECRET=whsec_dummy",
      "price_dummy",
      "`sk-managed`",
      "DATABASE_URL=postgres://postgres@localhost:5432/app_test",
      "postgres://u:p@host/db",
      'postgres://...',
      "re_test_key",
    ].join("\n");
    expect(scanText("docs.md", text)).toEqual([]);
  });

  it("flags a connection string with a real host and password", () => {
    const rules = scanText("x", `DATABASE_URL=postgresql://owner:${fake("", 16)}@ep-cool-name.eu-central-1.aws.neon.tech/db`).map((f) => f.rule);
    expect(rules).toEqual(["Database connection string with credentials"]);
  });

  it("finds values copied from the developer's own env file", () => {
    const literals = secretLiterals("A=short\nB=" + fake("", 20) + "\n");
    expect(scanText("x", `const v = "${fake("", 20)}"`, { literals }).map((f) => f.rule)).toEqual(["Value from the developer's .env file"]);
    expect(scanText("x", "const v = 'short'", { literals })).toEqual([]);
  });

  it("finds personal or project-specific strings regardless of case", () => {
    const findings = scanText("x", "// owner: SomeName\nok", { forbidden: ["somename"] });
    expect(findings).toEqual([{ file: "x", line: 1, rule: "Personal or project-specific string" }]);
    expect(scanText("x", "anything", { forbidden: [""] })).toEqual([]);
  });
});

describe("secretLiterals", () => {
  it("keeps long values and ignores short ones, localhost URLs and paths", () => {
    const env = ["A=abcdefghijklmnop", "B=short", "C=http://localhost:3000/x-long-value", 'D="quoted-long-value-123"', "E=/dashboard-long-path", "# F=commented-long-value-1", "A2=abcdefghijklmnop"].join("\n");
    expect(secretLiterals(env)).toEqual(["abcdefghijklmnop", "quoted-long-value-123"]);
  });
});

describe("findBrandLeaks", () => {
  const leaks = (text: string) => findBrandLeaks("f.tsx", text, "ShipLog").map((f) => f.line);

  it("flags the brand inside string literals, template literals and JSX text", () => {
    expect(leaks('const a = "Welcome to ShipLog";')).toEqual([1]);
    expect(leaks("const a = `ShipLog: ${x}`;")).toEqual([1]);
    expect(leaks("<p>Made with ShipLog</p>")).toEqual([1]);
    expect(leaks("ok\n<h1>ShipLog</h1>")).toEqual([2]);
  });

  it("ignores identifiers and types that merely contain the name", () => {
    expect(leaks("export type ShipLog = {};")).toEqual([]);
    expect(leaks("export default async function ShipLogRedirect() {}")).toEqual([]);
    expect(leaks("const x: Promise<ShipLog | null> = y;")).toEqual([]);
    expect(leaks("import type { ShipLog } from \"@/lib/logs\";")).toEqual([]);
  });
});

describe("fillLicense", () => {
  const template = "(c) {{YEAR}} {{LICENSOR}}. Law: {{JURISDICTION}}. {{LICENSOR_EMAIL}}";
  const details = { licensor: "Acme Ltd", licensorEmail: "legal@acme.test", jurisdiction: "Ireland" };

  it("fills every placeholder", () => {
    expect(fillLicense(template, details, 2026)).toEqual({ text: "(c) 2026 Acme Ltd. Law: Ireland. legal@acme.test", unresolved: [] });
  });

  it("reports placeholders that were left as REPLACE ME or empty", () => {
    const result = fillLicense(template, { licensor: "REPLACE ME: name", licensorEmail: " ", jurisdiction: "Ireland" }, 2026);
    expect(result.unresolved.sort()).toEqual(["LICENSOR", "LICENSOR_EMAIL"]);
  });

  it("reports unknown placeholders left in the template", () => {
    expect(fillLicense("{{SOMETHING}} {{YEAR}}", details, 2026).unresolved).toEqual(["SOMETHING"]);
  });
});

describe("package transformations", () => {
  it("removes seller-only scripts and adds the license pointer, leaving the rest alone", () => {
    const out = JSON.parse(transformPackageJson(JSON.stringify({ name: "x", scripts: { dev: "next dev", "migrate:clerk": "a", release: "b", "scan:secrets": "c" }, dependencies: { next: "1" } })));
    expect(out).toEqual({ name: "x", scripts: { dev: "next dev" }, dependencies: { next: "1" }, license: "SEE LICENSE IN LICENSE.md" });
  });

  it("removes only the README lines about the removed script", () => {
    expect(stripMigrateClerk("a\n| `npm run migrate:clerk` | x |\nb\n")).toBe("a\nb\n");
  });
});

describe("small helpers", () => {
  it("formats a checksum file that `shasum -c` accepts", () => {
    expect(checksumLine("abc", "x.zip")).toBe("abc  x.zip\n");
  });

  it("detects binary content by a NUL byte", () => {
    expect(looksBinary(new Uint8Array([104, 105, 0, 1]))).toBe(true);
    expect(looksBinary(new TextEncoder().encode("plain text"))).toBe(false);
  });
});
