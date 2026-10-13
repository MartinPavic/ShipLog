import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export type ProjectRepo = { fullName: string; branch?: string };

export type ProjectSchedule = {
  enabled: boolean;
  dayOfWeek: number;
  hour: number;
  timezone: string;
  periodDays: number;
  autoDeliver: boolean;
};

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ownerId is `orgId ?? userId` everywhere below.

export const billingAccounts = pgTable("billing_accounts", {
  ownerId: text("owner_id").primaryKey(),
  plan: text("plan", { enum: ["free", "pro"] }).notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  status: text("status"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usageCounters = pgTable(
  "usage_counters",
  {
    ownerId: text("owner_id").notNull(),
    period: text("period").notNull(), // YYYY-MM
    kind: text("kind", { enum: ["managed", "byok"] }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.period, t.kind] })]
);

export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const githubConnections = pgTable("github_connections", {
  userId: text("user_id").primaryKey(),
  login: text("login").notNull(),
  encryptedToken: text("encrypted_token").notNull(),
  scopes: text("scopes").notNull().default(""),
  createdAt: createdAt(),
});

export const aiCredentials = pgTable(
  "ai_credentials",
  {
    ownerId: text("owner_id").notNull(),
    provider: text("provider", { enum: ["openai", "anthropic", "grok"] }).notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    last4: text("last4").notNull(),
    model: text("model"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.provider] })]
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    createdBy: text("created_by").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    repos: jsonb("repos").$type<ProjectRepo[]>().notNull().default(sql`'[]'::jsonb`),
    template: text("template").notNull().default("weekly_update"),
    tone: text("tone"),
    audience: text("audience"),
    customPrompt: text("custom_prompt"),
    defaultPeriodDays: integer("default_period_days").notNull().default(7),
    schedule: jsonb("schedule").$type<ProjectSchedule>(),
    isPublicChangelog: boolean("is_public_changelog").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("projects_owner_idx").on(t.ownerId),
    uniqueIndex("projects_owner_slug_idx").on(t.ownerId, t.slug),
  ]
);

export const shipLogs = pgTable(
  "ship_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    createdBy: text("created_by").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull().default(""),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    template: text("template").notNull(),
    provider: text("provider"),
    model: text("model"),
    status: text("status", { enum: ["generating", "ready", "failed"] })
      .notNull()
      .default("generating"),
    error: text("error"),
    sourceSnapshot: jsonb("source_snapshot"),
    pinned: boolean("pinned").notNull().default(false),
    shareToken: text("share_token"),
    sharePasswordHash: text("share_password_hash"),
    createdAt: createdAt(),
  },
  (t) => [
    index("ship_logs_owner_idx").on(t.ownerId),
    index("ship_logs_project_created_idx").on(t.projectId, t.createdAt.desc()),
    uniqueIndex("ship_logs_share_token_idx").on(t.shareToken),
  ]
);

export const shipLogVersions = pgTable(
  "ship_log_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    logId: uuid("log_id")
      .notNull()
      .references(() => shipLogs.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("ship_log_versions_log_idx").on(t.logId, t.createdAt.desc())]
);

export const deliveryChannels = pgTable(
  "delivery_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["slack", "discord", "email"] }).notNull(),
    encryptedConfig: text("encrypted_config").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("delivery_channels_project_idx").on(t.projectId)]
);

export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    logId: uuid("log_id")
      .notNull()
      .references(() => shipLogs.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => deliveryChannels.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["sent", "failed"] }).notNull(),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deliveries_log_idx").on(t.logId)]
);
