import Link from "next/link";
import { notFound } from "next/navigation";
import { LogViewer } from "@/components/log-viewer";
import { ApiError } from "@/lib/api";
import { assertLogVisible, getLog, listVersions } from "@/lib/logs";
import { getOwner } from "@/lib/owner";
import { getPlanLimits } from "@/lib/plans";
import { getProject } from "@/lib/projects";
import { UpgradeButton } from "@/components/upgrade-button";

export default async function LogPage({ params }: { params: Promise<{ id: string; logId: string }> }) {
  const { id, logId } = await params;
  const owner = await getOwner();
  const [project, log] = await Promise.all([getProject(owner.ownerId, id), getLog(owner.ownerId, logId)]);
  if (!project || !log || log.projectId !== project.id) notFound();

  try {
    await assertLogVisible(log, (await getPlanLimits(owner.ownerId)).limits);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return (
      <div className="max-w-3xl space-y-4">
        <p className="text-sm text-muted-foreground">{err.message}</p>
        <UpgradeButton />
      </div>
    );
  }

  const versions = await listVersions(log.id);

  return (
    <div className="max-w-3xl space-y-4">
      <Link
        href={`/dashboard/projects/${project.id}?tab=history`}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← {project.name}
      </Link>
      <LogViewer
        projectId={project.id}
        log={{
          id: log.id,
          title: log.title,
          content: log.content,
          pinned: log.pinned,
          status: log.status,
          periodStart: log.periodStart.toISOString(),
          periodEnd: log.periodEnd.toISOString(),
          createdAt: log.createdAt.toISOString(),
        }}
        versions={versions.map((v) => ({ id: v.id, content: v.content, createdAt: v.createdAt.toISOString() }))}
      />
    </div>
  );
}
