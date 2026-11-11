import { describe, expect, it } from "vitest";
import { isAllowedWebhook, webhookHint } from "./webhooks";

const TEAMS_QUERY = "?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=SECRETSIG_abc-123";
const teamsUrl = (host = "prod-12.westus.logic.azure.com", path = "/workflows/anything", query = TEAMS_QUERY) =>
  `https://${host}${path}${query}`;

describe("isAllowedWebhook", () => {
  it.each([
    ["slack", "https://hooks.slack.com/services/T0123ABC/B0123ABC/abcDEF123456"],
    ["discord", "https://discord.com/api/webhooks/123456789012345678/abc_DEF-123"],
    ["discord", "https://discordapp.com/api/webhooks/123/abc"],
    ["discord", "https://canary.discord.com/api/webhooks/123/abc?thread_id=99"],
    ["teams", teamsUrl()],
    ["teams", teamsUrl("prod-12.westus.logic.azure.com:443")],
    ["teams", teamsUrl("prod-01.northeurope.logic.azure.com")],
    ["teams", teamsUrl("PROD-12.WESTUS.LOGIC.AZURE.COM")],
    ["teams", teamsUrl(undefined, "/xxxxxxxxx")],
    ["teams", teamsUrl(undefined, "/powerautomate/automations/direct/workflows/abc/triggers/manual/paths/invoke")],
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
    ["teams", teamsUrl().replace("https:", "http:")],
    ["teams", teamsUrl("user:pw@prod-12.westus.logic.azure.com")],
    ["teams", teamsUrl("prod-12.westus.logic.azure.com@evil.com")],
    ["teams", teamsUrl("prod-12.westus.logic.azure.com:8443")],
    ["teams", teamsUrl("prod-12.westus.logic.azure.com:444")],
    ["teams", teamsUrl("logic.azure.com")],
    ["teams", teamsUrl("evil-logic.azure.com")],
    ["teams", teamsUrl("prod-12.westus.logic.azure.com.")],
    ["teams", teamsUrl("prod-12.westus.logic.azure.com.evil.com")],
    ["teams", teamsUrl("evil.com", "/prod.logic.azure.com/workflows/abc/triggers/manual/paths/invoke")],
    ["teams", teamsUrl("localhost")],
    ["teams", teamsUrl("169.254.169.254")],
    ["teams", teamsUrl("contoso.environment.api.powerplatform.com")],
    ["teams", teamsUrl("outlook.office.com", "/webhook/abc/IncomingWebhook/def/ghi")],
    ["teams", teamsUrl(undefined, "/")],
    ["teams", teamsUrl(undefined, undefined, "?api-version=2016-06-01")],
    ["teams", teamsUrl(undefined, undefined, "?sig=")],
    ["teams", "https://hooks.slack.com/services/T1/B1/x"],
    ["teams", "https://discord.com/api/webhooks/123/abc"],
    ["slack", teamsUrl()],
    ["discord", teamsUrl()],
    ["teams", "not a url"],
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

  it("never exposes the Teams signature or its tail", () => {
    const hint = webhookHint(teamsUrl());
    expect(hint).toBe("prod-12.westus.logic.azure.com/…");
    expect(hint).not.toContain("SECRETSIG");
    expect(hint).not.toContain("sig");
    expect(hint).not.toContain("123");
  });
});
