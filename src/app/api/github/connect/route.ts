import { NextResponse } from "next/server";
import { appUrl } from "@/lib/app-url";
import { handle } from "@/lib/api";
import { buildAuthorizeUrl, newState, oauthConfig, STATE_COOKIE } from "@/lib/github-oauth";
import { getOwner } from "@/lib/owner";

export const GET = handle(async () => {
  await getOwner();

  const config = oauthConfig();
  if (!config) {
    return NextResponse.redirect(new URL("/dashboard/settings?github=not_configured", appUrl()));
  }

  const state = newState();
  const res = NextResponse.redirect(buildAuthorizeUrl(config.clientId, state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/api/github",
  });
  return res;
});
