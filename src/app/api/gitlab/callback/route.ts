import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { appUrl } from "@/lib/app-url";
import { exchangeGitLabCode, GITLAB_CALLBACK_PATH, GITLAB_STATE_COOKIE, gitlabJson, verifyGitLabState } from "@/lib/gitlab-oauth";
import { getGitLabInstance, saveGitLabTokenSet } from "@/lib/gitlab-settings";
import { getOwner } from "@/lib/owner";

export const GET = handle(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const expectedState = (await cookies()).get(GITLAB_STATE_COOKIE)?.value;
  const redirectWith = (status: string) => {
    const response = NextResponse.redirect(new URL(`/dashboard/settings?gitlab=${status}`, appUrl()));
    response.cookies.set(GITLAB_STATE_COOKIE, "", { path: "/api/gitlab", maxAge: 0 });
    return response;
  };

  if (params.get("error")) return redirectWith("denied");
  const code = params.get("code");
  const receivedState = params.get("state");
  if (!code || !receivedState || !expectedState) return redirectWith("invalid_state");

  try {
    const owner = await getOwner();
    const instance = await getGitLabInstance(owner.ownerId);
    if (!instance || !verifyGitLabState(receivedState, expectedState, owner.ownerId, owner.userId, instance.baseUrl)) {
      return redirectWith("invalid_state");
    }
    const redirectUri = `${appUrl()}${GITLAB_CALLBACK_PATH}`;
    const tokens = await exchangeGitLabCode(instance.baseUrl, instance, code, redirectUri);
    const profile = await gitlabJson<{ username?: string }>(instance.baseUrl, "/api/v4/user", tokens.accessToken);
    if (!profile.username) return redirectWith("error");
    await saveGitLabTokenSet(owner.ownerId, owner.userId, profile.username, tokens, {
      baseUrl: instance.baseUrl,
      clientId: instance.clientId,
    });
    return redirectWith("connected");
  } catch (error) {
    console.error("GitLab OAuth callback failed:", error instanceof Error ? error.message : "unknown error");
    return redirectWith("error");
  }
});