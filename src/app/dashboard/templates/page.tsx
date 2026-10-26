import { TemplatesManager } from "@/components/templates-manager";
import { getOwner, isAdmin } from "@/lib/owner";
import { listTemplates } from "@/lib/templates";

export default async function TemplatesPage() {
  const owner = await getOwner();
  const templates = await listTemplates(owner.ownerId);

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="mb-2 text-2xl font-bold">Templates</h1>
        <p className="text-muted-foreground">
          Templates decide how a ship log is written: its structure, length and style. Create your own or start from a
          built-in one.
        </p>
      </div>
      <TemplatesManager initialTemplates={templates} canDelete={isAdmin(owner)} />
    </div>
  );
}
