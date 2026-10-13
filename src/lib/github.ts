import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { githubConnections, type ProjectRepo } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  type Activity,
  type RepoActivity,
  type RawCommit,
  type RawIssue,
  type RawPull,
  type RawRelease,
  applyBudget,
  dropPullCommits,
  normalizeCommits,
  normalizeIssues,
  normalizePulls,
  normalizeReleases,
} from "@/lib/github-activity";

const GITHUB_API = "https://api.github.com";
const PER_PAGE = 100;

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
    return new ApiError(400, "GitHub rejected your token. Reconnect GitHub in Settings.", "GITHUB_AUTH");
  }
  if (status === 403 || status === 404) {
    return new ApiError(
      400,
      repo
        ? `Cannot access ${repo}. Check the name and that your GitHub connection has access.`
        : "GitHub denied access. Check your connection's permissions.",
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

// Pages are capped so a huge repo can't blow the request time or GitHub's rate limit.
async function paginate<T>(
  token: string,
  path: string,
  opts: { repo: string; maxPages: number; stopAfter?: (page: T[]) => boolean }
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= opts.maxPages; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await ghFetch(token, `${path}${sep}per_page=${PER_PAGE}&page=${page}`);
    if (!res.ok) throw githubError(res.status, opts.repo);
    const batch = (await res.json()) as T[];
    items.push(...batch);
    if (batch.length < PER_PAGE || opts.stopAfter?.(batch)) break;
  }
  return items;
}

async function fetchRepoActivity(
  token: string,
  { fullName, branch }: ProjectRepo,
  since: Date,
  until: Date
): Promise<RepoActivity> {
  const range = `since=${since.toISOString()}&until=${until.toISOString()}`;
  const branchParam = branch ? `&sha=${encodeURIComponent(branch)}` : "";
  const sinceMs = since.getTime();

  const [rawCommits, rawPulls, rawIssues, rawReleases] = await Promise.all([
    paginate<RawCommit>(token, `/repos/${fullName}/commits?${range}${branchParam}`, { repo: fullName, maxPages: 3 }),
    paginate<RawPull & { updated_at: string }>(
      token,
      `/repos/${fullName}/pulls?state=closed&sort=updated&direction=desc`,
      {
        repo: fullName,
        maxPages: 3,
        // Sorted by update time, so once a page ends before the window nothing newer follows.
        stopAfter: (page) => new Date(page[page.length - 1].updated_at).getTime() < sinceMs,
      }
    ),
    paginate<RawIssue>(
      token,
      `/repos/${fullName}/issues?state=closed&sort=updated&direction=desc&since=${since.toISOString()}`,
      { repo: fullName, maxPages: 2 }
    ),
    paginate<RawRelease>(token, `/repos/${fullName}/releases`, { repo: fullName, maxPages: 1 }),
  ]);

  const pullRequests = normalizePulls(rawPulls, since, until);
  return {
    repo: fullName,
    commits: dropPullCommits(normalizeCommits(rawCommits), pullRequests),
    pullRequests,
    issues: normalizeIssues(rawIssues, since, until),
    releases: normalizeReleases(rawReleases, since, until),
    omitted: { commits: 0, pullRequests: 0, issues: 0, releases: 0 },
  };
}

export async function fetchActivity(
  token: string,
  repos: ProjectRepo[],
  since: Date,
  until: Date
): Promise<Activity> {
  const perRepo = await Promise.all(repos.map((r) => fetchRepoActivity(token, r, since, until)));
  return { since: since.toISOString(), until: until.toISOString(), repos: applyBudget(perRepo) };
}

export type RepoSummary = {
  fullName: string;
  private: boolean;
  description: string | null;
  pushedAt: string | null;
  defaultBranch: string;
};

export async function listRepos(token: string, page: number, perPage: number): Promise<RepoSummary[]> {
  const res = await ghFetch(
    token,
    `/user/repos?sort=pushed&direction=desc&affiliation=owner,collaborator,organization_member&per_page=${perPage}&page=${page}`
  );
  if (!res.ok) throw githubError(res.status);
  const raw = (await res.json()) as {
    full_name: string;
    private: boolean;
    description: string | null;
    pushed_at: string | null;
    default_branch: string;
  }[];
  return raw.map((r) => ({
    fullName: r.full_name,
    private: r.private,
    description: r.description,
    pushedAt: r.pushed_at,
    defaultBranch: r.default_branch,
  }));
}

const REPO_CACHE_TTL_MS = 60_000;
const repoCache = new Map<string, { expires: number; repos: RepoSummary[] }>();

export async function listReposCached(userId: string, token: string, page: number, perPage: number) {
  const key = `${userId}:${page}:${perPage}`;
  const hit = repoCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.repos;

  const repos = await listRepos(token, page, perPage);
  if (repoCache.size > 200) repoCache.clear();
  repoCache.set(key, { expires: Date.now() + REPO_CACHE_TTL_MS, repos });
  return repos;
}

// Used when no repo is chosen: the user's most recently pushed repos inside the window.
export async function listRecentlyPushedRepos(token: string, since: Date, limit = 5): Promise<ProjectRepo[]> {
  const repos = await listRepos(token, 1, 30);
  return repos
    .filter((r) => r.pushedAt && new Date(r.pushedAt) >= since)
    .slice(0, limit)
    .map((r) => ({ fullName: r.fullName }));
}
