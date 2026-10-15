import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { billingAccounts } from "@/db/schema";
import { ApiError } from "@/lib/api";

export type Plan = "free" | "pro";

export type PlanLimits = {
  maxProjects: number;
  managedGenerationsPerMonth: number;
  byokGenerationsPerMonth: number;
  visibleLogs: number;
  managedAi: boolean;
  scheduling: boolean;
  delivery: boolean;
  pdfExport: boolean;
  teams: boolean;
};

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    maxProjects: 1,
    managedGenerationsPerMonth: 0,
    byokGenerationsPerMonth: 5,
    visibleLogs: 10,
    managedAi: false,
    scheduling: false,
    delivery: false,
    pdfExport: false,
    teams: false,
  },
  pro: {
    maxProjects: Infinity,
    managedGenerationsPerMonth: 200,
    byokGenerationsPerMonth: Infinity,
    visibleLogs: Infinity,
    managedAi: true,
    scheduling: true,
    delivery: true,
    pdfExport: true,
    teams: true,
  },
};

export function planFromStatus(status: string | null | undefined): Plan {
  return status === "active" || status === "trialing" ? "pro" : "free";
}

export async function getPlan(ownerId: string): Promise<Plan> {
  const [row] = await getDb()
    .select({ plan: billingAccounts.plan })
    .from(billingAccounts)
    .where(eq(billingAccounts.ownerId, ownerId))
    .limit(1);
  return row?.plan ?? "free";
}

export async function getPlanLimits(ownerId: string) {
  const plan = await getPlan(ownerId);
  return { plan, limits: PLAN_LIMITS[plan] };
}

const FEATURE_LABELS = {
  delivery: "Delivery to Slack, Discord and email",
  scheduling: "Scheduled logs",
  pdfExport: "PDF export",
  teams: "Teams",
} as const;

export async function requirePlanFeature(ownerId: string, feature: keyof typeof FEATURE_LABELS): Promise<void> {
  const { limits } = await getPlanLimits(ownerId);
  if (!limits[feature]) {
    throw new ApiError(403, `${FEATURE_LABELS[feature]} is a Pro feature. Upgrade to use it.`, "LIMIT_REACHED");
  }
}
