import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { PrintButton } from "@/components/export-menu";
import { UpgradeButton } from "@/components/upgrade-button";
import { formatDate } from "@/lib/format";
import { assertLogVisible, getLog } from "@/lib/logs";
import { getOwner } from "@/lib/owner";
import { getPlanLimits } from "@/lib/plans";
import { getProject } from "@/lib/projects";

// The browser's print dialog produces the PDF; the dashboard chrome is hidden by print styles.
export default async function PrintLogPage({ params }: { params: Promise<{ id: string; logId: string }> }) {
  const { id, logId } = await params;
  const owner = await getOwner();
  const [project, log, { limits }] = await Promise.all([
    getProject(owner.ownerId, id),
    getLog(owner.ownerId, logId),
    getPlanLimits(owner.ownerId),
  ]);
  if (!project || !log || log.projectId !== project.id) notFound();

  if (!limits.pdfExport) {
    return (
      <div className="max-w-3xl space-y-4">
        <p className="text-sm text-muted-foreground">PDF export is a Pro feature.</p>
        <UpgradeButton />
      </div>
    );
  }
  await assertLogVisible(log, limits);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="print:hidden">
        <PrintButton />
      </div>
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">{project.name}</p>
        <h1 className="text-2xl font-bold">{log.title}</h1>
        <p className="text-sm text-muted-foreground">
          {formatDate(log.periodStart)} – {formatDate(log.periodEnd)}
        </p>
      </header>
      <Markdown>{log.content}</Markdown>
    </div>
  );
}
