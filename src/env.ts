import { z } from "zod";

type Env = Record<string, string | undefined>;

const OFF = new Set(["false", "0", "off", "no"]);

function flag(env: Env, name: string): boolean {
  const raw = env[name]?.trim().toLowerCase();
  return raw === undefined || raw === "" ? true : !OFF.has(raw);
}

export type Features = {
  /** Off: nobody is charged and every workspace gets unlimited use. */
  billing: boolean;
  /** Off: the server's own AI key is never used. */
  managedAi: boolean;
  /** Off: everyone works in a personal workspace; organizations are ignored. */
  teams: boolean;
  scheduling: boolean;
  delivery: boolean;
};

// Read from the environment on every call, so tests and long-running processes see changes.
export function features(env: Env = process.env): Features {
  return {
    billing: flag(env, "BILLING_ENABLED"),
    managedAi: flag(env, "MANAGED_AI_ENABLED"),
    teams: flag(env, "TEAMS_ENABLED"),
    scheduling: flag(env, "SCHEDULING_ENABLED"),
    delivery: flag(env, "DELIVERY_ENABLED"),
  };
}

/** AI_PROVIDER=mock replaces every AI call with a deterministic offline generator (demos, tests). */
export function isMockAi(env: Env = process.env): boolean {
  return env.AI_PROVIDER?.trim().toLowerCase() === "mock";
}

/** The server's own key for managed AI, or undefined when managed AI is off or unconfigured. */
export function managedAiKey(env: Env = process.env): string | undefined {
  return features(env).managedAi ? env.OPENAI_API_KEY?.trim() || undefined : undefined;
}

const required = (hint: string) => z.string({ error: hint }).trim().min(1, hint);

const encryptionKey = required("ENCRYPTION_KEY is required: generate one with `openssl rand -base64 32`").refine(
  (v) => Buffer.from(v, "base64").length === 32,
  "ENCRYPTION_KEY must be 32 random bytes, base64-encoded: `openssl rand -base64 32`"
);

export type EnvReport = { errors: string[]; warnings: string[] };

/**
 * Checks the variables the enabled features depend on. Errors mean the app can't work; warnings
 * mean a feature will be unavailable. `production` makes the public URL mandatory.
 */
export function validateEnv(env: Env = process.env, production = env.NODE_ENV === "production"): EnvReport {
  const set = (name: string) => Boolean(env[name]?.trim());
  const on = features(env);
  const shape: Record<string, z.ZodType> = {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: required("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is required (Clerk dashboard, API keys)"),
    CLERK_SECRET_KEY: required("CLERK_SECRET_KEY is required (Clerk dashboard, API keys)"),
    DATABASE_URL: required("DATABASE_URL is required (Postgres connection string, e.g. from Neon)"),
    ENCRYPTION_KEY: encryptionKey,
    GITHUB_CLIENT_ID: required("GITHUB_CLIENT_ID is required (GitHub OAuth app)"),
    GITHUB_CLIENT_SECRET: required("GITHUB_CLIENT_SECRET is required (GitHub OAuth app)"),
    AI_PROVIDER: z.enum(["live", "mock"], { error: "AI_PROVIDER must be `live` or `mock`" }).optional(),
  };
  if (production) shape.NEXT_PUBLIC_APP_URL = z.url({ error: "NEXT_PUBLIC_APP_URL must be the public https URL of the app" });
  if (on.billing) {
    shape.STRIPE_SECRET_KEY = required("STRIPE_SECRET_KEY is required when BILLING_ENABLED is on");
    shape.STRIPE_PRICE_ID = required("STRIPE_PRICE_ID is required when BILLING_ENABLED is on");
    shape.STRIPE_WEBHOOK_SECRET = required("STRIPE_WEBHOOK_SECRET is required when BILLING_ENABLED is on");
  }
  if (on.scheduling) {
    shape.CRON_SECRET = z
      .string({ error: "CRON_SECRET is required when SCHEDULING_ENABLED is on (or set SCHEDULING_ENABLED=false)" })
      .trim()
      .min(16, "CRON_SECRET must be at least 16 characters: `openssl rand -base64 24`");
  }

  const present = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = z.object(shape).safeParse(present);
  const errors = parsed.success ? [] : [...new Set(parsed.error.issues.map((i) => i.message))];

  const warnings: string[] = [];
  if (isMockAi(env)) warnings.push("AI_PROVIDER=mock: generated logs are placeholders, not real AI output.");
  else if (on.managedAi && on.billing && !set("OPENAI_API_KEY")) {
    warnings.push("OPENAI_API_KEY is not set: Pro workspaces will have to bring their own AI key.");
  }
  if (on.delivery && !(set("RESEND_API_KEY") && set("RESEND_FROM"))) {
    warnings.push("RESEND_API_KEY / RESEND_FROM are not set: the email channel and failure notices are disabled.");
  }
  if (production && set("NEXT_PUBLIC_APP_URL") && /localhost|127\.0\.0\.1/.test(env.NEXT_PUBLIC_APP_URL!)) {
    warnings.push("NEXT_PUBLIC_APP_URL points at localhost in production.");
  }
  return { errors, warnings };
}

export function formatEnvReport({ errors, warnings }: EnvReport): string {
  const lines: string[] = [];
  if (errors.length) lines.push("Invalid environment:", ...errors.map((e) => `  - ${e}`));
  if (warnings.length) lines.push("Environment warnings:", ...warnings.map((w) => `  - ${w}`));
  return lines.join("\n");
}
