import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { billingAccounts } from "@/db/schema";
import { features, type Features } from "@/env";
import { ApiError } from "@/lib/api";

export type Plan = "free" | "pro" | "ultra";
export type AiMode = "byok" | "managed";

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

const PAID_FEATURES = {
  managedAi: true,
  scheduling: true,
  delivery: true,
  pdfExport: true,
  teams: true,
} as const;

const PRO_MANAGED_LIMITS: PlanLimits = {
  maxProjects: 5,
  managedGenerationsPerMonth: 50,
  byokGenerationsPerMonth: 0,
  visibleLogs: Infinity,
  ...PAID_FEATURES,
};

const PRO_BYOK_LIMITS: PlanLimits = {
  ...PRO_MANAGED_LIMITS,
  managedGenerationsPerMonth: 0,
  byokGenerationsPerMonth: 50,
};

const ULTRA_MANAGED_LIMITS: PlanLimits = {
  maxProjects: Infinity,
  managedGenerationsPerMonth: 200,
  byokGenerationsPerMonth: 0,
  visibleLogs: Infinity,
  ...PAID_FEATURES,
};

const ULTRA_BYOK_LIMITS: PlanLimits = {
  ...ULTRA_MANAGED_LIMITS,
  managedGenerationsPerMonth: 0,
  byokGenerationsPerMonth: Infinity,
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
  pro: PRO_MANAGED_LIMITS,
  ultra: ULTRA_MANAGED_LIMITS,
};

export function planFromStatus(status: string | null | undefined): Plan {
  return status === "active" || status === "trialing" ? "pro" : "free";
}

// Clerk organization ids; personal workspaces use the user id.
export const isOrgOwner = (ownerId: string) => ownerId.startsWith("org_");

// Teams are a Pro feature: a Free organization keeps its data but can't create projects or generate until upgraded.
const FREE_ORG_LIMITS: PlanLimits = { ...PLAN_LIMITS.free, maxProjects: 0, byokGenerationsPerMonth: 0 };

// With billing off there is no paywall: everyone gets the Pro feature set without caps.
const UNLIMITED: PlanLimits = {
  ...ULTRA_MANAGED_LIMITS,
  maxProjects: Infinity,
  managedGenerationsPerMonth: Infinity,
  byokGenerationsPerMonth: Infinity,
};

// Deployment feature flags can only switch capabilities off, never grant one the plan lacks.
function applyFlags(limits: PlanLimits, on: Features): PlanLimits {
  if (on.managedAi && on.teams && on.scheduling && on.delivery) return limits;
  return {
    ...limits,
    managedAi: limits.managedAi && on.managedAi,
    teams: limits.teams && on.teams,
    scheduling: limits.scheduling && on.scheduling,
    delivery: limits.delivery && on.delivery,
  };
}

export function limitsFor(plan: Plan, ownerId: string, aiMode: AiMode = "managed"): PlanLimits {
  const on = features();
  if (!on.billing) return applyFlags(UNLIMITED, on);
  if (plan === "free") {
    return applyFlags(isOrgOwner(ownerId) ? FREE_ORG_LIMITS : PLAN_LIMITS.free, on);
  }
  if (plan === "pro") {
    return applyFlags(aiMode === "byok" ? PRO_BYOK_LIMITS : PRO_MANAGED_LIMITS, on);
  }
  return applyFlags(aiMode === "byok" ? ULTRA_BYOK_LIMITS : ULTRA_MANAGED_LIMITS, on);
}

export async function getPlan(ownerId: string): Promise<Plan> {
  if (!features().billing) return "pro";
  const [row] = await getDb()
    .select({ plan: billingAccounts.plan })
    .from(billingAccounts)
    .where(eq(billingAccounts.ownerId, ownerId))
    .limit(1);
  return row?.plan ?? "free";
}

export async function getPlanLimits(ownerId: string) {
  if (!features().billing) {
    return { plan: "pro" as const, aiMode: null, limits: limitsFor("pro", ownerId) };
  }

  const [row] = await getDb()
    .select({ plan: billingAccounts.plan, aiMode: billingAccounts.aiMode })
    .from(billingAccounts)
    .where(eq(billingAccounts.ownerId, ownerId))
    .limit(1);

  const plan = row?.plan ?? "free";
  const aiMode = row?.aiMode ?? null;
  return {
    plan,
    aiMode,
    limits: limitsFor(plan, ownerId, aiMode ?? undefined),
  };
}

const FEATURE_LABELS = {
  delivery: "Delivery to Slack, Discord and email",
  scheduling: "Scheduled logs",
  pdfExport: "PDF export",
  teams: "Teams",
} as const;

// Throws when a deployment flag has switched the whole feature off.
export function assertFeatureEnabled(feature: keyof Features): void {
  if (!features()[feature]) throw new ApiError(404, "This feature is turned off.", "FEATURE_DISABLED");
}

export async function requirePlanFeature(ownerId: string, feature: keyof typeof FEATURE_LABELS): Promise<void> {
  if (feature !== "pdfExport" && !features()[feature]) {
    throw new ApiError(403, `${FEATURE_LABELS[feature]} isn't enabled on this deployment.`, "FEATURE_DISABLED");
  }
  const { limits } = await getPlanLimits(ownerId);
  if (!limits[feature]) {
    throw new ApiError(403, `${FEATURE_LABELS[feature]} is a Pro feature. Upgrade to use it.`, "LIMIT_REACHED");
  }
}

// Marketing copy derived from the real limits, so the pricing table can't drift from what is enforced.
export function planHighlights(plan: Plan): string[] {
  const l = applyFlags(PLAN_LIMITS[plan], features());
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
  if (plan === "free") {
    return [
      n(l.maxProjects, "project", "projects"),
      `${l.byokGenerationsPerMonth} generations / month with your own AI key`,
      `${l.visibleLogs} newest logs per project`,
      "Share links and public changelog",
    ];
  }
  if (plan === "pro") {
    return [
      n(l.maxProjects, "project", "projects"),
      ...(l.byokGenerationsPerMonth ? [`${l.byokGenerationsPerMonth} generations / month with your own AI key`] : []),
      ...(l.managedAi && l.managedGenerationsPerMonth
        ? [`${l.managedGenerationsPerMonth} managed-AI generations / month`]
        : []),
      "Full history",
      ...(l.scheduling || l.delivery ? ["Scheduled logs and delivery to Slack, Discord and email"] : []),
      ...(l.pdfExport ? ["PDF export"] : []),
      ...(l.teams ? ["Teams with organizations"] : []),
    ];
  }
  return [
    "Unlimited projects",
    "Unlimited generations with your own AI key",
    ...(l.managedAi ? [`${l.managedGenerationsPerMonth} managed-AI generations / month`] : []),
    "Full history",
    ...(l.scheduling || l.delivery ? ["Scheduled logs and delivery to Slack, Discord and email"] : []),
    ...(l.pdfExport ? ["PDF export"] : []),
    ...(l.teams ? ["Teams with organizations"] : []),
  ];
}
