import { describe, expect, it } from "vitest";
import { mapProviderStatus } from "./providers";

describe("mapProviderStatus", () => {
  it("maps auth failures to a user-fixable message", () => {
    const err = mapProviderStatus("openai", 401);
    expect(err.status).toBe(400);
    expect(err.code).toBe("AI_AUTH");
  });

  it("maps rate limits", () => {
    expect(mapProviderStatus("anthropic", 429).code).toBe("AI_RATE_LIMIT");
  });

  it("maps bad model", () => {
    expect(mapProviderStatus("grok", 404).code).toBe("AI_MODEL");
  });

  it("maps server errors to 502", () => {
    const err = mapProviderStatus("openai", 503);
    expect(err.status).toBe(502);
    expect(err.code).toBe("AI_UNAVAILABLE");
  });
});
