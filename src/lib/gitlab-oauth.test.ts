import { beforeAll, describe, expect, it } from "vitest";
import {
  buildGitLabAuthorizeUrl,
  createPublicGitLabLookup,
  createGitLabState,
  exchangeGitLabCode,
  gitlabJson,
  gitlabError,
  isPublicGitLabAddress,
  normalizeGitLabBaseUrl,
  parseGitLabTokenResponse,
  refreshGitLabToken,
  requestGitLab,
  verifyGitLabState,
} from "./gitlab-oauth";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
});

describe("normalizeGitLabBaseUrl", () => {
  it("normalizes public HTTPS GitLab origins and subpaths", () => {
    expect(normalizeGitLabBaseUrl(" https://gitlab.example.com/ ")).toBe("https://gitlab.example.com");
    expect(normalizeGitLabBaseUrl("https://git.example.com/gitlab/ ")).toBe("https://git.example.com/gitlab");
  });

  it.each([
    "http://gitlab.example.com",
    "https://user:pass@gitlab.example.com",
    "https://gitlab.example.com?next=x",
    "https://gitlab.example.com/#fragment",
    "https://gitlab.example.com?",
    "https://gitlab.example.com/#",
    "https://localhost",
    "https://gitlab.local",
    "https://127.0.0.1",
    "https://10.2.3.4",
    "https://172.20.1.1",
    "https://192.168.1.1",
    "https://169.254.169.254",
    "https://[::1]",
    "not a URL",
  ])("rejects unsafe instance URL %s", (value) => {
    expect(() => normalizeGitLabBaseUrl(value)).toThrow();
  });

  it("canonicalizes host casing and rejects non-public address families", () => {
    expect(normalizeGitLabBaseUrl("https://GitLab.Example.COM./gitlab")).toBe("https://gitlab.example.com/gitlab");
    expect(normalizeGitLabBaseUrl("https://[2606:4700:4700::1111]")).toBe("https://[2606:4700:4700::1111]");
    expect(isPublicGitLabAddress("8.8.8.8")).toBe(true);
    expect(isPublicGitLabAddress("10.0.0.1")).toBe(false);
    expect(isPublicGitLabAddress("100.64.0.1")).toBe(false);
    expect(isPublicGitLabAddress("fd00::1")).toBe(false);
    expect(isPublicGitLabAddress("fe80::1")).toBe(false);
    expect(isPublicGitLabAddress("2001:db8::1")).toBe(false);
    expect(isPublicGitLabAddress("2001:0::1")).toBe(false);
    expect(isPublicGitLabAddress("2002:808:808::1")).toBe(false);
  });

  it("rejects DNS answers containing any private address before connection", async () => {
    const lookup = createPublicGitLabLookup((_hostname, _options, callback) => {
      callback(null, [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]);
    });
    const result = await new Promise<{ code?: string }>((resolve) => {
      lookup("gitlab.example.com", { all: true }, (error) => resolve({ code: error?.code }));
    });
    expect(result.code).toBe("EACCES");
  });
});

describe("GitLab OAuth state and authorize URL", () => {
  it("preserves self-managed subpaths and encodes the callback, scopes, and state", () => {
    const url = new URL(buildGitLabAuthorizeUrl("https://git.example.com/gitlab", "client", "state", "https://shiplog.example/api/gitlab/callback"));
    expect(url.origin + url.pathname).toBe("https://git.example.com/gitlab/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client");
    expect(url.searchParams.get("redirect_uri")).toBe("https://shiplog.example/api/gitlab/callback");
    expect(url.searchParams.get("scope")).toBe("read_api read_user");
    expect(url.searchParams.get("state")).toBe("state");
  });

  it("binds state to the initiating workspace, member, instance, and expiry", () => {
    const now = 1_800_000_000_000;
    const state = createGitLabState("org_a", "user_a", "https://gitlab.example.com", now);
    expect(verifyGitLabState(state, state, "org_a", "user_a", "https://gitlab.example.com", now)).toBe(true);
    expect(verifyGitLabState(state, state, "org_b", "user_a", "https://gitlab.example.com", now)).toBe(false);
    expect(verifyGitLabState(state, state, "org_a", "user_b", "https://gitlab.example.com", now)).toBe(false);
    expect(verifyGitLabState(state, state, "org_a", "user_a", "https://other.example.com", now)).toBe(false);
    expect(verifyGitLabState(`${state}x`, state, "org_a", "user_a", "https://gitlab.example.com", now)).toBe(false);
    expect(verifyGitLabState(state, state, "org_a", "user_a", "https://gitlab.example.com", now + 11 * 60_000)).toBe(false);
  });
});

describe("GitLab token responses", () => {
  it("parses expiring access and rotating refresh tokens", () => {
    expect(parseGitLabTokenResponse({
      access_token: "access-token",
      refresh_token: "rotated-refresh-token",
      token_type: "Bearer",
      expires_in: 7200,
      created_at: 1_800_000_000,
      scope: "read_api read_user",
    })).toEqual({
      accessToken: "access-token",
      refreshToken: "rotated-refresh-token",
      expiresAt: new Date(1_800_007_200_000),
      scopes: "read_api read_user",
    });
  });

  it.each([
    {},
    { access_token: "access", refresh_token: "refresh", expires_in: 0 },
    { access_token: "access", expires_in: 3600 },
    { access_token: "access", refresh_token: "refresh", expires_in: Number.MAX_VALUE },
    { access_token: "access", refresh_token: "refresh", expires_in: 3600, created_at: Number.MAX_VALUE },
  ])("rejects incomplete or invalid token responses", (response) => {
    expect(() => parseGitLabTokenResponse(response)).toThrow();
  });

  it("exchanges authorization codes and rotating refresh tokens through the configured subpath", async () => {
    const calls: { url: string; init: unknown }[] = [];
    const sender = async (url: URL, init: unknown) => {
      calls.push({ url: url.toString(), init });
      return Response.json({ access_token: "access", refresh_token: "refresh-next", expires_in: 3600, scope: "read_api read_user" });
    };
    const credentials = { clientId: "client", clientSecret: "secret" };
    const code = await exchangeGitLabCode("https://git.example.com/gitlab", credentials, "auth-code", "https://shiplog.example/api/gitlab/callback", sender);
    const refreshed = await refreshGitLabToken("https://git.example.com/gitlab", credentials, "refresh-current", sender);

    expect(calls.map((call) => call.url)).toEqual([
      "https://git.example.com/gitlab/oauth/token",
      "https://git.example.com/gitlab/oauth/token",
    ]);
    expect(code.accessToken).toBe("access");
    expect(refreshed.refreshToken).toBe("refresh-next");
    expect(new URLSearchParams((calls[1].init as { body: string }).body).get("grant_type")).toBe("refresh_token");
  });

  it("blocks redirects and maps request timeouts without following them", async () => {
    let requestHeaders: Record<string, string> | undefined;
    await requestGitLab("https://gitlab.example.com", "/api/v4/user", { headers: { Authorization: "Bearer token" } }, async (_url, init) => {
      requestHeaders = init.headers;
      return Response.json({});
    });
    expect(requestHeaders).toEqual({ Accept: "application/json", Authorization: "Bearer token" });
    const redirect = async () => new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/admin" } });
    await expect(requestGitLab("https://gitlab.example.com", "/api/v4/user", {}, redirect)).rejects.toMatchObject({ code: "GITLAB_REDIRECT" });
    const timeout = async () => { throw new DOMException("timeout", "TimeoutError"); };
    await expect(gitlabJson("https://gitlab.example.com", "/api/v4/user", "token", timeout)).rejects.toMatchObject({ code: "GITLAB_TIMEOUT" });
    await expect(requestGitLab("https://gitlab.example.com", "/api/v4/projects/%2e%2e/admin", {}, timeout)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("gitlabError", () => {
  it.each([
    [401, "GITLAB_AUTH"],
    [403, "GITLAB_ACCESS"],
    [404, "GITLAB_ACCESS"],
    [429, "GITLAB_RATE_LIMIT"],
    [502, "GITLAB_UNAVAILABLE"],
  ])("maps status %i to %s", (status, code) => {
    expect(gitlabError(status).code).toBe(code);
  });
});