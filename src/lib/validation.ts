import { z } from "zod";
import { AI_PROVIDERS } from "@/lib/ai/models";

export { AI_PROVIDERS, type AiProvider } from "@/lib/ai/models";

export const repoNameSchema = z
  .string()
  .trim()
  .regex(/^[\w.-]+\/[\w.-]+$/, "Repository must look like owner/repo");

export const periodDaysSchema = z.coerce.number().int().min(1).max(90);

export const aiSettingsSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  apiKey: z.string().trim().min(8).max(500).optional(),
  model: z.string().trim().min(1).max(100).optional(),
});

export const githubTokenSchema = z.object({
  token: z.string().trim().min(10).max(255),
});

export const generateSchema = z.object({
  repo: repoNameSchema.nullish(),
  days: periodDaysSchema.default(7),
});
