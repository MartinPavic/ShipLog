# Getting started

## What you need

- Node.js 22.12 or newer and npm.
- Free accounts at [Clerk](https://clerk.com) (sign-in), [Neon](https://neon.com) (Postgres) and GitHub (an OAuth app).
- Optional: [Stripe](https://stripe.com) for paid plans, [Resend](https://resend.com) for email, an OpenAI key for managed AI.

[Service setup](services.md) walks through each account. None of the optional ones is needed to start.

## Run it locally

```bash
npm install
npm run setup
npm run dev
```

`npm run setup` is a guided script. It:

1. creates `.env.local` from `.env.example` (with owner-only permissions),
2. generates `ENCRYPTION_KEY` and `CRON_SECRET`,
3. asks for each service's credentials; press Enter to skip any step,
4. asks whether you want billing and whether to use demo AI,
5. checks the database connection and applies the migrations,
6. prints what is still left to do by hand.

It is safe to run again: existing values are never replaced without asking. Back up `ENCRYPTION_KEY`. Stored GitHub
tokens, AI keys and webhook URLs cannot be decrypted without it.

Prefer to do it by hand? Copy `.env.example` to `.env.local`, fill it in following the [configuration
reference](configuration.md), run `npm run db:migrate`, then `npm run dev`.

To check an environment without prompts, for example in CI, run `npm run setup -- --check` (add `--production` for the
production rules and `--db` to test the database connection). It exits with code 1 when something is wrong.

## First run

1. Open <http://localhost:3000> and sign up.
2. In **Settings**, connect GitHub, then add an AI key (or enable demo mode, below).
3. Create a project, pick repositories and a template, and click **Generate**.

## Look around without GitHub or an AI key

```bash
# .env.local
AI_PROVIDER=mock
```

Sign up once, then run:

```bash
npm run seed
```

This adds a demo project with four weekly logs, their source activity and a version history to your newest account.
Demo mode replaces AI calls with a deterministic placeholder generator; you still need GitHub connected to generate
new logs. The demo project counts toward your plan's project limit. Remove it with `npm run seed -- --remove`, or
recreate it with `npm run seed -- --reset`. See `scripts/seed.ts` for the other options (`--owner`, `--usage`, `--yes`).

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server. |
| `npm run typecheck` / `npm run lint` | Static checks. |
| `npm test` | Unit tests. Database tests run when `DATABASE_URL` is set and use throwaway `test_` rows; point it at a development database. |
| `npm run db:generate` / `npm run db:migrate` | Create and apply migrations after editing `src/db/schema.ts`. |
| `npm run licenses` | Regenerate `THIRD_PARTY_NOTICES.md` and verify dependency licenses. |
