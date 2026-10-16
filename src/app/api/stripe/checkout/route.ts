import { currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { billingAccounts } from "@/db/schema";
import { ApiError, handle } from "@/lib/api";
import { appUrl } from "@/lib/app-url";
import { requireAdmin } from "@/lib/owner";
import { assertFeatureEnabled, planFromStatus } from "@/lib/plans";
import { STRIPE_PRICE_ID, stripe } from "@/lib/stripe";


export const POST = handle(async () => {
  assertFeatureEnabled("billing");
  const owner = await requireAdmin();
  const db = getDb();

  const [account] = await db
    .select()
    .from(billingAccounts)
    .where(eq(billingAccounts.ownerId, owner.ownerId))
    .limit(1);

  if (account && planFromStatus(account.status) === "pro") {
    throw new ApiError(409, "You already have an active subscription.", "ALREADY_SUBSCRIBED");
  }

  let customerId = account?.stripeCustomerId;
  if (!customerId) {
    const user = await currentUser();
    // Idempotency key stops concurrent checkouts from creating duplicate customers.
    const customer = await stripe.customers.create(
      { email: user?.emailAddresses[0]?.emailAddress, metadata: { ownerId: owner.ownerId } },
      { idempotencyKey: `customer-${owner.ownerId}` }
    );
    customerId = customer.id;
    await db
      .insert(billingAccounts)
      .values({ ownerId: owner.ownerId, stripeCustomerId: customerId })
      .onConflictDoUpdate({ target: billingAccounts.ownerId, set: { stripeCustomerId: customerId } });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${appUrl()}/dashboard?success=true`,
    cancel_url: `${appUrl()}/dashboard?canceled=true`,
    metadata: { ownerId: owner.ownerId },
    subscription_data: { metadata: { ownerId: owner.ownerId } },
  });

  return NextResponse.json({ url: session.url });
});
