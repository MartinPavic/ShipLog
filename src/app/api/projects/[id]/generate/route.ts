import { ApiError, handle, parseBody } from "@/lib/api";
import { STREAM_ERROR_MARKER } from "@/lib/constants";
import { startStreamingGeneration } from "@/lib/generation";
import { assertLogVisible, requireLog } from "@/lib/logs";
import { getOwner } from "@/lib/owner";
import { getPlanLimits } from "@/lib/plans";
import { requireProject } from "@/lib/projects";
import { enforceRateLimit, GENERATE_RATE } from "@/lib/rate-limit";
import { generateSchema } from "@/lib/validation";

export const maxDuration = 120;

// Streams the Markdown as plain text. Failures before the first byte are normal JSON errors;
// later ones end the stream with STREAM_ERROR_MARKER followed by the message.
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const owner = await getOwner();
  const { id } = await ctx.params;
  const project = await requireProject(owner.ownerId, id);
  const body = await parseBody(req, generateSchema);

  let existing;
  if (body.regenerateLogId) {
    existing = await requireLog(owner.ownerId, body.regenerateLogId);
    if (existing.projectId !== project.id) throw new ApiError(404, "Log not found", "NOT_FOUND");
    await assertLogVisible(existing, (await getPlanLimits(owner.ownerId)).limits);
  }

  // Before any usage is reserved, so rejected requests cost nothing.
  await enforceRateLimit(`generate:${owner.ownerId}`, GENERATE_RATE.limit, GENERATE_RATE.windowMs, "generation requests");

  const generation = await startStreamingGeneration({
    owner,
    project,
    period: { days: body.days, from: body.from, to: body.to },
    template: body.template,
    existing,
  });

  const encoder = new TextEncoder();
  let content = "";
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of generation.stream) {
          content += delta;
          controller.enqueue(encoder.encode(delta));
        }
        if (!content.trim()) {
          throw new ApiError(502, "The AI provider returned an empty response. Try again.", "AI_EMPTY");
        }
        await generation.finish(content);
        controller.close();
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof ApiError ? err.message : "Generation failed. Please try again.";
        if (!(err instanceof ApiError)) console.error("Generation failed:", err);
        await generation.fail(message).catch((e) => console.error("Could not record failure:", e));
        controller.enqueue(encoder.encode(STREAM_ERROR_MARKER + message));
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
      generation.abort();
      // The provider already billed for text it produced, so only refund an empty run.
      void generation.fail("Cancelled.", { refund: content.length === 0 }).catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      "X-Ship-Log-Id": generation.logId,
    },
  });
});

