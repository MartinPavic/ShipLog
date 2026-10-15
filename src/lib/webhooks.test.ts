import { describe, expect, it } from "vitest";
import { isAllowedWebhook, webhookHint } from "./webhooks";

describe("isAllowedWebhook", () => {
  it.each([
    ["slack", "https://hooks.slack.com/services/T0123ABC/B0123ABC/abcDEF123456"],
    ["discord", "https://discord.com/api/webhooks/123456789012345678/abc_DEF-123"],
    ["discord", "https://discordapp.com/api/webhooks/123/abc"],
    ["discord", "https://canary.discord.com/api/webhooks/123/abc?thread_id=99"],
  ] as const)("accepts %s %s", (kind, url) => {
    expect(isAllowedWebhook(kind, url)).toBe(true);
  });

  it.each([
    ["slack", "http://hooks.slack.com/services/T1/B1/x"],
    ["slack", "https://hooks.slack.com/services/T1/B1"],
    ["slack", "https://hooks.slack.com.evil.com/services/T1/B1/x"],
    ["slack", "https://evil.com/hooks.slack.com/services/T1/B1/x"],
    ["slack", "https://user:pw@hooks.slack.com/services/T1/B1/x"],
    ["slack", "https://hooks.slack.com:8443/services/T1/B1/x"],
    ["slack", "https://discord.com/api/webhooks/123/abc"],
    ["slack", "https://169.254.169.254/latest/meta-data"],
    ["slack", "https://localhost/services/T1/B1/x"],
    ["slack", "not a url"],
    ["discord", "https://hooks.slack.com/services/T1/B1/x"],
    ["discord", "https://discord.com/api/webhooks/abc/def"],
    ["discord", "https://discord.com/api/v10/channels/1/messages"],
    ["discord", "https://evil.discord.com.example.org/api/webhooks/1/a"],
  ] as const)("rejects %s %s", (kind, url) => {
    expect(isAllowedWebhook(kind, url)).toBe(false);
  });
});

describe("webhookHint", () => {
  it("shows the host and last characters only", () => {
    const hint = webhookHint("https://hooks.slack.com/services/T0123ABC/B0123ABC/secretvalue9876");
    expect(hint).toBe("hooks.slack.com/…/9876");
    expect(hint).not.toContain("secretvalue");
  });
});
