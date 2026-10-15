import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { QuickGenerate } from "@/components/quick-generate";
import { ManageBillingButton, UpgradeButton } from "@/components/upgrade-button";
import { UsageMeter } from "@/components/usage-meter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { TemplateId } from "@/lib/ai/templates";
import { PROJECT_COOKIE } from "@/lib/constants";
import { getDashboardData } from "@/lib/dashboard";
import { formatRelative } from "@/lib/format";
import { getOwner, isAdmin } from "@/lib/owner";
import { PLAN_LIMITS } from "@/lib/plans";

function Stat({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <p className="text-sm text-muted-foreground">{label}</p>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{children}</div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; canceled?: string }>;
}) {
  const { success, canceled } = await searchParams;
  const owner = await getOwner();
  const [user, data, cookieStore] = await Promise.all([currentUser(), getDashboardData(owner), cookies()]);

  const { plan, stats, usage, projects, recentLogs, onboarding, setup } = data;
  const maxProjects = PLAN_LIMITS[plan].maxProjects;
  const lastId = cookieStore.get(PROJECT_COOKIE)?.value;
  const initialProject = projects.find((p) => p.id === lastId) ?? projects[0];
  const setupMessage = !setup.github ? "Connect GitHub first." : !setup.canGenerate ? "Add an AI API key first." : null;

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Welcome back{user?.firstName ? `, ${user.firstName}` : ""}</h1>
          <p className="text-muted-foreground">Your ship logs at a glance.</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={plan === "pro" ? "default" : "secondary"}>{plan === "pro" ? "Pro" : "Free"}</Badge>
          {isAdmin(owner) && (plan === "pro" ? <ManageBillingButton /> : <UpgradeButton />)}
        </div>
      </div>

      {success && (
        <p role="status" className="rounded-lg border border-green-600/30 bg-green-600/5 p-4 text-sm">
          {plan === "pro"
            ? "You're on Pro. Thanks for subscribing!"
            : "Payment received. Your Pro plan activates in a moment; refresh this page in a few seconds."}
        </p>
      )}
      {canceled && !success && (
        <p role="status" className="rounded-lg border p-4 text-sm text-muted-foreground">
          Checkout was canceled. You haven&apos;t been charged.
        </p>
      )}

      {!onboarding.complete && <OnboardingChecklist steps={onboarding.steps} next={onboarding.next} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Logs this month">{stats.logsThisMonth}</Stat>
        <Stat label="Projects" hint={Number.isFinite(maxProjects) ? `of ${maxProjects} on your plan` : undefined}>
          {stats.projectCount}
        </Stat>
        <Stat label="Last generated">
          <span className="text-lg">{stats.lastGeneratedAt ? formatRelative(stats.lastGeneratedAt) : "Never"}</span>
        </Stat>
        <Stat label="Usage">
          <UsageMeter used={usage.used} limit={usage.limit} />
        </Stat>
      </div>

      {initialProject && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Quick generate</h2>
          <QuickGenerate
            projects={projects.map((p) => ({
              id: p.id,
              name: p.name,
              defaultPeriodDays: p.defaultPeriodDays,
              template: p.template as TemplateId,
            }))}
            initialProjectId={initialProject.id}
            usage={{ used: usage.used, limit: usage.limit }}
            setupMessage={setupMessage}
          />
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent logs</h2>
          <Link href="/dashboard/projects" className="text-sm underline underline-offset-2">
            All projects
          </Link>
        </div>
        {recentLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing generated yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {recentLogs.map((log) => (
              <li key={log.id}>
                <Link
                  href={`/dashboard/projects/${log.projectId}/logs/${log.id}`}
                  className="flex items-center justify-between gap-4 p-4 hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{log.title}</p>
                    <p className="text-xs text-muted-foreground">{log.projectName}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {log.status === "generating" && <Badge variant="secondary">Generating</Badge>}
                    {log.status === "failed" && <Badge variant="destructive">Failed</Badge>}
                    {formatRelative(log.createdAt)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
