import { currentUser } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";
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

  const session = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"checkout:" + owner.ownerId}))`);
    const [account] = await tx
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
      (candidate) => candidate.mode === "subscription" && candidate.line_items?.data?.some((item) => item.price?.id === STRIPE_PRICE_ID)
    );
    if (matching?.url) return matching;
    await Promise.all(openSessions.map((candidate) => stripe.checkout.sessions.expire(candidate.id)));

    return stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${appUrl()}/dashboard?success=true`,
      cancel_url: `${appUrl()}/dashboard?canceled=true`,
      metadata: { ownerId: owner.ownerId },
      subscription_data: { metadata: { ownerId: owner.ownerId } },
    });
  });

  return NextResponse.json({ url: session.url });
});
