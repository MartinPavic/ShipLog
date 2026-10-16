# Troubleshooting

**The production server starts but every request returns 500 and the log says "Invalid environment".**
The startup check found a missing or malformed variable and listed it. Fix it, or run
`npm run setup -- --check --production` to see the same list.

**"ENCRYPTION_KEY must be 32 bytes".**
Generate one with `openssl rand -base64 32`. After changing the key, previously stored GitHub tokens and AI keys cannot
be read: reconnect GitHub and re-enter the AI key.

**Every request returns 500 after editing `src/proxy.ts`.**
Clerk route matcher patterns cannot contain nested capture groups. `next build` does not catch this, so request an API
route after changing the file.

**The organization switcher shows an error.**
Enable Organizations in the Clerk dashboard, or set `TEAMS_ENABLED=false`.

**Connecting GitHub redirects back with "not configured".**
Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. If GitHub shows a redirect URI mismatch, the OAuth app's callback URL
must be exactly `<NEXT_PUBLIC_APP_URL>/api/github/callback`.

**"Add your AI API key in Settings first."**
The workspace has no key and managed AI is not available to it (Free plan, `MANAGED_AI_ENABLED=false`, or no
`OPENAI_API_KEY`). Add a key in Settings, or set `AI_PROVIDER=mock` for placeholder output.

**A Free workspace can't create a second project.**
That is the plan limit. The demo project from `npm run seed` counts too: remove it with `npm run seed -- --remove`.

**Stripe checkout works but the plan never changes to Pro.**
The webhook is not reaching the app. Locally, keep `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
running and use its signing secret as `STRIPE_WEBHOOK_SECRET`. In production, check the endpoint URL, that the four
events are selected, and the delivery log in the Stripe dashboard.

**Scheduled logs never run.**
Check that `CRON_SECRET` is set, that something calls the cron endpoint hourly, and that the project's schedule is
enabled. The project's Settings tab shows the last run and why it was skipped. The project creator's GitHub connection is
used; in an organization an admin can take the schedule over from the project's settings.

**`/api/health` reports `"schemaReady": false`.**
The migrations have not been applied to that database. Run `npm run db:migrate` with `DATABASE_URL_UNPOOLED` set.

**Database tests fail to connect.**
Check `DATABASE_URL` and, on Neon, that the branch is awake. Without `DATABASE_URL` those suites are skipped.

**`npm run setup` says it is interactive.**
It needs a terminal. In scripts and CI use `npm run setup -- --check`.

**A warning about SSL modes appears from `pg`.**
Harmless. To silence it, use `sslmode=verify-full` in the connection string.
