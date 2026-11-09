import { NextResponse } from "next/server";
import { appUrl } from "@/lib/app-url";
import { handle } from "@/lib/api";
import { buildGitLabAuthorizeUrl, createGitLabState, GITLAB_CALLBACK_PATH, GITLAB_STATE_COOKIE } from "@/lib/gitlab-oauth";
import { getGitLabInstanceStatus } from "@/lib/gitlab-settings";
import { getOwner } from "@/lib/owner";

export const GET = handle(async () => {
  const owner = await getOwner();
  const instance = await getGitLabInstanceStatus(owner.ownerId);
  if (!instance) return NextResponse.redirect(new URL("/dashboard/settings?gitlab=not_configured", appUrl()));

  const state = createGitLabState(owner.ownerId, owner.userId, instance.baseUrl);
  const redirectUri = `${appUrl()}${GITLAB_CALLBACK_PATH}`;
  const response = NextResponse.redirect(buildGitLabAuthorizeUrl(instance.baseUrl, instance.clientId, state, redirectUri));
  response.cookies.set(GITLAB_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/api/gitlab",
  });
  return response;
});