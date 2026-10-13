import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { aiCredentials } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { DEFAULT_MODELS, MANAGED_PROVIDER } from "@/lib/ai/models";
import { decrypt } from "@/lib/crypto";
import { getPlanLimits, type PlanLimits } from "@/lib/plans";
import type { AiProvider } from "@/lib/validation";

export type AiAccess = {
  kind: "managed" | "byok";
  provider: AiProvider;
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

// Own key wins; otherwise Pro falls back to the server's managed key.
export async function resolveAiAccess(ownerId: string): Promise<AiAccess> {
  const { limits } = await getPlanLimits(ownerId);
  const credential = await getAiCredential(ownerId);

  if (credential) {
    return {
      kind: "byok",
      provider: credential.provider,
      key: decrypt(credential.encryptedKey),
      model: credential.model ?? DEFAULT_MODELS[credential.provider],
      limits,
    };
  }

  const managedKey = process.env.OPENAI_API_KEY;
  if (limits.managedAi && managedKey) {
    return {
      kind: "managed",
      provider: MANAGED_PROVIDER,
      key: managedKey,
      model: DEFAULT_MODELS[MANAGED_PROVIDER],
      limits,
    };
  }

  throw new ApiError(400, "Add your AI API key in Settings first.", "NO_AI_KEY");
}
