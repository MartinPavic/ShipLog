import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy";
process.env.STRIPE_PRICE_PRO_BYOK_ID ||= "price_pro_byok_test";
process.env.STRIPE_PRICE_PRO_MANAGED_ID ||= "price_pro_managed_test";
process.env.STRIPE_PRICE_ULTRA_BYOK_ID ||= "price_ultra_byok_test";
process.env.STRIPE_PRICE_ULTRA_MANAGED_ID ||= "price_ultra_managed_test";
process.env.STRIPE_PRICE_ID ||= "price_legacy_single_test";

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
const PRICE_IDS = {
  proByok: process.env.STRIPE_PRICE_PRO_BYOK_ID!,
  proManaged: process.env.STRIPE_PRICE_PRO_MANAGED_ID!,
  ultraByok: process.env.STRIPE_PRICE_ULTRA_BYOK_ID!,
  ultraManaged: process.env.STRIPE_PRICE_ULTRA_MANAGED_ID!,
  legacy: process.env.STRIPE_PRICE_ID!,
} as const;

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

  const recurringItem = (priceId: string, currentPeriodEnd = 1_900_000_000) => ({
    current_period_end: currentPeriodEnd,
    price: { id: priceId, type: "recurring" },
  });

  const subscription = (over: Record<string, unknown> = {}) => ({
    id: `sub_${rand()}`,
    object: "subscription",
    customer: "cus_x",
    status: "active",
    metadata: {},
    items: { data: [recurringItem(PRICE_IDS.proManaged)] },
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
    const { billingAccounts, projects, stripeEvents } = await import("@/db/schema");
    await getDb().delete(projects).where(inArray(projects.ownerId, createdOwners));
    await getDb().delete(billingAccounts).where(inArray(billingAccounts.ownerId, createdOwners));
    await getDb().delete(stripeEvents).where(inArray(stripeEvents.id, createdEvents));
  });

  describe("webhook: subscription lifecycle", () => {
    it.each([
      [PRICE_IDS.proByok, "pro", "byok"],
      [PRICE_IDS.proManaged, "pro", "managed"],
      [PRICE_IDS.ultraByok, "ultra", "byok"],
      [PRICE_IDS.ultraManaged, "ultra", "managed"],
    ] as const)("grants %s as %s/%s for active subscriptions", async (priceId, plan, aiMode) => {
      const owner = newOwner();
      const customer = customerId();
      const sub = subscription({ customer, metadata: { ownerId: owner.ownerId }, items: { data: [recurringItem(priceId)] } });
      const retrieve = vi.spyOn((await stripeLib()).subscriptions, "retrieve").mockResolvedValue(sub as never);

      const res = await deliver(event("customer.subscription.updated", sub));
      expect(res.status).toBe(200);
      expect(retrieve).toHaveBeenCalledWith(sub.id);
      expect(await account(owner.ownerId)).toMatchObject({
        plan,
        aiMode,
        status: "active",
        stripeCustomerId: customer,
        stripeSubscriptionId: sub.id,
        currentPeriodEnd: new Date(1_900_000_000 * 1000),
      });
    });

    it("grants entitlement for trialing subscriptions with a recognized price", async () => {
      const owner = newOwner();
      const sub = subscription({
        customer: customerId(),
        status: "trialing",
        metadata: { ownerId: owner.ownerId },
        items: { data: [recurringItem(PRICE_IDS.ultraByok)] },
      });
      vi.spyOn((await stripeLib()).subscriptions, "retrieve").mockResolvedValue(sub as never);

      await deliver(event("customer.subscription.updated", sub));
      expect(await account(owner.ownerId)).toMatchObject({ plan: "ultra", aiMode: "byok", status: "trialing" });
    });

    it.each(["past_due", "unpaid", "incomplete", "incomplete_expired", "canceled", "paused"])(
      "stores free/null when status is %s",
      async (status) => {
        const owner = newOwner();
        const sub = subscription({
          customer: customerId(),
          status,
          metadata: { ownerId: owner.ownerId },
          items: { data: [recurringItem(PRICE_IDS.ultraManaged)] },
        });
        vi.spyOn((await stripeLib()).subscriptions, "retrieve").mockResolvedValue(sub as never);

        await deliver(event("customer.subscription.updated", sub));
        expect(await account(owner.ownerId)).toMatchObject({ plan: "free", aiMode: null, status });
      }
    );

    it.each([
      ["unknown", [recurringItem("price_unknown")]],
      ["legacy single-price", [recurringItem(PRICE_IDS.legacy)]],
      ["missing recurring price", [{ current_period_end: 1_900_000_000, price: null }]],
      ["multiple recognized prices", [recurringItem(PRICE_IDS.proByok), recurringItem(PRICE_IDS.ultraManaged)]],
      ["recognized plus unknown recurring price", [recurringItem(PRICE_IDS.proByok), recurringItem("price_unknown")]],
      ["recognized plus legacy recurring price", [recurringItem(PRICE_IDS.proByok), recurringItem(PRICE_IDS.legacy)]],
      ["recognized plus missing price", [recurringItem(PRICE_IDS.proByok), { price: null }]],
      ["recognized plus one-time price", [recurringItem(PRICE_IDS.proByok), { price: { id: "price_addon", type: "one_time" } }]],
    ] as const)("stores free/null for %s entitlements", async (_label, items) => {
      const owner = newOwner();
      const sub = subscription({ customer: customerId(), metadata: { ownerId: owner.ownerId }, items: { data: items } });
      vi.spyOn((await stripeLib()).subscriptions, "retrieve").mockResolvedValue(sub as never);

      await deliver(event("customer.subscription.updated", sub));
      expect(await account(owner.ownerId)).toMatchObject({
        plan: "free",
        aiMode: null,
        status: "active",
        stripeSubscriptionId: sub.id,
      });
    });

    it("switches plan and mode as the subscription price changes", async () => {
      const owner = newOwner();
      const customer = customerId();
      const sub = subscription({ customer, metadata: { ownerId: owner.ownerId }, items: { data: [recurringItem(PRICE_IDS.proByok)] } });
      const retrieve = vi.spyOn((await stripeLib()).subscriptions, "retrieve")
        .mockResolvedValueOnce(sub as never)
        .mockResolvedValueOnce({ ...sub, items: { data: [recurringItem(PRICE_IDS.ultraManaged)] } } as never);

      await deliver(event("customer.subscription.updated", sub));
      expect(await account(owner.ownerId)).toMatchObject({ plan: "pro", aiMode: "byok" });

      await deliver(event("customer.subscription.updated", sub));
      expect(retrieve).toHaveBeenCalledTimes(2);
      expect(await account(owner.ownerId)).toMatchObject({ plan: "ultra", aiMode: "managed" });
    });

    it("rejects a truncated subscription item snapshot", async () => {
      const owner = newOwner();
      const sub = subscription({ customer: customerId(), metadata: { ownerId: owner.ownerId }, items: { data: [recurringItem(PRICE_IDS.proByok)], has_more: true } });
      vi.spyOn((await stripeLib()).subscriptions, "retrieve").mockResolvedValue(sub as never);
      expect((await deliver(event("customer.subscription.updated", sub))).status).toBe(200);
      expect(await account(owner.ownerId)).toMatchObject({ plan: "free", aiMode: null });
    });

    it("walks through cancel, failed payment and reactivation", async () => {
      const owner = newOwner();
      const customer = customerId();
      const sub = subscription({ customer, metadata: { ownerId: owner.ownerId }, items: { data: [recurringItem(PRICE_IDS.proManaged)] } });
      vi.spyOn((await stripeLib()).subscriptions, "retrieve")
        .mockResolvedValueOnce(sub as never)
        .mockResolvedValueOnce({ ...sub, status: "past_due", metadata: {} } as never)
        .mockResolvedValueOnce({ ...sub, metadata: {}, items: { data: [recurringItem(PRICE_IDS.proManaged)] } } as never)
        .mockResolvedValueOnce({ ...sub, status: "canceled", metadata: {} } as never);

      await deliver(event("customer.subscription.updated", sub));
      expect(await account(owner.ownerId)).toMatchObject({ plan: "pro", aiMode: "managed" });

      // The owner is found through the stored customer, so later events don't need metadata.
      await deliver(event("invoice.payment_failed", {
        id: "in_1",
        customer,
        parent: { type: "subscription_details", subscription_details: { subscription: sub.id } },
      }));
      expect(await account(owner.ownerId)).toMatchObject({ plan: "free", aiMode: null, status: "past_due" });

      await deliver(event("customer.subscription.updated", { ...sub, metadata: {} }));
      expect(await account(owner.ownerId)).toMatchObject({ plan: "pro", aiMode: "managed" });

      await deliver(event("customer.subscription.deleted", { ...sub, status: "canceled", metadata: {} }));
      expect(await account(owner.ownerId)).toMatchObject({ plan: "free", aiMode: null, status: "canceled", stripeCustomerId: customer });
    });

    it("does not demote from a stale payment_failed event when Stripe shows the subscription is recovered", async () => {
      const owner = newOwner();
      const customer = customerId();
      const sub = subscription({ customer, metadata: { ownerId: owner.ownerId }, items: { data: [recurringItem(PRICE_IDS.proManaged)] } });
      const retrieve = vi.spyOn((await stripeLib()).subscriptions, "retrieve")
        .mockResolvedValueOnce(sub as never)
        .mockResolvedValueOnce({ ...sub, status: "active" } as never);

      await deliver(event("customer.subscription.updated", sub));
      await deliver(event("invoice.payment_failed", {
        id: "in_stale_failure",
        customer,
        parent: { type: "subscription_details", subscription_details: { subscription: sub.id } },
      }));

      expect(retrieve).toHaveBeenNthCalledWith(2, sub.id);
      expect(await account(owner.ownerId)).toMatchObject({
        plan: "pro",
        aiMode: "managed",
        status: "active",
        stripeSubscriptionId: sub.id,
      });
    });

    it("ignores a payment failure for a subscription that has been replaced", async () => {
      const owner = newOwner();
      const customer = customerId();
      const currentSubscription = subscription({ customer, metadata: { ownerId: owner.ownerId } });
      vi.spyOn((await stripeLib()).subscriptions, "retrieve").mockResolvedValue(currentSubscription as never);
      await deliver(event("customer.subscription.updated", currentSubscription));

      await deliver(event("invoice.payment_failed", {
        id: "in_old_subscription",
        customer,
        parent: { type: "subscription_details", subscription_details: { subscription: "sub_old" } },
      }));

      expect(await account(owner.ownerId)).toMatchObject({
        plan: "pro",
        aiMode: "managed",
        status: "active",
        stripeSubscriptionId: currentSubscription.id,
      });
    });

    it("supports legacy invoice.subscription payloads", async () => {
      const owner = newOwner();
      const customer = customerId();
      const sub = subscription({ customer, metadata: { ownerId: owner.ownerId } });
      vi.spyOn((await stripeLib()).subscriptions, "retrieve")
        .mockResolvedValueOnce(sub as never)
        .mockResolvedValueOnce({ ...sub, status: "past_due", metadata: {} } as never);
      await deliver(event("customer.subscription.updated", sub));

      await deliver(event("invoice.payment_failed", { id: "in_legacy", customer, subscription: sub.id }));

      expect(await account(owner.ownerId)).toMatchObject({ plan: "free", aiMode: null, status: "past_due", stripeSubscriptionId: sub.id });
    });

    it("supports organization owners", async () => {
      const org = newOwner(true);
      const sub = subscription({ customer: customerId(), metadata: { ownerId: org.ownerId }, items: { data: [recurringItem(PRICE_IDS.ultraByok)] } });
      vi.spyOn((await stripeLib()).subscriptions, "retrieve").mockResolvedValue(sub as never);
      await deliver(event("customer.subscription.updated", sub));
      expect(await account(org.ownerId)).toMatchObject({ plan: "ultra", aiMode: "byok" });
      const { getPlanLimits } = await import("@/lib/plans");
      expect((await getPlanLimits(org.ownerId)).limits.teams).toBe(true);
    });

    it("uses the latest subscription snapshot so stale event payloads cannot overwrite newer entitlements", async () => {
      const owner = newOwner();
      const customer = customerId();
      const currentSub = subscription({ customer, metadata: { ownerId: owner.ownerId }, items: { data: [recurringItem(PRICE_IDS.ultraManaged)] } });
      const retrieve = vi.spyOn((await stripeLib()).subscriptions, "retrieve")
        .mockResolvedValueOnce(currentSub as never)
        .mockResolvedValueOnce(currentSub as never);

      await deliver(event("customer.subscription.updated", { ...currentSub, status: "active" }));
      await deliver(event("customer.subscription.deleted", { ...currentSub, status: "canceled", items: { data: [recurringItem(PRICE_IDS.proByok)] } }));

      expect(retrieve).toHaveBeenNthCalledWith(1, currentSub.id);
      expect(retrieve).toHaveBeenNthCalledWith(2, currentSub.id);
      expect(await account(owner.ownerId)).toMatchObject({ plan: "ultra", aiMode: "managed", stripeSubscriptionId: currentSub.id });
    });

    it.each(["customer.subscription.updated", "customer.subscription.deleted", "checkout.session.completed", "invoice.payment_failed"])(
      "serializes distinct %s events across Stripe retrieval and persistence",
      async (secondType) => {
        const owner = newOwner();
        const customer = customerId();
        const oldSub = subscription({ customer, metadata: { ownerId: owner.ownerId }, items: { data: [recurringItem(PRICE_IDS.proByok)] } });
        const newSub = { ...oldSub, items: { data: [recurringItem(PRICE_IDS.ultraManaged)] } };
        await seedAccount(owner.ownerId, { stripeCustomerId: customer, stripeSubscriptionId: oldSub.id, status: "active", plan: "pro", aiMode: "byok" });
        let releaseFirst!: () => void;
        let enteredFirst!: () => void;
        const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
        const entered = new Promise<void>((resolve) => { enteredFirst = resolve; });
        const retrieve = vi.spyOn((await stripeLib()).subscriptions, "retrieve")
          .mockImplementationOnce((async () => { enteredFirst(); await gate; return oldSub; }) as never)
          .mockResolvedValue(newSub as never);
        const first = deliver(event("customer.subscription.updated", oldSub));
        await entered;
        const secondObject = secondType === "checkout.session.completed"
          ? { mode: "subscription", customer, subscription: oldSub.id, metadata: { ownerId: owner.ownerId } }
          : secondType === "invoice.payment_failed"
            ? { customer, parent: { subscription_details: { subscription: oldSub.id } } }
            : newSub;
        const second = deliver(event(secondType, secondObject));
        const { getDb } = await import("@/db");
        const { sql } = await import("drizzle-orm");
        let overlappingRetrievals: number;
        try {
          await vi.waitFor(async () => {
            const waiting = await getDb().execute(sql`select 1 from pg_locks where locktype = 'advisory' and not granted and objid in (hashtext(${"checkout:" + owner.ownerId})::oid, hashtext(${"subscription:" + oldSub.id})::oid)`);
            expect(retrieve.mock.calls.length > 1 || waiting.rows.length > 0).toBe(true);
          });
          overlappingRetrievals = retrieve.mock.calls.length;
        } finally {
          releaseFirst();
          await Promise.all([first, second]);
        }
        const responses = await Promise.all([first, second]);
        expect(responses.map((response) => response.status)).toEqual([200, 200]);
        expect(overlappingRetrievals).toBe(1);
        expect(await account(owner.ownerId)).toMatchObject({ plan: "ultra", aiMode: "managed", stripeSubscriptionId: oldSub.id });
      }
    );

    it("ignores events it cannot attribute to anyone", async () => {
      const unknown = customerId();
      const sub = subscription({ customer: unknown });
      vi.spyOn((await stripeLib()).subscriptions, "retrieve").mockResolvedValue(sub as never);
      expect((await deliver(event("customer.subscription.updated", sub))).status).toBe(200);
      expect((await deliver(event("invoice.payment_failed", { id: "in_2", customer: unknown }))).status).toBe(200);
      const { getDb } = await import("@/db");
      const { billingAccounts } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      expect(await getDb().select().from(billingAccounts).where(eq(billingAccounts.stripeCustomerId, unknown))).toHaveLength(0);
    });

    it.each([true, false])("preserves pre-downgrade reports without lifting never-paid Free history (paid=%s)", async (paid) => {
      current = newOwner();
      const owner = current;
      const sub = subscription({ customer: customerId(), metadata: { ownerId: owner.ownerId } });
      const retrieve = vi.spyOn((await stripeLib()).subscriptions, "retrieve").mockResolvedValue(sub as never);
      if (paid) expect((await deliver(event("customer.subscription.updated", sub))).status).toBe(200);
      const { getDb } = await import("@/db");
      const { shipLogs } = await import("@/db/schema");
      const { createProject } = await import("./projects");
      const { createProjectSchema } = await import("./validation");
      const { getPlanLimits } = await import("./plans");
      const project = await createProject(owner, createProjectSchema.parse({ name: "Retained history" }), (await getPlanLimits(owner.ownerId)).limits.maxProjects);
      const rows = Array.from({ length: 12 }, (_, index) => ({
        projectId: project.id, ownerId: owner.ownerId, createdBy: owner.userId,
        title: `Report ${index}`, content: `Body ${index}`, template: "weekly_update", status: "ready" as const,
        periodStart: new Date(), periodEnd: new Date(), createdAt: new Date(Date.now() - (20 - index) * 1000),
      }));
      const logs = await getDb().insert(shipLogs).values(rows).returning();
      if (paid) {
        retrieve.mockResolvedValue({ ...sub, status: "canceled" } as never);
        expect((await deliver(event("customer.subscription.deleted", sub))).status).toBe(200);
      }
      expect((await getPlanLimits(owner.ownerId)).limits.visibleLogs).toBe(10);
      const list = (await import("@/app/api/projects/[id]/logs/route")).GET;
      const open = (await import("@/app/api/logs/[id]/route")).GET;
      const listed = await list(new Request("http://x/logs?pageSize=50"), { params: Promise.resolve({ id: project.id }) });
      expect(listed.status).toBe(200);
      expect(await listed.json()).toMatchObject({ total: paid ? 12 : 10, hidden: paid ? 0 : 2 });
      for (const [index, log] of logs.entries()) {
        const response = await open(new Request("http://x/log"), { params: Promise.resolve({ id: log.id }) });
        expect(response.status).toBe(paid || index >= 2 ? 200 : 403);
      }
      if (paid) {
        const later = await getDb().insert(shipLogs).values(rows.map((row, index) => ({ ...row, createdAt: new Date(Date.now() + (index + 1) * 1000) }))).returning();
        await deliver(event("customer.subscription.deleted", sub));
        const after = await list(new Request("http://x/logs?pageSize=50"), { params: Promise.resolve({ id: project.id }) });
        expect(await after.json()).toMatchObject({ total: 22, hidden: 2 });
        expect((await open(new Request("http://x/log"), { params: Promise.resolve({ id: logs[0].id }) })).status).toBe(200);
        expect((await open(new Request("http://x/log"), { params: Promise.resolve({ id: later[0].id }) })).status).toBe(403);
      }
    });

    it("acknowledges event types it does not handle", async () => {
      expect((await deliver(event("charge.succeeded", { id: "ch_1" }))).status).toBe(200);
    });
  });

  describe("webhook: checkout.session.completed", () => {
    it.each([true, false])("clears only a matching pending checkout ID (matching=%s)", async (matching) => {
      const owner = newOwner();
      const customer = customerId();
      const pendingId = `cs_${rand()}`;
      const sub = subscription({ customer, metadata: { ownerId: owner.ownerId } });
      await seedAccount(owner.ownerId, { stripeCustomerId: customer, stripeCheckoutSessionId: pendingId });
      vi.spyOn((await stripeLib()).subscriptions, "retrieve").mockResolvedValue(sub as never);

      const response = await deliver(event("checkout.session.completed", {
        id: matching ? pendingId : `cs_other_${rand()}`,
        mode: "subscription", customer, subscription: sub.id, metadata: { ownerId: owner.ownerId },
      }));

      expect(response.status).toBe(200);
      expect(await account(owner.ownerId)).toMatchObject({
        stripeSubscriptionId: sub.id,
        stripeCheckoutSessionId: matching ? null : pendingId,
      });
    });

    it("rechecks current subscription identity when another subscription replaces it under the workspace lock", async () => {
      const owner = newOwner();
      const customer = customerId();
      const oldSub = subscription({ customer, status: "canceled", metadata: { ownerId: owner.ownerId } });
      const replacement = subscription({ customer, metadata: { ownerId: owner.ownerId }, items: { data: [recurringItem(PRICE_IDS.ultraByok)] } });
      await seedAccount(owner.ownerId, { stripeCustomerId: customer, stripeSubscriptionId: oldSub.id, status: "canceled" });
      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const started = new Promise<void>((resolve) => { entered = resolve; });
      const retrieve = vi.spyOn((await stripeLib()).subscriptions, "retrieve").mockImplementation((async (id: string) => {
        if (id === replacement.id) { entered(); await gate; return replacement; }
        return oldSub;
      }) as never);
      const replacing = deliver(event("checkout.session.completed", { mode: "subscription", customer, subscription: replacement.id, metadata: { ownerId: owner.ownerId } }));
      await started;
      const stale = deliver(event("customer.subscription.updated", oldSub));
      const { getDb } = await import("@/db");
      const { sql } = await import("drizzle-orm");
      try {
        await vi.waitFor(async () => {
          const waiting = await getDb().execute(sql`select 1 from pg_locks where locktype = 'advisory' and not granted and objid = hashtext(${"checkout:" + owner.ownerId})::oid`);
          expect(waiting.rows.length).toBeGreaterThan(0);
        });
      } finally {
        release();
        await Promise.all([replacing, stale]);
      }
      expect(retrieve).toHaveBeenCalledOnce();
      expect(await account(owner.ownerId)).toMatchObject({ plan: "ultra", aiMode: "byok", stripeSubscriptionId: replacement.id });
    });

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

    it("does not let stale checkout completion overwrite an existing live subscription id", async () => {
      const owner = newOwner();
      const customer = customerId();
      const currentSub = subscription({
        id: "sub_current_live",
        customer,
        status: "active",
        metadata: { ownerId: owner.ownerId },
        items: { data: [recurringItem(PRICE_IDS.ultraManaged)] },
      });
      const staleSub = subscription({
        id: "sub_stale_old",
        customer,
        status: "canceled",
        metadata: { ownerId: owner.ownerId },
        items: { data: [recurringItem(PRICE_IDS.proByok)] },
      });
      vi.spyOn((await stripeLib()).subscriptions, "retrieve")
        .mockResolvedValueOnce(currentSub as never)
        .mockResolvedValueOnce(staleSub as never);

      await deliver(event("customer.subscription.updated", currentSub));
      await deliver(event("checkout.session.completed", {
        id: "cs_stale_old",
        mode: "subscription",
        subscription: staleSub.id,
        customer,
        metadata: { ownerId: owner.ownerId },
      }));

      expect(await account(owner.ownerId)).toMatchObject({
        plan: "ultra",
        aiMode: "managed",
        status: "active",
        stripeSubscriptionId: currentSub.id,
      });
    });
  });

  describe("webhook: security and delivery guarantees", () => {
    it("rejects missing, forged and wrongly signed requests without touching data", async () => {
      const owner = newOwner();
      const evt = event("customer.subscription.updated", subscription({ customer: customerId(), metadata: { ownerId: owner.ownerId } }));
      vi.spyOn((await stripeLib()).subscriptions, "retrieve").mockResolvedValue(evt.data.object as never);

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
      vi.spyOn((await stripeLib()).subscriptions, "retrieve").mockResolvedValue(evt.data.object as never);

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
      vi.spyOn((await stripeLib()).subscriptions, "retrieve").mockResolvedValue(evt.data.object as never);
      const responses = await Promise.all(Array.from({ length: 6 }, () => deliver(evt)));
      const bodies = await Promise.all(responses.map(async (response) => ({ status: response.status, body: await response.json() })));
      expect(bodies.filter((result) => result.status === 200 && !result.body.duplicate)).toHaveLength(1);
      expect(bodies.filter((result) => result.status === 200 || result.status === 500)).toHaveLength(6);
      expect(await (await deliver(evt)).json()).toEqual({ received: true, duplicate: true });
    });

    it("reclaims an event claim abandoned beyond the processing lease", async () => {
      const owner = newOwner();
      const evt = event("customer.subscription.updated", subscription({ customer: customerId(), metadata: { ownerId: owner.ownerId } }));
      vi.spyOn((await stripeLib()).subscriptions, "retrieve").mockResolvedValue(evt.data.object as never);
      const { getDb } = await import("@/db");
      const { stripeEvents } = await import("@/db/schema");
      await getDb().insert(stripeEvents).values({ id: evt.id, status: "processing", updatedAt: new Date(Date.now() - 10 * 60 * 1000) });

      expect((await deliver(evt)).status).toBe(200);
      expect(await account(owner.ownerId)).toMatchObject({ plan: "pro" });
    });

    it("does not let an expired worker complete or release a newer claim", async () => {
      const { getDb } = await import("@/db");
      const { stripeEvents } = await import("@/db/schema");
      const { and, eq } = await import("drizzle-orm");
      const { claimStripeEvent, completeStripeEvent, processStripeEvent, releaseStripeEvent } = await import("./billing");
      const owner = newOwner();
      const customer = customerId();
      const evt = event("customer.subscription.updated", subscription({ customer, metadata: { ownerId: owner.ownerId } }));
      vi.spyOn((await stripeLib()).subscriptions, "retrieve").mockResolvedValue(evt.data.object as never);
      const first = await claimStripeEvent(evt.id);
      expect(first.status).toBe("claimed");
      if (first.status !== "claimed") throw new Error("Expected initial claim");
      await getDb().update(stripeEvents).set({ updatedAt: new Date(Date.now() - 10 * 60 * 1000) }).where(eq(stripeEvents.id, evt.id));
      const second = await claimStripeEvent(evt.id);
      expect(second.status).toBe("claimed");
      if (second.status !== "claimed") throw new Error("Expected reclaimed event");

      await processStripeEvent(evt as never, first.token);
      expect(await account(owner.ownerId)).toBeUndefined();
      expect(await completeStripeEvent(evt.id, first.token)).toBe(false);
      await releaseStripeEvent(evt.id, first.token);
      const [row] = await getDb().select().from(stripeEvents).where(and(eq(stripeEvents.id, evt.id), eq(stripeEvents.claimToken, second.token)));
      expect(row.status).toBe("processing");
    });

    it("returns a retryable response when the webhook worker loses its claim", async () => {
      const evt = event("charge.succeeded", { id: "ch_stale" });
      const billing = await import("./billing");
      vi.spyOn(billing, "processStripeEvent").mockResolvedValueOnce(false);
      const { stripe } = await import("@/lib/stripe");
      const payload = JSON.stringify(evt);
      const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
      const { POST } = await import("@/app/api/webhooks/stripe/route");
      const response = await POST(new Request("http://x/api/webhooks/stripe", {
        method: "POST",
        body: payload,
        headers: { "stripe-signature": signature },
      }));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Processing lease expired" });
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
      const openSessions: { id: string; url: string; mode: string; status: string; line_items: { data: Array<{ price: { id: string } }> } }[] = [];
      return {
        customers: vi.spyOn(stripe.customers, "create").mockImplementation((async () => ({ id: customerId() })) as never),
        sessions: vi.spyOn(stripe.checkout.sessions, "create").mockImplementation((async (args: { line_items: Array<{ price: string }> }) => {
          const session = {
            id: `cs_${rand()}`,
            url: sessionUrl,
            mode: "subscription",
            status: "open",
            line_items: { data: [{ price: { id: args.line_items[0]!.price } }] },
          };
          openSessions.push(session);
          return session;
        }) as never),
        openSessions: vi.spyOn(stripe.checkout.sessions, "list").mockImplementation((async (args: { status: string }) => ({
          data: openSessions.filter((session) => !args.status || session.status === args.status),
        })) as never),
        retrieveSession: vi.spyOn(stripe.checkout.sessions, "retrieve").mockImplementation((async (sessionId: string) => {
          const session = openSessions.find((candidate) => candidate.id === sessionId);
          if (!session) throw new Error("Unknown mock checkout session");
          return session;
        }) as never),
        subscriptions: vi.spyOn(stripe.subscriptions, "list").mockResolvedValue({ data: [] } as never),
        retrieveSubscription: vi.spyOn(stripe.subscriptions, "retrieve").mockResolvedValue({ status: "canceled" } as never),
        expire: vi.spyOn(stripe.checkout.sessions, "expire").mockImplementation((async (sessionId: string) => {
          const session = openSessions.find((candidate) => candidate.id === sessionId);
          if (session) session.status = "expired";
          return { id: sessionId, status: "expired" };
        }) as never),
        portal: vi.spyOn(stripe.billingPortal.sessions, "create").mockResolvedValue({ url: "https://portal.test/p" } as never),
      };
    }
    const checkout = async (body?: unknown) => {
      const request = new Request("http://x/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? { tier: "pro", aiMode: "managed" }),
      });
      return (await import("@/app/api/stripe/checkout/route")).POST(request);
    };
    const portal = async () => (await import("@/app/api/stripe/portal/route")).POST();

    it("blocks completion between session listing/retrieval and replacement creation", async () => {
      current = newOwner();
      const s = await spies();
      const first = await checkout();
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ url: sessionUrl });
      const originalSession = await s.sessions.mock.results[0].value;
      let entered!: () => void;
      let resume!: () => void;
      const gated = new Promise<void>((resolve) => { entered = resolve; });
      const released = new Promise<void>((resolve) => { resume = resolve; });
      s.openSessions.mockImplementation((async (args: { status: string }) => {
        if (args.status === "open") { entered(); await released; }
        return { data: [] };
      }) as never);
      s.retrieveSession.mockImplementation((async () => {
        entered();
        await released;
        return { ...originalSession, status: "complete", subscription: "sub_pending" };
      }) as never);

      const second = checkout();
      await gated;
      originalSession.status = "complete";
      resume();
      const response = await second;
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "BILLING_PORTAL_REQUIRED" });
      expect(s.sessions).toHaveBeenCalledOnce();
    });

    it("adopts an untracked session that completes during unfiltered discovery", async () => {
      current = newOwner();
      await seedAccount(current.ownerId, { stripeCustomerId: customerId() });
      const s = await spies();
      const pending = { id: "cs_untracked", mode: "subscription", status: "open", url: sessionUrl };
      s.openSessions.mockImplementation((async (args: { status?: string }) => {
        expect(args.status).toBeUndefined();
        const snapshot = { ...pending };
        pending.status = "complete";
        return { data: [snapshot] };
      }) as never);
      s.retrieveSession.mockImplementation((async () => pending) as never);

      const response = await checkout();
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "BILLING_PORTAL_REQUIRED" });
      expect(await account(current.ownerId)).toMatchObject({ stripeCheckoutSessionId: pending.id });
      expect(s.sessions).not.toHaveBeenCalled();
    });

    it.each(["open", "complete"])("recovers a lost create response without duplicating a now-%s session", async (status) => {
      current = newOwner();
      const s = await spies();
      const create = s.sessions.getMockImplementation()!;
      let remote: Stripe.Response<Stripe.Checkout.Session> | undefined;
      let createdCount = 0;
      s.sessions.mockImplementation((async (params: Stripe.Checkout.SessionCreateParams, options: Stripe.RequestOptions) => {
        expect(await account(current.ownerId)).toMatchObject({
          stripeCheckoutSessionId: null,
          stripeCheckoutReservation: { id: options.idempotencyKey, params },
        });
        if (!remote) {
          remote = await create(params, options);
          createdCount++;
          throw new Error("Stripe created the session but its response was lost");
        }
        expect(options).toEqual(s.sessions.mock.calls[0][1]);
        expect(params).toEqual(s.sessions.mock.calls[0][0]);
        return remote;
      }) as never);

      expect((await checkout()).status).toBe(500);
      expect(remote).toBeDefined();
      remote!.status = status as "open" | "complete";
      const response = await checkout();
      expect(response.status).toBe(status === "open" ? 200 : 409);
      expect(createdCount).toBe(1);
      expect(s.sessions).toHaveBeenCalledTimes(2);
      expect(await account(current.ownerId)).toMatchObject({
        stripeCheckoutSessionId: remote!.id,
        stripeCheckoutReservation: null,
        plan: "free", aiMode: null,
      });
    });

    it("fails closed rather than retrying an ambiguous reservation beyond the idempotency window", async () => {
      current = newOwner();
      const s = await spies();
      s.sessions.mockRejectedValue(new Error("Ambiguous Stripe failure"));
      expect((await checkout()).status).toBe(500);
      const stored = await account(current.ownerId);
      expect(stored.stripeCheckoutReservation).not.toBeNull();
      vi.spyOn(Date, "now").mockReturnValue(stored.stripeCheckoutReservation!.createdAt + 23 * 60 * 60 * 1000);

      const response = await checkout();
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "BILLING_PORTAL_REQUIRED" });
      expect(s.sessions).toHaveBeenCalledOnce();
      expect(await account(current.ownerId)).toMatchObject({ stripeCheckoutReservation: stored.stripeCheckoutReservation });
    });

    it("blocks replacement if completion wins the expiration race", async () => {
      current = newOwner();
      const s = await spies();
      expect((await checkout()).status).toBe(200);
      const pending = await s.sessions.mock.results[0].value;
      s.expire.mockImplementation((async () => {
        pending.status = "complete";
        throw new Error("Session is no longer open");
      }) as never);

      const response = await checkout({ tier: "ultra", aiMode: "byok" });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "BILLING_PORTAL_REQUIRED" });
      expect(s.sessions).toHaveBeenCalledOnce();
      expect(await account(current.ownerId)).toMatchObject({ stripeCheckoutSessionId: pending.id });
    });

    it("persists and retrieves the exact open session instead of relying on lists", async () => {
      current = newOwner();
      const s = await spies();
      expect((await checkout()).status).toBe(200);
      const pending = await s.sessions.mock.results[0].value;
      expect(await account(current.ownerId)).toMatchObject({ stripeCheckoutSessionId: pending.id });
      s.openSessions.mockResolvedValue({ data: [] } as never);
      expect((await checkout()).status).toBe(200);
      expect(s.retrieveSession).toHaveBeenCalledWith(pending.id, { expand: ["line_items"] });
      expect(s.sessions).toHaveBeenCalledOnce();
    });

    it("replaces an expired pending session", async () => {
      current = newOwner();
      const s = await spies();
      expect((await checkout()).status).toBe(200);
      const pending = await s.sessions.mock.results[0].value;
      pending.status = "expired";
      expect((await checkout()).status).toBe(200);
      expect(s.sessions).toHaveBeenCalledTimes(2);
      const replacement = await s.sessions.mock.results[1].value;
      expect(await account(current.ownerId)).toMatchObject({ stripeCheckoutSessionId: replacement.id });
    });

    it("expires the exact pending session before changing variant", async () => {
      current = newOwner();
      const s = await spies();
      expect((await checkout()).status).toBe(200);
      const pending = await s.sessions.mock.results[0].value;
      expect((await checkout({ tier: "ultra", aiMode: "byok" })).status).toBe(200);
      expect(s.expire).toHaveBeenCalledWith(pending.id);
      expect(s.sessions).toHaveBeenCalledTimes(2);
      expect(s.sessions.mock.calls[1][0]).toMatchObject({ line_items: [{ price: PRICE_IDS.ultraByok, quantity: 1 }] });
    });

    it.each(["complete", null])("blocks a %s pending session without creating another", async (status) => {
      current = newOwner();
      const s = await spies();
      expect((await checkout()).status).toBe(200);
      const pending = await s.sessions.mock.results[0].value;
      s.retrieveSession.mockResolvedValue({ ...pending, status } as never);
      s.openSessions.mockResolvedValue({ data: [] } as never);
      const response = await checkout();
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "BILLING_PORTAL_REQUIRED" });
      expect(s.sessions).toHaveBeenCalledOnce();
    });

    it.each([
      [{ tier: "pro", aiMode: "byok" }, PRICE_IDS.proByok],
      [{ tier: "pro", aiMode: "managed" }, PRICE_IDS.proManaged],
      [{ tier: "ultra", aiMode: "byok" }, PRICE_IDS.ultraByok],
      [{ tier: "ultra", aiMode: "managed" }, PRICE_IDS.ultraManaged],
    ] as const)("resolves %o to configured price %s", async (variant, expectedPrice) => {
      current = newOwner();
      const s = await spies();
      const { stripePriceFor } = await import("@/lib/stripe-prices");
      expect(stripePriceFor(variant)).toBe(expectedPrice);

      const first = await checkout(variant);
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ url: sessionUrl });
      const args = s.sessions.mock.calls[0][0] as Record<string, unknown>;
      expect(args).toMatchObject({
        mode: "subscription",
        line_items: [{ price: expectedPrice, quantity: 1 }],
        automatic_tax: { enabled: true },
        billing_address_collection: "required",
        customer_update: { address: "auto" },
      });
    });

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
      expect(await account(current.ownerId)).toMatchObject({ plan: "free", aiMode: null });

      await checkout();
      expect(s.customers).toHaveBeenCalledOnce();
      expect(s.sessions).toHaveBeenCalledOnce();
      const args = s.sessions.mock.calls[0][0] as Record<string, unknown>;
      expect(args).toMatchObject({
        mode: "subscription",
        customer: stored,
        line_items: [{ price: PRICE_IDS.proManaged, quantity: 1 }],
        metadata: { ownerId: current.ownerId },
        subscription_data: { metadata: { ownerId: current.ownerId } },
        automatic_tax: { enabled: true },
      });
      expect(String(args.success_url)).toMatch(/\/dashboard\?success=true$/);
      expect(String(args.cancel_url)).toMatch(/\/dashboard\?canceled=true$/);
    });

    it("rejects invalid or missing checkout variants", async () => {
      current = newOwner();
      const s = await spies();

      const missing = await checkout({ tier: "pro" });
      expect(missing.status).toBe(400);
      expect(await missing.json()).toMatchObject({ code: "VALIDATION" });

      const invalidTier = await checkout({ tier: "enterprise", aiMode: "managed" });
      expect(invalidTier.status).toBe(400);
      expect(await invalidTier.json()).toMatchObject({ code: "VALIDATION" });

      const invalidMode = await checkout({ tier: "ultra", aiMode: "hybrid" });
      expect(invalidMode.status).toBe(400);
      expect(await invalidMode.json()).toMatchObject({ code: "VALIDATION" });

      expect(s.sessions).not.toHaveBeenCalled();
      expect(s.customers).not.toHaveBeenCalled();
    });

    it("creates only one open checkout session for concurrent requests", async () => {
      current = newOwner();
      const s = await spies();

      const responses = await Promise.all([checkout({ tier: "ultra", aiMode: "byok" }), checkout({ tier: "ultra", aiMode: "byok" })]);

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(s.sessions).toHaveBeenCalledOnce();
      const pending = await s.sessions.mock.results[0].value;
      expect(s.retrieveSession).toHaveBeenCalledWith(pending.id, { expand: ["line_items"] });
      expect(await Promise.all(responses.map((response) => response.json()))).toEqual([{ url: sessionUrl }, { url: sessionUrl }]);
      expect(s.customers).toHaveBeenCalledOnce();
    });

    it("expires an open session with an old configured price", async () => {
      current = newOwner();
      const s = await spies();
      const old = { id: "cs_old", status: "open", url: "https://checkout.test/old", mode: "subscription", line_items: { data: [{ price: { id: "price_old" } }] } };
      s.openSessions.mockResolvedValueOnce({ data: [old] } as never);
      s.retrieveSession.mockResolvedValueOnce(old as never);

      expect((await checkout({ tier: "pro", aiMode: "managed" })).status).toBe(200);
      expect(s.expire).toHaveBeenCalledWith("cs_old");
      expect(s.sessions).toHaveBeenCalledOnce();
    });

    it.each(["active", "trialing", "incomplete", "past_due", "unpaid", "paused"])(
      "blocks a second checkout while a live %s subscription awaits its webhook",
      async (status) => {
        current = newOwner();
        const s = await spies();
        expect((await checkout()).status).toBe(200);
        s.openSessions.mockResolvedValue({ data: [] } as never);
        s.subscriptions.mockResolvedValue({ data: [subscription({ status })] } as never);

        const response = await checkout();
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ code: "BILLING_PORTAL_REQUIRED" });
        expect(s.sessions).toHaveBeenCalledOnce();
        expect(await account(current.ownerId)).toMatchObject({ plan: "free", aiMode: null });
      }
    );

    it("checks a completed session's pending subscription before creating another checkout", async () => {
      current = newOwner();
      await seedAccount(current.ownerId, { stripeCustomerId: customerId() });
      const s = await spies();
      s.openSessions.mockResolvedValue({ data: [{ id: "cs_complete", status: "complete", mode: "subscription", subscription: "sub_pending" }] } as never);
      s.retrieveSubscription.mockResolvedValue(subscription({ id: "sub_pending", status: "incomplete" }) as never);

      expect((await checkout()).status).toBe(409);
      expect(s.retrieveSubscription).toHaveBeenCalledWith("sub_pending");
      expect(s.sessions).not.toHaveBeenCalled();
    });

    it("blocks owners with active subscriptions and tells them to use the billing portal", async () => {
      current = newOwner();
      await seedAccount(current.ownerId, { plan: "pro", status: "active", stripeCustomerId: customerId() });
      const s = await spies();

      const res = await checkout({ tier: "ultra", aiMode: "managed" });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "BILLING_PORTAL_REQUIRED" });
      expect(s.sessions).not.toHaveBeenCalled();
      expect(s.customers).not.toHaveBeenCalled();
    });

    it.each(["trialing", "past_due", "unpaid", "paused", "incomplete"]) (
      "blocks owners with an existing non-terminal %s subscription and tells them to use the billing portal",
      async (status) => {
        current = newOwner();
        await seedAccount(current.ownerId, {
          plan: "pro",
          status,
          stripeCustomerId: customerId(),
          stripeSubscriptionId: `sub_existing_${rand()}`,
        });
        const s = await spies();

        const res = await checkout({ tier: "ultra", aiMode: "managed" });
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ code: "BILLING_PORTAL_REQUIRED" });
        expect(s.sessions).not.toHaveBeenCalled();
        expect(s.customers).not.toHaveBeenCalled();
      }
    );

    it("lets a cancelled subscriber check out again with the same customer", async () => {
      current = newOwner();
      const existing = customerId();
      await seedAccount(current.ownerId, { plan: "free", status: "canceled", stripeCustomerId: existing });
      const s = await spies();

      expect((await checkout({ tier: "ultra", aiMode: "managed" })).status).toBe(200);
      expect(s.customers).not.toHaveBeenCalled();
      expect((s.sessions.mock.calls[0][0] as { customer: string }).customer).toBe(existing);
      expect(s.sessions.mock.calls[0][0]).toMatchObject({ billing_address_collection: "required", customer_update: { address: "auto" } });
    });

    it("attaches organization checkouts to the organization and requires an admin", async () => {
      const org = newOwner(true);
      current = org;
      const s = await spies();
      await checkout({ tier: "pro", aiMode: "managed" });
      expect((s.sessions.mock.calls[0][0] as { metadata: object }).metadata).toEqual({ ownerId: org.ownerId });

      current = { ...org, userId: `test_u_${rand()}`, orgRole: "org:member" };
      s.sessions.mockClear();
      expect((await checkout({ tier: "pro", aiMode: "managed" })).status).toBe(403);
      expect((await portal()).status).toBe(403);
      expect(s.sessions).not.toHaveBeenCalled();
      expect(s.portal).not.toHaveBeenCalled();
    });

    it("authorizes before body validation and price resolution", async () => {
      const org = newOwner(true);
      current = { ...org, userId: `test_u_${rand()}`, orgRole: "org:member" };
      const s = await spies();
      const savedProManaged = process.env.STRIPE_PRICE_PRO_MANAGED_ID;
      delete process.env.STRIPE_PRICE_PRO_MANAGED_ID;

      try {
        const invalidBody = await checkout({ tier: "pro" });
        expect(invalidBody.status).toBe(403);

        const missingConfig = await checkout({ tier: "pro", aiMode: "managed" });
        expect(missingConfig.status).toBe(403);

        expect(s.sessions).not.toHaveBeenCalled();
        expect(s.customers).not.toHaveBeenCalled();
      } finally {
        if (savedProManaged === undefined) delete process.env.STRIPE_PRICE_PRO_MANAGED_ID;
        else process.env.STRIPE_PRICE_PRO_MANAGED_ID = savedProManaged;
      }
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
