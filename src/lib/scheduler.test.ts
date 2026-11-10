import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

try {
  process.loadEnvFile(".env.local");
} catch {}

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    users: { getUser: async () => ({ primaryEmailAddress: { emailAddress: "creator@example.com" }, emailAddresses: [] }) },
  }),
  auth: async () => ({}),
  currentUser: async () => null,
}));

const gitlabMocks = vi.hoisted(() => ({ fetchActivity: vi.fn() }));
vi.mock("@/lib/gitlab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gitlab")>()),
  fetchGitLabActivity: gitlabMocks.fetchActivity,
}));

const rand = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const SLACK = "https://hooks.slack.com/services/T0AAAA/B0BBBB/secretslacktoken1234";

// Wednesday 10:30 UTC; the schedule fires on Wednesdays from 09:00 UTC.
const WEDNESDAY = new Date("2026-10-14T10:30:00Z");
const TUESDAY = new Date("2026-10-13T10:30:00Z");
const SLOT = "2026-10-14";
const schedule = { enabled: true, dayOfWeek: 3, hour: 9, timezone: "UTC", periodDays: 7, autoDeliver: true };

type Fx = { ownerId: string; userId: string; projectId: string; aiMode: "byok" | "managed" };
let calls: { url: string; body: unknown }[];
let activity: unknown[];
let ai: () => Response;
let slack: () => Response;
let savedEnv: Record<string, string | undefined>;

function stubFetch() {
  calls = [];
  gitlabMocks.fetchActivity.mockReset();
  activity = [
    {
      sha: "abcdef1234567",
      html_url: "u",
      parents: [{}],
      author: { login: "dev", type: "User" },
      commit: { message: "Add search", author: { name: "d", date: new Date().toISOString() } },
    },
  ];
  ai = () => new Response(JSON.stringify({ choices: [{ message: { content: "Weekly summary text" } }] }));
  slack = () => new Response("ok");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      let body: unknown = init?.body;
      try {
        body = JSON.parse(String(init?.body));
      } catch {}
      calls.push({ url, body });
      const u = new URL(url);
      if (u.hostname === "api.github.com") return new Response(JSON.stringify(u.pathname.endsWith("/commits") ? activity : []));
      if (u.hostname === "api.openai.com") return ai();
      if (u.hostname === "hooks.slack.com") return slack();
      if (u.hostname === "api.resend.com") return new Response(JSON.stringify({ id: "em_1" }));
      throw new Error(`Unexpected request to ${url}`);
    })
  );
}

describe.skipIf(!process.env.DATABASE_URL)("scheduled logs (database)", () => {
  const fixtures: Fx[] = [];

  async function setup(opts: {
    plan?: "free" | "pro" | "ultra";
    aiMode?: "byok" | "managed";
    github?: boolean;
    gitlab?: boolean;
    provider?: "github" | "gitlab";
    ai?: boolean;
    channel?: boolean;
    schedule?: object;
  } = {}): Promise<Fx> {
    const {
      plan = "pro",
      aiMode = "managed",
      github = true,
      gitlab = false,
      provider = "github",
      ai: withAi = true,
      channel = true,
    } = opts;
    const { getDb } = await import("@/db");
    const { aiCredentials, billingAccounts, deliveryChannels } = await import("@/db/schema");
    const { encrypt } = await import("./crypto");
    const { saveGithubConnection } = await import("./github");
    const { configureGitLabInstance, saveGitLabConnection } = await import("./gitlab-settings");
    const { createProject } = await import("./projects");
    const { createProjectSchema } = await import("./validation");
    const db = getDb();

    const fx = { ownerId: `test_o_${rand()}`, userId: `test_u_${rand()}`, projectId: "", aiMode };
    const owner = { userId: fx.userId, orgId: null, ownerId: fx.ownerId, orgRole: null };
    if (plan !== "free") await db.insert(billingAccounts).values({ ownerId: fx.ownerId, plan, aiMode, status: "active" });
    if (github) await saveGithubConnection(fx.userId, { login: "dev", token: "gh_token", scopes: "repo" });
    if (gitlab) {
      await configureGitLabInstance(fx.ownerId, {
        baseUrl: "https://gitlab.example.com",
        clientId: "gitlab-client",
        clientSecret: "gitlab-client-secret",
      });
      await saveGitLabConnection(fx.ownerId, fx.userId, {
        username: "creator", accessToken: "creator-gitlab-token", refreshToken: "creator-refresh",
        expiresAt: new Date(Date.now() + 60 * 60_000), scopes: "read_api read_user",
      });
    }
    if (withAi) {
      await db.insert(aiCredentials).values({ ownerId: fx.ownerId, provider: "openai", encryptedKey: encrypt("sk-test"), last4: "test" });
    }
    const repos = provider === "gitlab" ? [{ provider: "gitlab", fullName: "group/project" }] : [{ fullName: "o/r" }];
    const project = await createProject(owner, createProjectSchema.parse({ name: "Scheduled", repos }), 5);
    fx.projectId = project.id;
    const { projects } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db
      .update(projects)
      .set({ schedule: { ...schedule, ...opts.schedule } })
      .where(eq(projects.id, project.id));
    if (channel) {
      await db.insert(deliveryChannels).values({
        projectId: project.id,
        kind: "slack",
        encryptedConfig: encrypt(JSON.stringify({ webhookUrl: SLACK })),
      });
    }
    fixtures.push(fx);
    return fx;
  }

  async function run(fx: Fx, now = WEDNESDAY) {
    const { runScheduled } = await import("./scheduler");
    return runScheduled(now, { only: [fx.projectId] });
  }
  async function logsOf(fx: Fx) {
    const { getDb } = await import("@/db");
    const { shipLogs } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    return getDb().select().from(shipLogs).where(eq(shipLogs.projectId, fx.projectId));
  }
  async function runRow(fx: Fx) {
    const { getDb } = await import("@/db");
    const { scheduledRuns } = await import("@/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const [row] = await getDb().select().from(scheduledRuns).where(and(eq(scheduledRuns.projectId, fx.projectId), eq(scheduledRuns.slot, SLOT)));
    return row;
  }
  async function usage(fx: Fx) {
    const usage = await (await import("./usage")).getUsage(fx.ownerId);
    return usage[fx.aiMode];
  }
  const emails = () => calls.filter((c) => c.url.includes("api.resend.com"));

  beforeAll(() => {
    savedEnv = {
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      RESEND_FROM: process.env.RESEND_FROM,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      AI_PROVIDER: process.env.AI_PROVIDER,
    };
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM = "ShipLog <noreply@example.com>";
    process.env.OPENAI_API_KEY = "sk-test-server";
    process.env.AI_PROVIDER = "live";
  });
  beforeEach(stubFetch);
  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const { inArray } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const { aiCredentials, billingAccounts, githubConnections, gitlabConnections, gitlabInstances, projects, usageCounters } = await import("@/db/schema");
    const owners = fixtures.map((f) => f.ownerId);
    const db = getDb();
    await db.delete(projects).where(inArray(projects.ownerId, owners));
    await db.delete(usageCounters).where(inArray(usageCounters.ownerId, owners));
    await db.delete(aiCredentials).where(inArray(aiCredentials.ownerId, owners));
    await db.delete(billingAccounts).where(inArray(billingAccounts.ownerId, owners));
    await db.delete(githubConnections).where(inArray(githubConnections.userId, fixtures.map((f) => f.userId)));
    await db.delete(gitlabConnections).where(inArray(gitlabConnections.ownerId, owners));
    await db.delete(gitlabInstances).where(inArray(gitlabInstances.ownerId, owners));
  });

  it("generates with the creator's connection, delivers, and records the run", async () => {
    const fx = await setup();
    const summary = await run(fx);
    expect(summary).toMatchObject({ checked: 1, due: 1, generated: 1, skipped: 0, failed: 0 });

    const [log] = await logsOf(fx);
    expect(log).toMatchObject({ status: "ready", content: "Weekly summary text", createdBy: fx.userId });
    expect((await runRow(fx))).toMatchObject({ status: "done", attempts: 1, logId: log.id, error: null });
    expect(await usage(fx)).toBe(1);

    const github = calls.filter((c) => c.url.includes("api.github.com"));
    expect(github.length).toBeGreaterThan(0);
    const posted = calls.find((c) => c.url.includes("hooks.slack.com"))!.body as { text: string };
    expect(posted.text).toContain("Weekly summary text");

    const { listDeliveries } = await import("./delivery");
    expect(await listDeliveries(log.id)).toMatchObject([{ kind: "slack", status: "sent" }]);
  });

  it("uses the scheduled project's creator's GitLab connection", async () => {
    const fx = await setup({ github: false, gitlab: true, provider: "gitlab" });
    gitlabMocks.fetchActivity.mockImplementation(async (
      connection: { baseUrl: string; accessToken: string },
      repos: { provider?: "github" | "gitlab"; fullName: string; branch?: string }[],
      since: Date,
      until: Date
    ) => ({
      since: since.toISOString(),
      until: until.toISOString(),
      repos: repos.map((repo) => ({
        repo: repo.fullName,
        commits: [{ sha: "gitlab1", message: "GitLab release", author: "creator", date: since.toISOString(), url: "https://gitlab.example.com/group/project/-/commit/gitlab1" }],
        pullRequests: [], issues: [], releases: [],
        omitted: { commits: 0, pullRequests: 0, issues: 0, releases: 0 },
      })),
    }));
    const summary = await run(fx);
    expect(summary.generated).toBe(1);
    expect(gitlabMocks.fetchActivity).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "creator-gitlab-token" }),
      [{ provider: "gitlab", fullName: "group/project" }],
      expect.any(Date),
      expect.any(Date)
    );
    const [log] = await logsOf(fx);
    expect((log.sourceSnapshot as { repos: { repo: string }[] }).repos[0].repo).toBe("group/project");
  });

  it("is idempotent for a slot, even with parallel ticks", async () => {
    const fx = await setup();
    const results = await Promise.all([run(fx), run(fx), run(fx)]);
    expect(results.reduce((n, r) => n + r.generated, 0)).toBe(1);
    expect(await logsOf(fx)).toHaveLength(1);
    expect(await usage(fx)).toBe(1);

    const again = await run(fx);
    expect(again).toMatchObject({ due: 1, generated: 0 });
    expect(await logsOf(fx)).toHaveLength(1);
  });

  it("does nothing outside the scheduled weekday, hour or when disabled", async () => {
    const fx = await setup();
    expect(await run(fx, TUESDAY)).toMatchObject({ checked: 1, due: 0 });
    expect(await run(fx, new Date("2026-10-14T08:00:00Z"))).toMatchObject({ due: 0 });

    const off = await setup({ schedule: { enabled: false } });
    expect(await run(off)).toMatchObject({ checked: 0, due: 0 });
    expect(await logsOf(off)).toHaveLength(0);
  });

  it("skips downgraded accounts without generating", async () => {
    const fx = await setup({ plan: "free" });
    expect(await run(fx)).toMatchObject({ generated: 0, skipped: 1 });
    expect(await runRow(fx)).toMatchObject({ status: "skipped", error: "Scheduled logs require the Pro plan." });
    expect(await logsOf(fx)).toHaveLength(0);
    expect(calls.filter((c) => c.url.includes("api.openai.com"))).toHaveLength(0);
  });

  it("skips and notifies when the GitHub connection is missing", async () => {
    const fx = await setup({ github: false });
    expect(await run(fx)).toMatchObject({ skipped: 1, generated: 0 });
    expect(await runRow(fx)).toMatchObject({ status: "skipped" });
    expect((await runRow(fx)).error).toContain("Connect GitHub");
    expect(await usage(fx)).toBe(0);

    expect(emails()).toHaveLength(1);
    const mail = emails()[0].body as { to: string[]; subject: string; text: string };
    expect(mail.to).toEqual(["creator@example.com"]);
    expect(mail.subject).toContain("Scheduled");
    expect(mail.text).toContain(`/dashboard/projects/${fx.projectId}?tab=settings`);
  });

  it("skips and notifies when no AI key is available", async () => {
    const noKey = await setup({ ai: false, aiMode: "byok" });
    expect(await run(noKey)).toMatchObject({ skipped: 1 });
    expect((await runRow(noKey)).error).toContain("API key");
    expect(emails()).toHaveLength(1);
  });

  it("skips and notifies when the managed AI usage limit is reached", async () => {
    const saved = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-managed-test";
    try {
      const fx = await setup({ ai: false, plan: "ultra", aiMode: "managed" });
      const { getDb } = await import("@/db");
      const { usageCounters } = await import("@/db/schema");
      const { currentPeriod } = await import("./usage");
      await getDb().insert(usageCounters).values({ ownerId: fx.ownerId, period: currentPeriod(), kind: "managed", count: 200 });

      expect(await run(fx)).toMatchObject({ skipped: 1, generated: 0 });
      expect((await runRow(fx)).error).toContain("limit");
      expect(emails()).toHaveLength(1);
      expect(calls.filter((c) => c.url.includes("api.openai.com"))).toHaveLength(0);
    } finally {
      if (saved === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = saved;
    }
  });

  it("stays quiet when there was simply no activity", async () => {
    const fx = await setup();
    activity = [];
    expect(await run(fx)).toMatchObject({ skipped: 1, generated: 0 });
    expect((await runRow(fx)).error).toContain("No activity");
    expect(emails()).toHaveLength(0);
    expect(await usage(fx)).toBe(0);
  });

  it("notifies about a rejected AI key and refunds the usage", async () => {
    const fx = await setup();
    ai = () => new Response("nope", { status: 401 });
    expect(await run(fx)).toMatchObject({ skipped: 1 });
    expect((await runRow(fx)).error).toContain("rejected your API key");
    expect(emails()).toHaveLength(1);
    expect(await usage(fx)).toBe(0);
    expect(await logsOf(fx)).toHaveLength(0);
  });

  it("retries transient failures up to three attempts, then gives up", async () => {
    const fx = await setup();
    ai = () => new Response("down", { status: 503 });

    expect(await run(fx)).toMatchObject({ retry: 1, generated: 0 });
    expect(await runRow(fx)).toMatchObject({ status: "retry", attempts: 1 });
    expect(await usage(fx)).toBe(0);

    expect(await run(fx)).toMatchObject({ retry: 1 });
    expect(await runRow(fx)).toMatchObject({ status: "retry", attempts: 2 });

    expect(await run(fx)).toMatchObject({ failed: 1, retry: 0 });
    expect(await runRow(fx)).toMatchObject({ status: "failed", attempts: 3 });

    const aiCalls = calls.filter((c) => c.url.includes("api.openai.com")).length;
    expect(await run(fx)).toMatchObject({ generated: 0, failed: 0 });
    expect(calls.filter((c) => c.url.includes("api.openai.com")).length).toBe(aiCalls);
  });

  it("succeeds on a retry after a transient failure", async () => {
    const fx = await setup();
    ai = () => new Response("down", { status: 503 });
    await run(fx);
    ai = () => new Response(JSON.stringify({ choices: [{ message: { content: "Recovered" } }] }));
    expect(await run(fx)).toMatchObject({ generated: 1 });
    expect(await runRow(fx)).toMatchObject({ status: "done", attempts: 2 });
    expect((await logsOf(fx))[0].content).toBe("Recovered");
  });

  it("retries a transient failure on the next daily cron tick", async () => {
    const fx = await setup();
    ai = () => new Response("down", { status: 503 });
    expect(await run(fx, WEDNESDAY)).toMatchObject({ retry: 1 });
    expect(await runRow(fx)).toMatchObject({ status: "retry", attempts: 1 });

    ai = () => new Response(JSON.stringify({ choices: [{ message: { content: "Recovered next day" } }] }));
    const nextDay = await run(fx, new Date("2026-10-15T10:30:00Z"));

    expect(nextDay).toMatchObject({ due: 1, generated: 1, retry: 0 });
    expect(await runRow(fx)).toMatchObject({ status: "done", attempts: 2 });
  });

  it("reclaims a run that crashed while running, but not a fresh one", async () => {
    const fx = await setup();
    const { getDb } = await import("@/db");
    const { scheduledRuns } = await import("@/db/schema");
    const db = getDb();

    await db.insert(scheduledRuns).values({ projectId: fx.projectId, slot: SLOT, status: "running", updatedAt: new Date(WEDNESDAY.getTime() - 5 * 60 * 1000) });
    expect(await run(fx)).toMatchObject({ due: 1, generated: 0 });

    const { eq, and } = await import("drizzle-orm");
    await db
      .update(scheduledRuns)
      .set({ updatedAt: new Date(WEDNESDAY.getTime() - 45 * 60 * 1000) })
      .where(and(eq(scheduledRuns.projectId, fx.projectId), eq(scheduledRuns.slot, SLOT)));
    expect(await run(fx)).toMatchObject({ generated: 1 });
    expect(await runRow(fx)).toMatchObject({ status: "done", attempts: 2 });
  });

  it("reuses the log and does not resend a scheduled message after a crash", async () => {
    const fx = await setup();
    const { getDb } = await import("@/db");
    const { deliveries, deliveryChannels, scheduledRuns, shipLogs } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const [log] = await getDb().insert(shipLogs).values({
      projectId: fx.projectId,
      ownerId: fx.ownerId,
      createdBy: fx.userId,
      title: "Already generated",
      content: "Existing report",
      periodStart: new Date("2026-10-07"),
      periodEnd: new Date("2026-10-14"),
      template: "weekly_update",
      status: "ready",
      scheduleKey: `${fx.projectId}:${SLOT}`,
    }).returning();
    const [channel] = await getDb().select().from(deliveryChannels).where(eq(deliveryChannels.projectId, fx.projectId));
    const scheduleKey = `${fx.projectId}:${SLOT}`;
    await getDb().insert(scheduledRuns).values({
      projectId: fx.projectId,
      slot: SLOT,
      status: "running",
      attempts: 1,
      updatedAt: new Date(WEDNESDAY.getTime() - 60 * 60 * 1000),
    });
    await getDb().insert(deliveries).values({ logId: log.id, channelId: channel.id, status: "sending", scheduleKey });
    const aiBefore = calls.filter((call) => call.url.includes("api.openai.com")).length;
    const slackBefore = calls.filter((call) => call.url.includes("hooks.slack.com")).length;

    const summary = await run(fx, WEDNESDAY);

    expect(summary).toMatchObject({ generated: 1, failed: 0 });
    expect((await logsOf(fx)).map((item) => item.id)).toEqual([log.id]);
    expect(calls.filter((call) => call.url.includes("api.openai.com"))).toHaveLength(aiBefore);
    expect(calls.filter((call) => call.url.includes("hooks.slack.com"))).toHaveLength(slackBefore);
    expect(await runRow(fx)).toMatchObject({ status: "done", logId: log.id });
    expect((await getDb().select().from(deliveries).where(eq(deliveries.logId, log.id)))[0].status).toBe("unknown");
  });

  it("only delivers when autoDeliver is on, and a failing webhook doesn't fail the run", async () => {
    const quiet = await setup({ schedule: { autoDeliver: false } });
    expect(await run(quiet)).toMatchObject({ generated: 1 });
    expect(calls.filter((c) => c.url.includes("hooks.slack.com"))).toHaveLength(0);

    const failing = await setup();
    slack = () => new Response("gone", { status: 404 });
    expect(await run(failing)).toMatchObject({ generated: 1 });
    expect(await runRow(failing)).toMatchObject({ status: "done", error: "1 of 1 deliveries failed." });

    const noChannels = await setup({ channel: false });
    expect(await run(noChannels)).toMatchObject({ generated: 1 });
    expect((await runRow(noChannels)).error).toContain("No enabled delivery channels");
  });

  it("uses the schedule's period length", async () => {
    const fx = await setup({ schedule: { periodDays: 14 } });
    await run(fx);
    const [log] = await logsOf(fx);
    const days = (log.periodEnd.getTime() - log.periodStart.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(14);
  });

  it("works across timezones", async () => {
    // Wednesday 09:00 in Tokyo is Wednesday 00:00 UTC.
    const fx = await setup({ schedule: { timezone: "Asia/Tokyo" } });
    expect(await run(fx, new Date("2026-10-13T23:30:00Z"))).toMatchObject({ due: 0 }); // 08:30 JST
    expect(await run(fx, new Date("2026-10-14T00:30:00Z"))).toMatchObject({ due: 1, generated: 1 });
  });
});
