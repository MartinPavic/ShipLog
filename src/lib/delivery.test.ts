import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

try {
  process.loadEnvFile(".env.local");
} catch {}

const rand = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const base = { userId: `test_u_${rand()}`, orgId: null, orgRole: null };
const proOwner = { ...base, ownerId: `test_o_${rand()}` };
const freeOwner = { ...base, userId: `test_u_${rand()}`, ownerId: `test_o_${rand()}` };
const memberOwner = { userId: `test_u_${rand()}`, orgId: `org_${rand()}`, ownerId: `org_test_${rand()}`, orgRole: "org:member" };
let current: { userId: string; orgId: string | null; ownerId: string; orgRole: string | null } = proOwner;

vi.mock("@/lib/owner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner")>();
  const { ApiError } = await import("@/lib/api");
  return {
    ...actual,
    getOwner: async () => current,
    // The real requireAdmin calls the real getOwner internally, so it needs its own stand-in.
    requireAdmin: async () => {
      if (!actual.isAdmin(current)) throw new ApiError(403, "Only organization admins can do this");
      return current;
    },
  };
});

const SLACK = "https://hooks.slack.com/services/T0AAAA/B0BBBB/secretslacktoken1234";
const DISCORD = "https://discord.com/api/webhooks/123456789/secretdiscordtoken5678";

type Call = { url: string; body: unknown };
let calls: Call[];
let behaviour: Record<string, () => Response>;

function stubFetch() {
  calls = [];
  behaviour = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      let body: unknown = init?.body;
      try {
        body = JSON.parse(String(init?.body));
      } catch {}
      calls.push({ url, body });
      const host = new URL(url).hostname;
      if (behaviour[host]) return behaviour[host]();
      if (host === "hooks.slack.com") return new Response("ok");
      if (host === "discord.com") return new Response(null, { status: 204 });
      if (host === "api.resend.com") return new Response(JSON.stringify({ id: "em_1" }));
      throw new Error(`Unexpected request to ${url}`);
    })
  );
}

describe.skipIf(!process.env.DATABASE_URL)("delivery channels and send now (database)", () => {
  const ids: Record<string, string> = {};
  let savedEnv: Record<string, string | undefined>;

  const ctx = (id: string, channelId?: string) => ({ params: Promise.resolve({ id, channelId: channelId as string }) });
  const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

  async function channelsRoute() {
    return import("@/app/api/projects/[id]/channels/route");
  }
  async function addChannel(body: unknown, projectId = ids.project) {
    const { POST } = await channelsRoute();
    return POST(new Request("http://x", post(body)), ctx(projectId));
  }
  async function deliver(logId: string, body: unknown = {}) {
    const { POST } = await import("@/app/api/logs/[id]/deliver/route");
    return POST(new Request("http://x", post(body)), ctx(logId));
  }
  async function insertLog(projectId = ids.project, owner = proOwner, over: Record<string, unknown> = {}) {
    const { getDb } = await import("@/db");
    const { shipLogs } = await import("@/db/schema");
    const [row] = await getDb()
      .insert(shipLogs)
      .values({
        projectId,
        ownerId: owner.ownerId,
        createdBy: owner.userId,
        title: "Weekly update",
        content: "# Shipped\n\n- **Search** is live",
        periodStart: new Date("2026-10-06"),
        periodEnd: new Date("2026-10-13"),
        template: "weekly_update",
        status: "ready",
        ...over,
      })
      .returning();
    return row;
  }

  beforeAll(async () => {
    savedEnv = { RESEND_API_KEY: process.env.RESEND_API_KEY, RESEND_FROM: process.env.RESEND_FROM };
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM = "ShipLog <noreply@example.com>";

    const { getDb } = await import("@/db");
    const { billingAccounts } = await import("@/db/schema");
    const { createProject } = await import("./projects");
    const { createProjectSchema } = await import("./validation");
    await getDb().insert(billingAccounts).values({ ownerId: proOwner.ownerId, plan: "pro", status: "active" });
    ids.project = (await createProject(proOwner, createProjectSchema.parse({ name: "Delivery" }), 5)).id;
    ids.freeProject = (await createProject(freeOwner, createProjectSchema.parse({ name: "Free" }), 5)).id;
    await getDb().insert(billingAccounts).values({ ownerId: memberOwner.ownerId, plan: "pro", status: "active" });
    ids.orgProject = (await createProject(memberOwner, createProjectSchema.parse({ name: "Org" }), 5)).id;
  });

  beforeEach(() => {
    current = proOwner;
    stubFetch();
  });
  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const { inArray } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const { billingAccounts, projects, rateLimits } = await import("@/db/schema");
    const { like } = await import("drizzle-orm");
    const owners = [proOwner.ownerId, freeOwner.ownerId, memberOwner.ownerId];
    const db = getDb();
    await db.delete(projects).where(inArray(projects.ownerId, owners));
    await db.delete(billingAccounts).where(inArray(billingAccounts.ownerId, owners));
    await db.delete(rateLimits).where(like(rateLimits.key, `deliver:test_o_%`));
  });

  describe("channel management", () => {
    it("stores config encrypted and never returns the webhook URL", async () => {
      const res = await addChannel({ kind: "slack", webhookUrl: SLACK });
      expect(res.status).toBe(201);
      const { channel } = await res.json();
      ids.slack = channel.id;
      expect(channel).toMatchObject({ kind: "slack", enabled: true, hint: "hooks.slack.com/…/1234" });
      expect(JSON.stringify(channel)).not.toContain("secretslacktoken");

      const { getDb } = await import("@/db");
      const { deliveryChannels } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      const [row] = await getDb().select().from(deliveryChannels).where(eq(deliveryChannels.id, channel.id));
      expect(row.encryptedConfig).not.toContain("secretslacktoken");
      expect(row.encryptedConfig).not.toContain("hooks.slack.com");

      const { GET } = await channelsRoute();
      const list = await (await GET(new Request("http://x"), ctx(ids.project))).json();
      expect(JSON.stringify(list)).not.toContain("secretslacktoken");
      expect(list.channels.map((c: { id: string }) => c.id)).toContain(channel.id);
    });

    it("creates discord and email channels", async () => {
      const discord = await (await addChannel({ kind: "discord", webhookUrl: DISCORD })).json();
      ids.discord = discord.channel.id;
      expect(discord.channel.hint).toBe("discord.com/…/5678");

      const email = await (await addChannel({ kind: "email", recipients: ["Team@Example.com", "boss@example.com"] })).json();
      ids.email = email.channel.id;
      expect(email.channel.hint).toBe("team@example.com, boss@example.com");
    });

    it("rejects URLs outside the allow-list, including internal addresses", async () => {
      for (const body of [
        { kind: "slack", webhookUrl: "http://169.254.169.254/latest/meta-data" },
        { kind: "slack", webhookUrl: "https://evil.example.com/services/T1/B1/x" },
        { kind: "discord", webhookUrl: SLACK },
        { kind: "email", recipients: [] },
      ]) {
        const res = await addChannel(body);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: "VALIDATION" });
      }
    });

    it("requires Pro and an admin", async () => {
      current = freeOwner;
      const free = await addChannel({ kind: "slack", webhookUrl: SLACK }, ids.freeProject);
      expect(free.status).toBe(403);
      expect(await free.json()).toMatchObject({ code: "LIMIT_REACHED" });

      current = memberOwner;
      const member = await addChannel({ kind: "slack", webhookUrl: SLACK }, ids.orgProject);
      expect(member.status).toBe(403);
      // Members can still see the channel list.
      const { GET } = await channelsRoute();
      expect((await GET(new Request("http://x"), ctx(ids.orgProject))).status).toBe(200);
    });

    it("isolates tenants", async () => {
      current = freeOwner;
      const { GET } = await channelsRoute();
      expect((await GET(new Request("http://x"), ctx(ids.project))).status).toBe(404);
    });

    it("updates, disables and deletes channels", async () => {
      const { PATCH, DELETE } = await import("@/app/api/projects/[id]/channels/[channelId]/route");
      const patch = (id: string, body: unknown) => PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), ctx(ids.project, id));

      const disabled = await (await patch(ids.discord, { enabled: false })).json();
      expect(disabled.channel.enabled).toBe(false);

      const replaced = await (await patch(ids.slack, { webhookUrl: SLACK.replace("1234", "9999") })).json();
      expect(replaced.channel.hint).toBe("hooks.slack.com/…/9999");

      expect((await patch(ids.slack, { webhookUrl: "https://evil.example.com/x" })).status).toBe(400);
      expect((await patch(ids.slack, { recipients: ["a@b.co"] })).status).toBe(400);
      expect((await patch(ids.email, { webhookUrl: SLACK })).status).toBe(400);
      expect((await patch(ids.email, { recipients: ["new@example.com"] })).status).toBe(200);
      expect((await patch("not-a-uuid", { enabled: true })).status).toBe(404);

      const extra = await (await addChannel({ kind: "discord", webhookUrl: DISCORD })).json();
      const del = await DELETE(new Request("http://x", { method: "DELETE" }), ctx(ids.project, extra.channel.id));
      expect(del.status).toBe(200);
      expect((await patch(extra.channel.id, { enabled: true })).status).toBe(404);

      await patch(ids.discord, { enabled: true });
    });

    it("caps channels per project", async () => {
      const { createProject } = await import("./projects");
      const { createProjectSchema } = await import("./validation");
      const crowded = await createProject(proOwner, createProjectSchema.parse({ name: "Crowded" }), 10);
      for (let i = 0; i < 10; i++) {
        expect((await addChannel({ kind: "discord", webhookUrl: DISCORD }, crowded.id)).status).toBe(201);
      }
      const res = await addChannel({ kind: "discord", webhookUrl: DISCORD }, crowded.id);
      expect(res.status).toBe(400);
    });
  });

  describe("sending", () => {
    it("rejects email channels when email isn't configured", async () => {
      delete process.env.RESEND_API_KEY;
      const res = await addChannel({ kind: "email", recipients: ["a@b.co"] });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "EMAIL_NOT_CONFIGURED" });
      process.env.RESEND_API_KEY = "re_test_key";
    });

    it("delivers to every enabled channel in each channel's format and records the results", async () => {
      const log = await insertLog();
      const res = await deliver(log.id);
      expect(res.status).toBe(200);
      const { results } = await res.json();
      expect(results.map((r: { kind: string; status: string }) => `${r.kind}:${r.status}`).sort()).toEqual([
        "discord:sent",
        "email:sent",
        "slack:sent",
      ]);

      const slack = calls.find((c) => c.url.includes("hooks.slack.com"))!.body as { text: string };
      expect(slack.text).toBe("*Weekly update*\n\n*Shipped*\n\n• *Search* is live");

      const discord = calls.find((c) => c.url.includes("discord.com"))!.body as { embeds: { title: string; description: string }[] };
      expect(discord.embeds[0].title).toBe("Weekly update");
      expect(discord.embeds[0].description).toContain("**Search**");

      const email = calls.find((c) => c.url.includes("api.resend.com"))!.body as {
        from: string;
        to: string[];
        subject: string;
        html: string;
        text: string;
      };
      expect(email).toMatchObject({ from: "ShipLog <noreply@example.com>", to: ["new@example.com"], subject: "Weekly update" });
      expect(email.html).toContain("<strong>Search</strong>");
      expect(email.text).toContain("# Shipped");

      const { listDeliveries } = await import("./delivery");
      const history = await listDeliveries(log.id);
      expect(history).toHaveLength(3);
      expect(history.every((h) => h.status === "sent" && h.error === null)).toBe(true);
    });

    it("sends only the selected channels and ignores foreign or disabled ones", async () => {
      const log = await insertLog();
      const res = await deliver(log.id, { channelIds: [ids.slack, "11111111-1111-4111-8111-111111111111"] });
      const { results } = await res.json();
      expect(results).toHaveLength(1);
      expect(results[0].kind).toBe("slack");
      expect(calls.filter((c) => c.url.includes("discord.com"))).toHaveLength(0);
    });

    it("records failures with friendly messages while other channels still succeed", async () => {
      behaviour["hooks.slack.com"] = () => new Response("no_service", { status: 404 });
      behaviour["discord.com"] = () => new Response(null, { status: 429 });
      const log = await insertLog();
      const { results } = await (await deliver(log.id)).json();
      const by = Object.fromEntries(results.map((r: { kind: string }) => [r.kind, r]));

      expect(by.slack).toMatchObject({ status: "failed" });
      expect(by.slack.error).toContain("no longer knows this webhook");
      expect(by.discord.error).toContain("rate limiting");
      expect(by.email.status).toBe("sent");

      const { listDeliveries } = await import("./delivery");
      expect((await listDeliveries(log.id)).filter((h) => h.status === "failed")).toHaveLength(2);
    });

    it("treats redirects and network errors as failures", async () => {
      behaviour["hooks.slack.com"] = () => {
        throw new TypeError("fetch failed");
      };
      const log = await insertLog();
      const { results } = await (await deliver(log.id, { channelIds: [ids.slack] })).json();
      expect(results[0]).toMatchObject({ status: "failed", error: "Could not reach Slack." });

      const init = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1];
      expect(init.redirect).toBe("error");
    });

    it("reports email provider errors", async () => {
      behaviour["api.resend.com"] = () =>
        new Response(JSON.stringify({ name: "validation_error", message: "domain not verified", statusCode: 403 }), { status: 403 });
      const log = await insertLog();
      const { results } = await (await deliver(log.id, { channelIds: [ids.email] })).json();
      expect(results[0].status).toBe("failed");
      expect(results[0].error).toContain("domain not verified");
    });

    it("truncates long messages to the platform limits", async () => {
      const log = await insertLog(ids.project, proOwner, { content: "word ".repeat(5000) });
      await deliver(log.id, { channelIds: [ids.discord, ids.slack] });
      const discord = calls.find((c) => c.url.includes("discord.com"))!.body as { embeds: { description: string }[] };
      expect(discord.embeds[0].description.length).toBeLessThanOrEqual(4000);
      expect(discord.embeds[0].description.endsWith("…")).toBe(true);
    });

    it("refuses unfinished logs, Free plans and other tenants, and needs a channel", async () => {
      const generating = await insertLog(ids.project, proOwner, { status: "generating" });
      expect((await deliver(generating.id)).status).toBe(400);

      const log = await insertLog();
      current = freeOwner;
      expect((await deliver(log.id)).status).toBe(404);

      const freeLog = await insertLog(ids.freeProject, freeOwner);
      const free = await deliver(freeLog.id);
      expect(free.status).toBe(403);
      expect(await free.json()).toMatchObject({ code: "LIMIT_REACHED" });

      current = proOwner;
      const { createProject } = await import("./projects");
      const { createProjectSchema } = await import("./validation");
      const empty = await createProject(proOwner, createProjectSchema.parse({ name: "No channels" }), 10);
      const noChannels = await deliver((await insertLog(empty.id)).id);
      expect(noChannels.status).toBe(400);
      expect(await noChannels.json()).toMatchObject({ code: "NO_CHANNELS" });
    });

    it("sends a test message and maps webhook failures", async () => {
      const { POST } = await import("@/app/api/projects/[id]/channels/[channelId]/test/route");
      const test = (id: string) => POST(new Request("http://x", { method: "POST" }), ctx(ids.project, id));

      expect((await test(ids.slack)).status).toBe(200);
      expect((calls.at(-1)!.body as { text: string }).text).toContain("ShipLog test message");

      behaviour["hooks.slack.com"] = () => new Response("", { status: 404 });
      const failed = await test(ids.slack);
      expect(failed.status).toBe(502);
      expect(await failed.json()).toMatchObject({ code: "DELIVERY_FAILED" });
    });
  });
});
