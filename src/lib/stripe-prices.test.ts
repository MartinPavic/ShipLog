import { afterEach, describe, expect, it, vi } from "vitest";
import type { StripeVariant } from "./stripe-prices";

const PRICE_VARS = [
  "STRIPE_PRICE_PRO_BYOK_ID",
  "STRIPE_PRICE_PRO_MANAGED_ID",
  "STRIPE_PRICE_ULTRA_BYOK_ID",
  "STRIPE_PRICE_ULTRA_MANAGED_ID",
] as const;

const BASE_ENV = {
  STRIPE_PRICE_PRO_BYOK_ID: "price_pro_byok",
  STRIPE_PRICE_PRO_MANAGED_ID: "price_pro_managed",
  STRIPE_PRICE_ULTRA_BYOK_ID: "price_ultra_byok",
  STRIPE_PRICE_ULTRA_MANAGED_ID: "price_ultra_managed",
} as const;

afterEach(() => {
  for (const name of PRICE_VARS) delete process.env[name];
  vi.resetModules();
  vi.restoreAllMocks();
});

async function load(overrides: Partial<Record<(typeof PRICE_VARS)[number], string | undefined>> = {}) {
  for (const [name, value] of Object.entries({ ...BASE_ENV, ...overrides })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  return import("./stripe-prices");
}

describe("stripe-prices", () => {
  it("maps each paid variant to the configured Stripe price id", async () => {
    const { stripePriceFor } = await load();

    expect(stripePriceFor({ tier: "pro", aiMode: "byok" })).toBe(BASE_ENV.STRIPE_PRICE_PRO_BYOK_ID);
    expect(stripePriceFor({ tier: "pro", aiMode: "managed" })).toBe(BASE_ENV.STRIPE_PRICE_PRO_MANAGED_ID);
    expect(stripePriceFor({ tier: "ultra", aiMode: "byok" })).toBe(BASE_ENV.STRIPE_PRICE_ULTRA_BYOK_ID);
    expect(stripePriceFor({ tier: "ultra", aiMode: "managed" })).toBe(BASE_ENV.STRIPE_PRICE_ULTRA_MANAGED_ID);
  });

  it("maps configured prices back to their tier and mode", async () => {
    const { entitlementForStripePrice } = await load();

    const expectations: Array<[string, StripeVariant]> = [
      [BASE_ENV.STRIPE_PRICE_PRO_BYOK_ID, { tier: "pro", aiMode: "byok" }],
      [BASE_ENV.STRIPE_PRICE_PRO_MANAGED_ID, { tier: "pro", aiMode: "managed" }],
      [BASE_ENV.STRIPE_PRICE_ULTRA_BYOK_ID, { tier: "ultra", aiMode: "byok" }],
      [BASE_ENV.STRIPE_PRICE_ULTRA_MANAGED_ID, { tier: "ultra", aiMode: "managed" }],
    ];

    for (const [priceId, expected] of expectations) {
      expect(entitlementForStripePrice(priceId)).toEqual(expected);
    }
  });

  it("returns null for unknown prices", async () => {
    const { entitlementForStripePrice } = await load();
    expect(entitlementForStripePrice("price_unknown")).toBeNull();
  });

  it("fails closed if a required Stripe price id is missing", async () => {
    const { stripePriceFor, entitlementForStripePrice } = await load({ STRIPE_PRICE_ULTRA_MANAGED_ID: undefined });

    expect(() => stripePriceFor({ tier: "ultra", aiMode: "managed" })).toThrow(/STRIPE_PRICE_ULTRA_MANAGED_ID/);
    expect(() => entitlementForStripePrice("price_ultra_byok")).toThrow(/STRIPE_PRICE_ULTRA_MANAGED_ID/);
  });

  it("fails closed if configured Stripe price ids are duplicated", async () => {
    const { stripePriceFor, entitlementForStripePrice } = await load({
      STRIPE_PRICE_ULTRA_BYOK_ID: BASE_ENV.STRIPE_PRICE_PRO_BYOK_ID,
    });

    expect(() => stripePriceFor({ tier: "pro", aiMode: "byok" })).toThrow(/Duplicate Stripe price IDs/);
    expect(() => entitlementForStripePrice(BASE_ENV.STRIPE_PRICE_PRO_BYOK_ID)).toThrow(/Duplicate Stripe price IDs/);
  });
});
