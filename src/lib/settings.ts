import { isMockAi, managedAiKey } from "@/env";
import { getAiCredential } from "@/lib/ai/access";
import { getGithubConnection } from "@/lib/github";
import { getPlanLimits } from "@/lib/plans";

// Never includes secrets; safe to pass to client components.
export async function getSetupStatus(owner: { ownerId: string; userId: string }) {
  const [github, credential, { plan, limits }] = await Promise.all([
    getGithubConnection(owner.userId),
    getAiCredential(owner.ownerId),
    getPlanLimits(owner.ownerId),
  ]);
  const demoAi = isMockAi();
  const managedAi = limits.managedAi && Boolean(managedAiKey());

  return {
    plan,
    github: github ? { login: github.login } : null,
    ai: credential
      ? { provider: credential.provider, last4: credential.last4, model: credential.model }
      : null,
    managedAi,
    demoAi,
    canGenerate: Boolean(github) && (demoAi || Boolean(credential) || managedAi),
  };
}
