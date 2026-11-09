import { and, eq, lt, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { getDb } from "@/db";
import { billingAccounts, stripeEvents } from "@/db/schema";
import { entitlementForStripePrice } from "@/lib/stripe-prices";
import { stripe } from "@/lib/stripe";

const TERMINAL_SUBSCRIPTION_STATUSES = new Set<Stripe.Subscription.Status>(["canceled", "incomplete_expired"]);

const idOf = (ref: string | { id: string } | null | undefined) =>
  typeof ref === "string" ? ref : (ref?.id ?? null);

const isTerminalSubscriptionStatus = (status: string | null | undefined): boolean =>
  !!status && TERMINAL_SUBSCRIPTION_STATUSES.has(status as Stripe.Subscription.Status);

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

  if (sub.items.data.length !== 1 || recurringPrices.length !== 1 || recognized.length !== 1 || sub.items.has_more) {
    return { plan: "free", aiMode: null };
  }

  return { plan: recognized[0].tier, aiMode: recognized[0].aiMode };
}

async function retrieveCurrentSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  return stripe.subscriptions.retrieve(subscriptionId);
}

export async function processStripeEvent(event: Stripe.Event, claimToken: string): Promise<boolean> {
  let subscriptionId: string | null = null;
  let customerId: string | null = null;
  let metadataOwnerId: string | undefined;

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode !== "subscription" || !session.metadata?.ownerId) break;
      metadataOwnerId = session.metadata.ownerId;
      subscriptionId = idOf(session.subscription);
      customerId = idOf(session.customer);
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      subscriptionId = sub.id;
      customerId = idOf(sub.customer);
      metadataOwnerId = sub.metadata?.ownerId;
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      customerId = idOf(invoice.customer);
      const legacySubscriptionId = idOf((invoice as Stripe.Invoice & { subscription?: string | Stripe.Subscription }).subscription);
      subscriptionId = idOf(invoice.parent?.subscription_details?.subscription) ?? legacySubscriptionId;
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

    if (!subscriptionId) return true;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"subscription:" + subscriptionId}))`);
    const [attributedAccount] = customerId
      ? await tx.select().from(billingAccounts).where(eq(billingAccounts.stripeCustomerId, customerId)).limit(1)
      : [];
    const ownerId = attributedAccount?.ownerId ?? metadataOwnerId;
    if (!ownerId) return true;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"checkout:" + ownerId}))`);
    const [account] = await tx.select().from(billingAccounts).where(eq(billingAccounts.ownerId, ownerId)).limit(1).for("update");
    const differentSubscription = !!account?.stripeSubscriptionId && account.stripeSubscriptionId !== subscriptionId;
    const canReplace = event.type === "checkout.session.completed" && isTerminalSubscriptionStatus(account?.status);
    if (differentSubscription && !canReplace) return true;
    if (event.type === "invoice.payment_failed" && (!account || account.stripeSubscriptionId !== subscriptionId || account.stripeCustomerId !== customerId)) return true;
    const subscription = await retrieveCurrentSubscription(subscriptionId);

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
        ...(plan === "free" && account && account.plan !== "free"
          ? { historyRetainedThrough: new Date(Math.max(Date.now(), account.historyRetainedThrough?.getTime() ?? 0)) }
          : {}),
        updatedAt: new Date(),
      };
      await tx.insert(billingAccounts).values({ ownerId, ...values }).onConflictDoUpdate({ target: billingAccounts.ownerId, set: values });
    };

    await saveSubscription(ownerId, subscription);
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
