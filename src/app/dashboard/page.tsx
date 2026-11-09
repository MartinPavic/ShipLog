import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { QuickGenerate } from "@/components/quick-generate";
import { ManageBillingButton, UpgradeButton } from "@/components/upgrade-button";
import { UsageMeter } from "@/components/usage-meter";
import { Badge } from "@/components/ui/badge";
import { features } from "@/env";
import { PROJECT_COOKIE } from "@/lib/constants";
import { getDashboardData } from "@/lib/dashboard";
import { formatRelative } from "@/lib/format";
import { getOwner, isAdmin } from "@/lib/owner";
import { limitsFor } from "@/lib/plans";
import { listTemplates } from "@/lib/templates";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; canceled?: string }>;
}) {
  const { success, canceled } = await searchParams;
  const owner = await getOwner();
  const [user, data, cookieStore, templates] = await Promise.all([
    currentUser(),
    getDashboardData(owner),
    cookies(),
    listTemplates(owner.ownerId),
  ]);

  const { plan, stats, usage, projects, recentLogs, onboarding, setup } = data;
  const maxProjects = limitsFor(plan, owner.ownerId).maxProjects;
  const isPaid = plan !== "free";
  const planLabel = plan === "ultra" ? "Ultra" : plan === "pro" ? "Pro" : "Free";
  const billing = features().billing;
  const lastId = cookieStore.get(PROJECT_COOKIE)?.value;
  const initialProject = projects.find((p) => p.id === lastId) ?? projects[0];
  const setupMessage = !setup.github && !setup.gitlab?.connection
    ? "Connect GitHub or GitLab first."
    : !setup.canGenerate
      ? "Add an AI API key first."
      : null;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <div>
          <h1 className="text-2xl font-bold">Your reporting workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">Welcome back{user?.firstName ? `, ${user.firstName}` : ""}.</p>
        </div>
      </div>

      {success && (
        <p role="status" className="rounded-lg border border-success/30 bg-success/10 p-4 text-sm">
          {isPaid
            ? `You're on ${planLabel}. Thanks for subscribing!`
            : "Payment received. Your paid plan activates in a moment; refresh this page in a few seconds."}
        </p>
      )}
      {canceled && !success && (
        <p role="status" className="rounded-lg border p-4 text-sm text-muted-foreground">
          Checkout was canceled. You haven&apos;t been charged.
        </p>
      )}

      {!onboarding.complete && <OnboardingChecklist steps={onboarding.steps} next={onboarding.next} />}

      {initialProject && (
        <section className="space-y-5 border-t-2 border-double border-brass/60 pt-6" aria-labelledby="quick-generate-title">
          <h2 id="quick-generate-title" className="text-xl font-semibold">Quick generate</h2>
          <QuickGenerate
            projects={projects.map((p) => ({
              id: p.id,
              name: p.name,
              defaultPeriodDays: p.defaultPeriodDays,
              template: p.template,
            }))}
            templates={templates}
            initialProjectId={initialProject.id}
            usage={{ used: usage.used, limit: usage.limit }}
            setupMessage={setupMessage}
          />
        </section>
      )}

      <section className="space-y-3" aria-labelledby="recent-reports-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="recent-reports-title" className="text-xl font-semibold">Recent reports</h2>
          <Link href="/dashboard/projects" className="text-sm underline underline-offset-2">
            All projects
          </Link>
        </div>
        {recentLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">The log is still blank. Nothing generated yet.</p>
        ) : (
          <ul className="divide-y border-y">
            {recentLogs.map((log) => (
              <li key={log.id}>
                <Link
                  href={`/dashboard/projects/${log.projectId}/logs/${log.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 py-4 hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="break-words text-sm font-medium">{log.title}</p>
                    <p className="text-xs text-muted-foreground">{log.projectName}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                    {log.status === "generating" && <Badge variant="secondary">Generating</Badge>}
                    {log.status === "failed" && <Badge variant="destructive">Failed</Badge>}
                    {formatRelative(log.createdAt)}
                    {log.status === "ready" && <span className="text-sm text-foreground underline underline-offset-4">Review and share</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer aria-label="Account usage" className="flex flex-wrap items-center justify-between gap-5 border-t pt-5 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center gap-4">
          {billing && (
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={isPaid ? "default" : "secondary"}>{planLabel}</Badge>
              {isAdmin(owner) && (isPaid ? <ManageBillingButton /> : <UpgradeButton />)}
            </div>
          )}
          <UsageMeter used={usage.used} limit={usage.limit} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>{stats.projectCount} projects{Number.isFinite(maxProjects) ? ` of ${maxProjects} on your plan` : ""}</span>
          <span>{stats.logsThisMonth} reports this month</span>
        </div>
      </footer>
    </div>
  );
}
