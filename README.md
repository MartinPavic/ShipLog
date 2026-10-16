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
- **Billing**: Stripe subscriptions with a customer portal. Switch it off entirely with `BILLING_ENABLED=false`.

| | Free | Pro |
| --- | --- | --- |
| Projects | 1 | Unlimited |
| Generations per month | 5 (your own key) | 200 managed AI, unlimited with your own key |
| History | 10 newest logs per project | Full |
| Delivery, scheduling, PDF, teams | No | Yes |

Limits live in [`src/lib/plans.ts`](src/lib/plans.ts).

## Quick start

Requires Node.js 22.12 or newer.

```bash
npm install
npm run setup    # guided: creates .env.local, generates secrets, checks the database, applies migrations
npm run dev      # http://localhost:3000
```

`npm run setup` asks for each service's credentials and lets you skip any step. See [Getting
started](docs/getting-started.md) for the details, a no-account tour with demo data, and the manual alternative.

Before sending a change, run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`.

## Documentation

| | |
| --- | --- |
| [Getting started](docs/getting-started.md) | Run it locally, first run, demo data. |
| [Service setup](docs/services.md) | Clerk, Neon, GitHub, Stripe, Resend, OpenAI, cron. |
| [Configuration](docs/configuration.md) | Every environment variable, feature flag and limit. |
| [Architecture](docs/architecture.md) | Code layout, data model, how generation and billing work. |
| [Customization](docs/customization.md) | Branding, plans, templates, AI providers. |
| [Deployment](docs/deployment.md) | Vercel, other hosts, production checklist. |
| [Troubleshooting](docs/troubleshooting.md) | Common problems and fixes. |
| [Upgrading](docs/upgrading.md) | Moving to a newer version. |

See also the [changelog](CHANGELOG.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js development server, production build and server. |
| `npm run setup` | Guided setup. `-- --check` validates the environment without prompts (`--production`, `--db`). |
| `npm run seed` | Adds a demo project with sample logs to your newest account (`--remove`, `--reset`). |
| `npm run typecheck` / `lint` / `test` | TypeScript, ESLint (no explicit `any`) and Vitest. |
| `npm run db:generate` / `db:migrate` | Drizzle migrations. |
| `npm run licenses` | Regenerates the third-party notices and fails on any license that doesn't allow redistribution. |
| `npm run migrate:clerk -- [--dry-run]` | One-time move of secrets, plan and logs from old Clerk metadata into the database. Only needed by installs that predate the database. |

## Stack

Next.js 16 (App Router) and TypeScript, Tailwind CSS with shadcn/ui, Clerk, Postgres (Neon) through Drizzle ORM,
Stripe, Resend, and Vitest.

> Next.js 16 differs from older releases (`proxy.ts` replaces `middleware.ts`, `params` and `cookies()` are async).
> Read the guides in `node_modules/next/dist/docs/` before changing routing code (see [AGENTS.md](AGENTS.md)).
