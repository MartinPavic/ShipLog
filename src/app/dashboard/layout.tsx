import { auth } from "@clerk/nextjs/server";
import { UserButton, OrganizationSwitcher } from "@clerk/nextjs";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProjectSwitcher } from "@/components/project-switcher";
import { getOwner, isAdmin } from "@/lib/owner";
import { getPlanLimits } from "@/lib/plans";
import { listProjects } from "@/lib/projects";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const owner = await getOwner();
  const [projects, { plan }] = await Promise.all([listProjects(owner.ownerId), getPlanLimits(owner.ownerId)]);
  const freeOrg = owner.orgId !== null && plan === "free";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b print:hidden">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="font-semibold">
              ShipLog
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
                Dashboard
              </Link>
              <Link href="/dashboard/projects" className="text-muted-foreground hover:text-foreground">
                Projects
              </Link>
              <Link href="/dashboard/settings" className="text-muted-foreground hover:text-foreground">
                Settings
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <OrganizationSwitcher
              hidePersonal={false}
              afterSelectOrganizationUrl="/dashboard"
              afterSelectPersonalUrl="/dashboard"
              afterCreateOrganizationUrl="/dashboard"
              afterLeaveOrganizationUrl="/dashboard"
            />
            <ProjectSwitcher projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
            <UserButton />
          </div>
        </div>
      </header>
      {freeOrg && (
        <div role="status" className="border-b bg-yellow-500/5 print:hidden">
          <p className="container mx-auto px-4 py-2 text-sm">
            This organization is on the Free plan. Teams are a Pro feature:{" "}
            {isAdmin(owner) ? (
              <Link href="/dashboard/settings" className="underline underline-offset-2">
                upgrade in Settings
              </Link>
            ) : (
              "ask an admin to upgrade"
            )}{" "}
            to create projects and generate logs together.
          </p>
        </div>
      )}
      <main className="container mx-auto px-4 py-8 print:p-0">{children}</main>
    </div>
  );
}
