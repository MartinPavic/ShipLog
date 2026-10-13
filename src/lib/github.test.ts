import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchActivity, listRecentlyPushedRepos } from "./github";

const since = new Date("2026-10-01T00:00:00Z");
const until = new Date("2026-10-08T00:00:00Z");

function stubGithub(routes: Record<string, (url: URL) => unknown>, status = 200) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input);
      calls.push(url.pathname + url.search);
      const key = Object.keys(routes).find((k) => url.pathname.endsWith(k));
      return new Response(JSON.stringify(key ? routes[key](url) : []), { status });
    })
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchActivity", () => {
  it("combines commits, PRs, issues and releases, deduping squash commits", async () => {
    const calls = stubGithub({
      "/commits": () => [
        {
          sha: "aaaaaaa1",
          html_url: "u",
          parents: [{}],
          author: { login: "dev", type: "User" },
          commit: { message: "Add search (#7)", author: { name: "d", date: "2026-10-02T00:00:00Z" } },
        },
        {
          sha: "bbbbbbb2",
          html_url: "u",
          parents: [{}],
          author: { login: "dev", type: "User" },
          commit: { message: "Fix typo", author: { name: "d", date: "2026-10-03T00:00:00Z" } },
        },
      ],
      "/pulls": () => [
        {
          number: 7,
          title: "Add search",
          body: "body",
          html_url: "u",
          merged_at: "2026-10-02T00:00:00Z",
          updated_at: "2026-10-02T00:00:00Z",
          user: { login: "dev", type: "User" },
          labels: [],
        },
      ],
      "/issues": () => [
        { number: 3, title: "Bug", html_url: "u", closed_at: "2026-10-04T00:00:00Z", labels: [], user: null },
      ],
      "/releases": () => [
        { tag_name: "v1.0.0", name: "One", body: "", html_url: "u", published_at: "2026-10-05T00:00:00Z", draft: false },
      ],
    });

    const activity = await fetchActivity("tok", [{ fullName: "o/r" }], since, until);
    const [repo] = activity.repos;
    expect(repo.commits.map((c) => c.message)).toEqual(["Fix typo"]);
    expect(repo.pullRequests.map((p) => p.number)).toEqual([7]);
    expect(repo.issues.map((i) => i.number)).toEqual([3]);
    expect(repo.releases.map((r) => r.tag)).toEqual(["v1.0.0"]);
    expect(calls.some((c) => c.includes("/repos/o/r/commits") && c.includes("since=2026-10-01"))).toBe(true);
  });

  it("stops paginating pull requests once a page falls before the window", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({
      number: i,
      title: "t",
      body: null,
      html_url: "u",
      merged_at: null,
      updated_at: "2026-01-01T00:00:00Z",
      user: null,
      labels: [],
    }));
    const calls = stubGithub({ "/pulls": () => full });
    await fetchActivity("tok", [{ fullName: "o/r" }], since, until);
    expect(calls.filter((c) => c.includes("/pulls"))).toHaveLength(1);
  });

  it("maps a missing repo to a helpful error", async () => {
    stubGithub({}, 404);
    await expect(fetchActivity("tok", [{ fullName: "o/missing" }], since, until)).rejects.toMatchObject({
      code: "GITHUB_ACCESS",
      message: expect.stringContaining("o/missing"),
    });
  });

  it("maps a bad token to a reconnect message", async () => {
    stubGithub({}, 401);
    await expect(fetchActivity("tok", [{ fullName: "o/r" }], since, until)).rejects.toMatchObject({
      code: "GITHUB_AUTH",
    });
  });
});

describe("listRecentlyPushedRepos", () => {
  it("keeps only repos pushed inside the window", async () => {
    stubGithub({
      "/user/repos": () => [
        { full_name: "o/new", private: false, description: null, pushed_at: "2026-10-05T00:00:00Z", default_branch: "main" },
        { full_name: "o/old", private: false, description: null, pushed_at: "2026-01-05T00:00:00Z", default_branch: "main" },
      ],
    });
    expect(await listRecentlyPushedRepos("tok", since)).toEqual([{ fullName: "o/new" }]);
  });
});
