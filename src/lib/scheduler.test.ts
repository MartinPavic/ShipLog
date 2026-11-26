import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleInput } from "./validation";

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
const TEAMS_HOST = "prod-12.westus.logic.azure.com";
const TEAMS = `https://${TEAMS_HOST}:443/workflows/test-workflow/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=SECRETTEAMSSIG_abc-123`;

// Wednesday 10:30 UTC; the schedule fires on Wednesdays from 09:00 UTC.
const WEDNESDAY = new Date("2026-10-14T10:30:00Z");
const TUESDAY = new Date("2026-10-13T10:30:00Z");
const SLOT = "2026-10-14";
const schedule = { name: "Weekly", template: "weekly_update", enabled: true, weekdays: [3], hour: 9, timezone: "UTC", periodDays: 7 };

type Fx = { ownerId: string; userId: string; projectId: string; scheduleId: string; aiMode: "byok" | "managed" };
let calls: { url: string; body: unknown; auth: string | null }[];
let activity: unknown[];
let ai: () => Response;
let slack: () => Response;
let teams: () => Response;
let sentry: (url: URL) => Response;
let savedEnv: Record<string, string | undefined>;

const SENTRY_TOKEN = "sntryu_" + "0123abcd".repeat(8);
const sentryOk = (url: URL) =>
  new Response(
    JSON.stringify(
      url.pathname.endsWith("/projects/")
        ? [{ id: "11", slug: "web", name: "Web" }]
        : url.pathname.endsWith("/events/")
        ? [{ id: "e1" }]
        : [{ id: "100", title: "Checkout crash", level: "error", status: "unresolved", project: { id: "11" }, lastSeen: new Date().toISOString() }]
    )
  );

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
  teams = () => new Response(null, { status: 202 });
  sentry = sentryOk;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      let body: unknown = init?.body;
      try {
        body = JSON.parse(String(init?.body));
      } catch {}
      calls.push({ url, body, auth: new Headers(init?.headers).get("authorization") });
      const u = new URL(url);
      if (u.hostname === "sentry.io") return sentry(u);
      if (u.hostname === "api.github.com") return new Response(JSON.stringify(u.pathname.endsWith("/commits") ? activity : []));
      if (u.hostname === "api.openai.com") return ai();
      if (u.hostname === "hooks.slack.com") return slack();
      if (u.hostname === TEAMS_HOST) return teams();
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
    channelKind?: "slack" | "teams";
    selectChannel?: boolean;
    schedule?: object;
    sentry?: boolean;
  } = {}): Promise<Fx> {
    const {
      plan = "pro",
      aiMode = "managed",
      github = true,
      gitlab = false,
      provider = "github",
      ai: withAi = true,
      channel = true,
      channelKind = "slack",
    } = opts;
    const { getDb } = await import("@/db");
    const { aiCredentials, billingAccounts, deliveryChannels } = await import("@/db/schema");
    const { encrypt } = await import("./crypto");
    const { saveGithubConnection } = await import("./github");
    const { configureGitLabInstance, saveGitLabConnection } = await import("./gitlab-settings");
    const { createProject } = await import("./projects");
    const { createProjectSchema } = await import("./validation");
    const db = getDb();

    const fx = { ownerId: `test_o_${rand()}`, userId: `test_u_${rand()}`, projectId: "", scheduleId: "", aiMode };
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
    const project = await createProject(
      owner,
      createProjectSchema.parse({
        name: "Scheduled",
        repos,
        ...(opts.sentry ? { sentryProjects: [{ id: "11", slug: "web", name: "Web" }] } : {}),
      }),
      5
    );
    if (opts.sentry) {
      const { sentryConnections } = await import("@/db/schema");
      await db.insert(sentryConnections).values({ ownerId: fx.ownerId, organizationSlug: "acme", encryptedToken: encrypt(SENTRY_TOKEN) });
    }
    fx.projectId = project.id;
    let channelIds: string[] = [];
    if (channel) {
      const [row] = await db
        .insert(deliveryChannels)
        .values({
          projectId: project.id,
          kind: channelKind,
          encryptedConfig: encrypt(JSON.stringify({ webhookUrl: channelKind === "teams" ? TEAMS : SLACK })),
        })
        .returning({ id: deliveryChannels.id });
      if (opts.selectChannel !== false) channelIds = [row.id];
    }
    const { createSchedule } = await import("./schedules");
    const created = await createSchedule(owner, project.id, { ...schedule, ...opts.schedule, channelIds } as ScheduleInput);
    fx.scheduleId = created.id;
    fixtures.push(fx);
    return fx;
  }

  async function run(fx: Fx, now = WEDNESDAY) {
    const { runScheduled } = await import("./scheduler");
    return runScheduled(now, { only: [fx.scheduleId] });
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
    const [row] = await getDb().select().from(scheduledRuns).where(and(eq(scheduledRuns.scheduleId, fx.scheduleId), eq(scheduledRuns.slot, SLOT)));
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
    const { aiCredentials, billingAccounts, githubConnections, gitlabConnections, gitlabInstances, projects, sentryConnections, usageCounters } = await import("@/db/schema");
    const owners = fixtures.map((f) => f.ownerId);
    const db = getDb();
    await db.delete(sentryConnections).where(inArray(sentryConnections.ownerId, owners));
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

  it("adds selected Sentry issues using the workspace Sentry connection", async () => {
    const fx = await setup({ sentry: true });
    expect(await run(fx)).toMatchObject({ generated: 1, failed: 0 });

    const sentryCalls = calls.filter((c) => new URL(c.url).hostname === "sentry.io");
    expect(sentryCalls.length).toBeGreaterThan(0);
    expect(new Set(sentryCalls.map((c) => c.auth))).toEqual(new Set([`Bearer ${SENTRY_TOKEN}`]));
    expect(sentryCalls.every((c) => new URL(c.url).pathname.startsWith("/api/0/organizations/acme/"))).toBe(true);

    const [log] = await logsOf(fx);
    const snapshot = log.sourceSnapshot as { repos: { repo: string }[]; sentry: { issues: { id: string; title: string }[] } };
    expect(snapshot.repos[0].repo).toBe("o/r");
    expect(snapshot.sentry.issues).toMatchObject([{ id: "100", title: "Checkout crash" }]);
    const aiCall = calls.find((c) => c.url.includes("api.openai.com"))!;
    expect(JSON.stringify(aiCall.body)).toContain("Checkout crash");
  });

  it("makes no Sentry requests for a scheduled project without selected Sentry projects", async () => {
    const fx = await setup();
    expect(await run(fx)).toMatchObject({ generated: 1 });
    expect(calls.filter((c) => new URL(c.url).hostname === "sentry.io")).toHaveLength(0);
    expect("sentry" in ((await logsOf(fx))[0].sourceSnapshot as object)).toBe(false);
  });

  it("skips and notifies when the Sentry token is rejected, without charging usage", async () => {
    const fx = await setup({ sentry: true });
    sentry = () => new Response("no", { status: 401 });
    expect(await run(fx)).toMatchObject({ skipped: 1, generated: 0 });
    expect((await runRow(fx)).error).toContain("Sentry rejected the token");
    expect(emails()).toHaveLength(1);
    expect(await usage(fx)).toBe(0);
    expect(await logsOf(fx)).toHaveLength(0);
    expect(calls.filter((c) => c.url.includes("api.openai.com"))).toHaveLength(0);
  });

  it("skips and notifies when Sentry redirects the request, without charging usage", async () => {
    const fx = await setup({ sentry: true });
    sentry = () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } });
    expect(await run(fx)).toMatchObject({ skipped: 1, retry: 0, generated: 0 });
    expect(await runRow(fx)).toMatchObject({ status: "skipped" });
    expect((await runRow(fx)).error).toContain("Sentry redirected the request");
    expect((await runRow(fx)).error).toContain("organization slug");
    expect((await runRow(fx)).error).toContain("Reconnect Sentry in Settings");
    expect(emails()).toHaveLength(1);
    expect(await usage(fx)).toBe(0);
    expect(await logsOf(fx)).toHaveLength(0);
  });

  it("skips and notifies when Sentry project listing exceeds the page limit, without charging usage", async () => {
    const fx = await setup({ sentry: true });
    let page = 0;
    sentry = (url) => {
      if (!url.pathname.endsWith("/projects/")) return sentryOk(url);
      page += 1;
      return new Response(JSON.stringify([{ id: String(page), slug: `proj-${page}`, name: `Project ${page}` }]), {
        headers: {
          link: `<https://sentry.io/api/0/organizations/acme/projects/?cursor=0:${page * 100}:0>; rel=\"next\"; results=\"true\"; cursor=\"0:${page * 100}:0\"`,
        },
      });
    };

    expect(await run(fx)).toMatchObject({ skipped: 1, retry: 0, generated: 0, failed: 0 });
    expect(await runRow(fx)).toMatchObject({ status: "skipped" });
    expect((await runRow(fx)).error).toContain("above 1,000 projects are not supported yet");
    expect(emails()).toHaveLength(1);
    expect(await usage(fx)).toBe(0);
    expect(await logsOf(fx)).toHaveLength(0);
    expect(calls.filter((c) => c.url.includes("api.openai.com"))).toHaveLength(0);
  });

  it("skips and notifies when a selected Sentry project is no longer accessible, without charging usage", async () => {
    const fx = await setup({ sentry: true });
    sentry = (url) => {
      if (url.pathname.endsWith("/projects/")) {
        return new Response(JSON.stringify([{ id: "22", slug: "api", name: "API" }]));
      }
      return sentryOk(url);
    };
    expect(await run(fx)).toMatchObject({ skipped: 1, generated: 0, retry: 0, failed: 0 });
    expect(await runRow(fx)).toMatchObject({ status: "skipped" });
    expect((await runRow(fx)).error).toContain("Selected Sentry project");
    expect((await runRow(fx)).error).toContain("is not accessible");
    expect(emails()).toHaveLength(1);
    expect(await usage(fx)).toBe(0);
    expect(await logsOf(fx)).toHaveLength(0);
    expect(calls.filter((c) => c.url.includes("api.openai.com"))).toHaveLength(0);
  });

  it("retries when Sentry is temporarily unavailable", async () => {
    const fx = await setup({ sentry: true });
    sentry = () => new Response("down", { status: 503 });
    expect(await run(fx)).toMatchObject({ retry: 1, generated: 0 });
    expect(await runRow(fx)).toMatchObject({ status: "retry", attempts: 1 });
    expect(emails()).toHaveLength(0);
    expect(await logsOf(fx)).toHaveLength(0);
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
    expect(mail.subject).toContain("Weekly");
    expect(mail.text).toContain(`/dashboard/projects/${fx.projectId}?tab=schedules`);
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

    await db.insert(scheduledRuns).values({ scheduleId: fx.scheduleId, slot: SLOT, status: "running", updatedAt: new Date(WEDNESDAY.getTime() - 5 * 60 * 1000) });
    expect(await run(fx)).toMatchObject({ due: 1, generated: 0 });

    const { eq, and } = await import("drizzle-orm");
    await db
      .update(scheduledRuns)
      .set({ updatedAt: new Date(WEDNESDAY.getTime() - 45 * 60 * 1000) })
      .where(and(eq(scheduledRuns.scheduleId, fx.scheduleId), eq(scheduledRuns.slot, SLOT)));
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
      scheduleKey: `${fx.scheduleId}:${SLOT}`,
    }).returning();
    const [channel] = await getDb().select().from(deliveryChannels).where(eq(deliveryChannels.projectId, fx.projectId));
    const scheduleKey = `${fx.scheduleId}:${SLOT}`;
    await getDb().insert(scheduledRuns).values({
      scheduleId: fx.scheduleId,
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

  it("only delivers to selected channels, and a failing webhook doesn't fail the run", async () => {
    const quiet = await setup({ selectChannel: false });
    expect(await run(quiet)).toMatchObject({ generated: 1 });
    expect(calls.filter((c) => c.url.includes("hooks.slack.com"))).toHaveLength(0);
    expect(await runRow(quiet)).toMatchObject({ status: "done", error: null });

    const failing = await setup();
    slack = () => new Response("gone", { status: 404 });
    expect(await run(failing)).toMatchObject({ generated: 1 });
    expect(await runRow(failing)).toMatchObject({ status: "done", error: "1 of 1 deliveries failed." });

    const noChannels = await setup({ channel: false });
    expect(await run(noChannels)).toMatchObject({ generated: 1 });
    expect((await runRow(noChannels)).error).toBeNull();
  });

  it("records sent Teams scheduled deliveries", async () => {
    const fx = await setup({ channelKind: "teams" });
    expect(await run(fx)).toMatchObject({ generated: 1, failed: 0, skipped: 0 });

    const [log] = await logsOf(fx);
    const { listDeliveries } = await import("./delivery");
    expect(await listDeliveries(log.id)).toMatchObject([{ kind: "teams", status: "sent", error: null }]);
    expect(calls.filter((call) => call.url === TEAMS)).toHaveLength(1);
  });

  it("records failed Teams scheduled deliveries", async () => {
    const fx = await setup({ channelKind: "teams" });
    teams = () => new Response("gone", { status: 404 });

    expect(await run(fx)).toMatchObject({ generated: 1, failed: 0, skipped: 0 });
    expect(await runRow(fx)).toMatchObject({ status: "done", error: "1 of 1 deliveries failed." });

    const [log] = await logsOf(fx);
    const { listDeliveries } = await import("./delivery");
    expect(await listDeliveries(log.id)).toMatchObject([{ kind: "teams", status: "failed" }]);
  });

  it("records unknown Teams scheduled deliveries", async () => {
    const fx = await setup({ channelKind: "teams" });
    teams = () => {
      throw new Error("connection reset after request");
    };

    expect(await run(fx)).toMatchObject({ generated: 1, failed: 0, skipped: 0 });
    expect(await runRow(fx)).toMatchObject({ status: "done", error: "1 of 1 deliveries failed." });

    const [log] = await logsOf(fx);
    const { listDeliveries } = await import("./delivery");
    expect(await listDeliveries(log.id)).toMatchObject([
      { kind: "teams", status: "unknown", error: "Could not confirm delivery to Microsoft Teams." },
    ]);
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

  describe("several schedules", () => {
    const ownerOf = (fx: Fx) => ({ userId: fx.userId, orgId: null, ownerId: fx.ownerId, orgRole: null });
    async function addSchedule(fx: Fx, over: object = {}, createdBy = fx.userId) {
      const { createSchedule } = await import("./schedules");
      return createSchedule(
        { ...ownerOf(fx), userId: createdBy },
        fx.projectId,
        { ...schedule, name: "Second", enabled: true, channelIds: [], ...over } as ScheduleInput
      );
    }
    const runBoth = async (ids: string[]) => (await import("./scheduler")).runScheduled(WEDNESDAY, { only: ids });

    it("runs every due schedule of a project once, each with its own template and log", async () => {
      const fx = await setup({ channel: false });
      const second = await addSchedule(fx, { template: "changelog" });
      expect(await runBoth([fx.scheduleId, second.id])).toMatchObject({ due: 2, generated: 2, failed: 0 });

      const logs = await logsOf(fx);
      expect(logs.map((l) => l.scheduleKey).sort()).toEqual([`${fx.scheduleId}:${SLOT}`, `${second.id}:${SLOT}`].sort());
      expect(logs.find((l) => l.scheduleKey === `${fx.scheduleId}:${SLOT}`)!.template).toBe("weekly_update");
      expect(logs.find((l) => l.scheduleKey === `${second.id}:${SLOT}`)!.template).toBe("changelog");

      expect(await runBoth([fx.scheduleId, second.id])).toMatchObject({ generated: 0 });
      expect(await logsOf(fx)).toHaveLength(2);
    });

    it("delivers each schedule only to its own channels", async () => {
      const fx = await setup(); // the default schedule selects the Slack channel
      const { getDb } = await import("@/db");
      const { deliveryChannels } = await import("@/db/schema");
      const { encrypt } = await import("./crypto");
      const [teamsChannel] = await getDb()
        .insert(deliveryChannels)
        .values({ projectId: fx.projectId, kind: "teams", encryptedConfig: encrypt(JSON.stringify({ webhookUrl: TEAMS })) })
        .returning();
      const second = await addSchedule(fx, { channelIds: [teamsChannel.id] });

      expect(await runBoth([fx.scheduleId, second.id])).toMatchObject({ generated: 2 });
      expect(calls.filter((c) => c.url.includes("hooks.slack.com"))).toHaveLength(1);
      expect(calls.filter((c) => c.url === TEAMS)).toHaveLength(1);

      const { listDeliveries } = await import("./delivery");
      const logs = await logsOf(fx);
      const first = logs.find((l) => l.scheduleKey === `${fx.scheduleId}:${SLOT}`)!;
      const other = logs.find((l) => l.scheduleKey === `${second.id}:${SLOT}`)!;
      expect(await listDeliveries(first.id)).toMatchObject([{ kind: "slack", status: "sent" }]);
      expect(await listDeliveries(other.id)).toMatchObject([{ kind: "teams", status: "sent" }]);
    });

    it("does not deliver when the schedule has no channels, even if the project has enabled channels", async () => {
      const fx = await setup({ selectChannel: false });
      expect(await run(fx)).toMatchObject({ generated: 1 });
      expect(calls.filter((c) => c.url.includes("hooks.slack.com"))).toHaveLength(0);
      expect(await runRow(fx)).toMatchObject({ status: "done", error: null });
    });

    it("records a note, not a failure, when every selected channel is paused", async () => {
      const fx = await setup();
      const { getDb } = await import("@/db");
      const { deliveryChannels } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      await getDb().update(deliveryChannels).set({ enabled: false }).where(eq(deliveryChannels.projectId, fx.projectId));

      expect(await run(fx)).toMatchObject({ generated: 1, failed: 0 });
      expect((await runRow(fx)).error).toContain("No enabled delivery channels");
      expect(await logsOf(fx)).toHaveLength(1);
      expect(calls.filter((c) => c.url.includes("hooks.slack.com"))).toHaveLength(0);
    });

    it("only generates when the schedule's only channel was deleted, without falling back to other channels", async () => {
      const fx = await setup();
      const { getDb } = await import("@/db");
      const { deliveryChannels } = await import("@/db/schema");
      const { encrypt } = await import("./crypto");
      const { eq } = await import("drizzle-orm");
      await getDb().delete(deliveryChannels).where(eq(deliveryChannels.projectId, fx.projectId));
      await getDb()
        .insert(deliveryChannels)
        .values({ projectId: fx.projectId, kind: "teams", encryptedConfig: encrypt(JSON.stringify({ webhookUrl: TEAMS })) });

      expect(await run(fx)).toMatchObject({ generated: 1, failed: 0 });
      expect(calls.filter((c) => c.url.includes("hooks.slack.com") || c.url === TEAMS)).toHaveLength(0);
      expect(await runRow(fx)).toMatchObject({ status: "done", error: null });
    });

    it("ignores schedules of archived projects", async () => {
      const fx = await setup();
      const { getDb } = await import("@/db");
      const { projects } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      await getDb().update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, fx.projectId));
      expect(await run(fx)).toMatchObject({ checked: 0, due: 0 });
      expect(await logsOf(fx)).toHaveLength(0);
    });

    it("acts as the schedule's creator", async () => {
      const fx = await setup();
      const second = `test_u_${rand()}`;
      const { saveGithubConnection } = await import("./github");
      await saveGithubConnection(second, { login: "second", token: "gh_second", scopes: "repo" });
      fixtures.push({ ...fx, userId: second });
      const other = await addSchedule(fx, {}, second);

      expect(await runBoth([other.id])).toMatchObject({ generated: 1 });
      const github = calls.filter((c) => c.url.includes("api.github.com"));
      expect(github.length).toBeGreaterThan(0);
      expect(github.every((c) => c.auth === "Bearer gh_second")).toBe(true);
      expect((await logsOf(fx))[0].createdBy).toBe(second);
    });
  });
});
