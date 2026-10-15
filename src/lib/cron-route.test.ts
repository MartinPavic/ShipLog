import { afterEach, describe, expect, it, vi } from "vitest";

const { runScheduled } = vi.hoisted(() => ({
  runScheduled: vi.fn(async () => ({ checked: 2, due: 1, generated: 1, skipped: 0, failed: 0, retry: 0 })),
}));
vi.mock("@/lib/scheduler", () => ({ runScheduled }));

import { GET } from "@/app/api/cron/scheduled-logs/route";

const call = (authorization?: string) =>
  GET(new Request("http://x/api/cron/scheduled-logs", { headers: authorization ? { authorization } : {} }));

describe("GET /api/cron/scheduled-logs", () => {
  const original = process.env.CRON_SECRET;
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
    runScheduled.mockClear();
  });

  it("refuses to run when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer anything")).status).toBe(503);
    expect((await call()).status).toBe(503);
    expect(runScheduled).not.toHaveBeenCalled();
  });

  it("rejects missing, malformed and wrong credentials", async () => {
    process.env.CRON_SECRET = "cron-token-value";
    for (const header of [undefined, "", "cron-token-value", "Bearer wrong", "Bearer cron-token-valu", "Bearer cron-token-value2", "bearer cron-token-value"]) {
      expect((await call(header)).status).toBe(401);
    }
    expect(runScheduled).not.toHaveBeenCalled();
  });

  it("runs the scheduler for the right bearer token and returns only counts", async () => {
    process.env.CRON_SECRET = "cron-token-value";
    const res = await call("Bearer cron-token-value");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checked: 2, due: 1, generated: 1, skipped: 0, failed: 0, retry: 0 });
    expect(runScheduled).toHaveBeenCalledOnce();
  });
});
