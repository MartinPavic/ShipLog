import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PROJECT_COOKIE } from "@/lib/constants";
import { getOwner } from "@/lib/owner";
import { listProjects } from "@/lib/projects";

// Legacy entry point: jump to the last used project.
export default async function ShipLogRedirect() {
  const owner = await getOwner();
  const projects = await listProjects(owner.ownerId);
  const lastId = (await cookies()).get(PROJECT_COOKIE)?.value;
  const target = projects.find((p) => p.id === lastId) ?? projects[0];
  redirect(target ? `/dashboard/projects/${target.id}` : "/dashboard/projects");
}
