// Everything a buyer needs to rebrand the product lives here: name, copy, pricing display,
// legal placeholders and (optionally) colors. Plan limits are in src/lib/plans.ts and
// feature switches in the environment (see src/env.ts).

export const siteConfig = {
  name: "ShipLog",
  tagline: "Keep the captain's log.",
  taglineMuted: "Let your commits write it.",
  description:
    "ShipLog turns GitHub and GitLab activity into clean weekly updates, changelogs and client reports. Mix repositories from both, including your self-managed GitLab instance.",
  // Shown in the footer and in places where a person may need to reach you.
  supportEmail: "support@example.com",
  // Optional logo shown next to the name. Put the file in /public and reference it, e.g. "/logo.svg".
  logo: null as { src: string; alt: string } | null,
  // Optional brand colors, any CSS color. Leave undefined to keep the default theme.
  brand: {
    primary: undefined as string | undefined,
    primaryForeground: undefined as string | undefined,
  },
  // Appends "Made with <name>" to shared logs and public changelogs.
  publicFooter: true,
  // Display only. Charging is configured by the Stripe variant price environment variables.
  pricing: {
    currency: "€",
    interval: "mo",
    vatInclusiveLabel: "VAT included",
    pro: { byok: 12, managed: 19 },
    ultra: { byok: 22, managed: 29 },
  },
  // Replace the contents of /terms and /privacy before launch. While `reviewed` is false, both pages
  // show a banner saying they are templates.
  legal: {
    companyName: "Your Company Name",
    address: "Your registered address",
    jurisdiction: "Your jurisdiction",
    lastUpdated: "1 January 2026",
    reviewed: false,
  },
  features: [
    {
      title: "Connect GitHub or GitLab",
      body: "Connect GitHub or GitLab, including a self-managed instance, and mix repositories in one report. We read commits, merged pull requests, closed issues and releases.",
    },
    {
      title: "AI writes the report",
      body: "Choose a template, tone and audience. Use your own OpenAI, Anthropic or Grok key, or the included managed AI on Pro.",
    },
    {
      title: "Share and deliver",
      body: "Edit the result, share a read-only link, publish a changelog, or send it to Slack, Discord and email on a schedule.",
    },
  ],
  faq: [
    {
      q: "What does it read from GitHub and GitLab?",
      a: "Commits, merged pull requests, closed issues and releases of the repositories you select. You can mix GitHub and GitLab repositories, including one publicly reachable self-managed GitLab instance per workspace. Merge commits and bot authors are skipped; access tokens are encrypted.",
    },
    {
      q: "Which AI providers can I use?",
      a: "OpenAI, Anthropic and Grok with your own API key. Pro workspaces can also use the managed AI that is included in the plan.",
    },
    {
      q: "Can my team use it together?",
      a: "Yes. Create an organization to share projects, the AI key and the subscription. Billing is flat per organization, not per member.",
    },
    {
      q: "Can I cancel any time?",
      a: "Yes. Manage or cancel your subscription from Settings. Your projects and logs are kept, and the Free plan limits apply afterwards.",
    },
  ],
};

export type SiteConfig = typeof siteConfig;

export type PaidTier = "pro" | "ultra";
export type PaidAiMode = "byok" | "managed";

export function paidPriceLabel(tier: PaidTier, aiMode: PaidAiMode): string {
  const { currency, interval } = siteConfig.pricing;
  const amount = siteConfig.pricing[tier][aiMode];
  return `${currency}${amount}/${interval}`;
}

export function proPriceLabel(): string {
  return paidPriceLabel("pro", "managed");
}
