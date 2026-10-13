export const AI_PROVIDERS = ["openai", "anthropic", "grok"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

// Verify these against each provider's current model list before launch.
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  openai: "gpt-5-mini",
  anthropic: "claude-sonnet-4-5",
  grok: "grok-4-fast",
};

export const MANAGED_PROVIDER: AiProvider = "openai";

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  grok: "Grok (xAI)",
};
