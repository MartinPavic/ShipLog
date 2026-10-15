import { afterEach, describe, expect, it, vi } from "vitest";
import { STREAM_ERROR_MARKER as MARK } from "./constants";
import { ApiClientError, apiRequest } from "./client-api";
import { GenerationError, streamGeneration, visibleText } from "./client-generate";

afterEach(() => vi.unstubAllGlobals());

const enc = new TextEncoder();
function streamResponse(chunks: (string | Error)[], headers: Record<string, string> = { "X-Ship-Log-Id": "log-1" }, status = 200) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        if (chunk instanceof Error) controller.error(chunk);
        else controller.enqueue(enc.encode(chunk));
      }
      if (!chunks.some((c) => c instanceof Error)) controller.close();
    },
  });
  return new Response(body, { status, headers });
}
const stub = (res: Response) => vi.stubGlobal("fetch", vi.fn(async () => res));

describe("visibleText", () => {
  it("hides the marker and everything after it", () => {
    expect(visibleText(`partial${MARK}boom`)).toBe("partial");
    expect(visibleText(MARK)).toBe("");
  });

  it("holds back a partial marker at the end of the buffer", () => {
    for (let n = 1; n < MARK.length; n++) {
      expect(visibleText(`abc${MARK.slice(0, n)}`)).toBe("abc");
    }
  });

  it("leaves ordinary text alone, including similar-looking characters", () => {
    expect(visibleText("# Heading\n\n- item")).toBe("# Heading\n\n- item");
    expect(visibleText("ends with SHIPLOG")).toBe("ends with SHIPLOG");
    expect(visibleText("")).toBe("");
  });
});

describe("streamGeneration", () => {
  it("accumulates chunks, reports progress and returns the log id", async () => {
    stub(streamResponse(["Hel", "lo ", "world"]));
    const seen: string[] = [];
    const result = await streamGeneration("p1", { days: 7 }, (t) => seen.push(t));
    expect(result).toEqual({ logId: "log-1", content: "Hello world" });
    expect(seen).toEqual(["Hel", "Hello ", "Hello world"]);
  });

  it("sends the request as JSON to the project's endpoint", async () => {
    const fetchFn = vi.fn(async () => streamResponse(["x"]));
    vi.stubGlobal("fetch", fetchFn);
    await streamGeneration("proj-9", { regenerateLogId: "abc" }, () => {});
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/projects/proj-9/generate");
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ regenerateLogId: "abc" }) });
  });

  it("raises the server's message when the stream ends with the error marker", async () => {
    stub(streamResponse(["Partial text", `${MARK}Provider exploded`]));
    const seen: string[] = [];
    const err = await streamGeneration("p1", {}, (t) => seen.push(t)).catch((e) => e);
    expect(err).toBeInstanceOf(GenerationError);
    expect(err).toMatchObject({ message: "Provider exploded", logId: "log-1" });
    expect(seen.join("|")).not.toContain("\u001e");
    expect(seen.at(-1)).toBe("Partial text");
  });

  it("copes with the marker split across chunks without ever showing it", async () => {
    const half = Math.floor(MARK.length / 2);
    stub(streamResponse(["abc", MARK.slice(0, half), MARK.slice(half) + "boom"]));
    const seen: string[] = [];
    const err = await streamGeneration("p1", {}, (t) => seen.push(t)).catch((e) => e);
    expect(err).toMatchObject({ message: "boom" });
    expect(seen.every((t) => t === "abc")).toBe(true);
  });

  it("falls back to a generic message when the marker has no text", async () => {
    stub(streamResponse(["x", MARK]));
    await expect(streamGeneration("p1", {}, () => {})).rejects.toMatchObject({ message: "Generation failed." });
  });

  it("throws ApiClientError with the code for HTTP failures", async () => {
    stub(new Response(JSON.stringify({ error: "Monthly limit reached", code: "LIMIT_REACHED" }), { status: 403 }));
    const err = await streamGeneration("p1", {}, () => {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ message: "Monthly limit reached", code: "LIMIT_REACHED" });
  });

  it("uses a generic message when an error response isn't JSON", async () => {
    stub(new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(streamGeneration("p1", {}, () => {})).rejects.toMatchObject({
      message: "Something went wrong. Please try again.",
    });
  });

  it("reports an interrupted connection with the log id", async () => {
    stub(streamResponse(["partial", new TypeError("network error")]));
    await expect(streamGeneration("p1", {}, () => {})).rejects.toMatchObject({
      message: "The connection was interrupted. Please try again.",
      logId: "log-1",
    });
  });

  it("rethrows aborts so the caller can tell a cancel from a failure", async () => {
    const controller = new AbortController();
    const abort = new DOMException("aborted", "AbortError");
    stub(streamResponse(["x", abort]));
    controller.abort();
    const err = await streamGeneration("p1", {}, () => {}, controller.signal).catch((e) => e);
    expect(err).not.toBeInstanceOf(GenerationError);
    expect(err).toMatchObject({ name: "AbortError" });
  });

  it("rejects responses that lack the log id header", async () => {
    stub(streamResponse(["x"], {}));
    await expect(streamGeneration("p1", {}, () => {})).rejects.toBeInstanceOf(GenerationError);
  });
});

describe("apiRequest", () => {
  it("sends JSON bodies and returns parsed responses", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: 1 })));
    vi.stubGlobal("fetch", fetchFn);
    expect(await apiRequest("/api/x", "PATCH", { a: 1 })).toEqual({ ok: 1 });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init).toMatchObject({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: '{"a":1}' });
  });

  it("omits the content type when there is no body", async () => {
    const fetchFn = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchFn);
    await apiRequest("/api/x", "GET");
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("throws ApiClientError carrying message and code", async () => {
    stub(new Response(JSON.stringify({ error: "Nope", code: "X" }), { status: 400 }));
    await expect(apiRequest("/api/x", "POST")).rejects.toMatchObject({ message: "Nope", code: "X" });
  });

  it("survives non-JSON error bodies", async () => {
    stub(new Response("oops", { status: 500 }));
    await expect(apiRequest("/api/x", "POST")).rejects.toMatchObject({
      message: "Something went wrong. Please try again.",
    });
  });
});
