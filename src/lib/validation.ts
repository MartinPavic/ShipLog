import { z } from "zod";
import { AI_PROVIDERS } from "@/lib/ai/models";
import { TEMPLATE_IDS } from "@/lib/ai/templates";
import { isValidTimezone } from "@/lib/schedule";
import { isAllowedWebhook } from "@/lib/webhooks";

export { AI_PROVIDERS, type AiProvider } from "@/lib/ai/models";

export const repoNameSchema = z
  .string()
  .trim()
  .regex(/^[\w.-]+\/[\w.-]+$/, "Repository must look like owner/repo");

export const periodDaysSchema = z.coerce.number().int().min(1).max(90);

export const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid id");

// A built-in template id or the uuid of a custom template; ownership is checked where it is used.
export const templateIdSchema = z.union([z.enum(TEMPLATE_IDS), uuidSchema]);

const templateFields = {
  name: z.string().trim().min(1, "Name is required").max(60),
  description: z.string().trim().max(200),
  instructions: z
    .string()
    .trim()
    .min(20, "Describe what the template should write (at least 20 characters)")
    .max(3000),
};

export const templateInputSchema = z.object({ ...templateFields, description: templateFields.description.default("") });
export type TemplateInput = z.infer<typeof templateInputSchema>;

// Built from the fields without defaults, so an omitted description is left alone rather than cleared.
export const updateTemplateSchema = z
  .object(templateFields)
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update");

export const aiSettingsSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  apiKey: z.string().trim().min(8).max(500).optional(),
  model: z.string().trim().min(1).max(100).optional(),
});

// Empty strings clear the field.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();

const repoSchema = z.object({
  fullName: repoNameSchema,
  branch: z
    .string()
    .trim()
    .regex(/^[\w./-]{1,100}$/, "Invalid branch name")
    .optional(),
});

const projectFields = {
  name: z.string().trim().min(1, "Name is required").max(80),
  description: optionalText(500),
  repos: z.array(repoSchema).max(20),
  template: templateIdSchema,
  tone: optionalText(100),
  audience: optionalText(200),
  customPrompt: optionalText(1000),
  defaultPeriodDays: periodDaysSchema,
  isPublicChangelog: z.boolean(),
};

export const createProjectSchema = z.object({
  ...projectFields,
  repos: projectFields.repos.default([]),
  template: projectFields.template.default("weekly_update"),
  defaultPeriodDays: periodDaysSchema.default(7),
  isPublicChangelog: projectFields.isPublicChangelog.default(false),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const scheduleSchema = z.object({
  enabled: z.boolean(),
  dayOfWeek: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  timezone: z.string().refine(isValidTimezone, "Unknown timezone"),
  periodDays: periodDaysSchema,
  autoDeliver: z.boolean(),
});

export const updateProjectSchema = z.object({ ...projectFields, schedule: scheduleSchema.nullable() }).partial();
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

const DAY_MS = 24 * 60 * 60 * 1000;

export const generateSchema = z
  .object({
    days: periodDaysSchema.optional(),
    // Inclusive calendar range; takes precedence over `days`.
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    template: templateIdSchema.optional(),
    regenerateLogId: uuidSchema.optional(),
  })
  .refine((v) => (v.from === undefined) === (v.to === undefined), "Provide both a start and an end date")
  .refine((v) => !v.from || !v.to || v.from <= v.to, "The start date must not be after the end date")
  .refine(
    (v) => !v.from || !v.to || v.to.getTime() - v.from.getTime() < 90 * DAY_MS,
    "The date range can be at most 90 days"
  );

export const updateLogSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    content: z.string().max(50_000),
    pinned: z.boolean(),
    published: z.boolean(),
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update");

export const shareSchema = z.object({
  password: z.union([z.string().min(6, "Password must be at least 6 characters").max(100), z.literal("")]).nullable().optional(),
  rotate: z.boolean().optional(),
});

export const exportQuerySchema = z.object({
  format: z.enum(["markdown", "html", "slack"]).default("markdown"),
  download: z.preprocess((v) => v === "1" || v === "true", z.boolean()),
});

export const unlockSchema = z.object({ password: z.string().min(1).max(100) });

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

export const logListQuerySchema = z.object({
  q: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  from: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  to: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  pinned: z.preprocess((v) => v === "1" || v === "true", z.boolean()),
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(1000).default(1)),
  pageSize: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(50).default(20)),
});
export type LogListQuery = z.infer<typeof logListQuerySchema>;

const slackUrl = z.string().trim().refine((v) => isAllowedWebhook("slack", v), "Enter a Slack incoming webhook URL (https://hooks.slack.com/services/…)");
const discordUrl = z.string().trim().refine((v) => isAllowedWebhook("discord", v), "Enter a Discord webhook URL (https://discord.com/api/webhooks/…)");
const recipients = z.array(z.string().trim().toLowerCase().pipe(z.email("Enter valid email addresses"))).min(1, "Add at least one recipient").max(10);

export const createChannelSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("slack"), webhookUrl: slackUrl }),
  z.object({ kind: z.literal("discord"), webhookUrl: discordUrl }),
  z.object({ kind: z.literal("email"), recipients }),
]);
export type CreateChannelInput = z.infer<typeof createChannelSchema>;

// Which fields are meaningful depends on the channel's kind; the service validates them against it.
export const updateChannelSchema = z
  .object({ enabled: z.boolean(), webhookUrl: z.string().trim().max(500), recipients })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update");

export const deliverSchema = z.object({ channelIds: z.array(uuidSchema).max(10).optional() });
