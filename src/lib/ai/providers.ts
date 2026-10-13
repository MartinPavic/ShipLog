import { ApiError } from "@/lib/api";
import { PROVIDER_LABELS } from "@/lib/ai/models";
import type { AiProvider } from "@/lib/validation";

export type CompletionInput = {
  provider: AiProvider;
  key: string;
  model: string;
  system?: string;
  prompt: string;
  signal?: AbortSignal;
};

const TIMEOUT_MS = 60_000;
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

function buildRequest({ provider, key, model, system, prompt }: CompletionInput): {
  headers: Record<string, string>;
  body: unknown;
} {
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
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: prompt }],
      },
    };
  }
  return {
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: {
      model,
      messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }],
    },
  };
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
  const { provider } = input;
  const label = PROVIDER_LABELS[provider];
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  const { headers, body } = buildRequest(input);

  let res: Response;
  try {
    res = await fetch(ENDPOINTS[provider], { method: "POST", headers, body: JSON.stringify(body), signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ApiError(504, `${label} took too long to respond. Try again.`, "AI_TIMEOUT");
    }
    throw new ApiError(502, `Could not reach ${label}. Try again shortly.`, "AI_UNAVAILABLE");
  }

  if (!res.ok) throw mapProviderStatus(provider, res.status);

  const text = extractText(provider, await res.json()).trim();
  if (!text) throw new ApiError(502, `${label} returned an empty response. Try again.`, "AI_EMPTY");
  return text;
}
