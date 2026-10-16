// Pure helpers for scripts/package-release.ts, kept free of I/O so they can be tested.

const EXCLUDED_PREFIXES = [
  ".git/",
  ".next/",
  ".neon/",
  "node_modules/",
  "dist/",
  // Seller-only tooling and notes.
  "release/",
  "PLAN.md",
  "scripts/package-release.ts",
  "scripts/lib/release.ts",
  "scripts/lib/release.test.ts",
  // Only relevant to the original hosted installation.
  "scripts/migrate-clerk-metadata.ts",
];

export function isExcluded(path: string): boolean {
  const p = path.replace(/^\.\//, "");
  const name = p.slice(p.lastIndexOf("/") + 1);
  if (EXCLUDED_PREFIXES.some((prefix) => (prefix.endsWith("/") ? p.startsWith(prefix) : p === prefix))) return true;
  if (name === ".DS_Store" || name.endsWith(".tsbuildinfo")) return true;
  // Any .env file except the committed template.
  return /^\.env(\..+)?$/.test(name) && name !== ".env.example";
}

export type Finding = { file: string; line: number; rule: string };

// Each pattern is specific enough to avoid matching placeholders such as `sk_test_dummy`.
export const SECRET_PATTERNS: { rule: string; regex: RegExp }[] = [
  { rule: "Stripe live key", regex: /\b(?:sk|rk|pk)_live_[A-Za-z0-9]{8,}/ },
  { rule: "Stripe test secret key", regex: /\b(?:sk|rk)_test_[A-Za-z0-9]{20,}/ },
  { rule: "Stripe webhook secret", regex: /\bwhsec_[A-Za-z0-9]{16,}/ },
  { rule: "GitHub token", regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/ },
  { rule: "AWS access key id", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { rule: "Private key", regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { rule: "Slack token", regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { rule: "OpenAI or Anthropic key", regex: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/ },
  { rule: "Resend key", regex: /\bre_[A-Za-z0-9]{20,}/ },
  { rule: "Neon API key", regex: /\bnapi_[A-Za-z0-9]{20,}/ },
  { rule: "Clerk secret key", regex: /\bsk_(?:test|live)_[A-Za-z0-9]{30,}/ },
];

const SAFE_DB_HOSTS = new Set(["localhost", "127.0.0.1", "host", "example.com"]);
const SAFE_DB_PASSWORDS = new Set(["p", "pass", "password", "postgres", "x", "y"]);

// A connection string with a real-looking password and host.
function leakedConnectionString(line: string): boolean {
  for (const m of line.matchAll(/postgres(?:ql)?:\/\/[^:\s/@]+:([^@\s]+)@([^\s/:?"'`]+)/g)) {
    if (!SAFE_DB_HOSTS.has(m[2]) && !SAFE_DB_PASSWORDS.has(m[1])) return true;
  }
  return false;
}

/** Values worth hunting for verbatim: the secrets in a developer's own .env file. */
export function secretLiterals(envText: string): string[] {
  const values: string[] = [];
  for (const line of envText.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const value = m[1].trim().replace(/^(["'])(.*)\1$/, "$2");
    if (value.length >= 12 && !/^https?:\/\/localhost/.test(value) && !value.startsWith("/")) values.push(value);
  }
  return [...new Set(values)];
}

/** Scans one text file. Findings carry the rule and line, never the matched text. */
export function scanText(file: string, text: string, { literals = [], forbidden = [] }: { literals?: string[]; forbidden?: string[] } = {}): Finding[] {
  const findings: Finding[] = [];
  const lowerForbidden = forbidden.map((f) => f.toLowerCase());
  text.split("\n").forEach((line, index) => {
    const at = (rule: string) => findings.push({ file, line: index + 1, rule });
    for (const { rule, regex } of SECRET_PATTERNS) if (regex.test(line)) at(rule);
    if (leakedConnectionString(line)) at("Database connection string with credentials");
    if (literals.some((value) => line.includes(value))) at("Value from the developer's .env file");
    const lower = line.toLowerCase();
    if (lowerForbidden.some((f) => f && lower.includes(f))) at("Personal or project-specific string");
  });
  return findings;
}

/** Hardcoded brand names in string literals: the product name must only come from site config. */
export function findBrandLeaks(file: string, text: string, brand: string): Finding[] {
  const quoted = new RegExp(`(["'\`])(?:(?!\\1).)*\\b${brand}\\b`);
  const jsxText = new RegExp(`>[^<>{}]*\\b${brand}\\b[^<>{}]*<`);
  const findings: Finding[] = [];
  text.split("\n").forEach((line, index) => {
    if (quoted.test(line) || jsxText.test(line)) findings.push({ file, line: index + 1, rule: `Hardcoded "${brand}"` });
  });
  return findings;
}

export type LicenseDetails = { licensor: string; licensorEmail: string; jurisdiction: string };

export function fillLicense(template: string, details: LicenseDetails, year: number): { text: string; unresolved: string[] } {
  const values: Record<string, string> = {
    LICENSOR: details.licensor,
    LICENSOR_EMAIL: details.licensorEmail,
    JURISDICTION: details.jurisdiction,
    YEAR: String(year),
  };
  const unresolved = Object.entries(values)
    .filter(([key, value]) => key !== "YEAR" && (!value.trim() || /^REPLACE ME/i.test(value.trim())))
    .map(([key]) => key);
  const text = template.replace(/\{\{([A-Z_]+)\}\}/g, (whole, key: string) => values[key] ?? whole);
  return { text, unresolved: [...new Set([...unresolved, ...[...text.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1])])] };
}

const SELLER_SCRIPTS = ["migrate:clerk", "release"];

/** The buyer's package.json: no scripts for tooling that isn't shipped, and the license pointer. */
export function transformPackageJson(raw: string): string {
  const pkg = JSON.parse(raw) as { scripts?: Record<string, string>; license?: string; [key: string]: unknown };
  for (const name of SELLER_SCRIPTS) delete pkg.scripts?.[name];
  pkg.license = "SEE LICENSE IN LICENSE.md";
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

export function stripMigrateClerk(readme: string): string {
  return readme
    .split("\n")
    .filter((line) => !line.includes("migrate:clerk"))
    .join("\n");
}

export const checksumLine = (hash: string, filename: string) => `${hash}  ${filename}\n`;

export function looksBinary(buffer: Uint8Array): boolean {
  return buffer.subarray(0, 8000).includes(0);
}
