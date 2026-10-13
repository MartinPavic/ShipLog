import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { githubConnections } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { decrypt, encrypt } from "@/lib/crypto";

const GITHUB_API = "https://api.github.com";

export async function getGithubConnection(userId: string) {
  const [row] = await getDb()
    .select()
    .from(githubConnections)
    .where(eq(githubConnections.userId, userId))
    .limit(1);
  return row ? { login: row.login, scopes: row.scopes, token: decrypt(row.encryptedToken) } : null;
}

export async function saveGithubConnection(
  userId: string,
  conn: { login: string; token: string; scopes: string }
) {
  const values = { login: conn.login, encryptedToken: encrypt(conn.token), scopes: conn.scopes };
  await getDb()
    .insert(githubConnections)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: githubConnections.userId, set: values });
}

export async function deleteGithubConnection(userId: string) {
  await getDb().delete(githubConnections).where(eq(githubConnections.userId, userId));
}

async function ghFetch(token: string, path: string): Promise<Response> {
  try {
    return await fetch(`${GITHUB_API}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(502, "Could not reach GitHub. Try again shortly.", "GITHUB_UNAVAILABLE");
  }
}

function githubError(status: number, repo?: string | null) {
  if (status === 401) {
    return new ApiError(400, "GitHub rejected your token. Reconnect it in Settings.", "GITHUB_AUTH");
  }
  if (status === 403 || status === 404) {
    return new ApiError(
      400,
      repo
        ? `Cannot access ${repo}. Check the name and that your token has access.`
        : "GitHub denied access. Check your token's permissions.",
      "GITHUB_ACCESS"
    );
  }
  return new ApiError(502, "GitHub is temporarily unavailable. Try again shortly.", "GITHUB_UNAVAILABLE");
}

export async function verifyGithubToken(token: string) {
  const res = await ghFetch(token, "/user");
  if (!res.ok) throw githubError(res.status);
  const { login } = (await res.json()) as { login: string };
  return { login, scopes: res.headers.get("x-oauth-scopes") ?? "" };
}

type GitHubCommit = { commit: { message: string; author: { date: string } | null } };
type GitHubEvent = {
  type: string;
  created_at: string;
  repo: { name: string };
  payload: { commits?: { message: string }[] };
};

const firstLine = (message: string) => message.split("\n")[0];

// Interim activity fetch; Phase 3 replaces this with commits, PRs, issues and releases.
export async function fetchCommitLines(
  token: string,
  login: string,
  repo: string | null,
  since: Date
): Promise<string> {
  if (repo) {
    const res = await ghFetch(token, `/repos/${repo}/commits?since=${since.toISOString()}&per_page=50`);
    if (!res.ok) throw githubError(res.status, repo);
    const commits = (await res.json()) as GitHubCommit[];
    return commits
      .map((c) => `- ${firstLine(c.commit.message)} (${c.commit.author?.date.slice(0, 10) ?? "unknown"})`)
      .join("\n");
  }

  const res = await ghFetch(token, `/users/${encodeURIComponent(login)}/events?per_page=50`);
  if (!res.ok) throw githubError(res.status);
  const events = (await res.json()) as GitHubEvent[];
  return events
    .filter((e) => e.type === "PushEvent" && new Date(e.created_at) >= since)
    .flatMap((e) => (e.payload.commits ?? []).map((c) => `- ${firstLine(c.message)} (${e.repo.name})`))
    .slice(0, 40)
    .join("\n");
}
