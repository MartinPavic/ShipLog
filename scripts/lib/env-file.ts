import { randomBytes } from "node:crypto";

// Minimal .env reader/writer that keeps comments and ordering, so the file stays readable after setup.

function unquote(raw: string): string {
  const value = raw.trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
    const inner = value.slice(1, -1);
    return quote === '"' ? inner.replace(/\\(["\\])/g, "$1") : inner;
  }
  // Unquoted values end at an inline comment.
  return value.replace(/\s+#.*$/, "");
}

export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (match) env[match[1]] = unquote(match[2]);
  }
  return env;
}

function format(value: string): string {
  return /^[\w@%+=:,./-]*$/.test(value) ? value : `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

// Replaces the active assignment, else a commented-out example, else appends.
export function setEnvValue(text: string, key: string, value: string): string {
  const line = `${key}=${format(value)}`;
  const active = new RegExp(`^(\\s*export\\s+)?${key}\\s*=.*$`, "m");
  const commented = new RegExp(`^#\\s*${key}\\s*=.*$`, "m");
  if (active.test(text)) return text.replace(active, () => line);
  if (commented.test(text)) return text.replace(commented, () => line);
  return `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}${line}\n`;
}

export const randomSecret = (bytes: number) => randomBytes(bytes).toString("base64");
