import { features, isMockAi, managedAiKey } from "@/env";
import { getAiCredential, resolveUsageKind } from "@/lib/ai/access";
import { getGithubConnection } from "@/lib/github";
import { getGitLabConnectionStatus, getGitLabInstanceStatus } from "@/lib/gitlab-settings";
import { getPlanLimits } from "@/lib/plans";

// Never includes secrets; safe to pass to client components.
export async function getSetupStatus(owner: { ownerId: string; userId: string }) {
  const [github, gitlab, gitlabInstance, credential, { plan, aiMode, limits }] = await Promise.all([
    getGithubConnection(owner.userId),
    getGitLabConnectionStatus(owner.ownerId, owner.userId),
    getGitLabInstanceStatus(owner.ownerId),
    getAiCredential(owner.ownerId),
    getPlanLimits(owner.ownerId),
  ]);
  const billingEnabled = features().billing;
  const demoAi = isMockAi();
  const hasCredential = Boolean(credential);
  const hasManagedKey = Boolean(managedAiKey());
  const kind = billingEnabled
    ? resolveUsageKind(plan, aiMode, limits)
    : hasCredential
      ? "byok"
      : "managed";
  const managedAi = kind === "managed" && hasManagedKey;
  const aiReady = demoAi || (kind === "byok" ? hasCredential : hasManagedKey);
  const hasSourceConnection = Boolean(github || gitlab);

  return {
    plan,
    github: github ? { login: github.login } : null,
    gitlab: { instance: gitlabInstance, connection: gitlab },
    ai: credential
      ? { provider: credential.provider, last4: credential.last4, model: credential.model }
      : null,
    managedAi,
    demoAi,
    aiReady,
    canGenerate: hasSourceConnection && aiReady,
  };
}
