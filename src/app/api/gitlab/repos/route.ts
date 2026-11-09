import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { getFreshGitLabConnection } from "@/lib/gitlab-settings";
import { gitlabJson } from "@/lib/gitlab-oauth";
import { getOwner } from "@/lib/owner";
import { enforceRateLimit } from "@/lib/rate-limit";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(50).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(50),
});

type GitLabProject = {
  path_with_namespace: string;
  visibility: "private" | "internal" | "public";
  description: string | null;
};

export const GET = handle(async (req: Request) => {
  const owner = await getOwner();
  await enforceRateLimit(`gitlab-repos:${owner.ownerId}:${owner.userId}`, 60, 60 * 60 * 1000, "GitLab repository requests");
  const { page, per_page } = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const connection = await getFreshGitLabConnection(owner.ownerId, owner.userId);

  const query = new URLSearchParams({ membership: "true", order_by: "last_activity_at", sort: "desc", simple: "true", per_page: String(per_page), page: String(page) });
  const projects = await gitlabJson<GitLabProject[]>(connection.baseUrl, `/api/v4/projects?${query}`, connection.accessToken);
  const repos = projects.map((project) => ({
    fullName: project.path_with_namespace,
    private: project.visibility !== "public",
    description: project.description,
  }));
  return NextResponse.json({ repos, nextPage: repos.length === per_page && page < 50 ? page + 1 : null });
});