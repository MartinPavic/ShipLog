import { describe, expect, it } from "vitest";
import { fetchGitLabActivity, listRecentlyPushedGitLabRepos } from "@/lib/gitlab";

const BASE = "https://gitlab.example.com/base";
const SINCE = new Date("2026-04-01T00:00:00.000Z");
const UNTIL = new Date("2026-05-01T23:59:59.999Z");

type Sender = (url: URL) => Promise<Response>;
const senderFrom = (handler: Sender) => (url: URL) => handler(url);

function fixtureSender(): { sender: (url: URL) => Promise<Response>; calls: URL[] } {
  const calls: URL[] = [];
  const sender = async (url: URL) => {
    calls.push(url);
    if (url.pathname.endsWith("/repository/commits")) return Response.json([
      { id: "abcdef123456789", message: "Add setting\nDetails", author_name: "Ari", authored_date: "2026-04-20T12:00:00Z", web_url: "https://gitlab.example.com/base/group/project/-/commit/abcdef", parent_ids: ["p1"] },
      { id: "merge123456789", message: "Merge branch", author_name: "Ari", authored_date: "2026-04-21T12:00:00Z", web_url: "https://gitlab.example.com/base/group/project/-/commit/merge", parent_ids: ["p1", "p2"] },
      { id: "squash123456789", message: "Improve settings (!7)", author_name: "Ari", authored_date: "2026-04-22T12:00:00Z", web_url: "https://gitlab.example.com/base/group/project/-/commit/squash", parent_ids: ["p1"] },
    ]);
    if (url.pathname.endsWith("/merge_requests")) return Response.json([
      { iid: 7, title: "Improve settings", description: "Adds a field", web_url: "https://gitlab.example.com/base/group/project/-/merge_requests/7", merged_at: "2026-04-25T10:00:00Z", author: { username: "ari" }, labels: ["feature"], squash_commit_sha: "squash123456789" },
    ]);
    if (url.pathname.endsWith("/issues")) return Response.json([
      { iid: 9, title: "Fix crash", web_url: "https://gitlab.example.com/base/group/project/-/issues/9", closed_at: "2026-04-26T10:00:00Z", author: { username: "ari" }, labels: ["bug"] },
    ]);
    if (url.pathname.endsWith("/releases")) return Response.json([
      { tag_name: "v1.2", name: "Version 1.2", description: "Shipped", released_at: "2026-04-28T10:00:00Z", _links: { self: "https://gitlab.example.com/base/api/v4/projects/1/releases/v1.2" } },
    ]);
    if (url.pathname.endsWith("/repository/commits/abcdef1/diff")) return Response.json([
      { new_path: "src/settings.ts", diff: "+export const ready = true" },
    ]);
    if (url.pathname.endsWith("/merge_requests/7/diffs")) return Response.json([
      { new_path: "src/form.tsx", diff: "+<input />" },
    ]);
    return Response.json([]);
  };
  return { sender, calls };
}

describe("GitLab activity adapter", () => {
  it("normalizes commits, merged requests, closed issues, releases, links, authors, and changed files", async () => {
    const { sender, calls } = fixtureSender();
    const activity = await fetchGitLabActivity(
      { baseUrl: BASE, accessToken: "token" },
      [{ provider: "gitlab", fullName: "group/subgroup/project" }],
      SINCE,
      UNTIL,
      senderFrom(sender)
    );
    const repo = activity.repos[0];
    expect(repo.repo).toBe("group/subgroup/project");
    expect(repo.commits).toHaveLength(1);
    expect(repo.commits[0]).toMatchObject({ sha: "abcdef1", message: "Add setting", author: "Ari", url: expect.stringContaining("/-/commit/abcdef") });
    expect(repo.commits[0].changes).toContain("src/settings.ts");
    expect(repo.pullRequests[0]).toMatchObject({ number: 7, author: "ari", title: "Improve settings", url: expect.stringContaining("merge_requests/7") });
    expect(repo.pullRequests[0].changes).toContain("src/form.tsx");
    expect(repo.issues[0]).toMatchObject({ number: 9, title: "Fix crash", url: expect.stringContaining("issues/9") });
    expect(repo.releases[0]).toMatchObject({ tag: "v1.2", name: "Version 1.2", url: "https://gitlab.example.com/base/group/subgroup/project/-/releases/v1.2" });
    const mergeRequestList = calls.find((url) => url.pathname.endsWith("/merge_requests"));
    expect(mergeRequestList?.searchParams.get("merged_after")).toBe(SINCE.toISOString());
    expect(mergeRequestList?.searchParams.get("merged_before")).toBe(UNTIL.toISOString());
    expect(calls.every((url) => url.origin === "https://gitlab.example.com" && url.pathname.startsWith("/base/api/v4/"))).toBe(true);
  });

  it("caps pagination and turns recently active GitLab projects into provider-tagged repos", async () => {
    let pageCalls = 0;
    const sender = async (url: URL) => {
      if (url.pathname.endsWith("/repository/commits")) {
        pageCalls++;
        return Response.json(Array.from({ length: 100 }, (_, index) => ({
          id: `${url.searchParams.get("page")}-${index}`,
          message: "change",
          author_name: "Ari",
          authored_date: "2026-04-20T12:00:00Z",
          web_url: "https://gitlab.example.com/commit",
          parent_ids: [],
        })));
      }
      if (url.pathname.endsWith("/projects")) return Response.json([
        { path_with_namespace: "group/recent", last_activity_at: "2026-04-20T12:00:00Z" },
        { path_with_namespace: "group/old", last_activity_at: "2026-03-20T12:00:00Z" },
      ]);
      return Response.json([]);
    };
    const activity = await fetchGitLabActivity({ baseUrl: BASE, accessToken: "token" }, [
      { provider: "gitlab", fullName: "group/project" },
    ], SINCE, UNTIL, senderFrom(sender));
    expect(pageCalls).toBeLessThanOrEqual(3);
    expect(activity.repos[0].commits.length).toBeLessThanOrEqual(60);
    await expect(listRecentlyPushedGitLabRepos({ baseUrl: BASE, accessToken: "token" }, SINCE, 5, senderFrom(sender)))
      .resolves.toEqual([{ provider: "gitlab", fullName: "group/recent" }]);
  });

  it("maps rate limiting and malformed responses to actionable API errors", async () => {
    await expect(fetchGitLabActivity(
      { baseUrl: BASE, accessToken: "token" }, [{ provider: "gitlab", fullName: "group/project" }], SINCE, UNTIL,
      async () => new Response("", { status: 429 })
    )).rejects.toMatchObject({ code: "GITLAB_RATE_LIMIT" });
    await expect(fetchGitLabActivity(
      { baseUrl: BASE, accessToken: "token" }, [{ provider: "gitlab", fullName: "group/project" }], SINCE, UNTIL,
      async () => new Response("not json", { status: 200 })
    )).rejects.toMatchObject({ code: "GITLAB_UNAVAILABLE" });
  });
});
