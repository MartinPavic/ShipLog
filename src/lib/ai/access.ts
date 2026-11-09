import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { aiCredentials } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { DEFAULT_MODELS, MANAGED_PROVIDER } from "@/lib/ai/models";
import { features, isMockAi, managedAiKey } from "@/env";
import { decrypt } from "@/lib/crypto";
import { getPlanLimits, type AiMode, type Plan, type PlanLimits } from "@/lib/plans";
import type { AiProvider } from "@/lib/validation";

export type AiAccess = {
  kind: "managed" | "byok";
  provider: AiProvider | "mock";
  key: string;
  model: string;
  limits: PlanLimits;
};

export async function getAiCredential(ownerId: string) {
  const [row] = await getDb()
    .select()
    .from(aiCredentials)
    .where(eq(aiCredentials.ownerId, ownerId))
    .limit(1);
  return row ?? null;
}

export function resolveUsageKind(plan: Plan, aiMode: AiMode | null, limits: PlanLimits): "managed" | "byok" {
  if (plan === "free") return "byok";
  if (aiMode === "managed") return "managed";
  if (aiMode === "byok") return "byok";

  // Legacy/null mode rows: infer from limits so existing workspaces keep consistent behavior.
  return limits.managedGenerationsPerMonth > 0 && limits.byokGenerationsPerMonth === 0 ? "managed" : "byok";
}

export function resolveSourceKind(plan: Plan, aiMode: AiMode | null, limits: PlanLimits, hasCredential: boolean): "managed" | "byok" {
  if (!features().billing) {
    if (hasCredential) return "byok";
    if (managedAiKey()) return "managed";
  }
  return resolveUsageKind(plan, aiMode, limits);
}

// The subscription mode is authoritative: BYOK requires a workspace key, Managed requires the server key.
export async function resolveAiAccess(ownerId: string): Promise<AiAccess> {
  const { plan, aiMode, limits } = await getPlanLimits(ownerId);
  const credential = await getAiCredential(ownerId);
  const kind = resolveSourceKind(plan, aiMode, limits, Boolean(credential));
  const managedKey = managedAiKey();

  // Demo mode: nothing leaves the server and no key is needed, but usage is still counted.
  if (isMockAi()) {
    return { kind, provider: "mock", key: "mock", model: "mock", limits };
  }

  if (kind === "byok") {
    if (!credential) throw new ApiError(400, "Add your AI API key in Settings first.", "NO_AI_KEY");
    return {
      kind: "byok",
      provider: credential.provider,
      key: decrypt(credential.encryptedKey),
      model: credential.model ?? DEFAULT_MODELS[credential.provider],
      limits,
    };
  }

  if (!managedKey) {
    throw new ApiError(
      503,
      "Managed AI is unavailable on this deployment. Configure the server AI key or switch this workspace to BYOK mode.",
      "MANAGED_AI_UNAVAILABLE"
    );
  }

  return {
    kind: "managed",
    provider: MANAGED_PROVIDER,
    key: managedKey,
    model: DEFAULT_MODELS[MANAGED_PROVIDER],
    limits,
  };
}
