import { exportFilename, toHtml, toSlackMrkdwn } from "@/lib/export";
import { handle } from "@/lib/api";
import { assertLogVisible, requireLog } from "@/lib/logs";
import { getOwner } from "@/lib/owner";
import { getPlanLimits } from "@/lib/plans";
import { exportQuerySchema } from "@/lib/validation";

export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const owner = await getOwner();
  const log = await requireLog(owner.ownerId, (await ctx.params).id);
  await assertLogVisible(log, (await getPlanLimits(owner.ownerId)).limits);
  const { format, download } = exportQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  const body =
    format === "html" ? await toHtml(log.content) : format === "slack" ? toSlackMrkdwn(log.content) : log.content;
  const extension = format === "html" ? "html" : format === "slack" ? "txt" : "md";

  // Always plain text: a log is user-controlled content and must never render as a page on our origin.
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      ...(download ? { "Content-Disposition": `attachment; filename="${exportFilename(log.title, extension)}"` } : {}),
    },
  });
});
