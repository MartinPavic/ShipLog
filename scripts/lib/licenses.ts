// SPDX identifiers that permit redistribution of an application that depends on them.
export const ALLOWED_LICENSES = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "CC-BY-4.0",
  "Unlicense",
  "Python-2.0",
  "MPL-2.0",
]);

// Reviewed one by one; add a package here only after reading its license.
export const REVIEWED_EXCEPTIONS: Record<string, string> = {
  "@img/sharp-": "Prebuilt sharp/libvips binaries pulled in by Next.js image optimization. libvips is LGPL-3.0-or-later and dynamically linked, which permits use in a proprietary app; npm installs them on the buyer's machine and they are not part of the source zip.",
};

export function reviewedException(name: string): string | null {
  const key = Object.keys(REVIEWED_EXCEPTIONS).find((prefix) => name.startsWith(prefix));
  return key ? REVIEWED_EXCEPTIONS[key] : null;
}

// Handles "A OR B", "A AND B", parentheses and a "+" or "-or-later" suffix on allowed identifiers only literally.
export function isAllowed(expression: string): boolean {
  const tokens = expression.replace(/[()]/g, " ").trim().split(/\s+/);
  if (tokens.length === 0 || tokens[0] === "") return false;
  const groups: string[][] = [[]];
  for (const token of tokens) {
    if (token === "OR") groups.push([]);
    else if (token !== "AND") groups[groups.length - 1].push(token);
  }
  // OR: any alternative suffices; within an alternative (AND) every license must be allowed.
  return groups.some((alt) => alt.length > 0 && alt.every((id) => ALLOWED_LICENSES.has(id)));
}

export type LicenseField = string | { type?: string } | { type?: string }[] | undefined;

export function normalizeLicense(field: LicenseField, legacy?: LicenseField): string {
  const value = field ?? legacy;
  if (!value) return "UNKNOWN";
  if (typeof value === "string") return value.trim() || "UNKNOWN";
  if (Array.isArray(value)) {
    const types = value.map((v) => v.type).filter(Boolean);
    return types.length ? `(${types.join(" OR ")})` : "UNKNOWN";
  }
  return value.type?.trim() || "UNKNOWN";
}

export type Dependency = { name: string; version: string; license: string; url: string };

export function renderNotices(dependencies: Dependency[]): string {
  const rows = [...dependencies]
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
    .map((d) => `| ${d.name} | ${d.version} | ${d.license.replace(/\|/g, "/")} | ${d.url} |`);
  return [
    "# Third-party notices",
    "",
    "This product depends on the open-source packages below. Each remains under its own license; the full text ships",
    "with the package in `node_modules` after `npm install`. Regenerate with `npm run licenses`.",
    "",
    "| Package | Version | License | Source |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}
