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
      throw new ApiError(
        409,
        "You already have an active subscription. Use the billing portal to change plan or AI mode.",
        "BILLING_PORTAL_REQUIRED"
      );
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
      success_url: `${appUrl()}/dashboard?success=true`,
      cancel_url: `${appUrl()}/dashboard?canceled=true`,
      metadata: { ownerId: owner.ownerId },
      subscription_data: { metadata: { ownerId: owner.ownerId } },
    });
  });

  return NextResponse.json({ url: session.url });
});
