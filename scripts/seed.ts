/**
 * Adds a demo project with four weekly logs, a source snapshot and a version history.
 * No GitHub connection or AI key is needed to browse it.
 *
 * Usage: npm run seed -- [--owner <clerk user or org id>] [--user <user id>] [--reset] [--remove] [--usage] [--yes]
 *   (no --owner)  the newest Clerk user, after confirmation
 *   --reset       delete the existing demo project and create it again
 *   --remove      delete the demo project and stop
 *   --usage       also count two generations against this month's limit
 *   --yes         skip the confirmation
 */
import { loadEnvConfig } from "@next/env";
import { createClerkClient } from "@clerk/backend";
import { createInterface } from "node:readline/promises";

loadEnvConfig(process.cwd());

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};

async function confirm(question: string): Promise<boolean> {
  if (flag("yes")) return true;
  if (!process.stdin.isTTY) throw new Error("Not a terminal: pass --yes to continue without confirmation.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`${question} [y/N] `)).trim().toLowerCase().startsWith("y");
  } finally {
    rl.close();
  }
}

async function resolveTarget(): Promise<{ ownerId: string; userId: string; label: string }> {
  const owner = option("owner");
  if (owner) {
    const userId = option("user") ?? owner;
    if (owner.startsWith("org_") && userId === owner) throw new Error("For an organization, also pass --user <the creating user's id>.");
    return { ownerId: owner, userId, label: owner };
  }
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("Pass --owner <id>, or set CLERK_SECRET_KEY so the newest user can be found.");
  const { data } = await createClerkClient({ secretKey }).users.getUserList({ limit: 1, orderBy: "-created_at" });
  const user = data[0];
  if (!user) throw new Error("No users yet. Sign up in the app first, then run this again.");
  const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? "no email";
  return { ownerId: user.id, userId: user.id, label: `${[user.firstName, user.lastName].filter(Boolean).join(" ") || "Unnamed"} <${email}> (${user.id})` };
}

async function main() {
  const { removeDemo, seedDemo } = await import("./lib/seed-demo");
  const target = await resolveTarget();

  if (flag("remove")) {
    if (!(await confirm(`Remove the demo project for ${target.label}?`))) return;
    console.log((await removeDemo(target.ownerId)) ? "Demo project removed." : "There was no demo project.");
    return;
  }

  if (!(await confirm(`Add demo data to ${target.label}?`))) return;
  const result = await seedDemo(target.ownerId, target.userId, { reset: flag("reset"), usage: flag("usage") });
  if (result.status === "exists") {
    console.log("Demo data already exists. Use --reset to recreate it.");
    return;
  }
  console.log(`Demo project created: /dashboard/projects/${result.projectId}`);
  console.log("It counts toward your plan's project limit; remove it any time with: npm run seed -- --remove");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
