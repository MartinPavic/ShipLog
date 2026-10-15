const HOSTS = {
  slack: ["hooks.slack.com"],
  discord: ["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"],
} as const;

export type WebhookKind = keyof typeof HOSTS;

// A strict allow-list keeps stored webhook URLs from being used to reach internal services (SSRF).
export function isAllowedWebhook(kind: WebhookKind, value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  if (!(HOSTS[kind] as readonly string[]).includes(url.hostname)) return false;
  return kind === "slack"
    ? /^\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(url.pathname)
    : /^\/api\/webhooks\/\d+\/[\w-]+$/.test(url.pathname);
}

export function webhookHint(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}/…/${value.slice(-4)}`;
  } catch {
    return "…";
  }
}
