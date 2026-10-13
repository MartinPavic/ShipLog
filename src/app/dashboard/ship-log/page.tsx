import { desc, eq } from "drizzle-orm";
import { ShipLogClient } from "@/components/ship-log-client";
import { getDb } from "@/db";
import { shipLogs } from "@/db/schema";
import { getOwner } from "@/lib/owner";
import { getSetupStatus } from "@/lib/settings";

export default async function ShipLogPage() {
  const owner = await getOwner();
  const status = await getSetupStatus(owner);

  const logs = status.canGenerate
    ? await getDb()
        .select({
          id: shipLogs.id,
          createdAt: shipLogs.createdAt,
          content: shipLogs.content,
          title: shipLogs.title,
        })
        .from(shipLogs)
        .where(eq(shipLogs.ownerId, owner.ownerId))
        .orderBy(desc(shipLogs.createdAt))
        .limit(10)
    : [];

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-2">AI Ship Log</h1>
      <p className="text-muted-foreground mb-8">
        Generate a clean weekly progress report from your GitHub activity.
      </p>

      {!status.canGenerate ? (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-6">
          <p className="font-medium mb-2">Setup incomplete</p>
          <p className="text-sm text-muted-foreground mb-4">
            Connect GitHub and add an AI API key in Settings first.
          </p>
          <a href="/dashboard/settings" className="text-sm underline">
            Open Settings →
          </a>
        </div>
      ) : (
        <ShipLogClient
          initialLogs={logs.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() }))}
        />
      )}
    </div>
  );
}
