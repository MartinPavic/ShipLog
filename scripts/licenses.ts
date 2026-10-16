/**
 * Lists the production dependency tree with each package's license, fails on any license that
 * isn't known to allow redistribution, and writes THIRD_PARTY_NOTICES.md.
 *
 * Usage: npm run licenses            write THIRD_PARTY_NOTICES.md
 *        npm run licenses -- --check verify only; also fail if the committed notices are out of date
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isAllowed, normalizeLicense, renderNotices, reviewedException, type Dependency } from "./lib/licenses";

const ROOT = process.cwd();
const NOTICES = resolve(ROOT, "THIRD_PARTY_NOTICES.md");

type LockEntry = { version?: string; dev?: boolean; license?: string };

// Only the lockfile is read, so the result is identical on every platform and in CI,
// where optional platform packages for other systems are not installed.
function collect(): Dependency[] {
  const lock = JSON.parse(readFileSync(resolve(ROOT, "package-lock.json"), "utf8")) as { packages: Record<string, LockEntry> };
  const found = new Map<string, Dependency>();
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path.startsWith("node_modules/") || entry.dev) continue;
    const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    const version = entry.version ?? "?";
    found.set(`${name}@${version}`, {
      name,
      version,
      license: normalizeLicense(entry.license),
      url: `https://www.npmjs.com/package/${name}`,
    });
  }
  return [...found.values()];
}

const check = process.argv.includes("--check");
const dependencies = collect();

const rejected = dependencies.filter((d) => !isAllowed(d.license) && !reviewedException(d.name));
for (const d of rejected) console.error(`Not cleared for redistribution: ${d.name}@${d.version} (${d.license})`);

const reviewed = dependencies.filter((d) => !isAllowed(d.license) && reviewedException(d.name));
for (const reason of new Set(reviewed.map((d) => reviewedException(d.name)))) {
  console.log(`Reviewed exception (${reviewed.filter((d) => reviewedException(d.name) === reason).length} packages): ${reason}`);
}

const notices = renderNotices(dependencies);
let stale = false;
if (check) {
  stale = !existsSync(NOTICES) || readFileSync(NOTICES, "utf8") !== notices;
  if (stale) console.error("THIRD_PARTY_NOTICES.md is out of date. Run `npm run licenses` and commit the result.");
} else {
  writeFileSync(NOTICES, notices);
  console.log(`Wrote THIRD_PARTY_NOTICES.md (${dependencies.length} packages).`);
}

if (rejected.length > 0 || stale) process.exit(1);
console.log(`${dependencies.length} production packages checked: all licenses allow redistribution.`);
