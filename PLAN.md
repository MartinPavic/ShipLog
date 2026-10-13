# ShipLog v2 — Implementation Plan

Covers the product build (Part A) and selling the source code on Gumroad (Part B).

## Decisions

| Area | Decision |
| --- | --- |
| Database | Neon Postgres + Drizzle ORM |
| GitHub access | GitHub OAuth app, own OAuth flow, encrypted token stored in DB |
| AI keys | BYOK on Free, managed AI on Pro |
| Scope | Security fixes, projects + history, richer generation, sharing/exports, delivery/scheduling, dashboard/onboarding, Teams |
| Tenancy | Every tenant table keyed by `ownerId = orgId ?? userId` (Clerk Organizations) |
| Code sale | Gumroad, single-developer / single-end-product license |
| Hosted app | Own hosted ShipLog stays on Stripe billing |
| Buyer setup | Docs + setup script |
| DB at launch | Neon only (no Docker / local Postgres) |

### Plan limits (adjustable in `src/lib/plans.ts`)

- **Free:** 1 project, 5 generations/month, BYOK only, 10 newest logs visible, share links allowed.
- **Pro:** unlimited projects, 200 managed-AI generations/month (fair use; unlimited with BYOK), full history, scheduling, delivery, PDF export, teams.

> **Next.js 16 caveat:** read `node_modules/next/dist/docs` (see `AGENTS.md`) before touching routes. `proxy.ts` replaces `middleware.ts`, and `params`/`cookies()`/`headers()` are async.

## Current-state findings this plan addresses

- Secrets (GitHub PAT, AI key) are stored plaintext in Clerk `privateMetadata` and sent back to the browser by the settings page.
- The settings route overwrites keys with `""` on a partial save and has no validation.
- Stripe webhook `customer.subscription.deleted` is an empty stub, so cancelled users stay Pro. No billing portal, no idempotency, a new Stripe customer per checkout.
- Usage counter is read-modify-write on Clerk metadata, so concurrent requests bypass the 5/month limit.
- AI calls never check `res.ok`, so failures are saved as logs and consume quota. Model names are outdated.
- `days` is not clamped and `repo` is not validated before being put in a GitHub URL.
- History is capped at 10 logs by Clerk's 8 KB metadata limit, which blocks per-project history.
- Dead code: `dashboard-nav.tsx`, `ship-log-form.tsx`, `ship-log-history.tsx`, `lib/ai.ts`.
- `UserButton afterSignOutUrl` fails the type check, and several `any` types remain.
- Auth is enforced per page only; `proxy.ts` is bare `clerkMiddleware()`.
- Root layout metadata is still "Create Next App".

---

# Part A — Product build

## Phase 0 — Prep (blocks everything)

1. Read `AGENTS.md` and the relevant Next 16 docs. Install `drizzle-orm`, `@neondatabase/serverless`, `drizzle-kit` (dev), `zod`, `react-markdown`, `remark-gfm`, `vitest` (dev). Add to `.env.example`: `DATABASE_URL`, `ENCRYPTION_KEY` (32 bytes, base64), `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `OPENAI_API_KEY` (managed), `RESEND_API_KEY`, `RESEND_FROM`, `CRON_SECRET`.
2. Cleanup: delete unused `dashboard-nav`, `ship-log-form`, `ship-log-history`; fix the `UserButton` type error in `dashboard/layout.tsx`; replace `any` types.
3. `src/proxy.ts`: use `createRouteMatcher` to protect `/dashboard(.*)` and `/api/(settings|projects|ship-log|stripe/checkout|github)(.*)`. Leave `/api/webhooks/stripe`, `/api/cron`, `/s/*`, `/p/*` public.

## Phase 1 — Foundations (after 0)

4. Create `src/db/schema.ts`, `drizzle.config.ts`, `src/db/index.ts`. Tables:
   - `billing_accounts` (ownerId pk, plan, stripeCustomerId, stripeSubscriptionId, status, currentPeriodEnd)
   - `usage_counters` (ownerId, period `YYYY-MM`, kind, count; composite pk)
   - `stripe_events` (id pk)
   - `github_connections` (userId pk, login, encryptedToken, scopes)
   - `ai_credentials` (ownerId, provider, encryptedKey, last4, model)
   - `projects` (id, ownerId, createdBy, name, slug unique per owner, description, repos jsonb `[{fullName, branch?}]`, template, tone, audience, customPrompt, defaultPeriodDays, schedule jsonb, isPublicChangelog, archivedAt)
   - `ship_logs` (id, projectId, ownerId, createdBy, title, content md, periodStart, periodEnd, template, provider, model, status `generating|ready|failed`, error, sourceSnapshot jsonb, pinned, shareToken, sharePasswordHash, createdAt)
   - `ship_log_versions` (id, logId, content, createdBy, createdAt)
   - `delivery_channels` (id, projectId, kind `slack|discord|email`, encryptedConfig, enabled)
   - `deliveries` (id, logId, channelId, status, error, sentAt)
   - Indexes on `ownerId`, `(projectId, createdAt desc)`, unique `shareToken`.
5. Shared libs:
   - `src/lib/crypto.ts` — AES-256-GCM encrypt/decrypt with `ENCRYPTION_KEY`, mask helper
   - `src/lib/owner.ts` — `getOwner()` returning `{userId, orgId, ownerId, orgRole}`, `requireAdmin`
   - `src/lib/plans.ts` — limits + `getPlan(ownerId)`
   - `src/lib/validation.ts` — zod schemas
   - `src/lib/api.ts` — typed JSON error helper
6. Generate and run the first migration against Neon.

## Phase 2 — Security and billing fixes (after 1; steps parallel except 11)

7. **Settings:** replace `/api/settings` with `/api/settings/ai` (+ `DELETE`). zod-validated provider allow-list, encrypt the key, store `last4`, update only provided fields (no blanking), never return secrets. `settings-form` shows a masked value with a "Replace" flow. Remove secrets from `settings/page.tsx` props.
8. **Usage:** `lib/usage.ts` — `reserveGeneration(ownerId)` is a single SQL upsert that increments only when under the limit (`RETURNING`); `releaseGeneration()` on failure. Count managed vs BYOK separately.
9. **Stripe:**
   - Checkout reuses `stripeCustomerId`, blocks already-active subscribers, sets `ownerId` metadata, admin-only for orgs.
   - New `/api/stripe/portal` and a "Manage billing" button in Settings.
   - Webhook rewritten: idempotency via `stripe_events` insert; handles `checkout.session.completed`, `customer.subscription.updated`/`deleted`, `invoice.payment_failed`; updates `billing_accounts` by `stripeCustomerId`; plan derived from status `active|trialing`.
10. **AI error handling:** check `res.ok`, timeouts via `AbortSignal`, map provider errors to friendly messages; save the log and keep the usage count only on success. Model names configurable in `lib/ai/models.ts` (current names).
11. **Input validation** *(depends on 5):* clamp `days` to 1–90, validate `repo` with `^[\w.-]+/[\w.-]+$`, zod on every body.
12. **Migration script:** `scripts/migrate-clerk-metadata.ts` — idempotent, with a dry-run flag. Moves `githubToken`, `aiApiKey`, `plan`, `shipLogs` from Clerk `privateMetadata` into the DB (default project "Imported"), then clears the keys.

## Phase 3 — GitHub OAuth (after 1; parallel with Phase 2)

13. Routes:
    - `/api/github/connect` — state cookie, scopes `repo read:user`
    - `/api/github/callback` — verify state, exchange code, encrypt and store token, redirect to Settings
    - `DELETE /api/github/disconnect`
    - `GET /api/github/repos` — paginated repo list for the picker, briefly cached
14. `lib/github.ts`: client with token, `getViewer`, `listRepos`, `fetchActivity(repos, since, until)` covering commits (skip merge commits and bot authors), merged PRs (title, body excerpt, labels), closed issues, releases. Pagination caps, per-repo grouping, chunk and summarise when over an item budget.
15. Settings "GitHub" card: connect/disconnect, shows the login.

## Phase 4 — Projects and per-project history (after 1 and 3)

16. API: `/api/projects` (GET/POST), `/api/projects/[id]` (GET/PATCH/DELETE = archive). Enforce the Free-plan 1-project limit via `plans.ts`.
17. Pages: `dashboard/projects` (list + create) and `dashboard/projects/[id]` (overview, settings tab, history tab). Project form: name, description, repo multi-picker, template, tone, audience, custom prompt, default period.
18. History:
    - `/api/projects/[id]/logs` (GET, paginated, search `q`, date range, pinned filter)
    - `/api/logs/[id]` (GET; PATCH edits content/title/pinned and writes `ship_log_versions`; DELETE)
    - Regenerate action. Free plan shows the 10 newest.
    - Header project switcher (cookie or URL param). `/dashboard/ship-log` redirects to the last project.
19. Markdown rendering component (`react-markdown`) for logs.

## Phase 5 — Generation pipeline (after 2, 3, 4)

20. `lib/ai/providers.ts`: `streamCompletion({provider, key, model, system, prompt})` for OpenAI, Anthropic, Grok via `fetch` + SSE parsing; managed mode uses the server key (Pro only). `lib/ai/templates.ts`: weekly update, changelog, standup, client report, release notes, investor update; composes tone, audience, and custom prompt; outputs Markdown. Replaces dead `lib/ai.ts`.
21. `POST /api/projects/[id]/generate` (set `maxDuration`): auth + ownership check, reserve usage, insert `ship_logs` with `status=generating`, fetch GitHub activity, stream text to the client (header `X-Ship-Log-Id`). On end: save content and snapshot, `status=ready`. On error: release usage, `status=failed`.
22. Rewrite `ship-log-client`: streaming display, template/period/date-range controls, shows source commits/PRs, copy and regenerate, usage meter ("3/5").

## Phase 6 — Sharing and exports (after 4 and 5; parallel with 7)

23. Share: `POST/DELETE /api/logs/[id]/share` — random 32-byte base64url token, optional scrypt-hashed password. Public `/s/[token]` page: read-only, `noindex`, password gate via signed httpOnly cookie. Public changelog `/p/[ownerSlug]/[projectSlug]` for projects with `isPublicChangelog`.
24. Exports: copy as Markdown / HTML / Slack mrkdwn, download `.md`. PDF via a print-stylesheet page and the browser print dialog (no server PDF library; Pro).

## Phase 7 — Delivery and scheduling (after 5; parallel with 6)

25. Channels: `/api/projects/[id]/channels` CRUD (Slack/Discord webhook URL encrypted, email recipients). `lib/delivery.ts` senders (Slack/Discord via `fetch` POST, email via Resend). "Send now" on a log; results recorded in `deliveries`.
26. Scheduling: `project.schedule {enabled, dayOfWeek, hour, timezone, periodDays, autoDeliver}`. `vercel.json` hourly cron hits `/api/cron/scheduled-logs`, guarded by `Bearer CRON_SECRET`. It picks due projects (idempotent per period), uses the project creator's GitHub connection, reserves usage, generates (non-streaming), and delivers. Pro only; skip and notify when the token or usage is invalid.

## Phase 8 — Dashboard and onboarding (after 4 and 5)

27. `dashboard/page.tsx`: stats (logs this month, projects, last generated), usage meter, recent logs, quick generate, plan badge and upgrade CTA. Onboarding checklist derived from DB state: GitHub connected, AI key or Pro managed AI, first project, first log.

## Phase 9 — Teams (after 2 and 4)

28. Enable Clerk Organizations; add `OrganizationSwitcher` in the header; scope every query by `getOwner().ownerId`. Roles: admin = billing, credentials, channels, delete project; member = generate, view, edit logs. Org billing is flat per org (no per-seat). Personal workspace remains the default.
29. AI credentials are per owner; GitHub tokens are per user. Projects store `createdBy`; generation uses the current user's GitHub connection, scheduled runs use the creator's.

## Phase 10 — Quality (continuous; finalised last)

30. vitest unit tests: crypto round-trip, plans/limits, usage reservation (test DB or mocked), GitHub activity normalisation/filtering, prompt/template builder, Stripe webhook handler (mock events + idempotency), share token/password.
31. Rewrite README (setup, env, Stripe CLI, GitHub OAuth app, cron). Add `error.tsx`, `loading.tsx`, `not-found` per segment. Basic DB-based rate limit on generate (per owner).

## Relevant files

- Modify: `src/proxy.ts`, `src/app/layout.tsx`, `src/app/dashboard/{layout,page}.tsx`, `src/app/dashboard/settings/page.tsx`, `src/app/dashboard/ship-log/page.tsx` (becomes redirect)
- Rework: `src/app/api/{settings,stripe/checkout,webhooks/stripe,ship-log/generate}/route.ts`
- Components: `src/components/{settings-form,ship-log-client,upgrade-button}.tsx`
- Libraries: `src/lib/stripe.ts`, `src/lib/ai.ts` (replaced by `src/lib/ai/`)
- New: `src/db/*`, `src/lib/{crypto,owner,plans,usage,validation,github,delivery}.ts`, `src/lib/ai/*`, projects/logs/github/cron API routes, `/s/[token]`, `/p/*`, `vercel.json`, `drizzle.config.ts`, `scripts/migrate-clerk-metadata.ts`, `vitest.config.ts`

## Verification (Part A)

1. After each phase: `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean.
2. `npx drizzle-kit generate && npx drizzle-kit migrate`; inspect the schema in Neon.
3. `vitest run` for the Phase 10 test list.
4. Stripe CLI: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`, then `stripe trigger checkout.session.completed` / `customer.subscription.deleted` / `invoice.payment_failed`. Replay the same event twice and confirm a single effect. Confirm the plan flips to Free on cancel.
5. Concurrency: fire 10 parallel generate requests on a Free account; exactly 5 succeed.
6. Manual run-through: connect GitHub, create a project with 2 repos, generate (streaming), edit a log (version saved), share link with password, open public changelog, send to a test Slack webhook, call `/api/cron/scheduled-logs` with and without `CRON_SECRET`, switch org and confirm data isolation (a member cannot see personal projects or billing).
7. Confirm settings page HTML and API responses never contain raw tokens or keys.

---

# Part B — Selling on Gumroad (source code) alongside the hosted app

**Facts:** Gumroad is merchant of record for the code sale (it handles sales tax/VAT worldwide). Fees: 10% + $0.50 per direct sale, 30% for sales through Discover. Tax on your own hosted subscriptions (Stripe) stays your responsibility; consider Stripe Tax. This is not legal advice — have the license and ToS reviewed.

**Assessment:** the codebase is not sellable as-is. It needs de-branding, feature flags, setup tooling, docs and clean packaging. Generic boilerplates are a crowded market, so position it as a finished micro-SaaS (AI changelog / ship-log) that buyers can rebrand and launch.

## Phase 11 — Productize (pull steps 32–33 into Phases 0/1 to avoid rework)

32. `src/config/site.ts`: name, tagline, domain, support email, logo, brand colors (CSS variables), pricing copy. Replace hardcoded "ShipLog" in the landing page, layout metadata, footers, emails, share/changelog pages, OG tags.
33. `src/env.ts`: central zod env validation (fail fast, list missing vars) plus feature flags: `BILLING_ENABLED` (off means everyone unlimited), `MANAGED_AI_ENABLED` (needs a server key), `TEAMS_ENABLED`, `SCHEDULING_ENABLED`, `DELIVERY_ENABLED`. UI hides disabled features. Add a mock AI provider (`AI_PROVIDER=mock`) for demos and tests.
34. De-author: grep for hardcoded emails/URLs/price IDs, keep `.env.example` complete, never ship `.env.local`, rotate any dev keys used, package from tracked files only.
35. Real landing page (hero, features, pricing from config, FAQ) and legal templates (Terms/Privacy placeholders clearly marked "replace me"); screenshots and OG image.

## Phase 12 — Buyer experience (after Phase 10)

36. `scripts/setup.ts` (`npm run setup`, dependency-free readline): check Node version, copy `.env.example` to `.env.local`, generate `ENCRYPTION_KEY` and `CRON_SECRET`, prompt per service (skippable), validate `DATABASE_URL`, run migrations, optional seed, print remaining manual steps (Clerk, Stripe webhook, GitHub OAuth callback URL). Idempotent, never overwrites without confirmation, `--check` mode for CI.
37. `scripts/seed.ts`: demo workspace (project, logs, usage) that works without GitHub or AI keys.
38. `docs/`: getting started; service setup (Clerk, Neon, Stripe, GitHub OAuth, Resend, Vercel Cron); configuration reference (every env var and flag); architecture and data model; customization (branding, plan limits, templates, adding an AI provider); deployment (Vercel + deploy button); troubleshooting/FAQ; upgrade guide. Plus `CHANGELOG.md`.
39. Vercel deploy button and `vercel.json` (cron). Docker excluded.
40. CI (GitHub Actions): tsc, lint, vitest, build, `npm audit`, no `any`. Generate `THIRD_PARTY_NOTICES` via license-checker and verify every dependency license allows redistribution.

## Phase 13 — Packaging and Gumroad listing (last)

41. `scripts/package-release.ts`: `git archive` of a tagged commit into a zip (excludes `.env*`, `.next`, `node_modules`, `.git`, internal notes); injects `LICENSE.md` and `VERSION`; secret scan (`sk_`, `whsec_`, `ghp_`, `AKIA`, etc.) fails the build on any hit; writes a SHA-256 checksum. Smoke test: unzip to a temp dir, `npm ci`, `npm run build` with dummy env, `npm run setup -- --check`.
42. `LICENSE.md`: single developer, single end product; may build and sell a SaaS on top; no resale or redistribution of the source or as a competing boilerplate; no attribution required; updates included for v1.x. Lawyer review.
43. Gumroad product: digital product with the zip. Cover image, 4–5 screenshots, 60–90 s demo video, live read-only demo (own hosted instance seeded in demo mode). Description covers features, stack, what's included/not, required accounts and their free tiers, and support policy. Test a launch price around $79–149. Decide the refund policy up front (code is hard to "return"). Post-purchase message with setup steps and docs link. License keys / sale ping only if useful (verify current Gumroad docs; keys can gate updates and support, not the code itself).
44. Updates and support: semver tags, `CHANGELOG`, upload each new zip and email buyers through Gumroad; support via email form or GitHub issues with a stated response window. Private-repo invite automation deferred.
45. Launch checklist (non-code): Indie Hackers, X, Reddit r/SaaS, Product Hunt. Drive your own traffic (direct link fee 10% + $0.50 vs 30% via Discover).
46. Hosted instance separation: own Stripe, Clerk, Neon and GitHub OAuth app; Terms and Privacy live; Stripe Tax decision.

## Verification (Part B)

1. Fresh-machine test: new directory, only the zip and docs, brand-new Clerk/Neon/Stripe test accounts. Record gaps and fix docs/scripts until setup works.
2. Build and smoke test with flags off: `BILLING_ENABLED=false`, `MANAGED_AI_ENABLED=false`, `TEAMS_ENABLED=false`.
3. Secret scan has zero hits on the zip; `npm audit` clean; license check passes; zip listing has no `.env`, `.git`, `.next`.
4. Test purchase with a 100% coupon: download, verify checksum, check the post-purchase email and links.
5. Rebrand test: change only `src/config/site.ts` and the logo, then grep for leftover "ShipLog" strings.

## Risks

- Once delivered, the zip can be shared. The license and good updates are the only real protection.
- Supporting buyers across different Clerk, Stripe, Neon and GitHub OAuth setups is ongoing work; the setup script and docs exist to reduce it.

---

## Suggested release cut

- **Release 1 (shippable core):** Phases 0–5.
- **Release 2:** Phases 6–9.
- **Before Gumroad:** Phases 10–13.

## Excluded

Per-seat billing, GitHub App / webhook ingestion, GitLab / Bitbucket / Linear / Jira, Notion integration, server-side PDF generation, analytics, dark-mode toggle, Docker / local Postgres, private-repo invite automation, paid setup service, tiered licenses.

## Open considerations

1. The managed-AI model and the 200/month cap affect margin at €9/month; check per-generation cost before locking them in.
2. Free users get share links as a growth lever; gate to Pro if you prefer.
3. Neon-only at launch limits buyers; supporting plain Postgres would need a second driver path.
