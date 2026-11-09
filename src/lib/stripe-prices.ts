import type { AiMode, Plan } from "@/lib/plans";

export type StripeVariant = { tier: Exclude<Plan, "free">; aiMode: AiMode };

type StripeConfig = {
  proByok: string;
  proManaged: string;
  ultraByok: string;
  ultraManaged: string;
};

function read(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required Stripe price configuration: ${name}`);
  return value;
}

function stripeConfig(): StripeConfig {
  const config: StripeConfig = {
    proByok: read("STRIPE_PRICE_PRO_BYOK_ID"),
    proManaged: read("STRIPE_PRICE_PRO_MANAGED_ID"),
    ultraByok: read("STRIPE_PRICE_ULTRA_BYOK_ID"),
    ultraManaged: read("STRIPE_PRICE_ULTRA_MANAGED_ID"),
  };

  const ids = Object.values(config);
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    throw new Error("Duplicate Stripe price IDs are not allowed across paid variants.");
  }

  return config;
}

export function stripePriceFor(variant: StripeVariant): string {
  const config = stripeConfig();
  if (variant.tier === "pro") return variant.aiMode === "byok" ? config.proByok : config.proManaged;
  return variant.aiMode === "byok" ? config.ultraByok : config.ultraManaged;
}

export function entitlementForStripePrice(priceId: string): StripeVariant | null {
  const config = stripeConfig();
  if (priceId === config.proByok) return { tier: "pro", aiMode: "byok" };
  if (priceId === config.proManaged) return { tier: "pro", aiMode: "managed" };
  if (priceId === config.ultraByok) return { tier: "ultra", aiMode: "byok" };
  if (priceId === config.ultraManaged) return { tier: "ultra", aiMode: "managed" };
  return null;
}
