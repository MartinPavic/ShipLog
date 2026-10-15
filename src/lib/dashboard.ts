import { and, count, desc, eq, gte, isNull, max } from "drizzle-orm";
import { getDb } from "@/db";
import { projects, shipLogs } from "@/db/schema";
import { listProjects } from "@/lib/projects";
import { getSetupStatus } from "@/lib/settings";
import { getUsageMeter } from "@/lib/usage";

export type OnboardingStep = {
  id: "github" | "ai" | "project" | "log";
  title: string;
  description: string;
  href: string;
  done: boolean;
};

export function buildOnboarding(input: { github: boolean; ai: boolean; firstProjectId: string | null; hasLog: boolean }) {
  const steps: OnboardingStep[] = [
    {
      id: "github",
      title: "Connect GitHub",
      description: "Let ShipLog read the commits, pull requests and releases of your repositories.",
      href: "/dashboard/settings",
      done: input.github,
    },
    {
      id: "ai",
      title: "Add an AI key",
      description: "Use your own OpenAI, Anthropic or Grok key. Pro includes managed AI, so no key is needed.",
      href: "/dashboard/settings",
      done: input.ai,
    },
    {
      id: "project",
      title: "Create a project",
      description: "A project groups the repositories behind one ship log.",
      href: "/dashboard/projects",
      done: input.firstProjectId !== null,
    },
    {
      id: "log",
      title: "Generate your first ship log",
      description: "Pick a template and a period, and let the AI write it.",
      href: input.firstProjectId ? `/dashboard/projects/${input.firstProjectId}` : "/dashboard/projects",
      done: input.hasLog,
    },
  ];
  return { steps, complete: steps.every((s) => s.done), next: steps.find((s) => !s.done) ?? null };
}

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export async function getDashboardData(owner: { ownerId: string; userId: string }, now = new Date()) {
  const db = getDb();
  const ready = and(eq(shipLogs.ownerId, owner.ownerId), eq(shipLogs.status, "ready"));

  const [projectRows, status, usage, [monthly], [totals], recent] = await Promise.all([
    listProjects(owner.ownerId),
    getSetupStatus(owner),
    getUsageMeter(owner.ownerId),
    db.select({ n: count() }).from(shipLogs).where(and(ready, gte(shipLogs.createdAt, monthStart(now)))),
    db.select({ n: count(), last: max(shipLogs.createdAt) }).from(shipLogs).where(ready),
    db
      .select({
        id: shipLogs.id,
        title: shipLogs.title,
        status: shipLogs.status,
        createdAt: shipLogs.createdAt,
        projectId: projects.id,
        projectName: projects.name,
      })
      .from(shipLogs)
      .innerJoin(projects, eq(projects.id, shipLogs.projectId))
      .where(and(eq(shipLogs.ownerId, owner.ownerId), isNull(projects.archivedAt)))
      .orderBy(desc(shipLogs.createdAt))
      .limit(5),
  ]);

  return {
    plan: status.plan,
    setup: status,
    usage,
    projects: projectRows,
    stats: {
      logsThisMonth: monthly.n,
      logsTotal: totals.n,
      projectCount: projectRows.length,
      lastGeneratedAt: totals.last,
    },
    recentLogs: recent,
    onboarding: buildOnboarding({
      github: status.github !== null,
      ai: status.ai !== null || status.managedAi,
      firstProjectId: projectRows[0]?.id ?? null,
      hasLog: totals.n > 0,
    }),
  };
}
