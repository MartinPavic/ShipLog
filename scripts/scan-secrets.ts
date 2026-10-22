/**
 * Fails when the git index (or the whole tracked tree) contains something that looks like a credential.
 *
 * Usage: npm run scan:secrets            staged files, run by .githooks/pre-commit
 *        npm run scan:secrets -- --all   every tracked file, run in CI
 *
 * Enable the commit hook once per clone: git config core.hooksPath .githooks
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { looksBinary, scanText, secretLiterals, type Finding } from "./lib/release";

// These hold example credentials on purpose, to test the scanner itself.
const SKIP = new Set(["scripts/lib/release.ts", "scripts/lib/release.test.ts", "scripts/scan-secrets.ts"]);
const ENV_FILE = /(^|\/)\.env(\..+)?$/;

const git = (args: string[]) => execFileSync("git", args, { maxBuffer: 256 * 1024 * 1024 });
const paths = (args: string[]) => git(args).toString("utf8").split("\0").filter(Boolean);

const files = process.argv.includes("--all")
  ? paths(["ls-files", "-z"])
  : paths(["diff", "--cached", "--name-only", "--diff-filter=ACM", "-z"]);

// Public by design, so they are expected to appear in code and docs.
const envText = [".env", ".env.local", ".env.production.local"]
  .filter((f) => existsSync(f))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n")
  .split("\n")
  .filter((line) => !/^\s*(export\s+)?NEXT_PUBLIC_/.test(line))
  .join("\n");
const literals = secretLiterals(envText);

const findings: Finding[] = [];
for (const file of files) {
  if (ENV_FILE.test(file) && !file.endsWith(".env.example")) {
    findings.push({ file, line: 1, rule: "Env file is tracked" });
    continue;
  }
  if (SKIP.has(file)) continue;
  const content = git(["show", `:${file}`]);
  if (looksBinary(content)) continue;
  findings.push(...scanText(file, content.toString("utf8"), { literals }));
}

for (const f of findings) console.error(`${f.file}:${f.line}  ${f.rule}`);
if (findings.length > 0) {
  console.error(`\n${findings.length} possible secret(s) found. Remove them, or bypass once with --no-verify if they are false positives.`);
  process.exit(1);
}
console.log(`No secrets found in ${files.length} file(s).`);
