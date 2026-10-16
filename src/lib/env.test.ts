import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { features, formatEnvReport, isMockAi, managedAiKey, validateEnv } from "@/env";

const complete = () => ({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x",
  CLERK_SECRET_KEY: "sk_test_x",
  DATABASE_URL: "postgres://u:p@host/db",
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  GITHUB_CLIENT_ID: "id",
  GITHUB_CLIENT_SECRET: "secret",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_PRICE_ID: "price_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  CRON_SECRET: "a-sufficiently-long-secret",
  OPENAI_API_KEY: "sk-x",
  RESEND_API_KEY: "re_x",
  RESEND_FROM: "App <noreply@example.com>",
  NEXT_PUBLIC_APP_URL: "https://app.example.com",
});

describe("features", () => {
  it("are all on when nothing is set", () => {
    expect(features({})).toEqual({ billing: true, managedAi: true, teams: true, scheduling: true, delivery: true });
  });

  it("turn off for false, 0, off and no in any case, and ignore everything else", () => {
    for (const off of ["false", "FALSE", " 0 ", "off", "No"]) {
      expect(features({ BILLING_ENABLED: off }).billing).toBe(false);
    }
    for (const on of ["true", "1", "yes", "", "banana"]) {
      expect(features({ BILLING_ENABLED: on }).billing).toBe(true);
    }
  });

  it("are independent of each other", () => {
    expect(features({ TEAMS_ENABLED: "false", DELIVERY_ENABLED: "false" })).toEqual({
      billing: true,
      managedAi: true,
      teams: false,
      scheduling: true,
      delivery: false,
    });
  });

  it("read the live environment by default", () => {
    process.env.SCHEDULING_ENABLED = "false";
    try {
      expect(features().scheduling).toBe(false);
    } finally {
      delete process.env.SCHEDULING_ENABLED;
    }
    expect(features().scheduling).toBe(true);
  });
});

describe("isMockAi and managedAiKey", () => {
  it("detect demo mode", () => {
    expect(isMockAi({ AI_PROVIDER: "mock" })).toBe(true);
    expect(isMockAi({ AI_PROVIDER: " MOCK " })).toBe(true);
    expect(isMockAi({ AI_PROVIDER: "live" })).toBe(false);
    expect(isMockAi({})).toBe(false);
  });

  it("only expose the managed key while managed AI is on", () => {
    expect(managedAiKey({ OPENAI_API_KEY: "sk-1" })).toBe("sk-1");
    expect(managedAiKey({ OPENAI_API_KEY: "sk-1", MANAGED_AI_ENABLED: "false" })).toBeUndefined();
    expect(managedAiKey({ OPENAI_API_KEY: "  " })).toBeUndefined();
    expect(managedAiKey({})).toBeUndefined();
  });
});

describe("validateEnv", () => {
  it("accepts a complete production environment without warnings", () => {
    expect(validateEnv(complete(), true)).toEqual({ errors: [], warnings: [] });
  });

  it("lists every missing variable at once, naming where to get it", () => {
    const { errors } = validateEnv({}, false);
    for (const name of [
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      "CLERK_SECRET_KEY",
      "DATABASE_URL",
      "ENCRYPTION_KEY",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "STRIPE_SECRET_KEY",
      "STRIPE_PRICE_ID",
      "STRIPE_WEBHOOK_SECRET",
      "CRON_SECRET",
    ]) {
      expect(errors.some((e) => e.includes(name)), name).toBe(true);
    }
    expect(errors.find((e) => e.includes("ENCRYPTION_KEY"))).toContain("openssl rand -base64 32");
  });

  it("treats blank values as missing", () => {
    const env = { ...complete(), DATABASE_URL: "   ", GITHUB_CLIENT_ID: "" };
    const { errors } = validateEnv(env, true);
    expect(errors).toHaveLength(2);
  });

  it("rejects an encryption key of the wrong size", () => {
    const { errors } = validateEnv({ ...complete(), ENCRYPTION_KEY: randomBytes(16).toString("base64") }, true);
    expect(errors).toEqual([expect.stringContaining("32 random bytes")]);
  });

  it("drops the requirements of switched-off features", () => {
    const base = complete();
    delete (base as Partial<typeof base>).STRIPE_SECRET_KEY;
    delete (base as Partial<typeof base>).STRIPE_PRICE_ID;
    delete (base as Partial<typeof base>).STRIPE_WEBHOOK_SECRET;
    delete (base as Partial<typeof base>).CRON_SECRET;
    expect(validateEnv(base, true).errors).toHaveLength(4);
    expect(validateEnv({ ...base, BILLING_ENABLED: "false" }, true).errors).toHaveLength(1);
    expect(validateEnv({ ...base, BILLING_ENABLED: "false", SCHEDULING_ENABLED: "false" }, true).errors).toEqual([]);
  });

  it("rejects a short cron secret", () => {
    expect(validateEnv({ ...complete(), CRON_SECRET: "short" }, true).errors).toEqual([
      expect.stringContaining("at least 16 characters"),
    ]);
  });

  it("requires a valid public URL only in production", () => {
    const env = complete();
    delete (env as Partial<typeof env>).NEXT_PUBLIC_APP_URL;
    expect(validateEnv(env, false).errors).toEqual([]);
    expect(validateEnv(env, true).errors).toEqual([expect.stringContaining("NEXT_PUBLIC_APP_URL")]);
    expect(validateEnv({ ...env, NEXT_PUBLIC_APP_URL: "not a url" }, true).errors).toHaveLength(1);
  });

  it("rejects an unknown AI_PROVIDER", () => {
    expect(validateEnv({ ...complete(), AI_PROVIDER: "gpt" }, true).errors).toEqual([
      expect.stringContaining("AI_PROVIDER"),
    ]);
    expect(validateEnv({ ...complete(), AI_PROVIDER: "mock" }, true).errors).toEqual([]);
  });

  it("warns, rather than fails, about optional pieces", () => {
    const env = complete();
    delete (env as Partial<typeof env>).OPENAI_API_KEY;
    delete (env as Partial<typeof env>).RESEND_API_KEY;
    const report = validateEnv({ ...env, NEXT_PUBLIC_APP_URL: "http://localhost:3000" }, true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toHaveLength(3);
    expect(report.warnings.join("\n")).toMatch(/OPENAI_API_KEY[\s\S]*RESEND[\s\S]*localhost/);
  });

  it("warns that demo mode produces placeholder output", () => {
    expect(validateEnv({ ...complete(), AI_PROVIDER: "mock" }, true).warnings).toEqual([
      expect.stringContaining("placeholders"),
    ]);
  });

  it("never echoes values, so a report is safe to log", () => {
    const env = { ...complete(), ENCRYPTION_KEY: "super-secret-but-invalid", CRON_SECRET: "tiny-secret" };
    const text = formatEnvReport(validateEnv(env, true));
    expect(text).not.toContain("super-secret-but-invalid");
    expect(text).not.toContain("tiny-secret");
  });
});

describe("formatEnvReport", () => {
  it("is empty when there is nothing to say", () => {
    expect(formatEnvReport({ errors: [], warnings: [] })).toBe("");
  });

  it("groups errors and warnings", () => {
    expect(formatEnvReport({ errors: ["a"], warnings: ["b"] })).toBe(
      "Invalid environment:\n  - a\nEnvironment warnings:\n  - b"
    );
  });
});
