import Stripe from "stripe";

let client: Stripe | undefined;

// Created on first use: with BILLING_ENABLED=false there is no Stripe key, and the SDK throws if
// it is constructed without one.
export function getStripe(): Stripe {
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY!, { typescript: true });
  return client;
}

export const stripe: Stripe = new Proxy({} as Stripe, {
  get: (_target, prop) => Reflect.get(getStripe(), prop),
});

export const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID!;
