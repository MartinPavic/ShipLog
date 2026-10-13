import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl, newState, statesMatch } from "./github-oauth";

describe("statesMatch", () => {
  it("accepts equal states only", () => {
    const state = newState();
    expect(statesMatch(state, state)).toBe(true);
    expect(statesMatch(state, newState())).toBe(false);
    expect(statesMatch(state, state.slice(0, -1))).toBe(false);
  });

  it("rejects missing values", () => {
    expect(statesMatch(null, "x")).toBe(false);
    expect(statesMatch("x", undefined)).toBe(false);
    expect(statesMatch("", "")).toBe(false);
  });
});

describe("buildAuthorizeUrl", () => {
  it("includes client id, scopes, state and callback", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com/";
    const url = new URL(buildAuthorizeUrl("client123", "st4te"));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client123");
    expect(url.searchParams.get("scope")).toBe("repo read:user");
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/api/github/callback");
  });

  it("generates unguessable states", () => {
    expect(newState()).toHaveLength(43);
  });
});
