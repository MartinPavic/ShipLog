import { randomBytes, timingSafeEqual } from "node:crypto";
import { appUrl } from "@/lib/app-url";
import { ApiError } from "@/lib/api";

export const GITHUB_SCOPES = "repo read:user";
export const STATE_COOKIE = "gh_oauth_state";

export function oauthConfig() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export const newState = () => randomBytes(32).toString("base64url");

export function buildAuthorizeUrl(clientId: string, state: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${appUrl()}/api/github/callback`);
  url.searchParams.set("scope", GITHUB_SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}

export function statesMatch(received: string | null | undefined, expected: string | null | undefined): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function exchangeCodeForToken(code: string): Promise<{ token: string; scopes: string }> {
  const config = oauthConfig();
  if (!config) throw new ApiError(503, "GitHub OAuth is not configured.", "GITHUB_NOT_CONFIGURED");

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: `${appUrl()}/api/github/callback`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json()) as { access_token?: string; scope?: string; error?: string };
  if (!res.ok || !data.access_token) {
    throw new ApiError(400, "GitHub did not accept the authorization code.", "GITHUB_AUTH");
  }
  return { token: data.access_token, scopes: (data.scope ?? "").split(",").join(" ") };
}

// Best effort: tokens that didn't come from this OAuth app (e.g. migrated PATs) can't be revoked here.
export async function revokeGrant(token: string): Promise<void> {
  const config = oauthConfig();
  if (!config) return;
  await fetch(`https://api.github.com/applications/${config.clientId}/grant`, {
    method: "DELETE",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ access_token: token }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}
