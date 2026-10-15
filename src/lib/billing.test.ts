import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

try {
  process.loadEnvFile(".env.local");
} catch {}
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy";
process.env.STRIPE_PRICE_ID ||= "price_test";

vi.mock("@clerk/nextjs/server", () => ({
  currentUser: async () => ({ emailAddresses: [{ emailAddress: "billing@example.com" }] }),
  auth: async () => ({}),
  clerkClient: async () => ({}),
}));

type Who = { userId: string; orgId: string | null; ownerId: string; orgRole: string | null };
let current: Who;
vi.mock("@/lib/owner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner")>();
  const { ApiError } = await import("@/lib/api");
  return {
    ...actual,
    getOwner: async () => current,
    requireAdmin: async () => {
      if (!actual.isAdmin(current)) throw new ApiError(403, "Only organization admins can do this");
      return current;
    },
  };
});

const rand = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const WEBHOOK_SECRET = "whsec_test_secret_value";

describe.skipIf(!process.env.DATABASE_URL)("Stripe billing (database)", () => {
  const createdOwners: string[] = [];
  const createdEvents: string[] = [];
  const createdCustomers: string[] = [];
  let savedSecret: string | undefined;

  const newOwner = (org = false): Who => {
    const id = org ? `org_test_${rand()}` : `test_o_${rand()}`;
    createdOwners.push(id);
    return { userId: `test_u_${rand()}`, orgId: org ? id : null, ownerId: id, orgRole: org ? "org:admin" : null };
  };
  const eventId = () => {
    const id = `evt_test_${rand()}`;
    createdEvents.push(id);
    return id;
  };
  const customerId = () => {
    const id = `cus_test_${rand()}`;
    createdCustomers.push(id);
    return id;
  };

  const subscription = (over: Record<string, unknown> = {}) => ({
    id: `sub_${rand()}`,
    object: "subscription",
    customer: "cus_x",
    status: "active",
    metadata: {},
    items: { data: [{ current_period_end: 1_900_000_000 }] },
    ...over,
  });
  const event = (type: string, object: unknown, id = eventId()) => ({ id, object: "event", type, data: { object } });

  async function stripeLib() {
    return (await import("@/lib/stripe")).stripe;
  }
  async function deliver(evt: unknown, opts: { secret?: string | null; signature?: string | null } = {}) {
    const stripe = await stripeLib();
    const payload = JSON.stringify(evt);
    const signature =
      opts.signature !== undefined
        ? opts.signature
        : stripe.webhooks.generateTestHeaderString({ payload, secret: opts.secret ?? WEBHOOK_SECRET });
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    return POST(new Request("http://x/api/webhooks/stripe", { method: "POST", body: payload, headers: signature ? { "stripe-signature": signature } : {} }));
  }
  async function account(ownerId: string) {
    const { getDb } = await import("@/db");
    const { billingAccounts } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await getDb().select().from(billingAccounts).where(eq(billingAccounts.ownerId, ownerId));
    return row;
  }
  async function seedAccount(ownerId: string, values: Record<string, unknown>) {
    const { getDb } = await import("@/db");
    const { billingAccounts } = await import("@/db/schema");
    await getDb().insert(billingAccounts).values({ ownerId, ...values });
  }

  beforeAll(() => {
    savedSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    if (savedSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = savedSecret;
    const { inArray } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const { billingAccounts, stripeEvents } = await import("@/db/schema");
    await getDb().delete(billingAccounts).where(inArray(billingAccounts.ownerId, createdOwners));
    await getDb().delete(stripeEvents).where(inArray(stripeEvents.id, createdEvents));
  });

  describe("webhook: subscription lifecycle", () => {
    it("activates Pro from a new subscription and records customer and period end", async () => {
      const owner = newOwner();
      const customer = customerId();
      const sub = subscription({ customer, metadata: { ownerId: owner.ownerId } });
      const res = await deliver(event("customer.subscription.updated", sub));
      expect(res.status).toBe(200);
      expect(await account(owner.ownerId)).toMatchObject({
        plan: "pro",
        status: "active",
        stripeCustomerId: customer,
        stripeSubscriptionId: sub.id,
        currentPeriodEnd: new Date(1_900_000_000 * 1000),
      });
    });

    it.each([
      ["trialing", "pro"],
      ["active", "pro"],
      ["past_due", "free"],
      ["unpaid", "free"],
      ["incomplete", "free"],
      ["incomplete_expired", "free"],
      ["canceled", "free"],
      ["paused", "free"],
    ])("maps status %s to the %s plan", async (status, plan) => {
      const owner = newOwner();
      const sub = subscription({ customer: customerId(), status, metadata: { ownerId: owner.ownerId } });
      await deliver(event("customer.subscription.updated", sub));
      expect(await account(owner.ownerId)).toMatchObject({ plan, status });
    });

    it("walks through cancel, failed payment and reactivation", async () => {
      const owner = newOwner();
      const customer = customerId();
      const sub = subscription({ customer, metadata: { ownerId: owner.ownerId } });

      await deliver(event("customer.subscription.updated", sub));
      expect((await account(owner.ownerId)).plan).toBe("pro");

      // The owner is found through the stored customer, so later events don't need metadata.
      await deliver(event("invoice.payment_failed", { id: "in_1", customer }));
      expect(await account(owner.ownerId)).toMatchObject({ plan: "free", status: "past_due" });

      await deliver(event("customer.subscription.updated", { ...sub, metadata: {} }));
      expect((await account(owner.ownerId)).plan).toBe("pro");

      await deliver(event("customer.subscription.deleted", { ...sub, status: "canceled", metadata: {} }));
      expect(await account(owner.ownerId)).toMatchObject({ plan: "free", status: "canceled", stripeCustomerId: customer });
    });

    it("supports organization owners", async () => {
      const org = newOwner(true);
      await deliver(event("customer.subscription.updated", subscription({ customer: customerId(), metadata: { ownerId: org.ownerId } })));
      expect(await account(org.ownerId)).toMatchObject({ plan: "pro" });
      const { getPlanLimits } = await import("@/lib/plans");
      expect((await getPlanLimits(org.ownerId)).limits.teams).toBe(true);
    });

    it("ignores events from a subscription that was replaced by a newer one", async () => {
      const owner = newOwner();
      const customer = customerId();
      const newer = subscription({ customer, metadata: { ownerId: owner.ownerId } });
      await deliver(event("customer.subscription.updated", newer));

      const older = subscription({ customer, status: "canceled", metadata: { ownerId: owner.ownerId } });
      await deliver(event("customer.subscription.deleted", older));
      expect(await account(owner.ownerId)).toMatchObject({ plan: "pro", stripeSubscriptionId: newer.id });
    });

    it("ignores events it cannot attribute to anyone", async () => {
      const unknown = customerId();
      expect((await deliver(event("customer.subscription.updated", subscription({ customer: unknown })))).status).toBe(200);
      expect((await deliver(event("invoice.payment_failed", { id: "in_2", customer: unknown }))).status).toBe(200);
      const { getDb } = await import("@/db");
      const { billingAccounts } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      expect(await getDb().select().from(billingAccounts).where(eq(billingAccounts.stripeCustomerId, unknown))).toHaveLength(0);
    });

    it("acknowledges event types it does not handle", async () => {
      expect((await deliver(event("charge.succeeded", { id: "ch_1" }))).status).toBe(200);
    });
  });

  describe("webhook: checkout.session.completed", () => {
    it("fetches the subscription and applies it", async () => {
      const owner = newOwner();
      const customer = customerId();
      const sub = subscription({ customer, metadata: { ownerId: owner.ownerId } });
      const retrieve = vi.spyOn((await stripeLib()).subscriptions, "retrieve").mockResolvedValue(sub as never);

      const res = await deliver(
        event("checkout.session.completed", { id: "cs_1", mode: "subscription", subscription: sub.id, customer, metadata: { ownerId: owner.ownerId } })
      );
      expect(res.status).toBe(200);
      expect(retrieve).toHaveBeenCalledWith(sub.id);
      expect(await account(owner.ownerId)).toMatchObject({ plan: "pro", stripeSubscriptionId: sub.id });
    });

    it("ignores sessions that are not subscriptions or have no owner", async () => {
      const retrieve = vi.spyOn((await stripeLib()).subscriptions, "retrieve");
      const owner = newOwner();
      await deliver(event("checkout.session.completed", { id: "cs_2", mode: "payment", subscription: "sub_1", metadata: { ownerId: owner.ownerId } }));
      await deliver(event("checkout.session.completed", { id: "cs_3", mode: "subscription", subscription: "sub_1", metadata: {} }));
      await deliver(event("checkout.session.completed", { id: "cs_4", mode: "subscription", subscription: null, metadata: { ownerId: owner.ownerId } }));
      expect(retrieve).not.toHaveBeenCalled();
      expect(await account(owner.ownerId)).toBeUndefined();
    });
  });

  describe("webhook: security and delivery guarantees", () => {
    it("rejects missing, forged and wrongly signed requests without touching data", async () => {
      const owner = newOwner();
      const evt = event("customer.subscription.updated", subscription({ customer: customerId(), metadata: { ownerId: owner.ownerId } }));

      expect((await deliver(evt, { signature: null })).status).toBe(400);
      expect((await deliver(evt, { signature: "t=1,v1=deadbeef" })).status).toBe(400);
      expect((await deliver(evt, { secret: "whsec_other" })).status).toBe(400);

      const old = (await stripeLib()).webhooks.generateTestHeaderString({
        payload: JSON.stringify(evt),
        secret: WEBHOOK_SECRET,
        timestamp: Math.floor(Date.now() / 1000) - 3600,
      });
      expect((await deliver(evt, { signature: old })).status).toBe(400); // replayed outside the tolerance window
      expect(await account(owner.ownerId)).toBeUndefined();
    });

    it("rejects everything when no webhook secret is configured", async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      try {
        const res = await deliver(event("charge.succeeded", {}));
        expect(res.status).toBe(400);
      } finally {
        process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
      }
    });

    it("processes a given event id only once", async () => {
      const owner = newOwner();
      const evt = event("customer.subscription.updated", subscription({ customer: customerId(), metadata: { ownerId: owner.ownerId } }));

      expect(await (await deliver(evt)).json()).toEqual({ received: true });
      // If the replay were processed it would overwrite this.
      const { getDb } = await import("@/db");
      const { billingAccounts } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      await getDb().update(billingAccounts).set({ status: "tampered" }).where(eq(billingAccounts.ownerId, owner.ownerId));

      expect(await (await deliver(evt)).json()).toEqual({ received: true, duplicate: true });
      expect((await account(owner.ownerId)).status).toBe("tampered");
    });

    it("has exactly one winner when the same event arrives concurrently", async () => {
      const owner = newOwner();
      const evt = event("customer.subscription.updated", subscription({ customer: customerId(), metadata: { ownerId: owner.ownerId } }));
      const bodies = await Promise.all(Array.from({ length: 6 }, async () => (await deliver(evt)).json()));
      expect(bodies.filter((b) => !b.duplicate)).toHaveLength(1);
      expect(bodies.filter((b) => b.duplicate)).toHaveLength(5);
    });

    it("frees the claim when processing fails, so Stripe's retry is handled", async () => {
      const owner = newOwner();
      const customer = customerId();
      const sub = subscription({ customer, metadata: { ownerId: owner.ownerId } });
      const retrieve = vi.spyOn((await stripeLib()).subscriptions, "retrieve").mockRejectedValueOnce(new Error("stripe down"));
      const evt = event("checkout.session.completed", { id: "cs_5", mode: "subscription", subscription: sub.id, customer, metadata: { ownerId: owner.ownerId } });

      const failed = await deliver(evt);
      expect(failed.status).toBe(500);
      expect(await failed.json()).toEqual({ error: "Processing failed" });
      expect(await account(owner.ownerId)).toBeUndefined();

      retrieve.mockResolvedValue(sub as never);
      expect((await deliver(evt)).status).toBe(200);
      expect((await account(owner.ownerId)).plan).toBe("pro");
    });
  });

  describe("checkout and billing portal routes", () => {
    const sessionUrl = "https://checkout.test/session";
    async function spies() {
      const stripe = await stripeLib();
      return {
        customers: vi.spyOn(stripe.customers, "create").mockImplementation((async () => ({ id: customerId() })) as never),
        sessions: vi.spyOn(stripe.checkout.sessions, "create").mockResolvedValue({ url: sessionUrl } as never),
        portal: vi.spyOn(stripe.billingPortal.sessions, "create").mockResolvedValue({ url: "https://portal.test/p" } as never),
      };
    }
    const checkout = async () => (await import("@/app/api/stripe/checkout/route")).POST();
    const portal = async () => (await import("@/app/api/stripe/portal/route")).POST();

    it("creates one Stripe customer per owner and reuses it afterwards", async () => {
      current = newOwner();
      const s = await spies();

      const first = await checkout();
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ url: sessionUrl });
      expect(s.customers).toHaveBeenCalledOnce();
      expect(s.customers.mock.calls[0]).toEqual([
        { email: "billing@example.com", metadata: { ownerId: current.ownerId } },
        { idempotencyKey: `customer-${current.ownerId}` },
      ]);

      const stored = (await account(current.ownerId)).stripeCustomerId;
      expect(stored).toBeTruthy();

      await checkout();
      expect(s.customers).toHaveBeenCalledOnce();
      const { STRIPE_PRICE_ID } = await import("@/lib/stripe");
      const args = s.sessions.mock.calls[1][0] as Record<string, unknown>;
      expect(args).toMatchObject({
        mode: "subscription",
        customer: stored,
        line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
        metadata: { ownerId: current.ownerId },
        subscription_data: { metadata: { ownerId: current.ownerId } },
      });
      expect(String(args.success_url)).toMatch(/\/dashboard\?success=true$/);
      expect(String(args.cancel_url)).toMatch(/\/dashboard\?canceled=true$/);
    });

    it("blocks owners that already have an active subscription", async () => {
      current = newOwner();
      await seedAccount(current.ownerId, { plan: "pro", status: "active", stripeCustomerId: customerId() });
      const s = await spies();

      const res = await checkout();
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "ALREADY_SUBSCRIBED" });
      expect(s.sessions).not.toHaveBeenCalled();
      expect(s.customers).not.toHaveBeenCalled();
    });

    it("lets a cancelled subscriber check out again with the same customer", async () => {
      current = newOwner();
      const existing = customerId();
      await seedAccount(current.ownerId, { plan: "free", status: "canceled", stripeCustomerId: existing });
      const s = await spies();

      expect((await checkout()).status).toBe(200);
      expect(s.customers).not.toHaveBeenCalled();
      expect((s.sessions.mock.calls[0][0] as { customer: string }).customer).toBe(existing);
    });

    it("attaches organization checkouts to the organization and requires an admin", async () => {
      const org = newOwner(true);
      current = org;
      const s = await spies();
      await checkout();
      expect((s.sessions.mock.calls[0][0] as { metadata: object }).metadata).toEqual({ ownerId: org.ownerId });

      current = { ...org, userId: `test_u_${rand()}`, orgRole: "org:member" };
      s.sessions.mockClear();
      expect((await checkout()).status).toBe(403);
      expect((await portal()).status).toBe(403);
      expect(s.sessions).not.toHaveBeenCalled();
      expect(s.portal).not.toHaveBeenCalled();
    });

    it("opens the billing portal only for owners that have a customer", async () => {
      current = newOwner();
      const s = await spies();

      const none = await portal();
      expect(none.status).toBe(400);
      expect(await none.json()).toMatchObject({ code: "NO_BILLING_ACCOUNT" });

      const customer = customerId();
      await seedAccount(current.ownerId, { plan: "pro", status: "active", stripeCustomerId: customer });
      const res = await portal();
      expect(await res.json()).toEqual({ url: "https://portal.test/p" });
      expect(s.portal.mock.calls[0][0]).toMatchObject({ customer });
      expect(String((s.portal.mock.calls[0][0] as { return_url: string }).return_url)).toMatch(/\/dashboard\/settings$/);
    });
  });
});
