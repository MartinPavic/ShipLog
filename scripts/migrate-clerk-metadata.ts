/**
 * Moves secrets, plan and ship log history from Clerk privateMetadata into the database.
 * Idempotent: rows already present are kept, and Clerk keys are only cleared once migrated.
 *
 * Usage: npm run migrate:clerk -- [--dry-run]
 */
import { loadEnvConfig } from "@next/env";
import { createClerkClient } from "@clerk/backend";

loadEnvConfig(process.cwd());

type LegacyMetadata = {
  githubToken?: string;
  aiApiKey?: string;
  aiProvider?: string;
  plan?: string;
  stripeCustomerId?: string;
  subscriptionStatus?: string;
  generationCount?: number;
  generationMonth?: string;
  shipLogs?: { id?: string; createdAt: string; content: string; period?: string }[];
};

const DRY_RUN = process.argv.includes("--dry-run");
const DAY_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  // Imported after env is loaded so the db and crypto modules see DATABASE_URL / ENCRYPTION_KEY.
  const { getDb } = await import("../src/db/index");
  const { aiCredentials, billingAccounts, githubConnections, projects, shipLogs } = await import("../src/db/schema");
  const { encrypt, last4 } = await import("../src/lib/crypto");
  const { verifyGithubToken } = await import("../src/lib/github");
  const { AI_PROVIDERS } = await import("../src/lib/ai/models");
  const { eq, and } = await import("drizzle-orm");

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is not set");
  const clerk = createClerkClient({ secretKey });
  const db = getDb();

  console.log(DRY_RUN ? "DRY RUN: no changes will be written." : "Applying migration.");

  const totals = { users: 0, github: 0, ai: 0, plan: 0, logs: 0, skipped: 0 };

  for (let offset = 0; ; offset += 100) {
    const { data: users } = await clerk.users.getUserList({ limit: 100, offset });
    if (users.length === 0) break;

    for (const user of users) {
      const meta = user.privateMetadata as LegacyMetadata;
      const hasLegacy = meta.githubToken || meta.aiApiKey || meta.plan || meta.shipLogs?.length;
      if (!hasLegacy) continue;
      totals.users++;

      // Only keys that landed in the database are cleared from Clerk.
      const clear: Record<string, null> = {};
      const log = (msg: string) => console.log(`[${user.id}] ${msg}`);

      if (meta.githubToken) {
        try {
          const { login, scopes } = await verifyGithubToken(meta.githubToken);
          if (!DRY_RUN) {
            await db
              .insert(githubConnections)
              .values({ userId: user.id, login, scopes, encryptedToken: encrypt(meta.githubToken) })
              .onConflictDoNothing();
          }
          clear.githubToken = null;
          totals.github++;
          log(`github token -> github_connections (${login})`);
        } catch {
          totals.skipped++;
          log("github token rejected by GitHub; left in Clerk");
        }
      }

      if (meta.aiApiKey) {
        const provider = AI_PROVIDERS.find((p) => p === meta.aiProvider) ?? "openai";
        if (!DRY_RUN) {
          await db
            .insert(aiCredentials)
            .values({ ownerId: user.id, provider, encryptedKey: encrypt(meta.aiApiKey), last4: last4(meta.aiApiKey) })
            .onConflictDoNothing();
        }
        clear.aiApiKey = null;
        clear.aiProvider = null;
        totals.ai++;
        log(`ai key (${provider}) -> ai_credentials`);
      }

      if (meta.plan === "pro") {
        if (!DRY_RUN) {
          await db
            .insert(billingAccounts)
            .values({
              ownerId: user.id,
              plan: "pro",
              status: meta.subscriptionStatus ?? "active",
              stripeCustomerId: meta.stripeCustomerId ?? null,
            })
            .onConflictDoNothing();
        }
        clear.plan = null;
        clear.subscriptionStatus = null;
        clear.stripeCustomerId = null;
        totals.plan++;
        log("plan pro -> billing_accounts");
      }

      if (meta.shipLogs?.length) {
        let projectId: string | undefined;
        if (!DRY_RUN) {
          await db
            .insert(projects)
            .values({ ownerId: user.id, createdBy: user.id, name: "Imported", slug: "imported" })
            .onConflictDoNothing();
          [{ id: projectId }] = await db
            .select({ id: projects.id })
            .from(projects)
            .where(and(eq(projects.ownerId, user.id), eq(projects.slug, "imported")));
        }

        for (const entry of meta.shipLogs) {
          const createdAt = new Date(entry.createdAt);
          const days = Number(/Last (\d+) days/.exec(entry.period ?? "")?.[1]) || 7;
          if (!DRY_RUN && projectId) {
            await db
              .insert(shipLogs)
              .values({
                ...(entry.id && UUID_RE.test(entry.id) ? { id: entry.id } : {}),
                projectId,
                ownerId: user.id,
                createdBy: user.id,
                title: entry.period ?? "Imported log",
                content: entry.content,
                periodStart: new Date(createdAt.getTime() - days * DAY_MS),
                periodEnd: createdAt,
                template: "weekly_update",
                status: "ready",
                createdAt,
              })
              .onConflictDoNothing();
          }
          totals.logs++;
        }
        clear.shipLogs = null;
        log(`${meta.shipLogs.length} ship logs -> project "Imported"`);
      }

      if (!DRY_RUN && Object.keys(clear).length > 0) {
        // Always drop the old usage counters once anything migrated; the database tracks usage now.
        await clerk.users.updateUserMetadata(user.id, {
          privateMetadata: { ...clear, generationCount: null, generationMonth: null },
        });
      }
    }
  }

  console.log("Done:", totals);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
