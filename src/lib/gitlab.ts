import { ApiError } from "@/lib/api";
import { gitlabJson, type GitLabRequester } from "@/lib/gitlab-oauth";
import {
  applyBudget,
  describeChanges,
  dropPullCommits,
  excerpt,
  type Activity,
  type ActivityCommit,
  type ActivityIssue,
  type ActivityPull,
  type ActivityRelease,
  type RawFile,
  type RepoActivity,
  CHANGES_BUDGET,
} from "@/lib/github-activity";
import type { ProjectRepo } from "@/db/schema";

const MAX_PAGES = 3;
const PER_PAGE = 100;
const CHANGES_CONCURRENCY = 5;

type GitLabConnection = { baseUrl: string; accessToken: string };
type GitLabUser = { username?: string; name?: string; bot?: boolean } | null;
type GitLabCommit = {
  id: string;
  message: string;
  author_name?: string;
  author_email?: string;
  authored_date: string;
  web_url: string;
  parent_ids?: string[];
  author?: GitLabUser;
};
type GitLabMergeRequest = {
  iid: number;
  title: string;
  description: string | null;
  web_url: string;
  merged_at: string | null;
  merge_commit_sha?: string | null;
  squash_commit_sha?: string | null;
  author: GitLabUser;
  labels: string[];
};
type GitLabIssue = {
  iid: number;
  title: string;
  web_url: string;
  closed_at: string | null;
  author: GitLabUser;
  labels: string[];
};
type GitLabRelease = {
  tag_name: string;
  name: string | null;
  description: string | null;
  released_at: string | null;
  web_url: string;
  _links?: { self?: string };
};
type GitLabProject = { path_with_namespace: string; last_activity_at: string | null };

const isBot = (user: GitLabUser | undefined, authorName?: string) => {
  if (user?.bot) return true;
  const name = user?.username ?? authorName ?? "";
  return /(?:\[bot\]|-bot)$/i.test(name);
};

function inRange(value: string | null, since: Date, until: Date): value is string {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= since.getTime() && time <= until.getTime();
}

function labels(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((label): label is string => typeof label === "string") : [];
}

function endpoint(repo: string, resource: string): string {
  return `/api/v4/projects/${encodeURIComponent(repo)}/${resource}`;
}

async function paginate<T>(
  connection: GitLabConnection,
  path: string,
  query: URLSearchParams,
  sender?: GitLabRequester
): Promise<T[]> {
  const result: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams(query);
    params.set("per_page", String(PER_PAGE));
    params.set("page", String(page));
    const batch = await gitlabJson<unknown>(connection.baseUrl, `${path}?${params}`, connection.accessToken, sender);
    if (!Array.isArray(batch)) throw new ApiError(502, "GitLab returned an invalid project activity response.", "GITLAB_UNAVAILABLE");
    result.push(...batch as T[]);
    if (batch.length < PER_PAGE) break;
  }
  return result;
}

function normalizeCommits(raw: GitLabCommit[]): ActivityCommit[] {
  return raw
    .filter((commit) => (commit.parent_ids?.length ?? 0) <= 1 && !isBot(commit.author, commit.author_name))
    .map((commit) => {
      const [message, ...body] = commit.message.split("\n");
      return {
        sha: commit.id.slice(0, 7),
        message,
        body: excerpt(body.join("\n"), 500),
        author: commit.author?.username ?? commit.author_name ?? "unknown",
        date: commit.authored_date,
        url: commit.web_url,
      };
    });
}

function normalizeMergeRequests(raw: GitLabMergeRequest[], since: Date, until: Date): ActivityPull[] {
  return raw
    .filter((item) => inRange(item.merged_at, since, until) && !isBot(item.author))
    .map((item) => ({
      number: item.iid,
      title: item.title,
      body: excerpt(item.description, 800),
      labels: labels(item.labels),
      author: item.author?.username ?? "unknown",
      mergedAt: item.merged_at as string,
      url: item.web_url,
    }))
    .sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt));
}

function normalizeIssues(raw: GitLabIssue[], since: Date, until: Date): ActivityIssue[] {
  return raw
    .filter((item) => inRange(item.closed_at, since, until) && !isBot(item.author))
    .map((item) => ({
      number: item.iid,
      title: item.title,
      labels: labels(item.labels),
      closedAt: item.closed_at as string,
      url: item.web_url,
    }))
    .sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt));
}

function normalizeReleases(raw: GitLabRelease[], since: Date, until: Date, baseUrl: string, repo: string): ActivityRelease[] {
  return raw
    .filter((item) => inRange(item.released_at, since, until))
    .map((item) => ({
      tag: item.tag_name,
      name: item.name ?? item.tag_name,
      body: excerpt(item.description),
      publishedAt: item.released_at as string,
      url: item.web_url ?? `${baseUrl}/${repo}/-/releases/${encodeURIComponent(item.tag_name)}`,
    }))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

async function fetchRepoActivity(
  connection: GitLabConnection,
  repo: ProjectRepo,
  since: Date,
  until: Date,
  sender?: GitLabRequester
): Promise<RepoActivity> {
  const query = new URLSearchParams({ since: since.toISOString(), until: until.toISOString() });
  if (repo.branch) query.set("ref_name", repo.branch);
  const mergeQuery = new URLSearchParams({ state: "merged", merged_after: since.toISOString(), merged_before: until.toISOString(), order_by: "merged_at", sort: "desc" });
  const issueQuery = new URLSearchParams({ state: "closed", updated_after: since.toISOString(), order_by: "updated_at", sort: "desc" });
  const releaseQuery = new URLSearchParams();
  const [commits, mergeRequests, issues, releases] = await Promise.all([
    paginate<GitLabCommit>(connection, endpoint(repo.fullName, "repository/commits"), query, sender),
    paginate<GitLabMergeRequest>(connection, endpoint(repo.fullName, "merge_requests"), mergeQuery, sender),
    paginate<GitLabIssue>(connection, endpoint(repo.fullName, "issues"), issueQuery, sender),
    paginate<GitLabRelease>(connection, endpoint(repo.fullName, "releases"), releaseQuery, sender),
  ]);
  const pullRequests = normalizeMergeRequests(mergeRequests, since, until);
  const mergedCommitIds = new Set(mergeRequests
    .filter((item) => inRange(item.merged_at, since, until))
    .flatMap((item) => [item.merge_commit_sha, item.squash_commit_sha])
    .filter((id): id is string => Boolean(id)));
  return {
    repo: repo.fullName,
    commits: dropPullCommits(normalizeCommits(commits.filter((commit) => !mergedCommitIds.has(commit.id))), pullRequests),
    pullRequests,
    issues: normalizeIssues(issues, since, until),
    releases: normalizeReleases(releases, since, until, connection.baseUrl, repo.fullName),
    omitted: { commits: 0, pullRequests: 0, issues: 0, releases: 0 },
  };
}

async function fetchFiles(connection: GitLabConnection, path: string, sender?: GitLabRequester): Promise<RawFile[]> {
  try {
    const response = await gitlabJson<unknown>(connection.baseUrl, path, connection.accessToken, sender);
    const values = Array.isArray(response)
      ? response
      : (response as { changes?: unknown } | null)?.changes;
    if (!Array.isArray(values)) return [];
    return values.flatMap((value): RawFile[] => {
      if (!value || typeof value !== "object") return [];
      const file = value as { new_path?: unknown; diff?: unknown };
      if (typeof file.new_path !== "string") return [];
      const diff = typeof file.diff === "string" ? file.diff : "";
      return [{
        filename: file.new_path,
        additions: diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++" )).length,
        deletions: diff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---" )).length,
        patch: diff,
      }];
    });
  } catch {
    return [];
  }
}

async function attachChanges(connection: GitLabConnection, repos: RepoActivity[], sender?: GitLabRequester): Promise<void> {
  const jobs: (() => Promise<void>)[] = [];
  let pullCount = 0;
  let commitCount = 0;
  for (const repo of repos) {
    for (const pull of repo.pullRequests) {
      if (pullCount++ >= CHANGES_BUDGET.pullRequests) break;
      jobs.push(async () => {
        const path = endpoint(repo.repo, `merge_requests/${pull.number}/diffs?per_page=30&page=1`);
        pull.changes = describeChanges(await fetchFiles(connection, path, sender)) || undefined;
      });
    }
    for (const commit of repo.commits) {
      if (commitCount++ >= CHANGES_BUDGET.commits) break;
      jobs.push(async () => {
        const path = endpoint(repo.repo, `repository/commits/${encodeURIComponent(commit.sha)}/diff`);
        commit.changes = describeChanges(await fetchFiles(connection, path, sender)) || undefined;
      });
    }
  }
  for (let offset = 0; offset < jobs.length; offset += CHANGES_CONCURRENCY) {
    await Promise.all(jobs.slice(offset, offset + CHANGES_CONCURRENCY).map((job) => job()));
  }
}

export async function fetchGitLabActivity(
  connection: GitLabConnection,
  repos: ProjectRepo[],
  since: Date,
  until: Date,
  sender?: GitLabRequester
): Promise<Activity> {
  const results: RepoActivity[] = [];
  for (let offset = 0; offset < repos.length; offset += CHANGES_CONCURRENCY) {
    results.push(...await Promise.all(repos.slice(offset, offset + CHANGES_CONCURRENCY).map((repo) =>
      fetchRepoActivity(connection, repo, since, until, sender)
    )));
  }
  const budgeted = applyBudget(results);
  await attachChanges(connection, budgeted, sender);
  return { since: since.toISOString(), until: until.toISOString(), repos: budgeted };
}

export async function listRecentlyPushedGitLabRepos(
  connection: GitLabConnection,
  since: Date,
  limit = 5,
  sender?: GitLabRequester
): Promise<ProjectRepo[]> {
  const query = new URLSearchParams({ membership: "true", order_by: "last_activity_at", sort: "desc", simple: "true", per_page: "100", page: "1" });
  const projects = await gitlabJson<unknown>(connection.baseUrl, `/api/v4/projects?${query}`, connection.accessToken, sender);
  if (!Array.isArray(projects)) throw new ApiError(502, "GitLab returned an invalid project list.", "GITLAB_UNAVAILABLE");
  const max = Math.max(0, Math.min(20, Math.trunc(limit)));
  return (projects as GitLabProject[])
    .filter((project) => project.path_with_namespace && inRange(project.last_activity_at, since, new Date()))
    .slice(0, max)
    .map((project) => ({ provider: "gitlab", fullName: project.path_with_namespace }));
}
