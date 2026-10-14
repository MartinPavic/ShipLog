import { afterEach, describe, expect, it, vi } from "vitest";
import { complete, mapProviderStatus, openCompletionStream, parseSse } from "./providers";

describe("mapProviderStatus", () => {
  it("maps auth failures to a user-fixable message", () => {
    const err = mapProviderStatus("openai", 401);
    expect(err.status).toBe(400);
    expect(err.code).toBe("AI_AUTH");
  });

  it("maps rate limits", () => {
    expect(mapProviderStatus("anthropic", 429).code).toBe("AI_RATE_LIMIT");
  });

  it("maps bad model", () => {
    expect(mapProviderStatus("grok", 404).code).toBe("AI_MODEL");
  });

  it("maps server errors to 502", () => {
    const err = mapProviderStatus("openai", 503);
    expect(err.status).toBe(502);
    expect(err.code).toBe("AI_UNAVAILABLE");
  });
});

const encoder = new TextEncoder();

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe("parseSse", () => {
  it("parses events, comments and multi-line data", async () => {
    const events = await collect(
      parseSse(streamOf([": ping\n\nevent: a\ndata: one\ndata: two\n\n", "data: three\n\n"]))
    );
    expect(events).toEqual([
      { event: "a", data: "one\ntwo" },
      { event: null, data: "three" },
    ]);
  });

  it("handles events and CRLF split across chunks", async () => {
    const events = await collect(parseSse(streamOf(["data: he", "llo\r", "\n\r\ndata: x\r\n", "\r\n"])));
    expect(events.map((e) => e.data)).toEqual(["hello", "x"]);
  });

  it("flushes a final event without a trailing blank line", async () => {
    expect(await collect(parseSse(streamOf(["data: tail"])))).toEqual([{ event: null, data: "tail" }]);
  });

  it("decodes multi-byte characters split across chunks", async () => {
    const bytes = encoder.encode("data: héllo\n\n");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 8)); // cuts inside the two-byte "é"
        controller.enqueue(bytes.slice(8));
        controller.close();
      },
    });
    expect((await collect(parseSse(body)))[0].data).toBe("héllo");
  });
});

const openaiChunk = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
const anthropicChunk = (text: string) =>
  `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`;

function stubFetch(body: ReadableStream<Uint8Array> | string, status = 200) {
  const fn = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const input = { key: "k", model: "m", prompt: "p", system: "s" };

describe("openCompletionStream", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("streams OpenAI-style deltas and requests streaming", async () => {
    const fetchFn = stubFetch(streamOf([openaiChunk("Hel"), openaiChunk("lo"), "data: [DONE]\n\n", openaiChunk("ignored")]));
    const stream = await openCompletionStream({ ...input, provider: "openai" });
    expect((await collect(stream)).join("")).toBe("Hello");

    const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ stream: true, model: "m" });
    expect(body.messages[0]).toEqual({ role: "system", content: "s" });
  });

  it("streams Grok through the same format", async () => {
    stubFetch(streamOf([openaiChunk("hi"), "data: [DONE]\n\n"]));
    expect((await collect(await openCompletionStream({ ...input, provider: "grok" }))).join("")).toBe("hi");
  });

  it("streams Anthropic text deltas and ignores other events", async () => {
    const fetchFn = stubFetch(
      streamOf([
        "event: message_start\ndata: {}\n\n",
        anthropicChunk("A"),
        `event: content_block_delta\ndata: ${JSON.stringify({ delta: { type: "input_json_delta", partial_json: "{" } })}\n\n`,
        anthropicChunk("B"),
        "event: message_stop\ndata: {}\n\n",
      ])
    );
    expect((await collect(await openCompletionStream({ ...input, provider: "anthropic" }))).join("")).toBe("AB");

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("anthropic.com");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ stream: true, system: "s" });
  });

  it("fails before streaming on a bad key", async () => {
    stubFetch("nope", 401);
    await expect(openCompletionStream({ ...input, provider: "openai" })).rejects.toMatchObject({ code: "AI_AUTH" });
  });

  it("surfaces provider errors that arrive mid-stream", async () => {
    stubFetch(streamOf([anthropicChunk("A"), 'event: error\ndata: {"type":"error"}\n\n']));
    const stream = await openCompletionStream({ ...input, provider: "anthropic" });
    await expect(collect(stream)).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
  });

  it("rejects unreadable chunks", async () => {
    stubFetch(streamOf(["data: {not json\n\n"]));
    const stream = await openCompletionStream({ ...input, provider: "openai" });
    await expect(collect(stream)).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
  });
});

describe("complete", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns trimmed text and rejects empty answers", async () => {
    stubFetch(JSON.stringify({ choices: [{ message: { content: "  done \n" } }] }));
    expect(await complete({ ...input, provider: "openai" })).toBe("done");

    stubFetch(JSON.stringify({ choices: [{ message: { content: "" } }] }));
    await expect(complete({ ...input, provider: "openai" })).rejects.toMatchObject({ code: "AI_EMPTY" });
  });
});
