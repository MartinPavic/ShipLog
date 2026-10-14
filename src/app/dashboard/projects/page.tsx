import Link from "next/link";
import { ProjectForm } from "@/components/project-form";
import { UpgradeButton } from "@/components/upgrade-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { getOwner } from "@/lib/owner";
import { getPlanLimits } from "@/lib/plans";
import { listProjects } from "@/lib/projects";

export default async function ProjectsPage() {
  const owner = await getOwner();
  const [projects, { limits, plan }] = await Promise.all([listProjects(owner.ownerId), getPlanLimits(owner.ownerId)]);
  const atLimit = projects.length >= limits.maxProjects;

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="mb-2 text-2xl font-bold">Projects</h1>
        <p className="text-muted-foreground">Each project turns the activity of its repositories into ship logs.</p>
      </div>

      {projects.length > 0 && (
        <div className="space-y-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/dashboard/projects/${p.id}`} className="block">
              <Card className="transition hover:bg-muted/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {p.name}
                    {p.isPublicChangelog && <Badge variant="secondary">Public changelog</Badge>}
                  </CardTitle>
                  <CardDescription>
                    {p.repos.length} {p.repos.length === 1 ? "repository" : "repositories"} · {p.logCount}{" "}
                    {p.logCount === 1 ? "log" : "logs"}
                    {p.lastLogAt ? ` · last generated ${formatDate(p.lastLogAt)}` : ""}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {atLimit ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm text-muted-foreground">
              The {plan === "free" ? "Free" : ""} plan includes {limits.maxProjects} project
              {limits.maxProjects === 1 ? "" : "s"}. Upgrade to Pro for unlimited projects.
            </p>
            <UpgradeButton />
          </CardContent>
        </Card>
      ) : (
        <ProjectForm mode="create" />
      )}
    </div>
  );
}
