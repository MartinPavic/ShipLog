import { and, eq, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { getDb } from "@/db";
import { billingAccounts, stripeEvents } from "@/db/schema";
import { entitlementForStripePrice } from "@/lib/stripe-prices";
import { stripe } from "@/lib/stripe";

const idOf = (ref: string | { id: string } | null | undefined) =>
  typeof ref === "string" ? ref : (ref?.id ?? null);

function entitlementFromSubscription(sub: Stripe.Subscription): { plan: "free" | "pro" | "ultra"; aiMode: "byok" | "managed" | null } {
  if (sub.status !== "active" && sub.status !== "trialing") {
    return { plan: "free", aiMode: null };
  }

  const recurringPrices = sub.items.data
    .map((item) => {
      const price = item.price;
      if (!price || price.type !== "recurring") return null;
      return price.id;
    })
    .filter((priceId): priceId is string => Boolean(priceId));

  const recognized = recurringPrices
    .map((priceId) => entitlementForStripePrice(priceId))
    .filter((entitlement): entitlement is NonNullable<ReturnType<typeof entitlementForStripePrice>> => entitlement !== null);

  if (recognized.length !== 1) {
    return { plan: "free", aiMode: null };
  }

  return { plan: recognized[0].tier, aiMode: recognized[0].aiMode };
}

async function retrieveCurrentSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  return stripe.subscriptions.retrieve(subscriptionId);
}

export async function processStripeEvent(event: Stripe.Event, claimToken: string): Promise<boolean> {
  let subscription: Stripe.Subscription | undefined;
  let checkoutOwnerId: string | undefined;
  let failedInvoice: { customerId: string; subscriptionId: string } | undefined;

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      checkoutOwnerId = session.metadata?.ownerId;
      const subscriptionId = idOf(session.subscription);
      if (session.mode !== "subscription" || !checkoutOwnerId || !subscriptionId) break;
      subscription = await stripe.subscriptions.retrieve(subscriptionId);
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      subscription = await retrieveCurrentSubscription(sub.id);
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const customerId = idOf(invoice.customer);
      const legacySubscriptionId = idOf((invoice as Stripe.Invoice & { subscription?: string | Stripe.Subscription }).subscription);
      const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription) ?? legacySubscriptionId;
      if (customerId && subscriptionId) failedInvoice = { customerId, subscriptionId };
      break;
    }
  }

  return getDb().transaction(async (tx) => {
    const [claim] = await tx
      .select({ status: stripeEvents.status, claimToken: stripeEvents.claimToken })
      .from(stripeEvents)
      .where(eq(stripeEvents.id, event.id))
      .for("update");
    if (claim?.status !== "processing" || claim.claimToken !== claimToken) return false;

    const saveSubscription = async (ownerId: string, sub: Stripe.Subscription) => {
      const periodEnd = sub.items.data[0]?.current_period_end;
      const { plan, aiMode } = entitlementFromSubscription(sub);
      const values = {
        plan,
        aiMode,
        stripeCustomerId: idOf(sub.customer),
        stripeSubscriptionId: sub.id,
        status: sub.status,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        updatedAt: new Date(),
      };
      await tx.insert(billingAccounts).values({ ownerId, ...values }).onConflictDoUpdate({ target: billingAccounts.ownerId, set: values });
    };

    if (checkoutOwnerId && subscription) {
      await saveSubscription(checkoutOwnerId, subscription);
    } else if (subscription) {
      const customerId = idOf(subscription.customer);
      const [account] = customerId
        ? await tx.select().from(billingAccounts).where(eq(billingAccounts.stripeCustomerId, customerId)).limit(1)
        : [];
      const ownerId = account?.ownerId ?? subscription.metadata?.ownerId;
      if (ownerId && (!account?.stripeSubscriptionId || account.stripeSubscriptionId === subscription.id)) {
        await saveSubscription(ownerId, subscription);
      }
    } else if (failedInvoice) {
      await tx
        .update(billingAccounts)
        .set({ status: "past_due", plan: "free", aiMode: null, updatedAt: new Date() })
        .where(and(eq(billingAccounts.stripeCustomerId, failedInvoice.customerId), eq(billingAccounts.stripeSubscriptionId, failedInvoice.subscriptionId)));
    }
    return true;
  });
}

const WEBHOOK_CLAIM_TTL_MS = 5 * 60 * 1000;

export type StripeEventClaim = { status: "claimed"; token: string } | { status: "processed" } | { status: "in_progress" };

export async function claimStripeEvent(eventId: string): Promise<StripeEventClaim> {
  const now = new Date();
  const token = randomUUID();
  const rows = await getDb()
    .insert(stripeEvents)
    .values({ id: eventId, status: "processing", claimToken: token, updatedAt: now })
    .onConflictDoUpdate({
      target: stripeEvents.id,
      set: { status: "processing", claimToken: token, updatedAt: now },
      setWhere: and(eq(stripeEvents.status, "processing"), lt(stripeEvents.updatedAt, new Date(now.getTime() - WEBHOOK_CLAIM_TTL_MS))),
    })
    .returning({ id: stripeEvents.id });
  if (rows.length) return { status: "claimed", token };
  const [row] = await getDb().select({ status: stripeEvents.status }).from(stripeEvents).where(eq(stripeEvents.id, eventId)).limit(1);
  return { status: row?.status === "processed" ? "processed" : "in_progress" };
}

export async function completeStripeEvent(eventId: string, token: string): Promise<boolean> {
  const rows = await getDb()
    .update(stripeEvents)
    .set({ status: "processed", claimToken: null, updatedAt: new Date() })
    .where(and(eq(stripeEvents.id, eventId), eq(stripeEvents.status, "processing"), eq(stripeEvents.claimToken, token)))
    .returning({ id: stripeEvents.id });
  return rows.length > 0;
}

export async function releaseStripeEvent(eventId: string, token: string) {
  await getDb()
    .delete(stripeEvents)
    .where(and(eq(stripeEvents.id, eventId), eq(stripeEvents.status, "processing"), eq(stripeEvents.claimToken, token)));
}
