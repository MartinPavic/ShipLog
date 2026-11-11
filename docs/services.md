# Service setup

Each section ends with the variables to set. `npm run setup` asks for all of them.

## Clerk (authentication and organizations)

1. Create an application at <https://dashboard.clerk.com> and copy the publishable and secret keys.
2. For Teams, enable **Organizations** (Configure, Organizations). The app relies on Clerk's default `org:admin` and
   `org:member` roles: admins manage billing, the AI key, delivery channels and can archive projects; members
   generate, view and edit logs.
3. For production, create a production instance and use its keys (see [Deployment](deployment.md)).

Variables: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` (the sign-in and redirect URLs are already in
`.env.example`).

## Neon (Postgres)

1. Create a project in the Neon console.
2. Use the **pooled** connection string for `DATABASE_URL` and the **direct** one for `DATABASE_URL_UNPOOLED`.
   Migrations need the direct connection.
3. Run `npm run db:migrate`.

Any recent Postgres should work, because the app uses the standard `pg` driver and no Neon-specific features. The test suite is run against Postgres 17 in CI.
Neon is simply the documented path.

Variables: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`.

## GitHub OAuth app

1. GitHub, Settings, Developer settings, OAuth Apps, **New OAuth App**.
2. Authorization callback URL: `<NEXT_PUBLIC_APP_URL>/api/github/callback`, for example
   `http://localhost:3000/api/github/callback`.
3. Generate a client secret.

An OAuth app allows one callback URL, so create a separate app for production. The app asks for the `repo` and
`read:user` scopes. GitHub connections are per person, even inside an organization: each member connects their own.

Variables: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.

## GitLab OAuth (per workspace)

GitLab.com and one self-managed GitLab instance are supported in each workspace. GitLab OAuth credentials are entered
in **Settings** by a workspace admin; they are not deployment-wide environment variables. Every member then connects
their own GitLab account, just as GitHub connections are personal.

1. On GitLab.com, open **Edit profile, Applications**. On a self-managed instance, open the equivalent user
   Applications settings.
2. Create an OAuth application with the redirect URI exactly matching
   `<NEXT_PUBLIC_APP_URL>/api/gitlab/callback`, for example `https://shiplog.example.com/api/gitlab/callback`.
3. Grant the `read_api` and `read_user` scopes. No write scope is needed.
4. In ShipLog **Settings**, enter the instance URL, client ID and client secret. For GitLab.com use
   `https://gitlab.com`. For self-managed GitLab, use the public HTTPS base URL, including any installation subpath.
5. Each member selects **Connect GitLab** and authorizes their account.

The instance must be publicly reachable over HTTPS. Local, private and link-local addresses are rejected, and outbound
requests verify DNS results before connecting, preserve TLS hostname verification, reject redirects and use bounded
timeouts. Private-network-only GitLab installations are not supported. Each workspace can configure only one GitLab
instance. Replacing OAuth credentials or changing the instance URL disconnects all GitLab members; changing or removing
the URL is blocked while a project still references a GitLab repository. GitLab access and rotating refresh tokens,
and the OAuth client secret, are encrypted at rest using `ENCRYPTION_KEY`. Repository browsing is limited to 60
requests per member per hour.

## Stripe (optional)

Skip this if you set `BILLING_ENABLED=false`.

1. Create four monthly recurring prices and copy each id:
   - Pro BYOK: EUR 12/month
   - Pro Managed AI: EUR 19/month
   - Ultra BYOK: EUR 22/month
   - Ultra Managed AI: EUR 29/month
2. For each price, set tax behavior to **inclusive** (VAT-inclusive display and checkout).
3. Enable **Stripe Tax** automatic tax and add your required tax registrations before going live.
4. Forward webhooks while developing, and use the printed signing secret:

   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```

5. Enable the **customer portal** in the Stripe dashboard so "Manage billing" works, and allow switching across all four prices.
6. Try the lifecycle with `stripe trigger checkout.session.completed`, `customer.subscription.deleted` and
   `invoice.payment_failed`. Events are processed once per id, so replays are safe.

In production, add a webhook endpoint for `<APP_URL>/api/webhooks/stripe` with these events:
`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` and
`invoice.payment_failed`.

The landing page prices are VAT-inclusive display values. Keep them aligned with the four Stripe prices above.

Variables: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_BYOK_ID`, `STRIPE_PRICE_PRO_MANAGED_ID`, `STRIPE_PRICE_ULTRA_BYOK_ID`, `STRIPE_PRICE_ULTRA_MANAGED_ID`.

## Microsoft Teams delivery

ShipLog sends Microsoft Teams notifications through channel-specific Workflows webhook URLs. Teams is a paid delivery
channel that follows the same delivery limits as Slack, Discord and email, so it is available whenever
`DELIVERY_ENABLED` is on and the plan includes delivery. Configure one workflow per channel and paste that trigger URL
into the project's Delivery tab. The URL can carry a secret query string, so it is stored encrypted with
`ENCRYPTION_KEY` and is never shown again or written to logs.

1. In Microsoft Teams, open the target channel and create a **Workflows** flow from a template that posts to the
   channel When a Teams webhook request is received.
2. Copy the generated HTTPS webhook URL (`logic.azure.com` host) and add it as a `Microsoft Teams` channel in ShipLog.
3. Add at least one co-owner to the workflow. Workflows can stop when the original owner leaves the workspace; a
   co-owner keeps delivery operational.
4. Keep payload size in mind: Teams webhook-triggered workflow requests are limited to about 28 KB per message.

Legacy Office 365 connector webhooks are retired and are not supported by ShipLog. Use Workflows webhooks only.

This delivery integration is separate from Clerk Organizations. `TEAMS_ENABLED` controls ShipLog organization
workspaces, while `DELIVERY_ENABLED` controls whether Slack/Discord/Microsoft Teams/email delivery is available.
Teams delivery adds no environment variable and no SQL migration: `delivery_channels.kind` is a plain text column.

## Sentry (optional)

A workspace can add recent Sentry issues as supplemental context for its ship logs. Sentry never replaces the
repository sources: a log is still built from the project's GitHub or GitLab activity, with Sentry issues added when
the project has selected Sentry projects. Only sentry.io is supported. Self-hosted Sentry, OAuth, and Sentry alert
delivery are not supported.

1. In Sentry, create an organization auth token (or an internal integration token) with the read-only scopes
   `project:read` and `event:read` and nothing else.
2. A workspace admin opens Settings, enters the Sentry organization slug and the token, and saves. ShipLog verifies both
   against Sentry before storing anything. The token is encrypted with `ENCRYPTION_KEY`, shared by the whole
   workspace, and only its last four characters are ever shown. Members can see the connection status; only admins can
   change or remove it.
3. In a project's settings, pick the Sentry projects to include (up to 20). Projects without a selection never call
   Sentry, for manual and scheduled runs alike.

Each report counts events for an issue only inside the report window. The issue's lifetime count is never used. ShipLog
reads a bounded number of issues and event pages per run (at most 25 issues), so on very busy projects the issue and
event lists are capped: counts that hit the cap are lower bounds, marked "at least" in the context given to the model,
which is also told the list is not complete. Selections store only the Sentry project ID, slug and name, and every ID is
verified against the connected organization when you save the selection. If Sentry later refuses access, the run fails
with a clear Sentry error instead of silently omitting the source.

Disconnecting Sentry deletes the stored token but keeps each project's selections, so reconnecting restores them.
Until then, runs for projects with selections fail with a prompt to connect Sentry; scheduled runs are skipped and the
project creator is notified. If the stored token can no longer be read (for example after changing `ENCRYPTION_KEY`),
ShipLog asks you to reconnect Sentry. Sentry adds no environment variable.

## Resend (optional)

Used for the email delivery channel and for failure notices about scheduled logs. Verify a sending domain, then set
the key and a sender such as `Your App <noreply@yourdomain.com>`. Without them the email channel reports that it is not
configured.

Variables: `RESEND_API_KEY`, `RESEND_FROM`.

## OpenAI for managed AI (optional)

Pro Managed AI and Ultra Managed AI always use the server's OpenAI key, ignoring any saved workspace key (50 generations
on Pro Managed AI and 200 on Ultra Managed AI by default). Free and paid BYOK subscriptions require a workspace key.
Set `MANAGED_AI_ENABLED=false` to never use the server key. Managed AI subscriptions then cannot generate: restore the
server configuration or change the subscription to BYOK in the billing portal. There is no automatic fallback.
With billing disabled, workspaces prefer a saved workspace key, otherwise use available server-managed AI.

Variable: `OPENAI_API_KEY`.

## Scheduled logs (cron)

`vercel.json` calls `/api/cron/scheduled-logs` once a day at 21:00 UTC, the most frequent schedule the Vercel Hobby plan
allows. Set `CRON_SECRET` on your host; Vercel sends it as a Bearer token automatically. On another host, call the
endpoint hourly yourself:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.example.com/api/cron/scheduled-logs
```

A project's schedule becomes due on its chosen weekday from its chosen hour (in its timezone) until local midnight, runs
once per week, and retries transient failures up to three times. With the daily cron, only projects whose due window
includes 21:00 UTC fire, so a late chosen hour in a far-east timezone can be missed; on a Vercel Pro plan set the
schedule back to `0 * * * *` for full hourly accuracy.

Variable: `CRON_SECRET` (16 or more characters).
