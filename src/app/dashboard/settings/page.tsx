import { AiCard, GithubCard } from "@/components/settings-form";
import { ManageBillingButton, UpgradeButton } from "@/components/upgrade-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getOwner, isAdmin } from "@/lib/owner";
import { getSetupStatus } from "@/lib/settings";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ github?: string }>;
}) {
  const { github: githubNotice } = await searchParams;
  const owner = await getOwner();
  const status = await getSetupStatus(owner);
  const canManage = isAdmin(owner);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Settings</h1>
        <p className="text-muted-foreground">
          Connect your GitHub and AI provider so ShipLog can generate reports.
        </p>
        {owner.orgId && (
          <p className="mt-2 text-sm text-muted-foreground">
            You are in an organization workspace. The AI key and the subscription are shared by the whole
            organization and managed by its admins. Billing is flat per organization, not per member. GitHub
            connections stay personal: each member connects their own.
          </p>
        )}
      </div>

      <GithubCard login={status.github?.login ?? null} notice={githubNotice ?? null} />
      <AiCard ai={status.ai} canManage={canManage} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Billing
            <Badge variant={status.plan === "pro" ? "default" : "secondary"}>
              {status.plan === "pro" ? "Pro" : "Free"}
            </Badge>
          </CardTitle>
          <CardDescription>
            {status.plan === "pro"
              ? "Manage your subscription, payment method and invoices."
              : "Upgrade for unlimited projects, full history and managed AI."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!canManage ? (
            <p className="text-sm text-muted-foreground">Only organization admins can manage billing.</p>
          ) : status.plan === "pro" ? (
            <ManageBillingButton />
          ) : (
            <UpgradeButton />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
