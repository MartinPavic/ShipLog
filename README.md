# ShipLog

Turn GitHub activity into clean progress reports. ShipLog reads the commits, merged pull requests, closed issues and
releases of your repositories and uses an AI model to write a ship log: a weekly update, changelog, standup, client
report, release notes or investor update. Logs can be edited, shared, published, exported and delivered to Slack,
Discord or email, manually or on a schedule.

## Features

- **Projects** group the repositories behind one ship log, with a template, tone, audience and custom instructions.
- **Streaming generation** with OpenAI, Anthropic or Grok. Bring your own key, or use managed AI on Pro.
- **History** per project: search, date range, pinned logs, edit with version history, regenerate in place.
- **Sharing**: read-only links (optionally password protected, hidden from search engines) and a public changelog.
- **Exports**: Markdown, HTML, Slack mrkdwn, `.md` download, and PDF through the browser's print dialog (Pro).
- **Delivery and scheduling** (Pro): Slack, Discord and email channels; a weekly schedule per project.
- **Teams** (Pro): Clerk Organizations with admin and member roles. Billing is flat per organization.
- **Billing**: Stripe subscriptions with a customer portal.

| | Free | Pro |
| --- | --- | --- |
| Projects | 1 | Unlimited |
| Generations per month | 5 (your own key) | 200 managed AI, unlimited with your own key |
| History | 10 newest logs per project | Full |
| Delivery, scheduling, PDF, teams | No | Yes |

Limits live in [`src/lib/plans.ts`](src/lib/plans.ts).

## Stack

Next.js 16 (App Router) and TypeScript, Tailwind CSS with shadcn/ui, Clerk for auth and organizations, Postgres
(Neon) through Drizzle ORM and `pg`, Stripe, Resend, and Vitest.

> This project uses a newer Next.js than most documentation covers. Read the guides in
> `node_modules/next/dist/docs/` before changing routing code (see [AGENTS.md](AGENTS.md)). For example
> `proxy.ts` replaces `middleware.ts`, `params` and `cookies()` are async, and error boundaries receive `retry`.

## Quick start

Requires Node.js 22.12 or newer.

```bash
npm install
cp .env.example .env.local   # then fill it in, see below
npm run db:migrate           # applies the migrations in ./drizzle
npm run dev                  # http://localhost:3000
```

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Yes | Public base URL, used in OAuth callbacks, share links and Stripe redirects. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Yes | Clerk keys. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` and the other `NEXT_PUBLIC_CLERK_*_URL` values | Yes | Sign-in and sign-up routes (defaults in `.env.example`). |
| `DATABASE_URL` | Yes | Postgres connection string used by the app (pooled URL on Neon). |
| `DATABASE_URL_UNPOOLED` | For migrations | Direct connection used by `drizzle-kit`. Falls back to `DATABASE_URL`. |
| `ENCRYPTION_KEY` | Yes | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts stored tokens, API keys and webhook URLs, and signs share-link cookies. **Changing it makes stored secrets unreadable.** |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Yes | GitHub OAuth app. |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` | For billing | Stripe keys, the Pro price and the webhook signing secret. |
| `OPENAI_API_KEY` | For managed AI | Server-side key used for Pro accounts without their own key. |
| `RESEND_API_KEY`, `RESEND_FROM` | For email | Email delivery and scheduled-run notifications, e.g. `ShipLog <noreply@yourdomain.com>`. |
| `CRON_SECRET` | For schedules | Bearer token that guards `/api/cron/scheduled-logs`. The endpoint refuses to run without it. |

## Setting up the services

### Clerk

1. Create an application and copy the publishable and secret keys.
2. For teams, enable **Organizations** in the Clerk dashboard. The code uses the default `org:admin` and `org:member` roles.

### Database (Neon)

Create a Neon project and put the pooled connection string in `DATABASE_URL` and the direct one in
`DATABASE_URL_UNPOOLED`. Any Postgres works, since the app uses `pg`, but migrations should use a direct connection.
Schema changes live in `src/db/schema.ts`:

```bash
npm run db:generate   # create a migration after editing the schema
npm run db:migrate    # apply it
```

### GitHub OAuth app

1. GitHub, Settings, Developer settings, OAuth Apps, **New OAuth App**.
2. Authorization callback URL: `<NEXT_PUBLIC_APP_URL>/api/github/callback`, for example
   `http://localhost:3000/api/github/callback`.
3. Put the client ID and a generated client secret into `.env.local`.

An OAuth app allows only one callback URL, so create a separate app for production. The app requests the `repo`
and `read:user` scopes. GitHub connections are per user, even inside an organization.

### Stripe

1. Create a recurring price for Pro and put its id in `STRIPE_PRICE_ID`.
2. Forward webhooks to your local server with the Stripe CLI and use the printed signing secret as `STRIPE_WEBHOOK_SECRET`:

   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```

3. Try the lifecycle with `stripe trigger checkout.session.completed`, `customer.subscription.deleted` and
   `invoice.payment_failed`. Events are processed once per event id, so replays are safe.
4. Enable the customer portal in the Stripe dashboard so "Manage billing" works.

In production, add a webhook endpoint for `<APP_URL>/api/webhooks/stripe` listening to `checkout.session.completed`,
`customer.subscription.updated`, `customer.subscription.deleted` and `invoice.payment_failed`.

### Resend (email)

Verify a sending domain, then set `RESEND_API_KEY` and `RESEND_FROM`. Without them the email channel is disabled.

### Scheduled logs (cron)

[`vercel.json`](vercel.json) calls `/api/cron/scheduled-logs` every hour. Set `CRON_SECRET` in your Vercel project;
Vercel then sends it as a Bearer token automatically. Hourly cron jobs need a Vercel plan that allows them. You can
also trigger it yourself:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.example.com/api/cron/scheduled-logs
```

A project's schedule is due on its chosen weekday from its chosen hour until local midnight, runs once per week,
and retries transient failures up to three times.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js development server, production build and server. |
| `npm run lint` | ESLint. |
| `npm run test` | Vitest. |
| `npm run db:generate` / `db:migrate` | Drizzle migrations. |
| `npm run migrate:clerk -- [--dry-run]` | One-time move of secrets, plan and logs from old Clerk metadata into the database. Use `--dry-run` first. |

Before sending a change, run `npx tsc --noEmit`, `npm run lint`, `npm run test` and `npm run build`.

## Testing

Unit tests cover the pure logic. Many suites also run against a real database: they use `DATABASE_URL` from
`.env.local`, create rows with `test_` prefixed owner ids, and delete them afterwards. **Point `DATABASE_URL` at a
development database, not production.** Without `DATABASE_URL` those suites are skipped. Stripe, GitHub, AI,
Slack, Discord and Resend are always stubbed, so no test makes an external call.

## How it works

- **Tenancy.** Every row is keyed by `ownerId`, which is the Clerk organization id when an organization is active and
  the user id otherwise. `getOwner()` in `src/lib/owner.ts` is the single place that decides it. Admin-only actions
  use `requireAdmin()`.
- **Plans.** `getPlanLimits(ownerId)` returns the limits for the workspace. A Free *organization* can view its data but
  cannot create projects or generate until it is upgraded.
- **Usage.** `reserveGeneration` is a single atomic SQL upsert that increments a monthly counter only while under the
  limit, and releases it when a generation fails.
- **Generation.** `POST /api/projects/[id]/generate` streams plain text. Errors before the first byte are normal JSON
  errors; later failures end the stream with a marker followed by the message (see `src/lib/constants.ts`).
- **Secrets.** GitHub tokens, AI keys and webhook URLs are AES-256-GCM encrypted and never returned to the browser.
- **Abuse limits.** A database-backed rate limiter protects generation, delivery and share-link password attempts.
- **Security headers** are set in `next.config.ts`. There is no Content-Security-Policy yet; adding one needs an
  allowance for Clerk and Stripe.

## Project layout

```
src/app/            routes: dashboard, public pages (/s, /p), API routes, error and loading boundaries
src/components/     UI components (ui/ holds the shadcn primitives)
src/db/             Drizzle schema and connection
src/lib/            domain logic: plans, usage, generation, github, delivery, scheduler, sharing, billing...
src/lib/ai/         providers (streaming), templates, models, credential resolution
drizzle/            generated SQL migrations
scripts/            one-off scripts
```

## Deploying

Deploy to Vercel (or any Node host), set every variable above, run `npm run db:migrate` against the production
database, point Stripe's webhook at `/api/webhooks/stripe`, and add the production OAuth callback to your GitHub app.

## Troubleshooting

- **Every request returns 500 after editing `src/proxy.ts`.** Route matcher patterns cannot contain nested capture
  groups. `next build` does not catch this, so request an API route after changing it.
- **"ENCRYPTION_KEY must be 32 bytes".** Generate one with `openssl rand -base64 32`.
- **The organization switcher shows an error.** Enable Organizations in the Clerk dashboard.
- **GitHub connect redirects back with "not configured".** Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
- **A scheduled run was skipped.** The project's Settings tab shows the last run and the reason. A project's
  creator's GitHub connection is used; in an organization an admin can use "Run scheduled logs as me".
- **Database tests fail to connect.** Check `DATABASE_URL` and that the Neon branch is awake.
