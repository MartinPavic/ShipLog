# Customization

## Branding and copy

Everything user-facing that names the product lives in [`src/config/site.ts`](../src/config/site.ts):

| Field | Used for |
| --- | --- |
| `name`, `tagline`, `taglineMuted`, `description` | Header, landing hero, page titles, social previews, emails and share-page footers. |
| `supportEmail` | Footer contact link and the legal pages. |
| `logo` | Optional image next to the name. Put the file in `public/` and set `{ src: "/logo.svg", alt: "..." }`. |
| `brand.primary`, `brand.primaryForeground` | Optional primary colors (any CSS color). Leave undefined for the default theme. |
| `publicFooter` | Whether shared logs and public changelogs end with "Made with <name>". |
| `pricing` | The price shown on the landing page and the upgrade button. Display only. |
| `features`, `faq` | Landing page sections. |
| `legal` | Company details for the Terms and Privacy pages. |

The Open Graph image is generated from the same file (`src/app/opengraph-image.tsx`).

## Theme

The default look is a captain's log: parchment, ink-navy and brass, with a deep-sea dark mode (toggle in the headers,
follows the system setting by default).

- **Colors:** CSS variables in `src/app/globals.css` (`:root` for light, `.dark` for dark). Besides the shadcn tokens
  there are `--success`, `--warning`, `--danger` and `--brass`. `brand.primary` still overrides `--primary`.
- **Fonts:** Fraunces for headings (`--font-display`) and Inter for body text, both loaded in `src/app/layout.tsx`.
- **Logo:** the ship's wheel in `src/components/nautical/ship-wheel.tsx` is used when `logo` is `null`; the favicon is
  `src/app/icon.svg`. Setting `logo` replaces the wheel in the UI.
- **Clerk widgets:** `src/lib/clerk-appearance.ts` maps Clerk's variables onto the same tokens, so they follow dark mode.
- **Emails:** `src/lib/email-template.ts` wraps outgoing emails; it uses inline hex colors because email clients ignore CSS variables.

The Terms (`/terms`) and Privacy (`/privacy`) pages are **templates**. Replace their text with your own, reviewed by a
lawyer, then set `legal.reviewed` to `true` to remove the notice banner.

After rebranding, search the project for the old name to catch anything you added yourself:

```bash
grep -rniE "shiplog|ship log" src public README.md docs
```

Code identifiers such as the `shipLogs` table are internal and do not need to change.

## Plans, limits and price

- **Limits:** edit `PLAN_LIMITS` in [`src/lib/plans.ts`](../src/lib/plans.ts). They are enforced on the server, and the
  pricing section on the landing page is generated from them.
- **Price:** create the Stripe price, set `STRIPE_PRICE_ID`, and update `pricing` in `site.ts` so the page matches.
- **No paywall at all:** set `BILLING_ENABLED=false`.
- **Switch features off:** use the [feature flags](configuration.md#feature-flags).

Before fixing the managed-AI cap, check what a generation costs you with your chosen model; the default is 200 a
month per Pro workspace.

## Templates

Templates are the report styles offered when generating (weekly update, changelog, standup, ...).

- **Custom templates:** users create, edit and delete their own on the **Templates** page (`/dashboard/templates`). They
  belong to the workspace (personal or organization), are stored in the `custom_templates` table, and appear next to the
  built-in ones in every template picker. Built-ins can be duplicated and edited as a copy. Deleting a template switches
  the projects that used it back to Weekly update. Each workspace can have up to 20.
- **Built-in templates:** edit [`src/lib/ai/templates.ts`](../src/lib/ai/templates.ts): add its id to `TEMPLATE_IDS` and an
  entry to `TEMPLATES` with a `label`, a `description` and the `instructions` given to the model. The id is stored as
  text, so no migration is needed.

Whatever the template says, the shared rules in `buildSystemPrompt` apply: write in plain language, never paste commit
messages, pull request titles or file paths, and never invent facts. For the newest 20 pull requests and 15 commits the app
also sends the changed file names and short excerpts of the added code (`CHANGES_BUDGET` in
`src/lib/github-activity.ts`), so the model can describe what a change does. Set both numbers to 0 to stop sending code.

## AI providers

Providers are listed in [`src/lib/ai/models.ts`](../src/lib/ai/models.ts), and the calls are made in
[`src/lib/ai/providers.ts`](../src/lib/ai/providers.ts).

To add a provider that speaks the OpenAI chat-completions API (many do):

1. In `models.ts`, add its id to `AI_PROVIDERS`, and an entry to `DEFAULT_MODELS` and `PROVIDER_LABELS`.
2. In `providers.ts`, add its URL to `ENDPOINTS`.

The settings form, validation and the credentials table (a text column, so no migration) all follow from
`AI_PROVIDERS`. A provider with a different request or streaming format also needs branches in `buildRequest`,
`extractText` and `readTextDeltas`, as the Anthropic one has. Add a test next to `src/lib/ai/` that stubs `fetch`.

Check each default model name against the provider's current model list before launch.

## Managed AI

The server key is always OpenAI (`MANAGED_PROVIDER` in `models.ts`). To use another provider, change that constant and
read its key in `managedAiKey()` in `src/env.ts`.

## Delivery channels

Slack, Discord and email senders are in [`src/lib/delivery.ts`](../src/lib/delivery.ts). A new kind needs an entry in
the channel `kind` enum in `src/db/schema.ts` (and a migration if you generate one), a validation schema, a sender, and a
form in `src/components/channels-manager.tsx`.

## Database changes

Edit `src/db/schema.ts`, then:

```bash
npm run db:generate   # writes a new SQL migration to ./drizzle
npm run db:migrate    # applies it
```

Commit the generated files. Keep your own migrations after the shipped ones so [upgrades](upgrading.md) stay simple.
