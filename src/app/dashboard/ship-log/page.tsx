import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ShipLogClient } from "@/components/ship-log-client";

export default async function ShipLogPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  const meta = (user?.privateMetadata || {}) as {
    githubToken?: string;
    aiApiKey?: string;
    aiProvider?: string;
    shipLogs?: Array<{ id: string; createdAt: string; content: string; period: string }>;
  };

  const hasCredentials = Boolean(meta.githubToken && meta.aiApiKey);

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-2">AI Ship Log</h1>
      <p className="text-muted-foreground mb-8">
        Generate a clean weekly progress report from your GitHub activity.
      </p>

      {!hasCredentials ? (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-6">
          <p className="font-medium mb-2">Credentials missing</p>
          <p className="text-sm text-muted-foreground mb-4">
            Go to Settings and add your GitHub token + AI API key first.
          </p>
          <a href="/dashboard/settings" className="text-sm underline">
            Open Settings →
          </a>
        </div>
      ) : (
        <ShipLogClient initialLogs={meta.shipLogs || []} />
      )}
    </div>
  );
}