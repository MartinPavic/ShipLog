import { siteConfig } from "@/config/site";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { deliveries, deliveryChannels } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { decrypt, encrypt } from "@/lib/crypto";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { toHtml, toSlackMrkdwn } from "@/lib/export";
import { isAllowedWebhook, webhookHint } from "@/lib/webhooks";
import type { CreateChannelInput } from "@/lib/validation";

export type ChannelKind = "slack" | "discord" | "email";
export type ChannelConfig = { webhookUrl: string } | { recipients: string[] };
export type DeliveryMessage = { title: string; markdown: string };

const MAX_CHANNELS = 10;
const SLACK_LIMIT = 30_000;
const DISCORD_EMBED_LIMIT = 4_000;
const LABELS: Record<ChannelKind, string> = { slack: "Slack", discord: "Discord", email: "Email" };

export class DeliveryError extends Error {}

function webhookStatusMessage(label: string, status: number): string {
  if (status === 404 || status === 410) return `${label} no longer knows this webhook. Remove it and add a new one.`;
  if (status === 401 || status === 403) return `${label} refused the webhook. Check that it is still active.`;
  if (status === 429) return `${label} is rate limiting this webhook. Try again in a minute.`;
  if (status >= 500) return `${label} is having problems. Try again shortly.`;
  return `${label} rejected the message (HTTP ${status}).`;
}

async function postJson(url: string, payload: unknown, label: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // Redirects could lead anywhere, so they are treated as failures.
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new DeliveryError(`Could not reach ${label}.`);
  }
  if (!res.ok) throw new DeliveryError(webhookStatusMessage(label, res.status));
}

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export async function sendMessage(kind: ChannelKind, config: ChannelConfig, message: DeliveryMessage): Promise<void> {
  if (kind === "email") {
    if (!isEmailConfigured()) throw new DeliveryError("Email delivery is not configured on this server.");
    const body = await toHtml(message.markdown);
    try {
      await sendEmail({
        to: (config as { recipients: string[] }).recipients,
        subject: message.title,
        text: message.markdown,
        html: `<h1>${message.title.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</h1>${body}`,
      });
    } catch (err) {
      throw new DeliveryError(err instanceof Error ? err.message : "Could not send the email.");
    }
    return;
  }

  const { webhookUrl } = config as { webhookUrl: string };
  if (!isAllowedWebhook(kind, webhookUrl)) throw new DeliveryError("This webhook URL is not allowed.");

  if (kind === "slack") {
    await postJson(webhookUrl, { text: truncate(`*${message.title}*\n\n${toSlackMrkdwn(message.markdown)}`, SLACK_LIMIT) }, "Slack");
  } else {
    await postJson(
      webhookUrl,
      { embeds: [{ title: truncate(message.title, 256), description: truncate(message.markdown, DISCORD_EMBED_LIMIT) }] },
      "Discord"
    );
  }
}

export type PublicChannel = { id: string; kind: ChannelKind; enabled: boolean; hint: string; createdAt: Date };

function readConfig(row: { encryptedConfig: string }): ChannelConfig {
  return JSON.parse(decrypt(row.encryptedConfig)) as ChannelConfig;
}

// Webhook URLs are secrets, so only a short hint ever leaves the server.
function toPublic(row: typeof deliveryChannels.$inferSelect): PublicChannel {
  const config = readConfig(row);
  return {
    id: row.id,
    kind: row.kind,
    enabled: row.enabled,
    createdAt: row.createdAt,
    hint: "webhookUrl" in config ? webhookHint(config.webhookUrl) : config.recipients.join(", "),
  };
}

export async function listChannels(projectId: string): Promise<PublicChannel[]> {
  const rows = await getDb()
    .select()
    .from(deliveryChannels)
    .where(eq(deliveryChannels.projectId, projectId))
    .orderBy(asc(deliveryChannels.createdAt));
  return rows.map(toPublic);
}

export async function createChannel(projectId: string, input: CreateChannelInput): Promise<PublicChannel> {
  if (input.kind === "email" && !isEmailConfigured()) {
    throw new ApiError(400, "Email delivery is not configured on this server.", "EMAIL_NOT_CONFIGURED");
  }
  const db = getDb();
  const existing = await db.select({ id: deliveryChannels.id }).from(deliveryChannels).where(eq(deliveryChannels.projectId, projectId));
  if (existing.length >= MAX_CHANNELS) {
    throw new ApiError(400, `A project can have at most ${MAX_CHANNELS} delivery channels.`, "VALIDATION");
  }

  const config: ChannelConfig = input.kind === "email" ? { recipients: input.recipients } : { webhookUrl: input.webhookUrl };
  const [row] = await db
    .insert(deliveryChannels)
    .values({ projectId, kind: input.kind, encryptedConfig: encrypt(JSON.stringify(config)) })
    .returning();
  return toPublic(row);
}

async function requireChannel(projectId: string, channelId: string) {
  const [row] = await getDb()
    .select()
    .from(deliveryChannels)
    .where(and(eq(deliveryChannels.id, channelId), eq(deliveryChannels.projectId, projectId)))
    .limit(1);
  if (!row) throw new ApiError(404, "Channel not found", "NOT_FOUND");
  return row;
}

export async function updateChannel(
  projectId: string,
  channelId: string,
  patch: { enabled?: boolean; webhookUrl?: string; recipients?: string[] }
): Promise<PublicChannel> {
  const row = await requireChannel(projectId, channelId);
  const set: Partial<typeof deliveryChannels.$inferInsert> = {};
  if (patch.enabled !== undefined) set.enabled = patch.enabled;

  if (patch.webhookUrl !== undefined) {
    if (row.kind === "email" || !isAllowedWebhook(row.kind, patch.webhookUrl)) {
      throw new ApiError(400, `Enter a valid ${LABELS[row.kind]} webhook URL.`, "VALIDATION");
    }
    set.encryptedConfig = encrypt(JSON.stringify({ webhookUrl: patch.webhookUrl }));
  }
  if (patch.recipients !== undefined) {
    if (row.kind !== "email") throw new ApiError(400, "Only email channels have recipients.", "VALIDATION");
    set.encryptedConfig = encrypt(JSON.stringify({ recipients: patch.recipients }));
  }

  if (Object.keys(set).length === 0) return toPublic(row);
  const [updated] = await getDb().update(deliveryChannels).set(set).where(eq(deliveryChannels.id, row.id)).returning();
  return toPublic(updated);
}

export async function deleteChannel(projectId: string, channelId: string): Promise<void> {
  const row = await requireChannel(projectId, channelId);
  await getDb().delete(deliveryChannels).where(eq(deliveryChannels.id, row.id));
}

export async function sendTestMessage(projectId: string, channelId: string): Promise<void> {
  const row = await requireChannel(projectId, channelId);
  try {
    await sendMessage(row.kind, readConfig(row), {
      title: `${siteConfig.name} test message`,
      markdown: "This is a test message. If you can read this, delivery is set up correctly.",
    });
  } catch (err) {
    if (err instanceof DeliveryError) throw new ApiError(502, err.message, "DELIVERY_FAILED");
    throw err;
  }
}

export type DeliveryResult = { channelId: string; kind: ChannelKind; status: "sent" | "failed"; error: string | null };

// Sends to every enabled channel (or the selected ones) and records each outcome.
export async function deliverLog(
  log: { id: string; title: string; content: string },
  projectId: string,
  channelIds?: string[]
): Promise<DeliveryResult[]> {
  const db = getDb();
  const channels = await db
    .select()
    .from(deliveryChannels)
    .where(
      and(
        eq(deliveryChannels.projectId, projectId),
        eq(deliveryChannels.enabled, true),
        channelIds?.length ? inArray(deliveryChannels.id, channelIds) : undefined
      )
    );
  if (channels.length === 0) {
    throw new ApiError(400, "No enabled delivery channels. Add one in the project's Delivery tab.", "NO_CHANNELS");
  }

  const results = await Promise.all(
    channels.map(async (channel): Promise<DeliveryResult> => {
      let error: string | null = null;
      try {
        await sendMessage(channel.kind, readConfig(channel), { title: log.title, markdown: log.content });
      } catch (err) {
        error = err instanceof DeliveryError ? err.message : "Unexpected error while sending.";
        if (!(err instanceof DeliveryError)) console.error("Delivery failed:", err);
      }
      const status = error ? "failed" : "sent";
      await db.insert(deliveries).values({ logId: log.id, channelId: channel.id, status, error });
      return { channelId: channel.id, kind: channel.kind, status, error };
    })
  );
  return results;
}

export async function listDeliveries(logId: string, limit = 10) {
  return getDb()
    .select({
      id: deliveries.id,
      kind: deliveryChannels.kind,
      status: deliveries.status,
      error: deliveries.error,
      sentAt: deliveries.sentAt,
    })
    .from(deliveries)
    .innerJoin(deliveryChannels, eq(deliveryChannels.id, deliveries.channelId))
    .where(eq(deliveries.logId, logId))
    .orderBy(desc(deliveries.sentAt))
    .limit(limit);
}
