import { NextResponse } from "next/server";
import { ApiError, handle, parseBody } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getSharedLog } from "@/lib/public";
import { ACCESS_COOKIE, ACCESS_TTL_SEC, isShareToken, signAccess, verifyPassword } from "@/lib/share";
import { unlockSchema } from "@/lib/validation";

const FIFTEEN_MIN = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

// Public: unlocks a password-protected share link by setting a signed, httpOnly access cookie.
export const POST = handle(async (req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  if (!isShareToken(token)) throw new ApiError(404, "This link is not available.", "NOT_FOUND");
  const { password } = await parseBody(req, unlockSchema);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  await enforceRateLimit(`unlock:${token}:${ip}`, 10, FIFTEEN_MIN, "password attempts");
  await enforceRateLimit(`unlock:${token}`, 100, HOUR, "password attempts");

  const log = await getSharedLog(token);
  if (!log?.passwordHash) throw new ApiError(404, "This link is not available.", "NOT_FOUND");
  if (!(await verifyPassword(password, log.passwordHash))) {
    throw new ApiError(401, "Incorrect password.", "BAD_PASSWORD");
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE, signAccess(token, log.passwordHash), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ACCESS_TTL_SEC,
    path: `/s/${token}`,
  });
  return res;
});
