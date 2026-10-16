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

## Stripe (optional)

Skip this if you set `BILLING_ENABLED=false`.

1. Create a recurring **price** for Pro and copy its id.
2. Forward webhooks while developing, and use the printed signing secret:

   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```

3. Enable the **customer portal** in the Stripe dashboard so "Manage billing" works.
4. Try the lifecycle with `stripe trigger checkout.session.completed`, `customer.subscription.deleted` and
   `invoice.payment_failed`. Events are processed once per id, so replays are safe.

In production, add a webhook endpoint for `<APP_URL>/api/webhooks/stripe` with these events:
`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` and
`invoice.payment_failed`.

The price shown on the landing page comes from `src/config/site.ts` and is display only; the amount charged is the
Stripe price. Keep them in sync.

Variables: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`.

## Resend (optional)

Used for the email delivery channel and for failure notices about scheduled logs. Verify a sending domain, then set
the key and a sender such as `Your App <noreply@yourdomain.com>`. Without them the email channel reports that it is not
configured.

Variables: `RESEND_API_KEY`, `RESEND_FROM`.

## OpenAI for managed AI (optional)

On the Pro plan, workspaces without their own key use the server's OpenAI key (200 generations a month by default).
Set `MANAGED_AI_ENABLED=false` to never use it. Free workspaces always bring their own key.

Variable: `OPENAI_API_KEY`.

## Scheduled logs (cron)

`vercel.json` calls `/api/cron/scheduled-logs` every hour. Set `CRON_SECRET` on your host; Vercel sends it as a Bearer
token automatically. On another host, call the endpoint hourly yourself:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.example.com/api/cron/scheduled-logs
```

A project's schedule becomes due on its chosen weekday from its chosen hour (in its timezone) until local midnight, runs
once per week, and retries transient failures up to three times. Hourly cron jobs need a Vercel plan that allows them.

Variable: `CRON_SECRET` (16 or more characters).
