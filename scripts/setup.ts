/**
 * Guided first-time setup: creates .env.local, generates secrets, asks for service credentials
 * (every step can be skipped), checks the database, applies migrations and prints what is left.
 * Safe to re-run: existing values are never replaced without asking.
 *
 * Usage:
 *   npm run setup                         interactive
 *   npm run setup -- --check              validate the environment, no prompts, exit code 1 on errors
 *   npm run setup -- --check --production also require production-only settings
 *   npm run setup -- --check --db         also test the database connection
 */
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { formatEnvReport, type EnvReport } from "../src/env";
import { checkEnvironment, MIN_NODE } from "./lib/check";
import { parseEnv, randomSecret, setEnvValue } from "./lib/env-file";

const ENV_FILE = resolve(process.cwd(), ".env.local");
const EXAMPLE_FILE = resolve(process.cwd(), ".env.example");
const args = new Set(process.argv.slice(2));

function loadEnv(): Record<string, string | undefined> {
  const fromFile = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, "utf8")) : {};
  // Like Next.js: variables already in the process win over the file.
  return { ...fromFile, ...process.env };
}

async function databaseError(url: string | undefined): Promise<string | null> {
  if (!url) return "DATABASE_URL is not set.";
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 10_000 });
  try {
    await pool.query("select 1");
    return null;
  } catch (err) {
    return `Could not connect to the database: ${err instanceof Error ? err.message : "unknown error"}`;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

function print(report: EnvReport) {
  const text = formatEnvReport(report);
  if (text) console.log(text);
}

async function check() {
  const env = loadEnv();
  const report = checkEnvironment(env, { production: args.has("--production"), nodeVersion: process.versions.node });
  if (args.has("--db")) {
    const error = await databaseError(env.DATABASE_URL);
    if (error) report.errors.push(error);
  }
  print(report);
  if (report.errors.length > 0) process.exit(1);
  console.log("Environment looks good.");
}

function manualSteps(env: Record<string, string | undefined>): string[] {
  const off = (name: string) => ["false", "0", "off", "no"].includes((env[name] ?? "").trim().toLowerCase());
  const appUrl = (env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const steps = [`GitHub: set the OAuth app's callback URL to ${appUrl}/api/github/callback`];
  if (!off("TEAMS_ENABLED")) steps.push("Clerk: enable Organizations (dashboard, Configure, Organizations) to use Teams");
  if (!off("BILLING_ENABLED")) {
    steps.push(`Stripe: run "stripe listen --forward-to ${appUrl}/api/webhooks/stripe" and put its signing secret in STRIPE_WEBHOOK_SECRET`);
    steps.push("Stripe: enable the customer portal so \"Manage billing\" works");
  }
  if (!off("SCHEDULING_ENABLED")) steps.push("Deployment: set CRON_SECRET on your host; vercel.json already schedules the cron job");
  steps.push("Optional: edit src/config/site.ts (name, copy, price display) and the legal pages");
  return steps;
}

async function interactive() {
  if (!process.stdin.isTTY) {
    console.error("This command is interactive. Run it in a terminal, or use --check for a non-interactive validation.");
    process.exit(1);
  }
  const node = process.versions.node;
  if (checkEnvironment({}, { production: false, nodeVersion: node }).errors.some((e) => e.startsWith("Node.js"))) {
    console.error(`Node.js ${MIN_NODE.major}.${MIN_NODE.minor} or newer is required (found ${node}).`);
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (question: string) => (await rl.question(question)).trim();
  const confirm = async (question: string, fallback: boolean) => {
    const answer = (await ask(`${question} ${fallback ? "[Y/n]" : "[y/N]"} `)).toLowerCase();
    return answer === "" ? fallback : answer.startsWith("y");
  };

  let text: string;
  if (existsSync(ENV_FILE)) {
    text = readFileSync(ENV_FILE, "utf8");
    console.log("Using the existing .env.local. Nothing is replaced without asking.\n");
  } else {
    copyFileSync(EXAMPLE_FILE, ENV_FILE);
    chmodSync(ENV_FILE, 0o600);
    text = readFileSync(ENV_FILE, "utf8");
    console.log("Created .env.local from .env.example.\n");
  }
  const get = (key: string) => parseEnv(text)[key] ?? "";
  // Saved after every change so Ctrl-C never loses progress. The file holds secrets, so it stays private.
  const save = (key: string, value: string) => {
    text = setEnvValue(text, key, value);
    writeFileSync(ENV_FILE, text, { mode: 0o600 });
  };

  async function prompt(key: string, label: string) {
    if (get(key)) {
      if (!(await confirm(`${key} is already set. Replace it?`, false))) return;
    }
    const value = await ask(`${label} (Enter to skip): `);
    if (value) save(key, value);
  }

  // Keys flagged optional don't count as missing; a group with only optional keys is done once any is set.
  async function group(title: string, help: string, keys: [string, string, boolean?][]) {
    console.log(`\n${title}\n  ${help}`);
    const required = keys.filter(([, , optional]) => !optional);
    const configured = required.length > 0 ? required.every(([key]) => get(key)) : keys.some(([key]) => get(key));
    if (configured && !(await confirm("  Already configured. Reconfigure?", false))) return;
    for (const [key, label] of keys) await prompt(key, `  ${label}`);
  }

  try {
    if (!get("ENCRYPTION_KEY")) {
      save("ENCRYPTION_KEY", randomSecret(32));
      console.log("Generated ENCRYPTION_KEY. Back it up: without it stored tokens and keys become unreadable.");
    }
    if (get("CRON_SECRET").length < 16) {
      save("CRON_SECRET", randomSecret(24));
      console.log("Generated CRON_SECRET.");
    }

    await group("Clerk (authentication)", "https://dashboard.clerk.com, your application, API keys.", [
      ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "Publishable key"],
      ["CLERK_SECRET_KEY", "Secret key"],
    ]);
    await group("Database (Neon Postgres)", "Neon console, connection details. Use the pooled URL here.", [
      ["DATABASE_URL", "Pooled connection string"],
      ["DATABASE_URL_UNPOOLED", "Direct connection string for migrations", true],
    ]);
    const appUrl = (get("NEXT_PUBLIC_APP_URL") || "http://localhost:3000").replace(/\/$/, "");
    await group("GitHub OAuth app", `GitHub, Settings, Developer settings, OAuth Apps. Callback URL: ${appUrl}/api/github/callback`, [
      ["GITHUB_CLIENT_ID", "Client ID"],
      ["GITHUB_CLIENT_SECRET", "Client secret"],
    ]);

    console.log("\nBilling");
    const billing = await confirm("  Charge for a Pro plan with Stripe? (No removes the paywall: everything is unlimited.)", get("BILLING_ENABLED") !== "false");
    save("BILLING_ENABLED", String(billing));
    if (billing) {
      await group("Stripe", "https://dashboard.stripe.com, test mode is fine to start.", [
        ["STRIPE_SECRET_KEY", "Secret key"],
        ["STRIPE_PRICE_ID", "Pro price id (price_...)"],
        ["STRIPE_WEBHOOK_SECRET", "Webhook signing secret (whsec_..., from `stripe listen`)"],
      ]);
    }

    console.log("\nAI");
    const demo = await confirm("  Use demo mode (placeholder output, no AI key needed)?", get("AI_PROVIDER") === "mock");
    save("AI_PROVIDER", demo ? "mock" : "live");
    if (!demo && billing) {
      await group("Managed AI (optional)", "An OpenAI key lets Pro workspaces generate without their own key.", [["OPENAI_API_KEY", "OpenAI API key", true]]);
    }

    await group("Email (optional)", "https://resend.com. Needed for email delivery and failure notices.", [
      ["RESEND_API_KEY", "API key", true],
      ["RESEND_FROM", 'Sender, e.g. "Your App <noreply@yourdomain.com>"', true],
    ]);

    const env = loadEnv();
    console.log("");
    print(checkEnvironment(env, { production: false, nodeVersion: node }));

    let dbReady = false;
    if (env.DATABASE_URL) {
      const error = await databaseError(env.DATABASE_URL);
      if (error) console.log(error);
      else {
        dbReady = true;
        console.log("Database connection works.");
      }
    }
    if (dbReady && (await confirm("Apply database migrations now?", true))) {
      const result = spawnSync("npx", ["drizzle-kit", "migrate"], { stdio: "inherit" });
      if (result.status !== 0) {
        console.log("Migrations failed; fix the error above and run `npm run db:migrate`.");
        dbReady = false;
      }
    }
    if (dbReady && (await confirm("Add demo data? (Sign up in the app first, then it is added to your newest account.)", false))) {
      spawnSync("npx", ["tsx", "scripts/seed.ts"], { stdio: "inherit" });
    }

    console.log("\nStill to do by hand:");
    for (const step of manualSteps(loadEnv())) console.log(`  - ${step}`);
    console.log("\nThen start the app with: npm run dev");
  } finally {
    rl.close();
  }
}

(args.has("--check") ? check() : interactive()).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
