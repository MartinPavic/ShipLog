import Link from "next/link";
import { redirect } from "next/navigation";
import { ProjectForm } from "@/components/project-form";
import { getOwner } from "@/lib/owner";
import { getPlanLimits } from "@/lib/plans";
import { listProjects } from "@/lib/projects";
import { listTemplates } from "@/lib/templates";

export default async function NewProjectPage() {
  const owner = await getOwner();
  const [projects, { limits }, templates] = await Promise.all([
    listProjects(owner.ownerId),
    getPlanLimits(owner.ownerId),
    listTemplates(owner.ownerId),
  ]);
  if (projects.length >= limits.maxProjects) redirect("/dashboard/projects");

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/dashboard/projects" className="text-sm text-muted-foreground underline underline-offset-2">
          All projects
        </Link>
        <h1 className="mt-2 text-2xl font-bold">New project</h1>
      </div>
      <ProjectForm mode="create" templates={templates} />
    </div>
  );
}
