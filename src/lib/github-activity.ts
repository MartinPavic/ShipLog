export type ActivityCommit = { sha: string; message: string; author: string; date: string; url: string };
export type ActivityPull = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  author: string;
  mergedAt: string;
  url: string;
};
export type ActivityIssue = { number: number; title: string; labels: string[]; closedAt: string; url: string };
export type ActivityRelease = { tag: string; name: string; body: string; publishedAt: string; url: string };

export type RepoActivity = {
  repo: string;
  commits: ActivityCommit[];
  pullRequests: ActivityPull[];
  issues: ActivityIssue[];
  releases: ActivityRelease[];
  omitted: { commits: number; pullRequests: number; issues: number; releases: number };
};

export type Activity = { since: string; until: string; repos: RepoActivity[] };

type RawUser = { login?: string; type?: string } | null;
type RawLabel = { name?: string } | string;

export type RawCommit = {
  sha: string;
  html_url: string;
  parents?: unknown[];
  author: RawUser;
  commit: { message: string; author: { name?: string; date: string } | null };
};
export type RawPull = {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  merged_at: string | null;
  user: RawUser;
  labels: RawLabel[];
};
export type RawIssue = {
  number: number;
  title: string;
  html_url: string;
  closed_at: string | null;
  labels: RawLabel[];
  user: RawUser;
  pull_request?: unknown;
};
export type RawRelease = {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string | null;
  draft: boolean;
};

export const ITEM_BUDGET = { releases: 10, pullRequests: 50, issues: 20, commits: 60 };
const BODY_EXCERPT = 300;

const isBot = (user: RawUser) => user?.type === "Bot" || Boolean(user?.login?.endsWith("[bot]"));
const labelNames = (labels: RawLabel[]) =>
  labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean);
const inRange = (iso: string | null, since: Date, until: Date): iso is string => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= since.getTime() && t <= until.getTime();
};
const byDateDesc = <T>(get: (item: T) => string) => (a: T, b: T) =>
  new Date(get(b)).getTime() - new Date(get(a)).getTime();

export function excerpt(text: string | null | undefined, max = BODY_EXCERPT): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function normalizeCommits(raw: RawCommit[]): ActivityCommit[] {
  return raw
    .filter((c) => (c.parents?.length ?? 0) <= 1 && !isBot(c.author))
    .map((c) => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split("\n")[0],
      author: c.author?.login ?? c.commit.author?.name ?? "unknown",
      date: c.commit.author?.date ?? "",
      url: c.html_url,
    }));
}

export function normalizePulls(raw: RawPull[], since: Date, until: Date): ActivityPull[] {
  return raw
    .filter((p) => inRange(p.merged_at, since, until) && !isBot(p.user))
    .map((p) => ({
      number: p.number,
      title: p.title,
      body: excerpt(p.body),
      labels: labelNames(p.labels),
      author: p.user?.login ?? "unknown",
      mergedAt: p.merged_at as string,
      url: p.html_url,
    }))
    .sort(byDateDesc((p) => p.mergedAt));
}

export function normalizeIssues(raw: RawIssue[], since: Date, until: Date): ActivityIssue[] {
  return raw
    .filter((i) => !i.pull_request && inRange(i.closed_at, since, until) && !isBot(i.user))
    .map((i) => ({
      number: i.number,
      title: i.title,
      labels: labelNames(i.labels),
      closedAt: i.closed_at as string,
      url: i.html_url,
    }))
    .sort(byDateDesc((i) => i.closedAt));
}

export function normalizeReleases(raw: RawRelease[], since: Date, until: Date): ActivityRelease[] {
  return raw
    .filter((r) => !r.draft && inRange(r.published_at, since, until))
    .map((r) => ({
      tag: r.tag_name,
      name: r.name ?? r.tag_name,
      body: excerpt(r.body),
      publishedAt: r.published_at as string,
      url: r.html_url,
    }))
    .sort(byDateDesc((r) => r.publishedAt));
}

// Squash merges show up as both a PR and a "(#123)" commit.
export function dropPullCommits(commits: ActivityCommit[], pulls: ActivityPull[]): ActivityCommit[] {
  const numbers = new Set(pulls.map((p) => p.number));
  return commits.filter((c) => {
    const match = /\(#(\d+)\)\s*$/.exec(c.message);
    return !(match && numbers.has(Number(match[1])));
  });
}

// Fair share across repos so one busy repo can't crowd out the others. Lists are newest-first.
export function takeRoundRobin<T>(lists: T[][], cap: number): T[][] {
  const counts = lists.map(() => 0);
  let remaining = cap;
  let progressed = true;
  while (remaining > 0 && progressed) {
    progressed = false;
    for (let i = 0; i < lists.length && remaining > 0; i++) {
      if (counts[i] < lists[i].length) {
        counts[i]++;
        remaining--;
        progressed = true;
      }
    }
  }
  return lists.map((list, i) => list.slice(0, counts[i]));
}

export function applyBudget(repos: RepoActivity[], budget = ITEM_BUDGET): RepoActivity[] {
  const result = repos.map((r) => ({ ...r }));
  for (const key of ["releases", "pullRequests", "issues", "commits"] as const) {
    const trimmed = takeRoundRobin(
      repos.map((r) => r[key] as unknown[]),
      budget[key]
    );
    trimmed.forEach((list, i) => {
      (result[i][key] as unknown[]) = list;
      result[i].omitted = { ...result[i].omitted, [key]: result[i].omitted[key] + repos[i][key].length - list.length };
    });
  }
  return result;
}

export function isActivityEmpty(activity: Activity): boolean {
  return activity.repos.every(
    (r) => r.commits.length + r.pullRequests.length + r.issues.length + r.releases.length === 0
  );
}

const day = (iso: string) => iso.slice(0, 10);
const tags = (labels: string[]) => (labels.length ? ` [${labels.join(", ")}]` : "");

export function formatActivity(activity: Activity): string {
  const blocks: string[] = [];
  for (const r of activity.repos) {
    const lines: string[] = [];
    if (r.releases.length) {
      lines.push("Releases:");
      for (const x of r.releases) {
        lines.push(`- ${x.tag}${x.name !== x.tag ? ` "${x.name}"` : ""} (${day(x.publishedAt)})${x.body ? `: ${x.body}` : ""}`);
      }
    }
    if (r.pullRequests.length) {
      lines.push("Merged pull requests:");
      for (const x of r.pullRequests) {
        lines.push(`- #${x.number} ${x.title}${tags(x.labels)} (${x.author}, ${day(x.mergedAt)})${x.body ? `: ${x.body}` : ""}`);
      }
    }
    if (r.issues.length) {
      lines.push("Closed issues:");
      for (const x of r.issues) lines.push(`- #${x.number} ${x.title}${tags(x.labels)} (${day(x.closedAt)})`);
    }
    if (r.commits.length) {
      lines.push("Commits:");
      for (const x of r.commits) lines.push(`- ${x.message} (${day(x.date)})`);
    }
    const omitted = Object.entries(r.omitted).filter(([, n]) => n > 0);
    if (omitted.length) lines.push(`(Omitted for length: ${omitted.map(([k, n]) => `${n} ${k}`).join(", ")})`);
    if (lines.length) blocks.push(`## ${r.repo}\n${lines.join("\n")}`);
  }
  return blocks.join("\n\n");
}
