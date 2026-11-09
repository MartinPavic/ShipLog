import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";

const testOwner = vi.hoisted(() => ({
  userId: `gitlab_user_${crypto.randomUUID()}`,
  orgId: null as string | null,
  ownerId: `gitlab_owner_${crypto.randomUUID()}`,
  orgRole: null as string | null,
  admin: true,
}));
const mockGitLabJson = vi.hoisted(() => vi.fn());
vi.mock("@/lib/owner", () => ({
  getOwner: async () => testOwner,
  requireAdmin: async () => {
    if (!testOwner.admin) throw new ApiError(403, "Only organization admins can do this");
    return testOwner;
  },
}));
vi.mock("@/lib/gitlab-oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gitlab-oauth")>()),
  gitlabJson: mockGitLabJson,
}));

const isLocalDatabase = (() => {
  try {
    const host = new URL(process.env.DATABASE_URL ?? "").hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
})();

describe.skipIf(!isLocalDatabase)("GitLab workspace settings (local database)", () => {
  let savedKey: string | undefined;
  let instances: typeof import("@/db/schema").gitlabInstances;
  let connections: typeof import("@/db/schema").gitlabConnections;
  let projects: typeof import("@/db/schema").projects;
  let getDb: typeof import("@/db").getDb;

  beforeAll(async () => {
    savedKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    ({ gitlabInstances: instances, gitlabConnections: connections, projects } = await import("@/db/schema"));
    ({ getDb } = await import("@/db"));
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(connections).where((await import("drizzle-orm")).eq(connections.ownerId, testOwner.ownerId));
    await db.delete(instances).where((await import("drizzle-orm")).eq(instances.ownerId, testOwner.ownerId));
    await db.delete(projects).where((await import("drizzle-orm")).eq(projects.ownerId, testOwner.ownerId));
    if (savedKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = savedKey;
  });

  it("keeps secrets encrypted and excludes them from config responses", async () => {
    const { PUT, GET } = await import("@/app/api/gitlab/config/route");
    const put = await PUT(new Request("http://localhost/api/gitlab/config", {
      method: "PUT",
      body: JSON.stringify({ baseUrl: "https://gitlab.example.com/team", clientId: "client-id", clientSecret: "client-secret-long" }),
    }));
    expect(put.status).toBe(200);
    const get = await GET();
    const result = await get.json();
    expect(result.instance).toMatchObject({ baseUrl: "https://gitlab.example.com/team", clientId: "client-id" });
    expect(JSON.stringify(result)).not.toContain("client-secret-long");
    const [stored] = await getDb().select().from(instances);
    expect(stored.encryptedClientSecret).not.toContain("client-secret-long");
  });

  it("replacing credentials disconnects all workspace members", async () => {
    const { saveGitLabConnection } = await import("@/lib/gitlab-settings");
    await saveGitLabConnection(testOwner.ownerId, testOwner.userId, {
      username: "member", accessToken: "member-access-token", refreshToken: "member-refresh-token",
      expiresAt: new Date(Date.now() + 60 * 60_000), scopes: "read_api read_user",
    });
    const { PUT } = await import("@/app/api/gitlab/config/route");
    const response = await PUT(new Request("http://localhost/api/gitlab/config", {
      method: "PUT",
      body: JSON.stringify({ baseUrl: "https://gitlab.example.com/team", clientId: "client-id-2", clientSecret: "another-long-client-secret" }),
    }));
    expect(response.status).toBe(200);
    expect(await getDb().select().from(connections).where((await import("drizzle-orm")).eq(connections.ownerId, testOwner.ownerId))).toHaveLength(0);
  });

  it("disconnects members when the workspace changes its GitLab instance URL", async () => {
    const { saveGitLabConnection } = await import("@/lib/gitlab-settings");
    await saveGitLabConnection(testOwner.ownerId, testOwner.userId, {
      username: "member", accessToken: "member-access-token", refreshToken: "member-refresh-token",
      expiresAt: new Date(Date.now() + 60 * 60_000), scopes: "read_api read_user",
    });
    const { PUT } = await import("@/app/api/gitlab/config/route");
    const response = await PUT(new Request("http://localhost/api/gitlab/config", {
      method: "PUT",
      body: JSON.stringify({ baseUrl: "https://gitlab-alt.example.com/group", clientId: "client-id-2", clientSecret: "alternate-client-secret" }),
    }));
    expect(response.status).toBe(200);
    expect(await getDb().select().from(connections).where((await import("drizzle-orm")).eq(connections.ownerId, testOwner.ownerId))).toHaveLength(0);
  });

  it("lists only the connected member's GitLab projects and caps pagination", async () => {
    const { saveGitLabConnection } = await import("@/lib/gitlab-settings");
    await saveGitLabConnection(testOwner.ownerId, testOwner.userId, {
      username: "member", accessToken: "member-access-token", refreshToken: "member-refresh-token",
      expiresAt: new Date(Date.now() + 60 * 60_000), scopes: "read_api read_user",
    });
    mockGitLabJson.mockResolvedValue([{ path_with_namespace: "group/subgroup/project", visibility: "internal", description: "Internal project" }]);
    const { GET } = await import("@/app/api/gitlab/repos/route");
    const response = await GET(new Request("http://localhost/api/gitlab/repos?page=1&per_page=1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      repos: [{ fullName: "group/subgroup/project", private: true, description: "Internal project" }],
      nextPage: 2,
    });
    expect(mockGitLabJson).toHaveBeenCalledWith(
      "https://gitlab-alt.example.com/group",
      expect.stringContaining("per_page=1"),
      "member-access-token"
    );
    const savedOwnerId = testOwner.ownerId;
    const savedUserId = testOwner.userId;
    try {
      testOwner.userId = "unconnected-member";
      const noConnection = await GET(new Request("http://localhost/api/gitlab/repos"));
      expect(await noConnection.json()).toMatchObject({ code: "NO_GITLAB" });
      testOwner.ownerId = "unconfigured-workspace";
      const noInstance = await GET(new Request("http://localhost/api/gitlab/repos"));
      expect(await noInstance.json()).toMatchObject({ code: "NO_GITLAB_INSTANCE" });
    } finally {
      testOwner.ownerId = savedOwnerId;
      testOwner.userId = savedUserId;
    }
    const capped = await GET(new Request("http://localhost/api/gitlab/repos?page=51"));
    expect(capped.status).toBe(400);
  });

  it("serializes refresh-token rotation and clears a connection after an invalid grant", async () => {
    const { getFreshGitLabConnection, getGitLabConnectionStatus, saveGitLabConnection } = await import("@/lib/gitlab-settings");
    await saveGitLabConnection(testOwner.ownerId, testOwner.userId, {
      username: "member", accessToken: "expired-access", refreshToken: "one-use-refresh",
      expiresAt: new Date(Date.now() - 1_000), scopes: "read_api read_user",
    });
    let refreshCalls = 0;
    const sender = async () => {
      refreshCalls++;
      return Response.json({ access_token: "rotated-access", refresh_token: "rotated-refresh", expires_in: 3600, scope: "read_api read_user" });
    };
    const [first, second] = await Promise.all([
      getFreshGitLabConnection(testOwner.ownerId, testOwner.userId, sender),
      getFreshGitLabConnection(testOwner.ownerId, testOwner.userId, sender),
    ]);
    expect(refreshCalls).toBe(1);
    expect(first.accessToken).toBe("rotated-access");
    expect(second.accessToken).toBe("rotated-access");

    await saveGitLabConnection(testOwner.ownerId, testOwner.userId, {
      username: "member", accessToken: "expired-access", refreshToken: "invalid-refresh",
      expiresAt: new Date(Date.now() - 1_000), scopes: "read_api read_user",
    });
    await expect(getFreshGitLabConnection(testOwner.ownerId, testOwner.userId, async () => new Response("invalid_grant", { status: 400 })))
      .rejects.toMatchObject({ code: "GITLAB_RECONNECT" });
    expect(await getGitLabConnectionStatus(testOwner.ownerId, testOwner.userId)).toBeNull();
  });

  it("rejects non-admin writes and blocks URL changes while a project references GitLab", async () => {
    const { PUT, DELETE } = await import("@/app/api/gitlab/config/route");
    testOwner.admin = false;
    const denied = await PUT(new Request("http://localhost/api/gitlab/config", {
      method: "PUT", body: JSON.stringify({ baseUrl: "https://gitlab.example.com/team", clientId: "x", clientSecret: "long-enough-secret" }),
    }));
    expect(denied.status).toBe(403);
    testOwner.admin = true;

    const missingSecret = await PUT(new Request("http://localhost/api/gitlab/config", {
      method: "PUT",
      body: JSON.stringify({ baseUrl: "https://gitlab.example.com/team", clientId: "new-client-id" }),
    }));
    expect(missingSecret.status).toBe(400);
    const missingHostSecret = await PUT(new Request("http://localhost/api/gitlab/config", {
      method: "PUT",
      body: JSON.stringify({ baseUrl: "https://gitlab-third.example.com/other", clientId: "client-id-2" }),
    }));
    expect(missingHostSecret.status).toBe(400);

    const db = getDb();
    await db.insert(projects).values({
      ownerId: testOwner.ownerId, createdBy: testOwner.userId, name: "No GitLab repo", slug: "no-gitlab-repo",
      repos: [],
    });
    await db.insert(projects).values({
      ownerId: testOwner.ownerId, createdBy: testOwner.userId, name: "GitLab project", slug: "gitlab-project",
      repos: [{ provider: "gitlab", fullName: "team/project" }],
      template: "weekly_update", defaultPeriodDays: 7, isPublicChangelog: false,
    });
    const changed = await PUT(new Request("http://localhost/api/gitlab/config", {
      method: "PUT", body: JSON.stringify({ baseUrl: "https://gitlab.example.com/other", clientId: "client-id-2", clientSecret: "another-long-client-secret" }),
    }));
    expect(changed.status).toBe(409);
    expect((await changed.json()).code).toBe("GITLAB_REPOS_IN_USE");
    const removed = await DELETE();
    expect(removed.status).toBe(409);
  });
});
