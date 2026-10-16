// Offline stand-in for an AI provider (AI_PROVIDER=mock): deterministic, instant, no network.
// It rebuilds a plausible log from the activity listed in the prompt, so demos and tests exercise
// the whole pipeline (usage, streaming, storage, sharing, delivery) without any API key.

const MAX_ITEMS = 8;
const CHUNK = 24;
const CHUNK_DELAY_MS = 8;

export function mockLogText(prompt: string): string {
  const items = prompt
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).replace(/\s*\([^()]*\)\s*$/, "").trim())
    .filter(Boolean)
    .slice(0, MAX_ITEMS);

  const body = items.length
    ? items.map((item) => `- ${item}`).join("\n")
    : "- No activity was found in this period.";

  return [
    "## Highlights",
    "",
    body,
    "",
    "## Summary",
    "",
    "This is placeholder output from the built-in demo AI. Add an AI API key in Settings, or unset `AI_PROVIDER=mock`, to get real reports.",
  ].join("\n");
}

export async function* streamMockLog(prompt: string, signal?: AbortSignal): AsyncGenerator<string> {
  const text = mockLogText(prompt);
  for (let i = 0; i < text.length; i += CHUNK) {
    signal?.throwIfAborted();
    yield text.slice(i, i + CHUNK);
    await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
  }
}
