// Everything a buyer needs to rebrand the product lives here: name, copy, pricing display,
// legal placeholders and (optionally) colors. Plan limits are in src/lib/plans.ts and
// feature switches in the environment (see src/env.ts).

export const siteConfig = {
  name: "ShipLog",
  tagline: "Stop writing weekly updates.",
  taglineMuted: "Generate them from your commits.",
  description:
    "ShipLog turns your GitHub commits, pull requests and releases into clean weekly updates, changelogs and client reports.",
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
  // Display only. Charging is configured by STRIPE_PRICE_ID.
  pricing: {
    currency: "€",
    pro: { price: 9, interval: "mo" },
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
      title: "Connect GitHub",
      body: "Sign in with GitHub and pick the repositories. We read commits, merged pull requests, closed issues and releases.",
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
      q: "What does it read from GitHub?",
      a: "Commits, merged pull requests, closed issues and releases of the repositories you select. Merge commits and bot authors are skipped. The access token is stored encrypted.",
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

export function proPriceLabel(): string {
  const { currency, pro } = siteConfig.pricing;
  return `${currency}${pro.price}/${pro.interval}`;
}
