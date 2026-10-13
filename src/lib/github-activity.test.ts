import { describe, expect, it } from "vitest";
import {
  type Activity,
  type RepoActivity,
  applyBudget,
  dropPullCommits,
  excerpt,
  formatActivity,
  isActivityEmpty,
  normalizeCommits,
  normalizeIssues,
  normalizePulls,
  normalizeReleases,
  takeRoundRobin,
} from "./github-activity";

const since = new Date("2026-10-01T00:00:00Z");
const until = new Date("2026-10-08T00:00:00Z");

const rawCommit = (over: Record<string, unknown> = {}) => ({
  sha: "abcdef1234567",
  html_url: "https://github.com/o/r/commit/abcdef1",
  parents: [{}],
  author: { login: "dev", type: "User" },
  commit: { message: "Fix bug\n\nlong body", author: { name: "Dev", date: "2026-10-02T10:00:00Z" } },
  ...over,
});

describe("normalizeCommits", () => {
  it("keeps first line, short sha, and drops merges and bots", () => {
    const result = normalizeCommits([
      rawCommit(),
      rawCommit({ parents: [{}, {}] }),
      rawCommit({ author: { login: "dependabot[bot]", type: "Bot" } }),
      rawCommit({ author: { login: "renovate", type: "Bot" } }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sha: "abcdef1", message: "Fix bug", author: "dev" });
  });

  it("keeps commits whose author has no GitHub account", () => {
    expect(normalizeCommits([rawCommit({ author: null })])[0].author).toBe("Dev");
  });
});

describe("normalizePulls", () => {
  const pull = (over: Record<string, unknown> = {}) => ({
    number: 1,
    title: "Add search",
    body: "Adds  search\n\nwith filters",
    html_url: "u",
    merged_at: "2026-10-03T00:00:00Z",
    user: { login: "dev", type: "User" },
    labels: [{ name: "feature" }],
    ...over,
  });

  it("keeps merged PRs in range, drops unmerged, out-of-range and bot PRs", () => {
    const result = normalizePulls(
      [
        pull(),
        pull({ number: 2, merged_at: null }),
        pull({ number: 3, merged_at: "2026-09-01T00:00:00Z" }),
        pull({ number: 4, user: { login: "x[bot]", type: "Bot" } }),
      ],
      since,
      until
    );
    expect(result.map((p) => p.number)).toEqual([1]);
    expect(result[0]).toMatchObject({ labels: ["feature"], body: "Adds search with filters" });
  });

  it("orders newest first", () => {
    const result = normalizePulls(
      [pull({ number: 1 }), pull({ number: 2, merged_at: "2026-10-05T00:00:00Z" })],
      since,
      until
    );
    expect(result.map((p) => p.number)).toEqual([2, 1]);
  });
});

describe("normalizeIssues / normalizeReleases", () => {
  it("drops pull requests returned by the issues API", () => {
    const base = { title: "t", html_url: "u", closed_at: "2026-10-02T00:00:00Z", labels: ["bug"], user: null };
    const result = normalizeIssues(
      [
        { ...base, number: 1 },
        { ...base, number: 2, pull_request: {} },
      ],
      since,
      until
    );
    expect(result.map((i) => i.number)).toEqual([1]);
  });

  it("drops drafts and out-of-range releases", () => {
    const base = { tag_name: "v1", name: null, body: "notes", html_url: "u", draft: false };
    const result = normalizeReleases(
      [
        { ...base, published_at: "2026-10-02T00:00:00Z" },
        { ...base, tag_name: "v2", published_at: "2026-10-02T00:00:00Z", draft: true },
        { ...base, tag_name: "v0", published_at: "2026-01-01T00:00:00Z" },
      ],
      since,
      until
    );
    expect(result.map((r) => r.tag)).toEqual(["v1"]);
    expect(result[0].name).toBe("v1");
  });
});

describe("dropPullCommits", () => {
  it("removes squash-merge commits that already have a PR entry", () => {
    const commits = [
      { sha: "a", message: "Add search (#12)", author: "d", date: "", url: "" },
      { sha: "b", message: "Direct fix", author: "d", date: "", url: "" },
      { sha: "c", message: "Other (#99)", author: "d", date: "", url: "" },
    ];
    const pulls = [{ number: 12, title: "", body: "", labels: [], author: "", mergedAt: "", url: "" }];
    expect(dropPullCommits(commits, pulls).map((c) => c.sha)).toEqual(["b", "c"]);
  });
});

describe("takeRoundRobin", () => {
  it("shares the cap fairly across lists", () => {
    const result = takeRoundRobin([[1, 2, 3, 4, 5], [6], [7, 8]], 5);
    expect(result).toEqual([[1, 2], [6], [7, 8]]);
  });

  it("returns everything when under the cap", () => {
    expect(takeRoundRobin([[1], [2, 3]], 10)).toEqual([[1], [2, 3]]);
  });
});

const repoActivity = (repo: string, commits: number): RepoActivity => ({
  repo,
  commits: Array.from({ length: commits }, (_, i) => ({
    sha: String(i),
    message: `commit ${i}`,
    author: "d",
    date: "2026-10-02T00:00:00Z",
    url: "",
  })),
  pullRequests: [],
  issues: [],
  releases: [],
  omitted: { commits: 0, pullRequests: 0, issues: 0, releases: 0 },
});

describe("applyBudget", () => {
  it("trims over-budget lists and records what was omitted", () => {
    const [a, b] = applyBudget([repoActivity("o/a", 100), repoActivity("o/b", 10)], {
      releases: 10,
      pullRequests: 50,
      issues: 20,
      commits: 20,
    });
    expect(a.commits).toHaveLength(10);
    expect(b.commits).toHaveLength(10);
    expect(a.omitted.commits).toBe(90);
    expect(b.omitted.commits).toBe(0);
  });
});

describe("formatActivity", () => {
  it("groups by repo and mentions omissions; empty repos are skipped", () => {
    const trimmed = applyBudget([repoActivity("o/a", 3), repoActivity("o/empty", 0)], {
      releases: 1,
      pullRequests: 1,
      issues: 1,
      commits: 2,
    });
    const activity: Activity = { since: "", until: "", repos: trimmed };
    const text = formatActivity(activity);
    expect(text).toContain("## o/a");
    expect(text).toContain("- commit 0 (2026-10-02)");
    expect(text).toContain("Omitted for length: 1 commits");
    expect(text).not.toContain("o/empty");
    expect(isActivityEmpty(activity)).toBe(false);
    expect(isActivityEmpty({ ...activity, repos: [repoActivity("o/empty", 0)] })).toBe(true);
  });
});

describe("excerpt", () => {
  it("collapses whitespace and truncates", () => {
    expect(excerpt("a   b\n c")).toBe("a b c");
    expect(excerpt("x".repeat(400), 10)).toHaveLength(10);
  });
});
