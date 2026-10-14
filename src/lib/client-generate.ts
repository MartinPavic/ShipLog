import { STREAM_ERROR_MARKER } from "@/lib/constants";
import { ApiClientError } from "@/lib/client-api";

export class GenerationError extends Error {
  constructor(
    message: string,
    public logId?: string
  ) {
    super(message);
  }
}

export type GenerateRequest = {
  days?: number;
  from?: string;
  to?: string;
  template?: string;
  regenerateLogId?: string;
};

// Reads the streamed Markdown, calling onText with the full text so far.
export async function streamGeneration(
  projectId: string,
  body: GenerateRequest,
  onText: (text: string) => void,
  signal?: AbortSignal
): Promise<{ logId: string; content: string }> {
  const res = await fetch(`/api/projects/${projectId}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiClientError(data.error ?? "Something went wrong. Please try again.", data.code);
  }

  const logId = res.headers.get("X-Ship-Log-Id");
  if (!logId || !res.body) throw new GenerationError("Unexpected response from the server.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      onText(raw.split(STREAM_ERROR_MARKER)[0]);
    }
    raw += decoder.decode();
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new GenerationError("The connection was interrupted. Please try again.", logId);
  }

  const [content, failure] = raw.split(STREAM_ERROR_MARKER);
  if (failure !== undefined) throw new GenerationError(failure || "Generation failed.", logId);
  return { logId, content };
}
