import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkEnvironment, nodeSupported } from "./check";

const validEnv = () => ({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x",
  CLERK_SECRET_KEY: "sk_test_x",
  DATABASE_URL: "postgres://u:p@localhost/db",
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  GITHUB_CLIENT_ID: "id",
  GITHUB_CLIENT_SECRET: "secret",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_PRICE_ID: "price_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  CRON_SECRET: "a-sufficiently-long-secret",
});

describe("nodeSupported", () => {
  it("accepts 22.12 and newer only", () => {
    expect(nodeSupported("22.12.0")).toBe(true);
    expect(nodeSupported("v24.1.0")).toBe(true);
    expect(nodeSupported("22.11.9")).toBe(false);
    expect(nodeSupported("20.19.0")).toBe(false);
    expect(nodeSupported("garbage")).toBe(false);
  });
});

describe("checkEnvironment", () => {
  it("passes a complete environment on a supported Node", () => {
    expect(checkEnvironment(validEnv(), { production: false, nodeVersion: "24.0.0" }).errors).toEqual([]);
  });

  it("puts an unsupported Node first", () => {
    const { errors } = checkEnvironment(validEnv(), { production: false, nodeVersion: "18.0.0" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Node.js 22.12");
  });

  it("applies production-only rules when asked", () => {
    expect(checkEnvironment(validEnv(), { production: false, nodeVersion: "24.0.0" }).errors).toEqual([]);
    expect(checkEnvironment(validEnv(), { production: true, nodeVersion: "24.0.0" }).errors).toHaveLength(1);
  });
});

// Only PATH is inherited, so the developer's own variables can't change the outcome.
const childEnv = (extra: Record<string, string>) =>
  ({ PATH: process.env.PATH ?? "", NODE_ENV: "development", ...extra }) as NodeJS.ProcessEnv;

describe("npm run setup -- --check", () => {
  const tsx = resolve(__dirname, "../../node_modules/.bin/tsx");
  const script = resolve(__dirname, "../setup.ts");
  // An empty directory, so the developer's own .env.local can't leak into the result.
  const run = (env: Record<string, string>, extra: string[] = []) => {
    const cwd = mkdtempSync(join(tmpdir(), "setup-check-"));
    try {
      return spawnSync(tsx, [script, "--check", ...extra], {
        cwd,
        env: childEnv(env),
        encoding: "utf8",
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  };

  it("exits 0 for a valid environment", () => {
    const result = run(validEnv());
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Environment looks good.");
  }, 30_000);

  it("exits 1 and lists the problems, never the values", () => {
    const result = run({ ...validEnv(), ENCRYPTION_KEY: "super-secret-but-short" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("ENCRYPTION_KEY");
    expect(result.stdout).not.toContain("super-secret-but-short");
  }, 30_000);

  it("reads .env.local from the working directory, with the process environment winning", () => {
    const cwd = mkdtempSync(join(tmpdir(), "setup-check-"));
    try {
      const file = Object.entries({ ...validEnv(), CRON_SECRET: "short" }).map(([k, v]) => `${k}=${v}`).join("\n");
      writeFileSync(join(cwd, ".env.local"), file);
      const base = { cwd, encoding: "utf8" as const };
      const fromFile = spawnSync(tsx, [script, "--check"], { ...base, env: childEnv({}) });
      expect(fromFile.status).toBe(1);
      expect(fromFile.stdout).toContain("CRON_SECRET");
      const overridden = spawnSync(tsx, [script, "--check"], {
        ...base,
        env: childEnv({ CRON_SECRET: "a-sufficiently-long-secret" }),
      });
      expect(overridden.status, overridden.stdout).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails --db clearly when the database can't be reached", () => {
    const result = run({ ...validEnv(), DATABASE_URL: "postgres://u:p@127.0.0.1:1/db" }, ["--db"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Could not connect to the database");
    expect(result.stdout).not.toContain("u:p@");
  }, 30_000);
});
