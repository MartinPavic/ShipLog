import { currentUser } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
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

export const POST = handle(async (req: Request) => {
  assertFeatureEnabled("billing");
  const owner = await requireAdmin();
  const variant = await parseBody(req, checkoutBodySchema);
  const priceId = stripePriceFor(variant);
  const db = getDb();

  const session = await db.transaction(async (tx) => {
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

    do {
      const page = await stripe.checkout.sessions.list({ customer: customerId, status: "complete", limit: 100, starting_after: startingAfter });
      for (const completed of page.data) {
        if (completed.mode !== "subscription") continue;
        const subscriptionId = typeof completed.subscription === "string" ? completed.subscription : completed.subscription?.id;
        if (!subscriptionId || isLive((await stripe.subscriptions.retrieve(subscriptionId)).status)) throw portalRequired();
      }
      startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
    } while (startingAfter);

    const openSessions = (await stripe.checkout.sessions.list({ customer: customerId, status: "open", limit: 10, expand: ["data.line_items"] })).data;
    const matching = openSessions.find(
      (candidate) => candidate.mode === "subscription" && candidate.line_items?.data?.some((item) => item.price?.id === priceId)
    );
    if (matching?.url) return matching;
    await Promise.all(openSessions.map((candidate) => stripe.checkout.sessions.expire(candidate.id)));

    return stripe.checkout.sessions.create({
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
    });
  });

  return NextResponse.json({ url: session.url });
});
