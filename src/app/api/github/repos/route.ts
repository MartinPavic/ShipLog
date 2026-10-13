import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handle } from "@/lib/api";
import { getGithubConnection, listReposCached } from "@/lib/github";
import { getOwner } from "@/lib/owner";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(50).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(30),
});

export const GET = handle(async (req: Request) => {
  const { userId } = await getOwner();
  const { page, per_page } = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  const github = await getGithubConnection(userId);
  if (!github) throw new ApiError(400, "Connect GitHub in Settings first.", "NO_GITHUB");

  const repos = await listReposCached(userId, github.token, page, per_page);
  return NextResponse.json({ repos, nextPage: repos.length === per_page ? page + 1 : null });
});
