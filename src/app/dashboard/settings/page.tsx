import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { SettingsForm } from "@/components/settings-form";

export default async function SettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  const privateMetadata = (user?.privateMetadata || {}) as {
    githubToken?: string;
    aiApiKey?: string;
    aiProvider?: string;
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-2">Settings</h1>
      <p className="text-muted-foreground mb-8">
        Connect your GitHub and AI provider so ShipLog can generate reports.
      </p>

      <SettingsForm
        initialGithubToken={privateMetadata.githubToken || ""}
        initialAiApiKey={privateMetadata.aiApiKey || ""}
        initialAiProvider={privateMetadata.aiProvider || "openai"}
      />
    </div>
  );
}