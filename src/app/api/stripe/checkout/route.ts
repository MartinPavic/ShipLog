import { currentUser } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { z } from "zod";
import { getDb } from "@/db";
import { billingAccounts } from "@/db/schema";
import { ApiError, handle, parseBody } from "@/lib/api";
import { appUrl } from "@/lib/app-url";
import { requireAdmin } from "@/lib/owner";
import { assertFeatureEnabled } from "@/lib/plans";
import { stripePriceFor } from "@/lib/stripe-prices";
import { stripe } from "@/lib/stripe";

const checkoutBodySchema = z.object({
  tier: z.enum(["pro", "ultra"]),
  aiMode: z.enum(["byok", "managed"]),
});

const portalRequired = () => new ApiError(
  409,
  "You already have an active subscription. Use the billing portal to change plan or AI mode.",
  "BILLING_PORTAL_REQUIRED"
);

const isLive = (status: string) => status !== "canceled" && status !== "incomplete_expired";
const matchesPrice = (session: Stripe.Checkout.Session, priceId: string) =>
  session.mode === "subscription" && session.line_items?.data.length === 1 &&
  !session.line_items.has_more && session.line_items.data[0].price?.id === priceId;
const RESERVATION_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

export const POST = handle(async (req: Request) => {
  assertFeatureEnabled("billing");
  const owner = await requireAdmin();
  const variant = await parseBody(req, checkoutBodySchema);
  const priceId = stripePriceFor(variant);
  const db = getDb();

  const advanceCheckout = () => db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"checkout:" + owner.ownerId}))`);
    const [account] = await tx
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.ownerId, owner.ownerId))
      .limit(1);

    const hasLiveSubscription =
      account?.status === "active" ||
      account?.status === "trialing" ||
      (!!account?.stripeSubscriptionId && account.status !== "canceled" && account.status !== "incomplete_expired");
    if (hasLiveSubscription) {
      throw portalRequired();
    }

    if (account?.stripeCheckoutReservation) {
      const reservation = account.stripeCheckoutReservation;
      if (Date.now() - reservation.createdAt >= RESERVATION_RETRY_WINDOW_MS) throw portalRequired();
      const created = await stripe.checkout.sessions.create(reservation.params, { idempotencyKey: reservation.id });
      await tx.update(billingAccounts).set({
        stripeCheckoutSessionId: created.id,
        stripeCheckoutReservation: null,
      }).where(eq(billingAccounts.ownerId, owner.ownerId));
      return null;
    }

    let customerId = account?.stripeCustomerId;
    if (!customerId) {
      const user = await currentUser();
      const customer = await stripe.customers.create(
        { email: user?.emailAddresses[0]?.emailAddress, metadata: { ownerId: owner.ownerId } },
        { idempotencyKey: `customer-${owner.ownerId}` }
      );
      customerId = customer.id;
      await tx
        .insert(billingAccounts)
        .values({ ownerId: owner.ownerId, stripeCustomerId: customerId })
        .onConflictDoUpdate({ target: billingAccounts.ownerId, set: { stripeCustomerId: customerId } });
    }

    let startingAfter: string | undefined;
    do {
      const page = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100, starting_after: startingAfter });
      if (page.data.some((subscription) => isLive(subscription.status))) throw portalRequired();
      startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
    } while (startingAfter);

    if (account?.stripeCheckoutSessionId) {
      const pending = await stripe.checkout.sessions.retrieve(account.stripeCheckoutSessionId, { expand: ["line_items"] });
      if (pending.status === "open") {
        if (matchesPrice(pending, priceId) && pending.url) return pending;
        try {
          const expired = await stripe.checkout.sessions.expire(pending.id);
          if (expired.status !== "expired") throw portalRequired();
        } catch (error) {
          const current = await stripe.checkout.sessions.retrieve(pending.id);
          if (current.status !== "open" && current.status !== "expired") throw portalRequired();
          throw error;
        }
      } else if (pending.status !== "expired") {
        throw portalRequired();
      }
      await tx.update(billingAccounts).set({ stripeCheckoutSessionId: null }).where(eq(billingAccounts.ownerId, owner.ownerId));
    }

    do {
      const page = await stripe.checkout.sessions.list({ customer: customerId, limit: 100, starting_after: startingAfter });
      for (const candidate of page.data) {
        if (candidate.mode !== "subscription" || candidate.status === "expired") continue;
        if (candidate.status === "complete") {
          const subscriptionId = typeof candidate.subscription === "string" ? candidate.subscription : candidate.subscription?.id;
          if (!subscriptionId || isLive((await stripe.subscriptions.retrieve(subscriptionId)).status)) throw portalRequired();
        } else {
          await tx.update(billingAccounts).set({ stripeCheckoutSessionId: candidate.id }).where(eq(billingAccounts.ownerId, owner.ownerId));
          return null;
        }
      }
      startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
    } while (startingAfter);

    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
      customer_update: { address: "auto" },
      success_url: `${appUrl()}/dashboard?success=true`,
      cancel_url: `${appUrl()}/dashboard?canceled=true`,
      metadata: { ownerId: owner.ownerId },
      subscription_data: { metadata: { ownerId: owner.ownerId } },
    };
    await tx.update(billingAccounts).set({
      stripeCheckoutReservation: { id: `checkout-${randomUUID()}`, createdAt: Date.now(), params },
    }).where(eq(billingAccounts.ownerId, owner.ownerId));
    return null;
  });
  let session = await advanceCheckout();
  while (!session) {
    session = await advanceCheckout();
  }

  return NextResponse.json({ url: session.url });
});
