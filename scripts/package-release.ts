/**
 * Builds the zip that buyers download, from a committed ref (never from the working tree).
 *
 *   npm run release -- [--ref <tag|commit>] [--staged] [--allow-untagged] [--allow-placeholders] [--skip-smoke]
 *
 * Steps: git archive, drop internal files, inject LICENSE.md and VERSION, scan for secrets and
 * hardcoded brand names, zip reproducibly, write a SHA-256 checksum, then unpack the zip in a
 * temp directory and run install, type check, tests, build and the environment check there.
 *
 * Without --ref it packages HEAD, which must carry the tag v<package.json version>. --allow-untagged
 * is for dry runs and the resulting zip must not be sold. --staged packages the git index (what
 * `git add` has staged) instead of a commit, to try the packaging before committing; also a dry run.
 */
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
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
  type Finding,
  type LicenseDetails,
} from "./lib/release";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

function fail(message: string): never {
  console.error(`\nRelease aborted: ${message}`);
  process.exit(1);
}

function run(command: string, commandArgs: string[], options: SpawnSyncOptions = {}): string {
  const result = spawnSync(command, commandArgs, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.error) fail(`${command} could not run: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${commandArgs.join(" ")} failed.\n${result.stderr ?? ""}`);
  return String(result.stdout ?? "").trim();
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  );
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

// Placeholder values that let the smoke test build and validate without any real service.
const DUMMY_ENV = {
  NEXT_PUBLIC_APP_URL: "https://example.com",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k",
  CLERK_SECRET_KEY: "sk_test_dummy",
  DATABASE_URL: "postgres://postgres@localhost:5432/app_test",
  ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  GITHUB_CLIENT_ID: "dummy",
  GITHUB_CLIENT_SECRET: "dummy",
  STRIPE_SECRET_KEY: "sk_test_dummy",
  STRIPE_PRICE_ID: "price_dummy",
  STRIPE_WEBHOOK_SECRET: "whsec_dummy",
  CRON_SECRET: "release-smoke-secret-0123456789",
};

function smokeTest(zip: string, top: string) {
  const dir = mkdtempSync(join(tmpdir(), "release-smoke-"));
  try {
    console.log("\nSmoke test in a clean directory");
    run("unzip", ["-q", zip, "-d", dir]);
    const cwd = join(dir, top);
    // Only PATH and HOME are inherited, so nothing from the seller's environment can make it pass.
    const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", CI: "1", ...DUMMY_ENV };
    const step = (label: string, command: string, commandArgs: string[], extra: Record<string, string> = {}) => {
      process.stdout.write(`  ${label} ... `);
      const result = spawnSync(command, commandArgs, { cwd, env: { ...env, ...extra } as NodeJS.ProcessEnv, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
      if (result.status !== 0) {
        console.log("FAILED");
        console.error(`${result.stdout.slice(-4000)}\n${result.stderr.slice(-4000)}`);
        fail(`smoke test step "${label}" failed.`);
      }
      console.log("ok");
    };
    step("npm ci", "npm", ["ci", "--no-audit", "--no-fund"]);
    step("typecheck", "npm", ["run", "typecheck"]);
    step("lint", "npm", ["run", "lint", "--", "--max-warnings=0"]);
    // Database-backed suites skip themselves without DATABASE_URL, so run the rest.
    step("tests", "npm", ["test"], { DATABASE_URL: "" });
    step("build", "npm", ["run", "build"]);
    step("environment check", "npm", ["run", "setup", "--", "--check", "--production"]);
    step("license check", "npm", ["run", "licenses", "--", "--check"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const pkg = readJson<{ version: string }>(resolve(ROOT, "package.json"));
  const config = readJson<LicenseDetails & { productSlug: string; forbiddenStrings: string[] }>(resolve(ROOT, "release/config.json"));
  const version = pkg.version;
  const staged = flag("staged");
  const ref = option("ref") ?? "HEAD";
  // A tree id works with git archive just like a commit id.
  const commit = staged ? run("git", ["write-tree"]) : run("git", ["rev-parse", "--verify", `${ref}^{commit}`]);
  const dryRun = staged || flag("allow-untagged") || flag("allow-placeholders");

  const pending = staged ? run("git", ["diff", "--name-only"]) : run("git", ["status", "--porcelain"]);
  if (pending) console.log(`Note: ${staged ? "unstaged" : "uncommitted"} changes are not included.`);

  if (!option("ref") && !staged && !flag("allow-untagged")) {
    const tags = run("git", ["tag", "--points-at", commit]).split("\n");
    if (!tags.includes(`v${version}`)) fail(`HEAD is not tagged v${version}. Tag the release commit, or pass --allow-untagged for a dry run.`);
  }
  const changelog = readFileSync(resolve(ROOT, "CHANGELOG.md"), "utf8");
  if (!changelog.includes(`## [${version}]`)) fail(`CHANGELOG.md has no section for ${version}.`);
  if (!dryRun && new RegExp(`## \\[${version.replace(/\./g, "\\.")}\\] - unreleased`).test(changelog)) {
    fail(`CHANGELOG.md still marks ${version} as unreleased. Put the release date there.`);
  }

  const top = `${config.productSlug}-${version}`;
  const stage = mkdtempSync(join(tmpdir(), "release-stage-"));
  const out = resolve(ROOT, "dist");
  mkdirSync(out, { recursive: true });

  try {
    // 1. Export the commit and drop what buyers must not get.
    const tarball = join(stage, "source.tar");
    run("git", ["archive", "--format=tar", "-o", tarball, commit]);
    const tree = join(stage, top);
    mkdirSync(tree);
    run("tar", ["-xf", tarball, "-C", tree]);
    rmSync(tarball);

    let removed = 0;
    for (const file of walk(tree)) {
      if (isExcluded(relative(tree, file))) {
        rmSync(file);
        removed++;
      }
    }

    // 2. Buyer-specific edits.
    const edit = (path: string, change: (text: string) => string) => {
      const file = join(tree, path);
      writeFileSync(file, change(readFileSync(file, "utf8")));
    };
    edit("package.json", transformPackageJson);
    edit("README.md", stripMigrateClerk);

    const details: LicenseDetails = { licensor: config.licensor, licensorEmail: config.licensorEmail, jurisdiction: config.jurisdiction };
    const license = fillLicense(readFileSync(resolve(ROOT, "release/LICENSE.md"), "utf8"), details, new Date().getUTCFullYear());
    if (license.unresolved.length > 0 && !flag("allow-placeholders")) {
      fail(`release/config.json still has placeholders for: ${license.unresolved.join(", ")}. Fill them in (or pass --allow-placeholders for a dry run).`);
    }
    writeFileSync(join(tree, "LICENSE.md"), license.text);
    writeFileSync(join(tree, "VERSION"), `${version}\n`);

    // 3. Secret and brand scans over everything that will ship.
    const envFile = resolve(ROOT, ".env.local");
    const literals = existsSync(envFile) ? secretLiterals(readFileSync(envFile, "utf8")) : [];
    const forbidden = config.forbiddenStrings;
    const findings: Finding[] = [];
    for (const file of walk(tree)) {
      const rel = relative(tree, file);
      const buffer = readFileSync(file);
      if (looksBinary(buffer)) continue;
      const text = buffer.toString("utf8");
      findings.push(...scanText(rel, text, { literals, forbidden }));
      const isSource = rel.startsWith("src/") && /\.(tsx?|css)$/.test(rel) && !/\.test\./.test(rel) && rel !== "src/config/site.ts";
      if (isSource) findings.push(...findBrandLeaks(rel, text, "ShipLog"));
    }
    if (findings.length > 0) {
      for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.rule}`);
      fail(`${findings.length} problem(s) found in the files that would ship (see above).`);
    }
    console.log(`Scanned the package: no secrets, personal strings or hardcoded brand names (${literals.length} local .env values checked).`);

    // 4. Zip with a stable order and timestamps, so the same commit gives the same file.
    const commitTime = new Date(Number(run("git", ["log", "-1", "--format=%ct", staged ? "HEAD" : commit])) * 1000);
    const files = walk(tree).sort();
    for (const file of [...files, ...new Set(files.map((f) => join(f, "..")))]) utimesSync(file, commitTime, commitTime);
    const zip = join(out, `${top}.zip`);
    rmSync(zip, { force: true });
    const list = files.map((f) => relative(stage, f)).join("\n");
    const zipped = spawnSync("zip", ["-X", "-q", zip, "-@"], { cwd: stage, input: list, encoding: "utf8" });
    if (zipped.status !== 0) fail(`zip failed: ${zipped.stderr}`);

    // 5. Verify what is actually inside, then checksum.
    const listing = run("unzip", ["-Z1", zip]).split("\n");
    const bad = listing.filter((entry) => isExcluded(entry.slice(top.length + 1)));
    if (bad.length > 0) fail(`the zip contains files that must not ship: ${bad.slice(0, 5).join(", ")}`);
    for (const required of ["LICENSE.md", "VERSION", "README.md", ".env.example", "docs/README.md", "THIRD_PARTY_NOTICES.md"]) {
      if (!listing.includes(`${top}/${required}`)) fail(`the zip is missing ${required}`);
    }
    const hash = createHash("sha256").update(readFileSync(zip)).digest("hex");
    writeFileSync(`${zip}.sha256`, checksumLine(hash, `${top}.zip`));

    console.log(`\n${zip}`);
    console.log(`  ${listing.length} files, ${(statSync(zip).size / 1024).toFixed(0)} KB, ${removed} internal files left out`);
    console.log(`  ${staged ? "staged tree" : "commit"} ${commit.slice(0, 10)}  sha256 ${hash}`);

    if (flag("skip-smoke")) console.log("\nSmoke test skipped.");
    else smokeTest(zip, top);
    console.log("\nRelease package is ready.");
    if (dryRun) console.log("This was a dry run: do not sell this zip.");
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

main();
