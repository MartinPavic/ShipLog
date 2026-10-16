import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth(), currentUser: async () => null }));

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy";

const FLAGS = ["BILLING_ENABLED", "TEAMS_ENABLED", "SCHEDULING_ENABLED"];
afterEach(() => {
  for (const name of FLAGS) delete process.env[name];
  delete process.env.CRON_SECRET;
  auth.mockReset();
});

describe("billing routes with BILLING_ENABLED=false", () => {
  it("answer 404 FEATURE_DISABLED before touching auth, Stripe or the database", async () => {
    process.env.BILLING_ENABLED = "false";
    for (const path of ["checkout", "portal"]) {
      const { POST } = await import(`@/app/api/stripe/${path}/route`);
      const res = await POST(new Request("http://x", { method: "POST" }));
      expect(res.status, path).toBe(404);
      expect(await res.json()).toMatchObject({ code: "FEATURE_DISABLED" });
    }
    expect(auth).not.toHaveBeenCalled();
  });

  it("ignores Stripe webhooks, even correctly signed ones", async () => {
    process.env.BILLING_ENABLED = "false";
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
    expect(res.status).toBe(404);
  });
});

describe("cron route with SCHEDULING_ENABLED=false", () => {
  it("still requires the secret, then reports that it skipped", async () => {
    process.env.SCHEDULING_ENABLED = "false";
    process.env.CRON_SECRET = "cron-token-value-123456";
    const { GET } = await import("@/app/api/cron/scheduled-logs/route");
    expect((await GET(new Request("http://x"))).status).toBe(401);
    const res = await GET(new Request("http://x", { headers: { authorization: "Bearer cron-token-value-123456" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: "Scheduling is turned off." });
  });
});

describe("getOwner with TEAMS_ENABLED", () => {
  const session = { userId: "user_1", orgId: "org_1", orgRole: "org:admin" };

  it("uses the organization when teams are on", async () => {
    auth.mockResolvedValue(session);
    const { getOwner } = await import("./owner");
    expect(await getOwner()).toEqual({ userId: "user_1", orgId: "org_1", ownerId: "org_1", orgRole: "org:admin" });
  });

  it("keeps everyone in their personal workspace when teams are off", async () => {
    process.env.TEAMS_ENABLED = "false";
    auth.mockResolvedValue(session);
    const { getOwner, isAdmin } = await import("./owner");
    const owner = await getOwner();
    expect(owner).toEqual({ userId: "user_1", orgId: null, ownerId: "user_1", orgRole: null });
    expect(isAdmin(owner)).toBe(true);
  });
});
