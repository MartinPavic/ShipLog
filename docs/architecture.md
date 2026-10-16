# Architecture

## Stack

Next.js 16 (App Router) and TypeScript, Tailwind CSS with shadcn/ui components, Clerk (authentication and
organizations), Postgres through Drizzle ORM and `pg`, Stripe, Resend, Vitest.

Next.js 16 differs from older releases (`proxy.ts` replaces `middleware.ts`, `params` and `cookies()` are async). Read
the guides in `node_modules/next/dist/docs/` before changing routing code. [AGENTS.md](../AGENTS.md) says the same to
AI coding tools.

## Layout

```
src/app/            routes: landing, legal, dashboard, public pages (/s, /p), API routes, error/loading boundaries
src/components/     UI (ui/ holds the shadcn primitives)
src/config/         branding, copy and pricing display (site.ts)
src/db/             Drizzle schema and the lazy connection
src/env.ts          feature flags and environment validation
src/instrumentation.ts  runs the environment check when the server starts
src/proxy.ts        Clerk route protection
src/lib/            domain logic
src/lib/ai/         providers (streaming), templates, models, credential resolution, mock provider
scripts/            setup, seed, license check, one-off migration
drizzle/            generated SQL migrations
docs/               this documentation
```

## Tenancy

Every row is keyed by `ownerId`: the Clerk organization id when an organization is active, otherwise the user id.
`getOwner()` in `src/lib/owner.ts` is the single place that decides it, and `requireAdmin()` guards admin-only actions.
Every query filters by `ownerId`, and a resource that belongs to someone else behaves exactly like one that does not
exist. With `TEAMS_ENABLED=false` organizations are ignored.

## Plans and usage

`getPlanLimits(ownerId)` returns the limits for a workspace, derived from its Stripe-backed `billing_accounts` row and
the feature flags. `reserveGeneration` in `src/lib/usage.ts` is one atomic SQL upsert that increments a monthly counter
only while under the limit, so parallel requests cannot overshoot. The reservation is released if generation fails.
Managed and own-key usage are counted separately.

## Generation

`POST /api/projects/[id]/generate`:

1. authenticates, checks ownership and the rate limit;
2. resolves AI access (own key, managed key, or mock) and reserves usage;
3. inserts a `ship_logs` row with status `generating`;
4. fetches GitHub activity with the current user's connection;
5. streams the model's output to the browser as plain text with an `X-Ship-Log-Id` header;
6. on completion stores the content and the source snapshot and marks the row `ready`; on failure releases the usage and
   marks it `failed`.

Errors before the first byte are ordinary JSON errors. A failure after streaming has started appends a marker followed
by the message (see `src/lib/constants.ts`); the browser reader in `src/lib/client-generate.ts` hides it from the text.
Scheduled runs use the same pipeline without streaming, with the project creator's GitHub connection.

## Data model

| Table | Purpose |
| --- | --- |
| `billing_accounts` | Plan, Stripe ids and subscription status per workspace. |
| `usage_counters` | Generations per workspace, month and kind (managed or own key). |
| `stripe_events` | Processed Stripe event ids, for idempotent webhooks. |
| `github_connections` | Per-user GitHub login and encrypted token. |
| `ai_credentials` | Per-workspace AI provider, encrypted key, last four characters and model. |
| `projects` | Repositories, template, tone, audience, schedule and public-changelog flag. |
| `ship_logs` | Generated logs: Markdown content, period, status, source snapshot, share token and password hash. |
| `ship_log_versions` | Earlier content of a log, written on every edit and regeneration. |
| `delivery_channels`, `deliveries` | Slack, Discord and email channels (encrypted config) and the send history. |
| `owner_profiles` | The slug used in public changelog URLs. |
| `rate_limits` | Fixed-window counters for the abuse limits. |
| `scheduled_runs` | One row per project and schedule slot, so a slot never runs twice. |

## Security model

- GitHub tokens, AI keys and webhook URLs are encrypted with AES-256-GCM (`src/lib/crypto.ts`) and never sent to the
  browser. The settings page only receives the last four characters.
- Share links carry a random 32-byte token; an optional password is stored as an scrypt hash and unlocks the page
  through a signed, httpOnly cookie. Shared pages are `noindex` and send `Referrer-Policy: no-referrer`.
- The Stripe webhook verifies the signature and claims each event id once. The cron endpoint compares a hashed bearer
  token in constant time.
- Activity from GitHub is treated as untrusted input in the system prompt. Markdown is sanitized when rendered.
- Unexpected server errors never expose their message to the client.

## Testing

`npm test` runs unit tests plus database-backed suites. The database suites use `DATABASE_URL`, create rows with
`test_` prefixed owner ids and remove them afterwards. Stripe, GitHub, AI providers, Slack, Discord and Resend are always
stubbed. CI runs everything against a Postgres 17 service.
