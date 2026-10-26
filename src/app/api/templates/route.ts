import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { getOwner } from "@/lib/owner";
import { createTemplate, listTemplates } from "@/lib/templates";
import { templateInputSchema } from "@/lib/validation";

export const GET = handle(async () => {
  const owner = await getOwner();
  return NextResponse.json({ templates: await listTemplates(owner.ownerId) });
});

export const POST = handle(async (req: Request) => {
  const owner = await getOwner();
  const input = await parseBody(req, templateInputSchema);
  return NextResponse.json({ template: await createTemplate(owner, input) }, { status: 201 });
});
