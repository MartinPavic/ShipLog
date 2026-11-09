import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { gitlabConnections, gitlabInstances, projects } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { decrypt, encrypt } from "@/lib/crypto";
import { normalizeGitLabBaseUrl, refreshGitLabToken, type GitLabRequester, type GitLabTokenSet } from "@/lib/gitlab-oauth";

export async function getGitLabInstance(ownerId: string) {
  const [row] = await getDb().select().from(gitlabInstances).where(eq(gitlabInstances.ownerId, ownerId)).limit(1);
  return row ? { ...row, baseUrl: normalizeGitLabBaseUrl(row.baseUrl), clientSecret: decrypt(row.encryptedClientSecret) } : null;
}

export async function getGitLabInstanceStatus(ownerId: string) {
  const [row] = await getDb().select().from(gitlabInstances).where(eq(gitlabInstances.ownerId, ownerId)).limit(1);
  return row ? { baseUrl: row.baseUrl, clientId: row.clientId, configured: true as const } : null;
}

export async function getGitLabConnection(ownerId: string, userId: string) {
  const [row] = await getDb()
    .select()
    .from(gitlabConnections)
    .where(and(eq(gitlabConnections.ownerId, ownerId), eq(gitlabConnections.userId, userId)))
    .limit(1);
  return row
    ? {
        ...row,
        accessToken: decrypt(row.encryptedAccessToken),
        refreshToken: decrypt(row.encryptedRefreshToken),
      }
    : null;
}

export async function getGitLabConnectionStatus(ownerId: string, userId: string) {
  const [row] = await getDb()
    .select({ username: gitlabConnections.username, expiresAt: gitlabConnections.expiresAt })
    .from(gitlabConnections)
    .where(and(eq(gitlabConnections.ownerId, ownerId), eq(gitlabConnections.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function saveGitLabConnection(ownerId: string, userId: string, connection: {
  username: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string;
}) {
  const values = {
    username: connection.username,
    encryptedAccessToken: encrypt(connection.accessToken),
    encryptedRefreshToken: encrypt(connection.refreshToken),
    expiresAt: connection.expiresAt,
    scopes: connection.scopes,
    updatedAt: new Date(),
  };
  await getDb()
    .insert(gitlabConnections)
    .values({ ownerId, userId, ...values })
    .onConflictDoUpdate({ target: [gitlabConnections.ownerId, gitlabConnections.userId], set: values });
}

export async function saveGitLabTokenSet(
  ownerId: string,
  userId: string,
  username: string,
  tokenSet: GitLabTokenSet,
  expectedInstance?: { baseUrl: string; clientId: string }
) {
  const connection = { username, ...tokenSet };
  if (!expectedInstance) return saveGitLabConnection(ownerId, userId, connection);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtext(${"gitlab-instance:" + ownerId}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`gitlab-connection:${ownerId}:${userId}`}))`);
    const [instance] = await tx.select().from(gitlabInstances).where(eq(gitlabInstances.ownerId, ownerId)).limit(1);
    if (!instance || instance.clientId !== expectedInstance.clientId || normalizeGitLabBaseUrl(instance.baseUrl) !== expectedInstance.baseUrl) {
      throw new ApiError(409, "GitLab settings changed during authorization. Start the connection again.", "GITLAB_CONFIG_CHANGED");
    }
    const values = {
      username: connection.username,
      encryptedAccessToken: encrypt(connection.accessToken),
      encryptedRefreshToken: encrypt(connection.refreshToken),
      expiresAt: connection.expiresAt,
      scopes: connection.scopes,
      updatedAt: new Date(),
    };
    await tx
      .insert(gitlabConnections)
      .values({ ownerId, userId, ...values })
      .onConflictDoUpdate({ target: [gitlabConnections.ownerId, gitlabConnections.userId], set: values });
  });
}

export async function getFreshGitLabConnection(ownerId: string, userId: string, sender?: GitLabRequester) {
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtext(${"gitlab-instance:" + ownerId}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`gitlab-connection:${ownerId}:${userId}`}))`);
    const [instance] = await tx.select().from(gitlabInstances).where(eq(gitlabInstances.ownerId, ownerId)).limit(1);
    if (!instance) throw new ApiError(400, "Ask a workspace admin to configure GitLab first.", "NO_GITLAB_INSTANCE");
    const [row] = await tx
      .select()
      .from(gitlabConnections)
      .where(and(eq(gitlabConnections.ownerId, ownerId), eq(gitlabConnections.userId, userId)))
      .limit(1);
    if (!row) throw new ApiError(400, "Connect GitLab in Settings first.", "NO_GITLAB");
    const baseUrl = normalizeGitLabBaseUrl(instance.baseUrl);

    if (row.expiresAt.getTime() <= Date.now() + 60_000) {
      try {
        const rotated = await refreshGitLabToken(baseUrl, {
          clientId: instance.clientId,
          clientSecret: decrypt(instance.encryptedClientSecret),
        }, decrypt(row.encryptedRefreshToken), sender);
        const values = {
          encryptedAccessToken: encrypt(rotated.accessToken),
          encryptedRefreshToken: encrypt(rotated.refreshToken),
          expiresAt: rotated.expiresAt,
          scopes: rotated.scopes || row.scopes,
          updatedAt: new Date(),
        };
        await tx
          .update(gitlabConnections)
          .set(values)
          .where(and(eq(gitlabConnections.ownerId, ownerId), eq(gitlabConnections.userId, userId)));
        return { reconnectRequired: false as const, connection: { username: row.username, baseUrl, accessToken: rotated.accessToken } };
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "GITLAB_AUTH") throw error;
        await tx.delete(gitlabConnections).where(and(eq(gitlabConnections.ownerId, ownerId), eq(gitlabConnections.userId, userId)));
        return { reconnectRequired: true as const };
      }
    }
    return { reconnectRequired: false as const, connection: { username: row.username, baseUrl, accessToken: decrypt(row.encryptedAccessToken) } };
  });
  if (result.reconnectRequired) throw new ApiError(400, "Your GitLab session expired. Reconnect GitLab in Settings.", "GITLAB_RECONNECT");
  return result.connection;
}

export async function deleteGitLabConnection(ownerId: string, userId: string) {
  await getDb()
    .delete(gitlabConnections)
    .where(and(eq(gitlabConnections.ownerId, ownerId), eq(gitlabConnections.userId, userId)));
}

async function hasGitLabRepos(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], ownerId: string) {
  const [row] = await tx
    .select({ hasRepos: sql<boolean>`coalesce(bool_or(exists (
      select 1
      from jsonb_array_elements(coalesce(${projects.repos}, '[]'::jsonb)) as repo
      where repo->>'provider' = 'gitlab'
    )), false)` })
    .from(projects)
    .where(eq(projects.ownerId, ownerId))
    .limit(1);
  return Boolean(row?.hasRepos);
}

export async function configureGitLabInstance(ownerId: string, input: {
  baseUrl: string;
  clientId: string;
  clientSecret?: string;
}) {
  const baseUrl = normalizeGitLabBaseUrl(input.baseUrl);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"gitlab-instance:" + ownerId}))`);
    const [existing] = await tx.select().from(gitlabInstances).where(eq(gitlabInstances.ownerId, ownerId)).limit(1);
    const urlChanged = Boolean(existing && normalizeGitLabBaseUrl(existing.baseUrl) !== baseUrl);
    if (urlChanged && await hasGitLabRepos(tx, ownerId)) {
      throw new ApiError(409, "Remove GitLab repositories from projects before changing the GitLab instance URL.", "GITLAB_REPOS_IN_USE");
    }
    if (!existing && !input.clientSecret) {
      throw new ApiError(400, "Enter the GitLab OAuth client secret.", "VALIDATION");
    }
    if (existing && (urlChanged || existing.clientId !== input.clientId) && !input.clientSecret) {
      throw new ApiError(400, "Enter the matching OAuth client secret when changing the host or client ID.", "VALIDATION");
    }

    const credentialsChanged = Boolean(existing && (urlChanged || existing.clientId !== input.clientId || input.clientSecret));
    const encryptedClientSecret = input.clientSecret ? encrypt(input.clientSecret) : existing?.encryptedClientSecret;
    if (!encryptedClientSecret) throw new ApiError(400, "Enter the GitLab OAuth client secret.", "VALIDATION");
    const values = { baseUrl, clientId: input.clientId, encryptedClientSecret, updatedAt: new Date() };
    await tx
      .insert(gitlabInstances)
      .values({ ownerId, ...values })
      .onConflictDoUpdate({ target: gitlabInstances.ownerId, set: values });
    if (credentialsChanged) await tx.delete(gitlabConnections).where(eq(gitlabConnections.ownerId, ownerId));
  });
}

export async function deleteGitLabInstance(ownerId: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"gitlab-instance:" + ownerId}))`);
    if (await hasGitLabRepos(tx, ownerId)) {
      throw new ApiError(409, "Remove GitLab repositories from projects before removing this instance.", "GITLAB_REPOS_IN_USE");
    }
    await tx.delete(gitlabConnections).where(eq(gitlabConnections.ownerId, ownerId));
    await tx.delete(gitlabInstances).where(eq(gitlabInstances.ownerId, ownerId));
  });
}