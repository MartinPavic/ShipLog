import { ApiError } from "@/lib/api";
import { mockLogText, streamMockLog } from "@/lib/ai/mock";
import { PROVIDER_LABELS } from "@/lib/ai/models";
import type { AiProvider } from "@/lib/validation";

type BaseInput = {
  key: string;
  model: string;
  system?: string;
  prompt: string;
  signal?: AbortSignal;
};
type LiveInput = BaseInput & { provider: AiProvider };
export type CompletionInput = LiveInput | (BaseInput & { provider: "mock" });

const COMPLETE_TIMEOUT_MS = 60_000;
const STREAM_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_TOKENS = 2048;

const ENDPOINTS: Record<AiProvider, string> = {
  openai: "https://api.openai.com/v1/chat/completions",
  grok: "https://api.x.ai/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
};

export function mapProviderStatus(provider: AiProvider, status: number): ApiError {
  const label = PROVIDER_LABELS[provider];
  if (status === 401 || status === 403) {
    return new ApiError(400, `${label} rejected your API key. Check it in Settings.`, "AI_AUTH");
  }
  if (status === 429) {
    return new ApiError(
      429,
      `${label} rate limit or quota exceeded. Check your ${label} billing and try again.`,
      "AI_RATE_LIMIT"
    );
  }
  if (status === 400 || status === 404) {
    return new ApiError(
      400,
      `${label} could not use the selected model. Pick a different model in Settings.`,
      "AI_MODEL"
    );
  }
  return new ApiError(502, `${label} is temporarily unavailable. Try again shortly.`, "AI_UNAVAILABLE");
}

function buildRequest(
  { provider, key, model, system, prompt }: CompletionInput,
  stream: boolean
): { headers: Record<string, string>; body: unknown } {
  if (provider === "anthropic") {
    return {
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        ...(stream ? { stream: true } : {}),
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: prompt }],
      },
    };
  }
  return {
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: {
      model,
      ...(stream ? { stream: true } : {}),
      messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }],
    },
  };
}

async function request(input: LiveInput, stream: boolean): Promise<Response> {
  const { provider } = input;
  const label = PROVIDER_LABELS[provider];
  const timeout = AbortSignal.timeout(stream ? STREAM_TIMEOUT_MS : COMPLETE_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  const { headers, body } = buildRequest(input, stream);

  let res: Response;
  try {
    res = await fetch(ENDPOINTS[provider], { method: "POST", headers, body: JSON.stringify(body), signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ApiError(504, `${label} took too long to respond. Try again.`, "AI_TIMEOUT");
    }
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(502, `Could not reach ${label}. Try again shortly.`, "AI_UNAVAILABLE");
  }
  if (!res.ok) throw mapProviderStatus(provider, res.status);
  return res;
}

function extractText(provider: AiProvider, data: unknown): string {
  if (provider === "anthropic") {
    const blocks = (data as { content?: { type: string; text?: string }[] }).content ?? [];
    return blocks.map((b) => (b.type === "text" ? (b.text ?? "") : "")).join("");
  }
  const choices = (data as { choices?: { message?: { content?: string | null } }[] }).choices;
  return choices?.[0]?.message?.content ?? "";
}

export async function complete(input: CompletionInput): Promise<string> {
  if (input.provider === "mock") return mockLogText(input.prompt);
  const res = await request(input, false);
  const text = extractText(input.provider, await res.json()).trim();
  if (!text) {
    throw new ApiError(502, `${PROVIDER_LABELS[input.provider]} returned an empty response. Try again.`, "AI_EMPTY");
  }
  return text;
}

export type SseEvent = { event: string | null; data: string };

function parseSseBlock(block: string): SseEvent | null {
  let event: string | null = null;
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return data.length ? { event, data: data.join("\n") } : null;
}

export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Normalising the whole buffer handles a \r\n split across chunks.
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const event = parseSseBlock(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (event) yield event;
      }
    }
    const rest = parseSseBlock((buffer + decoder.decode()).replace(/\r\n/g, "\n"));
    if (rest) yield rest;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function parseJson(provider: AiProvider, raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ApiError(502, `${PROVIDER_LABELS[provider]} sent an unreadable response. Try again.`, "AI_UNAVAILABLE");
  }
}

async function* readTextDeltas(provider: AiProvider, body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const unavailable = () =>
    new ApiError(502, `${PROVIDER_LABELS[provider]} stopped responding mid-way. Try again.`, "AI_UNAVAILABLE");

  try {
    for await (const evt of parseSse(body)) {
      if (provider === "anthropic") {
        if (evt.event === "error") throw unavailable();
        if (evt.event === "message_stop") return;
        if (evt.event !== "content_block_delta") continue;
        const delta = parseJson(provider, evt.data).delta as { type?: string; text?: string } | undefined;
        if (delta?.type === "text_delta" && delta.text) yield delta.text;
      } else {
        if (evt.data === "[DONE]") return;
        const json = parseJson(provider, evt.data);
        if (json.error) throw unavailable();
        const choices = json.choices as { delta?: { content?: string | null } }[] | undefined;
        const text = choices?.[0]?.delta?.content;
        if (text) yield text;
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ApiError(504, `${PROVIDER_LABELS[provider]} took too long to respond. Try again.`, "AI_TIMEOUT");
    }
    throw err;
  }
}

// Connects and checks the status eagerly so callers can still return a proper HTTP error.
export async function openCompletionStream(input: CompletionInput): Promise<AsyncGenerator<string>> {
  if (input.provider === "mock") return streamMockLog(input.prompt, input.signal);
  const res = await request(input, true);
  if (!res.body) {
    throw new ApiError(502, `${PROVIDER_LABELS[input.provider]} sent an empty response. Try again.`, "AI_EMPTY");
  }
  return readTextDeltas(input.provider, res.body);
}
