const HOSTS = {
  slack: ["hooks.slack.com"],
  discord: ["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"],
} as const;

export type WebhookKind = keyof typeof HOSTS | "teams";

// Microsoft currently documents Teams Workflows callbacks on *.logic.azure.com.
// Keep host validation strict, but avoid assuming a path grammar that docs do not define.
const TEAMS_HOST_SUFFIX = ".logic.azure.com";

function isTeamsHost(hostname: string): boolean {
  return hostname.length > TEAMS_HOST_SUFFIX.length && hostname.endsWith(TEAMS_HOST_SUFFIX);
}

// A strict allow-list keeps stored webhook URLs from being used to reach internal services (SSRF).
export function isAllowedWebhook(kind: WebhookKind, value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  // `port` is empty for the default 443, so an explicit :443 is accepted and any other port is not.
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  if (kind === "teams") {
    return isTeamsHost(url.hostname) && url.pathname !== "/" && !!url.searchParams.get("sig");
  }
  if (!(HOSTS[kind] as readonly string[]).includes(url.hostname)) return false;
  return kind === "slack"
    ? /^\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(url.pathname)
    : /^\/api\/webhooks\/\d+\/[\w-]+$/.test(url.pathname);
}

export function webhookHint(value: string): string {
  try {
    const url = new URL(value);
    if (isTeamsHost(url.hostname)) return `${url.hostname}/…`;
    return `${url.hostname}/…/${value.slice(-4)}`;
  } catch {
    return "…";
  }
}
