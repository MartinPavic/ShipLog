import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { appUrl } from "@/lib/app-url";
import { saveGithubConnection, verifyGithubToken } from "@/lib/github";
import { exchangeCodeForToken, STATE_COOKIE, statesMatch } from "@/lib/github-oauth";
import { getOwner } from "@/lib/owner";

export const GET = handle(async (req: Request) => {
  const { userId } = await getOwner();
  const params = new URL(req.url).searchParams;

  const redirectWith = (status: string) => {
    const res = NextResponse.redirect(new URL(`/dashboard/settings?github=${status}`, appUrl()));
    res.cookies.set(STATE_COOKIE, "", { path: "/api/github", maxAge: 0 });
    return res;
  };

  if (params.get("error")) return redirectWith("denied");

  const code = params.get("code");
  const expectedState = (await cookies()).get(STATE_COOKIE)?.value;
  if (!code || !statesMatch(params.get("state"), expectedState)) return redirectWith("invalid_state");

  try {
    const { token } = await exchangeCodeForToken(code);
    const { login, scopes } = await verifyGithubToken(token);
    await saveGithubConnection(userId, { login, token, scopes });
    return redirectWith("connected");
  } catch (err) {
    console.error("GitHub OAuth callback failed:", err);
    return redirectWith("error");
  }
});
