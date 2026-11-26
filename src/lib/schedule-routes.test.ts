import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

try {
  process.loadEnvFile(".env.local");
} catch {}

const rand = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const base = { orgId: null, orgRole: null };
const proOwner = { ...base, userId: `test_u_${rand()}`, ownerId: `test_o_${rand()}` };
const freeOwner = { ...base, userId: `test_u_${rand()}`, ownerId: `test_o_${rand()}` };
const memberOwner = { userId: `test_u_${rand()}`, orgId: `org_${rand()}`, ownerId: `org_test_${rand()}`, orgRole: "org:member" };
const adminOwner = { ...memberOwner, userId: `test_u_${rand()}`, orgRole: "org:admin" };
let current: { userId: string; orgId: string | null; ownerId: string; orgRole: string | null } = proOwner;

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

const SLACK = "https://hooks.slack.com/services/T0AAAA/B0BBBB/secretslacktoken1234";
const valid = { name: "Customer update", template: "client_report", weekdays: [5], hour: 9, timezone: "Europe/Zagreb", periodDays: 7 };

describe.skipIf(!process.env.DATABASE_URL)("schedule routes (database)", () => {
  const ids: Record<string, string> = {};
  let savedBilling: string | undefined;

  const req = (method: string, body?: unknown) =>
    new Request("http://x", { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const ctx = (id: string, scheduleId?: string) => ({ params: Promise.resolve({ id, scheduleId: scheduleId as string }) });
  const collection = () => import("@/app/api/projects/[id]/schedules/route");
  const item = () => import("@/app/api/projects/[id]/schedules/[scheduleId]/route");

  async function channelOf(projectId: string) {
    const { getDb } = await import("@/db");
    const { deliveryChannels } = await import("@/db/schema");
    const { encrypt } = await import("./crypto");
    const [row] = await getDb()
      .insert(deliveryChannels)
      .values({ projectId, kind: "slack", encryptedConfig: encrypt(JSON.stringify({ webhookUrl: SLACK })) })
      .returning();
    return row;
  }
  async function create(body: unknown, projectId = ids.project) {
    return (await collection()).POST(req("POST", body), ctx(projectId));
  }

  beforeAll(async () => {
    savedBilling = process.env.BILLING_ENABLED;
    process.env.BILLING_ENABLED = "true";
    const { getDb } = await import("@/db");
    const { billingAccounts } = await import("@/db/schema");
    const { createProject } = await import("./projects");
    const { createProjectSchema } = await import("./validation");
    const db = getDb();
    await db.insert(billingAccounts).values([
      { ownerId: proOwner.ownerId, plan: "pro", aiMode: "byok", status: "active" },
      { ownerId: memberOwner.ownerId, plan: "pro", aiMode: "byok", status: "active" },
    ]);
    const make = (owner: typeof current, name: string) =>
      createProject(owner, createProjectSchema.parse({ name }), 5).then((p) => p.id);
    ids.project = await make(proOwner, "Schedules");
    ids.other = await make(proOwner, "Other");
    ids.free = await make(freeOwner, "Free");
    ids.org = await make(adminOwner, "Org");
  });

  afterAll(async () => {
    if (savedBilling === undefined) delete process.env.BILLING_ENABLED;
    else process.env.BILLING_ENABLED = savedBilling;
    const { inArray } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const { billingAccounts, projects } = await import("@/db/schema");
    const owners = [proOwner.ownerId, freeOwner.ownerId, memberOwner.ownerId];
    await getDb().delete(projects).where(inArray(projects.ownerId, owners));
    await getDb().delete(billingAccounts).where(inArray(billingAccounts.ownerId, owners));
  });

  it("lets an admin create, list, update and delete schedules", async () => {
    current = proOwner;
    const channel = await channelOf(ids.project);
    const created = await create({ ...valid, channelIds: [channel.id] });
    expect(created.status).toBe(201);
    const { schedule } = await created.json();
    expect(schedule).toMatchObject({ name: "Customer update", weekdays: [5], enabled: true, channelIds: [channel.id], createdBy: proOwner.userId });

    const listed = await (await collection()).GET(req("GET"), ctx(ids.project));
    expect((await listed.json()).schedules.map((s: { id: string }) => s.id)).toContain(schedule.id);

    const patched = await (await item()).PATCH(req("PATCH", { name: "Renamed", hour: 10 }), ctx(ids.project, schedule.id));
    expect(patched.status).toBe(200);
    expect((await patched.json()).schedule).toMatchObject({ name: "Renamed", hour: 10, channelIds: [channel.id] });

    const removed = await (await item()).DELETE(req("DELETE"), ctx(ids.project, schedule.id));
    expect(removed.status).toBe(200);
    const after = await (await collection()).GET(req("GET"), ctx(ids.project));
    expect((await after.json()).schedules.map((s: { id: string }) => s.id)).not.toContain(schedule.id);
  });

  it("lets members view schedules but not change them", async () => {
    current = adminOwner;
    const { schedule } = await (await create(valid, ids.org)).json();

    current = memberOwner;
    expect((await (await collection()).GET(req("GET"), ctx(ids.org))).status).toBe(200);
    expect((await create(valid, ids.org)).status).toBe(403);
    expect((await (await item()).PATCH(req("PATCH", { name: "x" }), ctx(ids.org, schedule.id))).status).toBe(403);
    expect((await (await item()).DELETE(req("DELETE"), ctx(ids.org, schedule.id))).status).toBe(403);
  });

  it("requires the scheduling feature to create or enable a schedule", async () => {
    current = freeOwner;
    const denied = await create({ ...valid, enabled: true }, ids.free);
    expect(denied.status).toBe(403);
    expect((await (await collection()).GET(req("GET"), ctx(ids.free))).status).toBe(200);
    expect((await (await (await collection()).GET(req("GET"), ctx(ids.free))).json()).schedules).toHaveLength(0);

    const paused = await create({ ...valid, enabled: false }, ids.free);
    expect(paused.status).toBe(201);
    const { schedule } = await paused.json();
    expect((await (await item()).PATCH(req("PATCH", { enabled: true }), ctx(ids.free, schedule.id))).status).toBe(403);
    expect((await (await item()).PATCH(req("PATCH", { name: "Renamed" }), ctx(ids.free, schedule.id))).status).toBe(200);
  });

  it("rejects channels of another project and schedules of another project", async () => {
    current = proOwner;
    const foreign = await channelOf(ids.other);
    expect((await create({ ...valid, channelIds: [foreign.id] })).status).toBe(400);

    const { schedule } = await (await create(valid)).json();
    const patch = await (await item()).PATCH(req("PATCH", { channelIds: [foreign.id] }), ctx(ids.project, schedule.id));
    expect(patch.status).toBe(400);
    const wrongProject = await (await item()).PATCH(req("PATCH", { name: "x" }), ctx(ids.other, schedule.id));
    expect(wrongProject.status).toBe(404);
  });

  it("validates the body", async () => {
    current = proOwner;
    expect((await create({ ...valid, weekdays: [] })).status).toBe(400);
    expect((await create({ ...valid, timezone: "Mars/Base" })).status).toBe(400);
    const { schedule } = await (await create(valid)).json();
    expect((await (await item()).PATCH(req("PATCH", {}), ctx(ids.project, schedule.id))).status).toBe(400);
  });
});
