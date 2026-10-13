import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getDb } from "@/db";
import { billingAccounts, stripeEvents } from "@/db/schema";
import { planFromStatus } from "@/lib/plans";
import { stripe } from "@/lib/stripe";

const idOf = (ref: string | { id: string } | null | undefined) =>
  typeof ref === "string" ? ref : (ref?.id ?? null);

async function findByCustomer(customerId: string) {
  const [row] = await getDb()
    .select()
    .from(billingAccounts)
    .where(eq(billingAccounts.stripeCustomerId, customerId))
    .limit(1);
  return row ?? null;
}

async function applySubscription(ownerId: string, sub: Stripe.Subscription) {
  const periodEnd = sub.items.data[0]?.current_period_end;
  const values = {
    plan: planFromStatus(sub.status),
    stripeCustomerId: idOf(sub.customer),
    stripeSubscriptionId: sub.id,
    status: sub.status,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    updatedAt: new Date(),
  };
  await getDb()
    .insert(billingAccounts)
    .values({ ownerId, ...values })
    .onConflictDoUpdate({ target: billingAccounts.ownerId, set: values });
}

// Events for a subscription that was replaced by a newer one must not overwrite it.
async function applySubscriptionEvent(sub: Stripe.Subscription) {
  const customerId = idOf(sub.customer);
  const account = customerId ? await findByCustomer(customerId) : null;
  const ownerId = account?.ownerId ?? sub.metadata?.ownerId;
  if (!ownerId) return;
  if (account?.stripeSubscriptionId && account.stripeSubscriptionId !== sub.id) return;
  await applySubscription(ownerId, sub);
}

export async function processStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const ownerId = session.metadata?.ownerId;
      const subscriptionId = idOf(session.subscription);
      if (session.mode !== "subscription" || !ownerId || !subscriptionId) return;
      await applySubscription(ownerId, await stripe.subscriptions.retrieve(subscriptionId));
      return;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await applySubscriptionEvent(event.data.object);
      return;
    case "invoice.payment_failed": {
      const customerId = idOf(event.data.object.customer);
      if (!customerId) return;
      await getDb()
        .update(billingAccounts)
        .set({ status: "past_due", plan: "free", updatedAt: new Date() })
        .where(eq(billingAccounts.stripeCustomerId, customerId));
      return;
    }
  }
}

// Returns false when the event was already handled.
export async function claimStripeEvent(eventId: string): Promise<boolean> {
  const rows = await getDb()
    .insert(stripeEvents)
    .values({ id: eventId })
    .onConflictDoNothing()
    .returning({ id: stripeEvents.id });
  return rows.length > 0;
}

export async function releaseStripeEvent(eventId: string) {
  await getDb().delete(stripeEvents).where(eq(stripeEvents.id, eventId));
}
