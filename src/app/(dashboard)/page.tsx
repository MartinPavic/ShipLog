import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Welcome back</h1>
      <p className="text-muted-foreground mb-8">
        Generate clean weekly progress reports from your GitHub activity.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <a
          href="/dashboard/ship-log"
          className="rounded-lg border p-6 hover:bg-muted/50 transition"
        >
          <h2 className="font-semibold mb-1">AI Ship Log</h2>
          <p className="text-sm text-muted-foreground">
            Create this week’s progress report in seconds
          </p>
        </a>
        <a
          href="/dashboard/settings"
          className="rounded-lg border p-6 hover:bg-muted/50 transition"
        >
          <h2 className="font-semibold mb-1">Settings</h2>
          <p className="text-sm text-muted-foreground">
            Connect GitHub & AI keys
          </p>
        </a>
      </div>
    </div>
  );
}