const HOSTS = {
  slack: ["hooks.slack.com"],
  discord: ["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"],
} as const;

export type WebhookKind = keyof typeof HOSTS | "teams";

// Microsoft documents Workflows webhook URLs only as https://<host>.logic.azure.com:443/<path>;
// the path below is the Logic Apps request-trigger shape those URLs use in practice.
const TEAMS_HOST_SUFFIX = ".logic.azure.com";
const TEAMS_PATH = /^\/workflows\/([0-9a-f]{32})\/triggers\/[\w-]+\/paths\/invoke$/i;

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
    return isTeamsHost(url.hostname) && TEAMS_PATH.test(url.pathname) && !!url.searchParams.get("sig");
  }
  if (!(HOSTS[kind] as readonly string[]).includes(url.hostname)) return false;
  return kind === "slack"
    ? /^\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(url.pathname)
    : /^\/api\/webhooks\/\d+\/[\w-]+$/.test(url.pathname);
}

export function webhookHint(value: string): string {
  try {
    const url = new URL(value);
    // The tail of a Teams URL is its signature, so the hint uses the workflow id instead.
    const teamsId = isTeamsHost(url.hostname) ? TEAMS_PATH.exec(url.pathname)?.[1] : undefined;
    return `${url.hostname}/…/${teamsId ? teamsId.slice(-4) : value.slice(-4)}`;
  } catch {
    return "…";
  }
}
