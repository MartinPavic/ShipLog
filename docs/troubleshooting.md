# Troubleshooting

**The production server starts but every request returns 500 and the log says "Invalid environment".**
The startup check found a missing or malformed variable and listed it. Fix it, or run
`npm run setup -- --check --production` to see the same list.

**"ENCRYPTION_KEY must be 32 bytes".**
Generate one with `openssl rand -base64 32`. After changing the key, previously stored GitHub/GitLab tokens, GitLab
OAuth secrets and AI keys cannot be read: reconnect the source accounts and re-enter affected credentials.

**Every request returns 500 after editing `src/proxy.ts`.**
Clerk route matcher patterns cannot contain nested capture groups. `next build` does not catch this, so request an API
route after changing the file.

**The organization switcher shows an error.**
Enable Organizations in the Clerk dashboard, or set `TEAMS_ENABLED=false`.

**Connecting GitHub redirects back with "not configured".**
Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. If GitHub shows a redirect URI mismatch, the OAuth app's callback URL
must be exactly `<NEXT_PUBLIC_APP_URL>/api/github/callback`.

**Connecting GitLab fails or returns to Settings with an error.**
Check that a workspace admin configured the correct GitLab host, OAuth client ID and secret, and that the app's
redirect URI is exactly `<NEXT_PUBLIC_APP_URL>/api/gitlab/callback` with the `read_api` and `read_user` scopes. A
self-managed instance must be publicly reachable over HTTPS; private and local hosts are deliberately rejected.

**"Add your AI API key in Settings first."**
Free and BYOK subscriptions require a workspace key, regardless of server-managed AI availability. Add a key in Settings,
or set `AI_PROVIDER=mock` for placeholder output.

**"Managed AI is unavailable".**
The subscription is locked to Managed AI, but `MANAGED_AI_ENABLED=false` or `OPENAI_API_KEY` is missing. Restore managed
AI configuration or change the subscription to BYOK through billing management. A saved workspace key is not a fallback.

**A Free workspace can't create a second project.**
That is the plan limit. The demo project from `npm run seed` counts too: remove it with `npm run seed -- --remove`.

**Stripe checkout works but the plan never changes to Pro.**
The webhook is not reaching the app. Locally, keep `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
running and use its signing secret as `STRIPE_WEBHOOK_SECRET`. In production, check the endpoint URL, that the four
events are selected, and the delivery log in the Stripe dashboard.

**Billing is enabled, but startup says a Stripe variable is missing.**
Set all four price IDs (`STRIPE_PRICE_PRO_BYOK_ID`, `STRIPE_PRICE_PRO_MANAGED_ID`, `STRIPE_PRICE_ULTRA_BYOK_ID`,
`STRIPE_PRICE_ULTRA_MANAGED_ID`) plus `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. With
`BILLING_ENABLED=false`, none of those Stripe variables is required.

**A subscription exists in Stripe, but the workspace still looks Free.**
The subscription item price does not match one of the four configured price IDs. Legacy single-price mappings are
ignored by entitlement logic in the three-tier setup.

**Scheduled logs never run.**
Check that `CRON_SECRET` is set, that something calls the cron endpoint hourly, and that the project's schedule is
enabled. The project's Settings tab shows the last run and why it was skipped. The project creator's GitHub or GitLab
connection is used; in an organization an admin can take the schedule over from the project's settings.

**`/api/health` reports `"schemaReady": false`.**
The migrations have not been applied to that database. Run `npm run db:migrate` with `DATABASE_URL_UNPOOLED` set.

**Database tests fail to connect.**
Point `DATABASE_URL` at a disposable local Postgres database with migrations applied. Never run database tests against
production or a shared development database. Without `DATABASE_URL` those suites are skipped.

**`npm run setup` says it is interactive.**
It needs a terminal. In scripts and CI use `npm run setup -- --check`.

**A warning about SSL modes appears from `pg`.**
Harmless. To silence it, use `sslmode=verify-full` in the connection string.
