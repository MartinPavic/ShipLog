import { features, isMockAi, managedAiKey } from "@/env";
import { getAiCredential, resolveUsageKind } from "@/lib/ai/access";
import { getGithubConnection } from "@/lib/github";
import { getGitLabConnectionStatus, getGitLabInstanceStatus } from "@/lib/gitlab-settings";
import { getPlanLimits } from "@/lib/plans";
import { getUsage, getUsageMeter } from "@/lib/usage";

// Never includes secrets; safe to pass to client components.
export async function getSetupStatus(owner: { ownerId: string; userId: string }) {
  const billingEnabled = features().billing;
  const [github, gitlab, gitlabInstance, credential, { plan, aiMode, limits }] = await Promise.all([
    getGithubConnection(owner.userId),
    getGitLabConnectionStatus(owner.ownerId, owner.userId),
    getGitLabInstanceStatus(owner.ownerId),
    getAiCredential(owner.ownerId),
    getPlanLimits(owner.ownerId),
  ]);
  const demoAi = isMockAi();
  const hasCredential = Boolean(credential);
  const hasManagedKey = Boolean(managedAiKey());
  let kind = resolveUsageKind(plan, aiMode, limits);
  let usage: { used: number; limit: number | null };

  if (billingEnabled) {
    const usageMeter = await getUsageMeter(owner.ownerId);
    usage = { used: usageMeter.used, limit: usageMeter.limit };
  } else {
    const usageCounters = await getUsage(owner.ownerId);
    kind = hasCredential ? "byok" : hasManagedKey ? "managed" : kind;
    usage = { used: usageCounters[kind], limit: null };
  }

  const managedAi = kind === "managed" && hasManagedKey;
  const aiReady = demoAi || (kind === "byok" ? hasCredential : hasManagedKey);
  const hasSourceConnection = Boolean(github || gitlab);

  return {
    plan,
    aiMode: kind,
    usage,
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
