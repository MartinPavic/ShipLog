# Deployment

The app is a standard Node.js Next.js application. Vercel is the easiest host because `vercel.json` already schedules
the cron job.

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FYOUR_ACCOUNT%2FYOUR_REPO&env=NEXT_PUBLIC_APP_URL,NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,CLERK_SECRET_KEY,DATABASE_URL,ENCRYPTION_KEY,GITHUB_CLIENT_ID,GITHUB_CLIENT_SECRET,CRON_SECRET&envDescription=See%20docs%2Fconfiguration.md%20for%20every%20variable)

Replace `YOUR_ACCOUNT/YOUR_REPO` in that link with your own repository once you have pushed the code, then use it in
your README or listing. Or deploy by hand:

1. Push the project to your own Git repository and import it in Vercel.
2. Add every variable from [Configuration](configuration.md) under Settings, Environment Variables. At minimum:
   `NEXT_PUBLIC_APP_URL` (your https URL), the Clerk keys, `DATABASE_URL`, `ENCRYPTION_KEY`, the GitHub OAuth pair and
   `CRON_SECRET`; plus the Stripe variables unless `BILLING_ENABLED=false`.
3. Deploy. The build does not need a database.
4. Apply the migrations to the production database (below).

## Production checklist

- [ ] **Clerk:** use a production instance and its keys; add your domain; enable Organizations if you use Teams.
- [ ] **GitHub:** a separate OAuth app whose callback URL is `https://your-domain/api/github/callback`.
- [ ] **Stripe:** live keys and price, a webhook endpoint for `https://your-domain/api/webhooks/stripe` with the four
      events listed in [Service setup](services.md#stripe-optional), and the customer portal enabled.
- [ ] **Database:** run migrations (below). Use the pooled URL for `DATABASE_URL`.
- [ ] **Secrets:** a new `ENCRYPTION_KEY` for production, stored somewhere safe. Never reuse the development one.
- [ ] **Cron:** `CRON_SECRET` set on the host.
- [ ] **Email:** a verified Resend domain, if you use email delivery.
- [ ] **Legal:** the Terms and Privacy pages replaced and `legal.reviewed` set to `true`.
- [ ] **Branding:** `src/config/site.ts` updated, including `supportEmail`.
- [ ] **Health:** `https://your-domain/api/health` returns `{"db":"ok","schemaReady":true}`.

## Running migrations in production

From your machine, pointing at the production database (use the direct connection):

```bash
DATABASE_URL_UNPOOLED="postgres://..." npm run db:migrate
```

Run this before deploying a version that changes the schema. Migrations that were already applied are skipped, so repeating it is safe.

## Deploying elsewhere

```bash
npm ci
npm run build
npm start
```

Use Node.js 22.12 or newer and set the same variables. Something must call
`GET /api/cron/scheduled-logs` with `Authorization: Bearer $CRON_SECRET` every hour (a host cron job or an external
scheduler), or leave `SCHEDULING_ENABLED=false`. Generation requests can run for up to two minutes, so make sure your
platform does not cut requests off earlier.

## Environment validation

When the production server starts it checks the environment and refuses to serve if a required value is missing or
malformed, listing every problem. Run `npm run setup -- --check --production --db` locally or in CI to see the same
report before deploying.
