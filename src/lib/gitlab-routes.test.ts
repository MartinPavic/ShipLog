import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  owner: { ownerId: "org-route-test", userId: "user-route-test", orgId: "org-route-test", orgRole: "org:admin" },
  cookieState: "",
  getInstanceStatus: vi.fn(),
  getInstance: vi.fn(),
  exchangeCode: vi.fn(),
  gitlabJson: vi.fn(),
  saveTokenSet: vi.fn(),
}));

vi.mock("@/lib/owner", () => ({ getOwner: async () => routeState.owner }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => routeState.cookieState ? { value: routeState.cookieState } : undefined }),
}));
vi.mock("@/lib/gitlab-settings", () => ({
  getGitLabInstanceStatus: routeState.getInstanceStatus,
  getGitLabInstance: routeState.getInstance,
  saveGitLabTokenSet: routeState.saveTokenSet,
}));
vi.mock("@/lib/gitlab-oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gitlab-oauth")>()),
  exchangeGitLabCode: routeState.exchangeCode,
  gitlabJson: routeState.gitlabJson,
}));

beforeEach(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  routeState.cookieState = "";
  routeState.getInstanceStatus.mockReset();
  routeState.getInstance.mockReset();
  routeState.exchangeCode.mockReset();
  routeState.gitlabJson.mockReset();
  routeState.saveTokenSet.mockReset();
});

describe("GitLab OAuth routes", () => {
  it("starts authorization with the exact callback URI and a bound HTTP-only state cookie", async () => {
    routeState.getInstanceStatus.mockResolvedValue({ baseUrl: "https://gitlab.example.com/base", clientId: "client-id", configured: true });
    const { GET } = await import("@/app/api/gitlab/connect/route");
    const response = await GET();
    const authorize = new URL(response.headers.get("location")!);
    expect(authorize.origin + authorize.pathname).toBe("https://gitlab.example.com/base/oauth/authorize");
    expect(authorize.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/gitlab/callback");
    const cookie = response.headers.get("set-cookie") ?? "";
    const state = cookie.match(/gl_oauth_state=([^;]+)/)?.[1];
    expect(state).toBeTruthy();
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/api/gitlab");
  });

  it("rejects callback state mismatch without exchanging the code and always clears state", async () => {
    const { createGitLabState } = await import("@/lib/gitlab-oauth");
    const expected = createGitLabState(routeState.owner.ownerId, routeState.owner.userId, "https://gitlab.example.com");
    routeState.cookieState = expected;
    const { GET } = await import("@/app/api/gitlab/callback/route");
    const response = await GET(new Request(`http://localhost/api/gitlab/callback?code=secret-code&state=${expected}x`));
    expect(new URL(response.headers.get("location")!).searchParams.get("gitlab")).toBe("invalid_state");
    expect(routeState.exchangeCode).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("saves the member connection only after state validation and profile lookup", async () => {
    const { createGitLabState } = await import("@/lib/gitlab-oauth");
    const baseUrl = "https://gitlab.example.com/base";
    const state = createGitLabState(routeState.owner.ownerId, routeState.owner.userId, baseUrl);
    routeState.cookieState = state;
    routeState.getInstance.mockResolvedValue({ baseUrl, clientId: "client-id", clientSecret: "client-secret" });
    const tokenSet = { accessToken: "access", refreshToken: "refresh", expiresAt: new Date(Date.now() + 60_000), scopes: "read_api read_user" };
    routeState.exchangeCode.mockResolvedValue(tokenSet);
    routeState.gitlabJson.mockResolvedValue({ username: "member" });
    const { GET } = await import("@/app/api/gitlab/callback/route");
    const response = await GET(new Request(`http://localhost/api/gitlab/callback?code=auth-code&state=${state}`));
    expect(new URL(response.headers.get("location")!).searchParams.get("gitlab")).toBe("connected");
    expect(routeState.saveTokenSet).toHaveBeenCalledWith(
      routeState.owner.ownerId,
      routeState.owner.userId,
      "member",
      tokenSet,
      { baseUrl, clientId: "client-id" }
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
