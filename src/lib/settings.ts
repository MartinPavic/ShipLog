import { isMockAi, managedAiKey } from "@/env";
import { getAiCredential } from "@/lib/ai/access";
import { getGithubConnection } from "@/lib/github";
import { getGitLabConnectionStatus, getGitLabInstanceStatus } from "@/lib/gitlab-settings";
import { getPlanLimits } from "@/lib/plans";

// Never includes secrets; safe to pass to client components.
export async function getSetupStatus(owner: { ownerId: string; userId: string }) {
  const [github, gitlab, gitlabInstance, credential, { plan, limits }] = await Promise.all([
    getGithubConnection(owner.userId),
    getGitLabConnectionStatus(owner.ownerId, owner.userId),
    getGitLabInstanceStatus(owner.ownerId),
    getAiCredential(owner.ownerId),
    getPlanLimits(owner.ownerId),
  ]);
  const demoAi = isMockAi();
  const managedAi = limits.managedAi && Boolean(managedAiKey());

  return {
    plan,
    github: github ? { login: github.login } : null,
    gitlab: { instance: gitlabInstance, connection: gitlab },
    ai: credential
      ? { provider: credential.provider, last4: credential.last4, model: credential.model }
      : null,
    managedAi,
    demoAi,
    canGenerate: Boolean(github || gitlab) && (demoAi || Boolean(credential) || managedAi),
  };
}
