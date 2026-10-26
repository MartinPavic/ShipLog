import { and, asc, count, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { customTemplates, projects } from "@/db/schema";
import { builtInTemplates, isBuiltInTemplate, type TemplateView } from "@/lib/ai/templates";
import { ApiError } from "@/lib/api";
import type { Owner } from "@/lib/owner";
import { uuidSchema, type TemplateInput } from "@/lib/validation";

export const MAX_CUSTOM_TEMPLATES = 20;
const FALLBACK_TEMPLATE = "weekly_update";

type Row = typeof customTemplates.$inferSelect;

const toView = (row: Row): TemplateView => ({
  id: row.id,
  label: row.name,
  description: row.description,
  instructions: row.instructions,
  builtIn: false,
});

export async function listTemplates(ownerId: string): Promise<TemplateView[]> {
  const rows = await getDb()
    .select()
    .from(customTemplates)
    .where(eq(customTemplates.ownerId, ownerId))
    .orderBy(asc(customTemplates.name));
  return [...builtInTemplates(), ...rows.map(toView)];
}

export async function getTemplate(ownerId: string, id: string): Promise<TemplateView | null> {
  if (isBuiltInTemplate(id)) return builtInTemplates().find((t) => t.id === id) ?? null;
  if (!uuidSchema.safeParse(id).success) return null;
  const [row] = await getDb()
    .select()
    .from(customTemplates)
    .where(and(eq(customTemplates.id, id), eq(customTemplates.ownerId, ownerId)))
    .limit(1);
  return row ? toView(row) : null;
}

export async function requireTemplate(ownerId: string, id: string): Promise<TemplateView> {
  const template = await getTemplate(ownerId, id);
  if (!template) throw new ApiError(404, "Template not found", "NOT_FOUND");
  return template;
}

export async function createTemplate(owner: Owner, input: TemplateInput): Promise<TemplateView> {
  const db = getDb();
  const [{ n }] = await db.select({ n: count() }).from(customTemplates).where(eq(customTemplates.ownerId, owner.ownerId));
  if (n >= MAX_CUSTOM_TEMPLATES) {
    throw new ApiError(403, `You can create up to ${MAX_CUSTOM_TEMPLATES} custom templates.`, "LIMIT_REACHED");
  }
  const [row] = await db
    .insert(customTemplates)
    .values({ ownerId: owner.ownerId, createdBy: owner.userId, ...input })
    .returning();
  return toView(row);
}

export async function updateTemplate(ownerId: string, id: string, patch: Partial<TemplateInput>): Promise<TemplateView> {
  if (!uuidSchema.safeParse(id).success) throw new ApiError(404, "Template not found", "NOT_FOUND");
  const [row] = await getDb()
    .update(customTemplates)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(customTemplates.id, id), eq(customTemplates.ownerId, ownerId)))
    .returning();
  if (!row) throw new ApiError(404, "Template not found", "NOT_FOUND");
  return toView(row);
}

// Projects that used the template fall back to the default one; old logs keep their text.
export async function deleteTemplate(ownerId: string, id: string): Promise<void> {
  if (!uuidSchema.safeParse(id).success) throw new ApiError(404, "Template not found", "NOT_FOUND");
  await getDb().transaction(async (tx) => {
    const rows = await tx
      .delete(customTemplates)
      .where(and(eq(customTemplates.id, id), eq(customTemplates.ownerId, ownerId)))
      .returning({ id: customTemplates.id });
    if (rows.length === 0) throw new ApiError(404, "Template not found", "NOT_FOUND");
    await tx
      .update(projects)
      .set({ template: FALLBACK_TEMPLATE, updatedAt: new Date() })
      .where(and(eq(projects.ownerId, ownerId), eq(projects.template, id)));
  });
}
