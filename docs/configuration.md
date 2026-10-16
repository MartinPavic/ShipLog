# Configuration reference

All settings come from environment variables (`.env.local` locally, your host's settings in production). The variables
each enabled feature needs are validated when the server starts: in production a missing or malformed value stops the
server and lists every problem at once; in development it only prints a warning. You can run the same check any time
with `npm run setup -- --check`. The rules live in [`src/env.ts`](../src/env.ts).

## Variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Production | `http://localhost:3000` | Public base URL. Used for OAuth callbacks, share links, Stripe redirects and metadata. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | | Clerk publishable key. |
| `CLERK_SECRET_KEY` | Yes | | Clerk secret key. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | No | `/sign-in`, `/sign-up` | Sign-in and sign-up routes. |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` | No | `/dashboard` | Where users land after signing in or up. |
| `DATABASE_URL` | Yes | | Postgres connection string used by the app (the pooled URL on Neon). |
| `DATABASE_URL_UNPOOLED` | For migrations | `DATABASE_URL` | Direct connection used by `drizzle-kit` for `npm run db:migrate`. |
| `ENCRYPTION_KEY` | Yes | | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts stored GitHub tokens, AI keys and webhook URLs, and signs share-link cookies. **Changing it makes stored secrets unreadable.** |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Yes | | GitHub OAuth app. |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` | If billing is on | | Stripe secret key, the Pro price, and the webhook signing secret. |
| `OPENAI_API_KEY` | No | | Server key for managed AI on Pro. |
| `RESEND_API_KEY`, `RESEND_FROM` | No | | Email delivery and scheduled-run failure notices. `RESEND_FROM` looks like `Your App <noreply@yourdomain.com>`. |
| `CRON_SECRET` | If scheduling is on | | Bearer token (16 or more characters) that guards `/api/cron/scheduled-logs`. The endpoint refuses to run without it. |
| `AI_PROVIDER` | No | `live` | `mock` replaces every AI call with an offline placeholder generator. |
| `BILLING_ENABLED`, `MANAGED_AI_ENABLED`, `TEAMS_ENABLED`, `SCHEDULING_ENABLED`, `DELIVERY_ENABLED` | No | on | Feature flags, below. |

## Feature flags

A flag set to `false` (or `0`, `off`, `no`, in any case) switches the feature off everywhere: the UI hides it, the API
refuses it, and the pricing section stops advertising it. Flags can only switch things off; they never grant what a
plan lacks. They are read at runtime, so changing one needs a restart, not a rebuild.

| Flag | When off |
| --- | --- |
| `BILLING_ENABLED` | No paywall: every workspace gets the Pro features without caps. Stripe routes return 404, billing UI and the pricing section are hidden, and no Stripe variables are required. |
| `MANAGED_AI_ENABLED` | The server's `OPENAI_API_KEY` is never used; everyone brings their own key. |
| `TEAMS_ENABLED` | Everyone works in a personal workspace and the organization switcher is hidden. |
| `SCHEDULING_ENABLED` | No scheduled logs. The cron endpoint reports that it skipped, and `CRON_SECRET` is not required. |
| `DELIVERY_ENABLED` | Slack, Discord and email channels and "send now" are unavailable. |

## Demo mode

`AI_PROVIDER=mock` builds a deterministic placeholder log from the real GitHub activity. No provider is called and no
key is needed. Usage limits still apply, and the log is stored with provider `mock`. Use it for demos and local testing.

## Plan limits

Defined in [`src/lib/plans.ts`](../src/lib/plans.ts) and enforced on the server.

| | Free | Pro |
| --- | --- | --- |
| Projects | 1 | Unlimited |
| Generations per month | 5 with your own key | Unlimited with your own key, 200 with managed AI |
| Visible logs per project | 10 newest | All |
| Scheduling, delivery, PDF export, teams | No | Yes |
| Share links and public changelog | Yes | Yes |

A Free **organization** can see its data but cannot create projects or generate until it is upgraded. Billing is flat
per workspace, not per member. With `BILLING_ENABLED=false`, everyone gets the Pro column without the caps.

## Abuse limits

Database-backed and fixed in code:

| Action | Limit |
| --- | --- |
| Generate | 30 per hour per workspace (`GENERATE_RATE` in `src/lib/rate-limit.ts`) |
| Delivery and channel tests | 30 per hour per workspace |
| Share-link password attempts | 10 per 15 minutes per link and address, 100 per hour per link |

## Other settings

- `vercel.json`: the hourly cron schedule.
- `next.config.ts`: security headers. There is no Content-Security-Policy; adding one needs allowances for Clerk and Stripe.
- `src/config/site.ts`: branding and copy, see [Customization](customization.md).
