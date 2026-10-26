import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { getOwner, requireAdmin } from "@/lib/owner";
import { deleteTemplate, updateTemplate } from "@/lib/templates";
import { updateTemplateSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const owner = await getOwner();
  const { id } = await ctx.params;
  const patch = await parseBody(req, updateTemplateSchema);
  return NextResponse.json({ template: await updateTemplate(owner.ownerId, id, patch) });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const owner = await requireAdmin();
  const { id } = await ctx.params;
  await deleteTemplate(owner.ownerId, id);
  return NextResponse.json({ success: true });
});
