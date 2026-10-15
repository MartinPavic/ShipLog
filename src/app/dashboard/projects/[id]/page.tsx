import Link from "next/link";
import { notFound } from "next/navigation";
import { ArchiveProjectButton } from "@/components/archive-project-button";
import { ChannelsManager } from "@/components/channels-manager";
import { DEFAULT_SCHEDULE, ProjectForm } from "@/components/project-form";
import { ProjectGenerate } from "@/components/project-generate";
import { UpgradeButton } from "@/components/upgrade-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TEMPLATES, type TemplateId } from "@/lib/ai/templates";
import { formatDate } from "@/lib/format";
import { listChannels } from "@/lib/delivery";
import { isEmailConfigured } from "@/lib/email";
import { listLogs } from "@/lib/logs";
import { getOwner, isAdmin } from "@/lib/owner";
import { getOwnerSlug } from "@/lib/owner-profile";
import { getPlanLimits } from "@/lib/plans";
import { getProject } from "@/lib/projects";
import { getLastRun } from "@/lib/scheduler";
import { getSetupStatus } from "@/lib/settings";
import { getUsageMeter } from "@/lib/usage";
import { logListQuerySchema } from "@/lib/validation";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "history", label: "History" },
  { id: "delivery", label: "Delivery" },
  { id: "settings", label: "Settings" },
] as const;

type SearchParams = Record<string, string | undefined>;

function historyHref(projectId: string, params: SearchParams, page: number) {
  const next = new URLSearchParams({ tab: "history" });
  for (const key of ["q", "from", "to", "pinned"]) if (params[key]) next.set(key, params[key]);
  if (page > 1) next.set("page", String(page));
  return `/dashboard/projects/${projectId}?${next}`;
}

function LogList({
  projectId,
  items,
}: {
  projectId: string;
  items: Awaited<ReturnType<typeof listLogs>>["items"];
}) {
  return (
    <div className="space-y-3">
      {items.map((log) => (
        <Link key={log.id} href={`/dashboard/projects/${projectId}/logs/${log.id}`} className="block">
          <Card className="transition hover:bg-muted/50">
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2 text-base">
                {log.title}
                {log.pinned && <Badge variant="secondary">Pinned</Badge>}
                {log.status === "generating" && <Badge variant="secondary">Generating</Badge>}
                {log.status === "failed" && <Badge variant="destructive">Failed</Badge>}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {TEMPLATES[log.template as TemplateId]?.label ?? log.template} · {formatDate(log.createdAt)}
              </p>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">{log.excerpt}</p>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const owner = await getOwner();
  const project = await getProject(owner.ownerId, id);
  if (!project) notFound();

  const tab = TABS.find((t) => t.id === sp.tab)?.id ?? "overview";
  const { limits } = await getPlanLimits(owner.ownerId);
  const ownerSlug = tab === "settings" && project.isPublicChangelog ? await getOwnerSlug(owner.ownerId) : null;
  const lastRun = tab === "settings" ? await getLastRun(project.id) : null;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{project.name}</h1>
        {project.description && <p className="mt-1 text-muted-foreground">{project.description}</p>}
      </div>

      <nav className="flex gap-4 border-b text-sm">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/dashboard/projects/${project.id}?tab=${t.id}`}
            className={`-mb-px border-b-2 pb-2 ${
              tab === t.id ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <OverviewTab
          owner={owner}
          projectId={project.id}
          defaultDays={project.defaultPeriodDays}
          defaultTemplate={project.template as TemplateId}
          limits={limits}
        />
      )}

      {tab === "history" && <HistoryTab owner={owner} projectId={project.id} sp={sp} limits={limits} />}

      {tab === "delivery" && (
        <ChannelsManager
          projectId={project.id}
          initialChannels={(await listChannels(project.id)).map((c) => ({
            id: c.id,
            kind: c.kind,
            enabled: c.enabled,
            hint: c.hint,
          }))}
          canManage={isAdmin(owner)}
          deliveryAllowed={limits.delivery}
          emailConfigured={isEmailConfigured()}
        />
      )}

      {tab === "settings" && (
        <div className="space-y-6">
          {ownerSlug && (
            <p className="text-sm text-muted-foreground">
              Public changelog:{" "}
              <Link href={`/p/${ownerSlug}/${project.slug}`} className="underline underline-offset-2">
                /p/{ownerSlug}/{project.slug}
              </Link>
            </p>
          )}
          <ProjectForm
            mode="edit"
            projectId={project.id}
            initial={{
              name: project.name,
              description: project.description ?? "",
              repos: project.repos,
              template: project.template as TemplateId,
              tone: project.tone ?? "",
              audience: project.audience ?? "",
              customPrompt: project.customPrompt ?? "",
              defaultPeriodDays: project.defaultPeriodDays,
              isPublicChangelog: project.isPublicChangelog,
              schedule: project.schedule ?? DEFAULT_SCHEDULE,
            }}
            schedulingAllowed={limits.scheduling}
            canTakeOver={isAdmin(owner) && project.createdBy !== owner.userId}
            lastRun={lastRun ? { slot: lastRun.slot, status: lastRun.status, error: lastRun.error } : null}
          />
          {isAdmin(owner) && (
            <Card>
              <CardHeader>
                <CardTitle>Danger zone</CardTitle>
              </CardHeader>
              <CardContent>
                <ArchiveProjectButton projectId={project.id} />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

async function OverviewTab({
  owner,
  projectId,
  defaultDays,
  defaultTemplate,
  limits,
}: {
  owner: Awaited<ReturnType<typeof getOwner>>;
  projectId: string;
  defaultDays: number;
  defaultTemplate: TemplateId;
  limits: Awaited<ReturnType<typeof getPlanLimits>>["limits"];
}) {
  const [status, recent, usage] = await Promise.all([
    getSetupStatus(owner),
    listLogs(owner.ownerId, projectId, logListQuerySchema.parse({ pageSize: 5 }), limits),
    getUsageMeter(owner.ownerId),
  ]);
  const setupMessage = !status.github
    ? "Connect GitHub first."
    : !status.canGenerate
      ? "Add an AI API key first."
      : null;

  return (
    <div className="space-y-6">
      <ProjectGenerate
        projectId={projectId}
        defaultDays={defaultDays}
        defaultTemplate={defaultTemplate}
        setupMessage={setupMessage}
        usage={{ used: usage.used, limit: usage.limit }}
      />
      {recent.items.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent logs</h2>
            <Link href={`/dashboard/projects/${projectId}?tab=history`} className="text-sm underline underline-offset-2">
              View all
            </Link>
          </div>
          <LogList projectId={projectId} items={recent.items} />
        </div>
      )}
    </div>
  );
}

async function HistoryTab({
  owner,
  projectId,
  sp,
  limits,
}: {
  owner: Awaited<ReturnType<typeof getOwner>>;
  projectId: string;
  sp: SearchParams;
  limits: Awaited<ReturnType<typeof getPlanLimits>>["limits"];
}) {
  const parsed = logListQuerySchema.safeParse(sp);
  const query = parsed.success ? parsed.data : logListQuerySchema.parse({});
  const { items, total, page, pageSize, hidden } = await listLogs(owner.ownerId, projectId, query, limits);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <form className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value="history" />
        <Input name="q" placeholder="Search logs" defaultValue={sp.q ?? ""} className="w-56" aria-label="Search" />
        <label className="space-y-1 text-xs text-muted-foreground">
          From
          <Input type="date" name="from" defaultValue={sp.from ?? ""} />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          To
          <Input type="date" name="to" defaultValue={sp.to ?? ""} />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="pinned" value="1" defaultChecked={Boolean(sp.pinned)} />
          Pinned only
        </label>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No logs match.</p>
      ) : (
        <LogList projectId={projectId} items={items} />
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={historyHref(projectId, sp, page - 1)} className="underline underline-offset-2">
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={historyHref(projectId, sp, page + 1)} className="underline underline-offset-2">
              Next
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}

      {hidden > 0 && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm text-muted-foreground">
              {hidden} older {hidden === 1 ? "log is" : "logs are"} hidden on the Free plan.
            </p>
            <UpgradeButton />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
