import { afterAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env.local");
} catch {}

// Runs against the real database with isolated owner ids; skipped when DATABASE_URL is missing.
describe.skipIf(!process.env.DATABASE_URL)("custom templates (database)", () => {
  const ownerA = { userId: `test_u_${crypto.randomUUID()}`, orgId: null, ownerId: `test_o_${crypto.randomUUID()}`, orgRole: null };
  const ownerB = { userId: `test_u_${crypto.randomUUID()}`, orgId: null, ownerId: `test_o_${crypto.randomUUID()}`, orgRole: null };
  const input = { name: "Monthly", description: "For customers", instructions: "Write a short monthly update for customers." };

  afterAll(async () => {
    const { inArray } = await import("drizzle-orm");
    const { getDb } = await import("@/db");
    const { customTemplates, projects } = await import("@/db/schema");
    const owners = [ownerA.ownerId, ownerB.ownerId];
    await getDb().delete(projects).where(inArray(projects.ownerId, owners));
    await getDb().delete(customTemplates).where(inArray(customTemplates.ownerId, owners));
  });

  it("lists built-ins first, then the owner's own templates only", async () => {
    const { createTemplate, listTemplates } = await import("./templates");
    const created = await createTemplate(ownerA, input);
    await createTemplate(ownerB, { ...input, name: "Theirs" });

    const mine = await listTemplates(ownerA.ownerId);
    expect(mine.filter((t) => t.builtIn)).toHaveLength(6);
    expect(mine.filter((t) => !t.builtIn)).toEqual([{ ...created, label: "Monthly", builtIn: false }]);
  });

  it("resolves built-in and own templates, and hides other owners' templates", async () => {
    const { createTemplate, getTemplate, requireTemplate } = await import("./templates");
    const mine = await createTemplate(ownerA, { ...input, name: "Mine" });

    expect((await getTemplate(ownerA.ownerId, "changelog"))?.builtIn).toBe(true);
    expect((await getTemplate(ownerA.ownerId, mine.id))?.instructions).toBe(input.instructions);
    expect(await getTemplate(ownerB.ownerId, mine.id)).toBeNull();
    expect(await getTemplate(ownerA.ownerId, "not-a-template")).toBeNull();
    await expect(requireTemplate(ownerB.ownerId, mine.id)).rejects.toMatchObject({ status: 404 });
  });

  it("updates only the owner's own templates", async () => {
    const { createTemplate, getTemplate, updateTemplate } = await import("./templates");
    const t = await createTemplate(ownerA, { ...input, name: "Edit me" });

    const updated = await updateTemplate(ownerA.ownerId, t.id, { name: "Edited", instructions: "Write exactly three bullet points." });
    expect(updated).toMatchObject({ label: "Edited", instructions: "Write exactly three bullet points.", description: "For customers" });
    expect((await getTemplate(ownerA.ownerId, t.id))?.label).toBe("Edited");
    await expect(updateTemplate(ownerB.ownerId, t.id, { name: "Hijack" })).rejects.toMatchObject({ status: 404 });
    await expect(updateTemplate(ownerA.ownerId, "changelog", { name: "Hijack" })).rejects.toMatchObject({ status: 404 });
  });

  it("only lets a project use a template its owner can see", async () => {
    const { createProject, updateProject } = await import("./projects");
    const { createTemplate } = await import("./templates");
    const { createProjectSchema } = await import("./validation");
    const t = await createTemplate(ownerA, { ...input, name: "For projects" });

    const project = await createProject(ownerA, createProjectSchema.parse({ name: "Uses custom", template: t.id }), 5);
    expect(project.template).toBe(t.id);
    await expect(createProject(ownerB, createProjectSchema.parse({ name: "Steals", template: t.id }), 5)).rejects.toMatchObject({ status: 404 });
    await expect(updateProject(ownerA.ownerId, project.id, { template: "11111111-1111-4111-8111-111111111111" })).rejects.toMatchObject({ status: 404 });
  });

  it("switches projects back to the default template when theirs is deleted", async () => {
    const { createProject, getProject } = await import("./projects");
    const { createTemplate, deleteTemplate, getTemplate } = await import("./templates");
    const { createProjectSchema } = await import("./validation");
    const t = await createTemplate(ownerA, { ...input, name: "Short lived" });
    const project = await createProject(ownerA, createProjectSchema.parse({ name: "Loses template", template: t.id }), 5);

    await expect(deleteTemplate(ownerB.ownerId, t.id)).rejects.toMatchObject({ status: 404 });
    await deleteTemplate(ownerA.ownerId, t.id);
    expect(await getTemplate(ownerA.ownerId, t.id)).toBeNull();
    expect((await getProject(ownerA.ownerId, project.id))?.template).toBe("weekly_update");
  });

  it("caps the number of custom templates per owner", async () => {
    const { MAX_CUSTOM_TEMPLATES, createTemplate, listTemplates } = await import("./templates");
    const have = (await listTemplates(ownerB.ownerId)).filter((t) => !t.builtIn).length;
    for (let i = have; i < MAX_CUSTOM_TEMPLATES; i++) await createTemplate(ownerB, { ...input, name: `T${i}` });
    await expect(createTemplate(ownerB, input)).rejects.toMatchObject({ code: "LIMIT_REACHED" });
  });
});
