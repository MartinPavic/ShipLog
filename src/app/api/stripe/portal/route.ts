import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { billingAccounts } from "@/db/schema";
import { ApiError, handle } from "@/lib/api";
import { appUrl } from "@/lib/app-url";
import { requireAdmin } from "@/lib/owner";
import { stripe } from "@/lib/stripe";

export const POST = handle(async () => {
  const owner = await requireAdmin();
  const [account] = await getDb()
    .select({ customerId: billingAccounts.stripeCustomerId })
    .from(billingAccounts)
    .where(eq(billingAccounts.ownerId, owner.ownerId))
    .limit(1);

  if (!account?.customerId) throw new ApiError(400, "No billing account yet.", "NO_BILLING_ACCOUNT");

  const session = await stripe.billingPortal.sessions.create({
    customer: account.customerId,
    return_url: `${appUrl()}/dashboard/settings`,
  });
  return NextResponse.json({ url: session.url });
});
