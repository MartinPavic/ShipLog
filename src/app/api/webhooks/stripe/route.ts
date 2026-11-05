import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { features } from "@/env";
import { claimStripeEvent, completeStripeEvent, processStripeEvent, releaseStripeEvent } from "@/lib/billing";
import { stripe } from "@/lib/stripe";

export async function POST(req: Request) {
  if (!features().billing) return NextResponse.json({ error: "Billing is turned off." }, { status: 404 });
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !secret) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const claim = await claimStripeEvent(event.id);
  if (claim.status === "processed") {
    return NextResponse.json({ received: true, duplicate: true });
  }
  if (claim.status === "in_progress") return NextResponse.json({ error: "Processing in progress" }, { status: 500 });

  try {
    if (!(await processStripeEvent(event, claim.token))) {
      return NextResponse.json({ error: "Processing lease expired" }, { status: 500 });
    }
    if (!(await completeStripeEvent(event.id, claim.token))) {
      return NextResponse.json({ error: "Processing lease expired" }, { status: 500 });
    }
  } catch (err) {
    // Free the claim so Stripe's retry gets processed.
    await releaseStripeEvent(event.id, claim.token);
    console.error(`Webhook ${event.type} failed:`, err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
