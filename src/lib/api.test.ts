import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, handle, jsonError, parseBody } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("handle", () => {
  it("passes arguments through and returns the handler's response", async () => {
    const fn = handle(async (a: number, b: string) => new Response(`${a}${b}`));
    expect(await (await fn(1, "x")).text()).toBe("1x");
  });

  it("turns ApiError into a JSON error with status and code", async () => {
    const res = await handle(async () => {
      throw new ApiError(418, "I'm a teapot", "TEA");
    })();
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ error: "I'm a teapot", code: "TEA" });
  });

  it("omits the code when there is none", async () => {
    const res = await handle(async () => {
      throw new ApiError(404, "Nope");
    })();
    expect(await res.json()).toEqual({ error: "Nope" });
  });

  it("reports the first validation issue as a 400", async () => {
    const schema = z.object({ name: z.string().min(2, "Name is too short") });
    const res = await handle(async () => {
      schema.parse({ name: "x" });
      return new Response();
    })();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Name is too short", code: "VALIDATION" });
  });

  it("never leaks the message of unexpected errors", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handle(async () => {
      throw new Error("connection string postgres://user:secret@host/db failed");
    })();
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "Internal server error" });
    expect(text).not.toContain("secret");
    expect(log).toHaveBeenCalledOnce();
  });
});

describe("parseBody", () => {
  const schema = z.object({ n: z.coerce.number().int() });
  const post = (body: string) => new Request("http://x", { method: "POST", body });

  it("parses and validates JSON", async () => {
    expect(await parseBody(post('{"n":"5"}'), schema)).toEqual({ n: 5 });
  });

  it("rejects malformed JSON and empty bodies with a validation error", async () => {
    for (const body of ["{not json", ""]) {
      await expect(parseBody(post(body), schema)).rejects.toMatchObject({ status: 400, code: "VALIDATION" });
    }
  });

  it("surfaces schema failures as ZodError for the wrapper to format", async () => {
    await expect(parseBody(post('{"n":1.5}'), schema)).rejects.toBeInstanceOf(z.ZodError);
  });
});

describe("jsonError", () => {
  it("builds a JSON response", async () => {
    const res = jsonError(429, "Slow down", "RATE_LIMITED");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Slow down", code: "RATE_LIMITED" });
  });
});
