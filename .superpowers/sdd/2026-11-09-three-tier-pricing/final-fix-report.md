# Three-Tier Pricing Final Fix Report

Date: 2026-11-09
Worktree: `/Users/martinpavic/Private/shiplog/.worktrees/three-tier-pricing`
Branch: `pricing/three-tier`
Baseline: `d83a3a0` (`docs: add three-tier pricing design and plan`), clean before this wave.
Status: All eight final-review findings addressed. No subagents used.

## Scope And Safety

Read the approved design and implementation plan before editing. All database operations, migrations and DB-backed tests used only:

```sh
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:63028/postgres'
export DATABASE_URL_UNPOOLED='postgresql://postgres:postgres@127.0.0.1:63028/postgres'
export ENCRYPTION_KEY='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
```

These are local disposable test credentials. There was no `.env.local` in this worktree; no environment-file secrets were read. No Neon, production database, live Stripe API, deployment, product/price creation, or portal configuration operations were performed. Stripe API calls in billing tests were mocked. Existing source-control and generation integration tests use their established network mocks. No runtime dependency was added. Unrelated worktree files, including `release/config.json`, were untouched.

## Findings And Fixes

1. **VAT address collection:** Checkout now sets `billing_address_collection: "required"` and `customer_update: { address: "auto" }` with automatic tax enabled. Tests assert this for all four price variants and an existing canceled subscriber reusing its customer. Inclusive price setup remains an operator prerequisite, not an external action in this wave.
2. **Concurrent subscription events:** Event claims are checked inside the DB transaction. A subscription advisory lock and the workspace checkout advisory lock now cover current Stripe snapshot retrieval and persistence. The billing account is reread with `FOR UPDATE` after workspace locking, and replaced-subscription identity is rechecked before retrieval/write. All handled event types use this path, including failed invoices. Distinct updated/deleted/checkout/invoice events are tested with a gated mocked Stripe retrieval and real local `pg_locks`. A separate test proves a waiting old-subscription event cannot overwrite a concurrent replacement checkout.
3. **Completed checkout gap:** Under the workspace checkout lock, Checkout paginates live Stripe subscriptions and completed subscription Checkout sessions before creating/reusing an open session. Non-terminal subscriptions, including incomplete/past-due states, require the portal. Completed sessions' subscriptions are retrieved; an unresolved pending subscription fails closed. Reconciliation never grants local paid entitlement. Tests reproduce completion before local webhook persistence and require 409 without a second session.
4. **Mixed prices:** Entitlement resolution requires exactly one subscription item, one recurring price and one recognized configured ShipLog mapping; truncated item lists fail closed. Unknown, legacy, missing, multiple, mixed recurring and mixed one-time combinations map to Free/null. New webhook tests cover these cases.
5. **Downgrade visibility:** Added nullable `billing_accounts.history_retained_through` using generated migration `0009_past_black_queen.sql`, journal and snapshot. Paid-to-Free transitions advance this cutoff; replayed Free events do not. Shared list/open checks retain reports at or before the cutoff in addition to the current plan's newest-log window. Actual project-log list and individual-log GET APIs are covered by a local DB regression with 12 paid reports, cancellation, all reports remaining listable/openable, 12 later Free reports, and replayed cancellation. The never-paid control remains capped at 10 and cannot open its two oldest reports. Existing project limits and project access remain unchanged.
6. **Month-independent settings tests:** Seed settings counters with `currentPeriod()`. The settings suite freezes only `Date` to March 2031 and restores real timers in cleanup, proving no dependence on November 2026.
7. **Billing-off source selection:** Shared `resolveSourceKind` chooses saved BYOK credentials first, otherwise available managed AI, while billing-enabled subscriptions retain their locked mode. Both access resolution and usage meters use it, including mock mode. Setup consumes the shared meter instead of duplicating source/counter selection. Tests compare dashboard meter, setup status and AI access before/after saving a workspace key.
8. **Stale mode copy:** Corrected onboarding, landing features/FAQ, configuration/services/troubleshooting docs and missing-managed-key environment warnings. Free/BYOK requires a workspace key; Managed AI uses only the server key. A managed outage requires restoring configuration or changing subscription mode, never silent BYOK fallback. Landing copy respects the managed feature flag. Existing rendered onboarding assertions now check the accurate copy.

## Design Ruling

The approved design says both that Free has 10 newest reports and that downgrade never hides existing reports. A plan-only `visibleLogs=10` cannot satisfy both, and the original schema had no persistent retention state. The smallest durable resolution is one nullable workspace cutoff, not unlimited history for every former subscriber and not a per-report backfill. The unchanged Free limit applies to never-paid workspaces and later Free reports; pre-downgrade reports remain permanently visible. Repeated paid-to-Free transitions retain newer history, but repeated already-Free events do not expand it. No subscribers exist to backfill, per the approved design. The migration is additive and was applied only locally. No production migration is authorized or executed here.

## RED / GREEN Evidence

All commands below ran from the requested worktree with the explicit local database/key exports above. Focused runs used dummy Stripe price IDs (`price_pro_byok_test`, `price_pro_managed_test`, `price_ultra_byok_test`, `price_ultra_managed_test`) and a dummy secret; all Stripe calls were mocked.

| Check | RED Evidence | GREEN Evidence |
| --- | --- | --- |
| Checkout address + completion race | `npm test -- src/lib/billing.test.ts -t 'checkout and billing portal routes'`: 11 expected failures, 14 passed. Four missing address/update assertions; seven duplicate-checkout responses were 200 instead of 409. | Same command: 25 passed, 35 intentionally unselected. |
| Distinct webhook races + mixed prices | `npm test -- src/lib/billing.test.ts -t 'webhook: subscription lifecycle'`: 7 expected failures, 24 passed. Three mixed-item cases incorrectly granted Pro/BYOK; four event types overlapped two Stripe retrievals. | Full billing suite after implementation: 67 passed. Initial GREEN attempt exposed a test probe expecting the workspace lock rather than the earlier subscription lock; accepting either valid lock and draining both requests in `finally` fixed the probe. |
| Downgrade retention | `npm test -- src/lib/billing.test.ts -t 'preserves pre-downgrade reports'`: paid case failed with total=10/hidden=2 instead of total=12/hidden=0; never-paid case passed. | `npm run db:generate && npm run db:migrate && npm test -- src/lib/billing.test.ts src/lib/projects.test.ts`: 76 passed. Migration commands used only the explicit local URLs. |
| Future-month settings + billing-off meter | `npm test -- src/lib/settings.test.ts`: 3 expected failures, 1 passed. Seeded usage was zero in March 2031; meter chose BYOK/zero instead of managed/4. | `npm test -- src/lib/settings.test.ts src/lib/usage.test.ts src/lib/ai/access.test.ts src/lib/dashboard.test.ts`: 38 passed. |
| Mode copy | `npm test -- scripts/docs.test.ts src/lib/dashboard.test.ts`: 2 expected failures, 22 passed. Stale managed-Pro copy and old AI setup title reproduced. | `npm test -- scripts/docs.test.ts src/lib/dashboard.test.ts src/lib/env.test.ts src/app/landing.test.tsx`: 53 passed. First attempt additionally caught managed copy on a managed-disabled landing; feature-aware copy fixed it. |
| Additional billing boundaries | Added tests for one-time mixed item, truncated items, concurrent replacement identity, and existing-customer address settings. | `npm test -- src/lib/billing.test.ts`: 72 passed. |

## Full Verification

Final full-suite environment (in addition to the local DB/key exports):

```sh
export OPENAI_API_KEY='sk-test-dummy'
export STRIPE_SECRET_KEY='sk_test_dummy'
export STRIPE_WEBHOOK_SECRET='whsec_test_dummy'
export STRIPE_PRICE_PRO_BYOK_ID='price_pro_byok_test'
export STRIPE_PRICE_PRO_MANAGED_ID='price_pro_managed_test'
export STRIPE_PRICE_ULTRA_BYOK_ID='price_ultra_byok_test'
export STRIPE_PRICE_ULTRA_MANAGED_ID='price_ultra_managed_test'
export AI_PROVIDER=live
npm test
```

Result: **62 files passed, 656 tests passed, zero skipped**, exit 0. `AI_PROVIDER=live` exercises existing mocked provider implementations, not external services.

An initial full run without `OPENAI_API_KEY` had **13 failures**: 12 scheduler fixtures defaulted to Managed AI but had no server key, plus one component assertion still expected obsolete onboarding text. The scheduler failures were `generates with the creator's connection`, creator GitLab connection, parallel slot idempotence, no activity, rejected key/refund, transient failure exhaustion, successful retry, next-day retry, abandoned-run reclaim, auto-delivery behavior, period length and timezone generation. No scheduler logic was changed. Supplying the dummy key and updating the obsolete rendered copy assertion gave `npm test -- src/lib/scheduler.test.ts src/components/dashboard-components.test.tsx`: **24 passed**, then the full **656 passed** run above.

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed, exit 0, repeated after build and test updates. |
| `npm run lint -- --max-warnings=0` | Passed, exit 0, no warnings. |
| `npm run build` | Passed, Next.js 16.4.2 compiled, TypeScript completed, 28/28 static pages generated. |
| `npm audit --omit=dev --audit-level=high` | Passed, 0 vulnerabilities. |
| `npm run licenses -- --check` | Passed, 235 production packages, existing reviewed sharp/libvips exception unchanged. |
| `git diff --check` | Passed, exit 0. |
| Editor diagnostics for touched billing/access/meter/settings/log modules and regression tests | No errors. |

Build used the explicit local DB/key and dummy Stripe exports above plus:

```sh
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY='pk_test_Y2xlcmsuZXhhbXBsZS5jb20k' \
CLERK_SECRET_KEY='sk_test_dummy' \
GITHUB_CLIENT_ID='github_dummy' GITHUB_CLIENT_SECRET='github_dummy' \
NEXT_PUBLIC_APP_URL='https://shiplog.example.test' \
CRON_SECRET='dummy_cron_secret_at_least_16' \
OPENAI_API_KEY='sk-test-dummy' AI_PROVIDER='mock' NEXT_TELEMETRY_DISABLED=1 \
npm run build
```

Final diff inspection covered shared Checkout/webhook locking, event claim checks, subscription identity guards, unknown-price failure, API visibility and hidden counts, environment cleanup in tests, generated migration metadata, and untouched unrelated files. The requested report is normally ignored by Git and is explicitly staged with force; other ignored task artifacts remain untouched.

## Remaining Concerns / Rollout

- Apply the additive migration to an approved deployment database before deploying this schema. Only the local disposable DB was migrated here.
- Stripe Tax registrations, four inclusive recurring prices, and a portal restricted to the supported four variants remain manual deployment prerequisites. No such configuration was created or changed.
- Tests establish application behavior against mocked Stripe, not a live payment/tax integration. A live/sandbox end-to-end payment or browser checkout was intentionally not performed.
- Webhook/Checkout locks intentionally span Stripe reads to prevent stale snapshot commits. Stripe errors roll back the transaction; webhook delivery retains its existing retry/claim behavior. Checkout reconciliation paginates history, so very large customer histories increase checkout latency.
- The retained cutoff uses application time, as do existing webhook update timestamps. Keep application/database clocks synchronized. Existing subscription/project limits and paid-feature restrictions are not lifted by retained report visibility.

The complete fix wave and this report are committed together; the delivery response supplies the resulting commit SHA and subject.

## Critical Checkout Race Follow-Up (2026-11-09)

Baseline: `7327f30`, clean worktree on `pricing/three-tier` before this task.
Implementation commit: `cc4d44499f803158cc523ef6255a873410eb4741` (`Fix checkout completion race with durable session reservations`).
This section supersedes finding 3's earlier claim that separate complete/open queries close the completion gap. The reviewer correctly reproduced a remaining race in that implementation.

### Scope And Implementation

- Read the approved design, implementation plan, existing final-fix report, and controller's Critical finding/ruling. No subagents were dispatched and no unrelated implementation was changed.
- Added nullable `billing_accounts.stripe_checkout_session_id`. Every new or adopted pending Checkout session is persisted under the existing workspace checkout advisory lock before that transaction releases its lock.
- Subsequent requests retrieve that exact ID. Only an open subscription session with exactly the requested configured price and a URL is reused. A variant mismatch must be confirmed expired before replacement. Complete or unknown/nonterminal statuses return `409 BILLING_PORTAL_REQUIRED` without creating another session. An already expired session permits a fresh reservation.
- If completion wins an attempted expiration, the handler rereads the exact session and returns the portal-directed conflict; expiration/network failures never authorize replacement.
- Replaced the separate status-filtered session scans with one paginated, unfiltered discovery path for accounts without a pending pointer. Completion cannot move an existing session between filtered queries. A discovered pending ID is committed before retrieval/reuse/expiration, including when completion happens during discovery.
- Added one nullable JSONB create reservation containing the stable idempotency key, creation timestamp, and exact Stripe create parameters. This reservation commits in its own locked transaction before any Checkout create call. Creation and pointer persistence run in a subsequent locked transaction. A lost Stripe response or rollback after successful creation leaves the committed reservation available for an identical idempotent retry; current status is retrieved after the resulting pointer commits, rather than trusting a cached create response.
- Unresolved reservations at or beyond 23 hours fail closed without another create call. They require operator reconciliation rather than risking key reuse after Stripe's idempotency retention window. This intentionally trades recovery availability for duplicate-subscription safety; reservations must not be blindly deleted to unblock checkout.
- Matching `checkout.session.completed` webhook persistence clears the pending session ID atomically with the subscription entitlement. An event carrying a different session ID does not clear it. Existing subscription identity checks and webhook locks remain in place; Checkout itself still grants no entitlement.

### Local Migration And Test Isolation

Generated and applied `drizzle/0010_square_fabian_cortez.sql` plus the generated journal/snapshot. SQL adds only nullable `stripe_checkout_session_id` (text) and `stripe_checkout_reservation` (JSONB); no existing rows or subscription state are rewritten.

Every migration and billing test command used these explicit values:

```sh
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:63028/postgres'
export DATABASE_URL_UNPOOLED='postgresql://postgres:postgres@127.0.0.1:63028/postgres'
export ENCRYPTION_KEY='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
export STRIPE_SECRET_KEY='sk_test_dummy'
export STRIPE_WEBHOOK_SECRET='whsec_test_dummy'
export STRIPE_PRICE_PRO_BYOK_ID='price_pro_byok_test'
export STRIPE_PRICE_PRO_MANAGED_ID='price_pro_managed_test'
export STRIPE_PRICE_ULTRA_BYOK_ID='price_ultra_byok_test'
export STRIPE_PRICE_ULTRA_MANAGED_ID='price_ultra_managed_test'
```

Removed the billing suite's `.env.local` loader. Stripe operations were mocked and database transactions/locks used the disposable local PostgreSQL instance only. No Neon/live services, Stripe dashboard/API operations, production migration, deployment, push, or dependency changes were performed.

### Verification Evidence

- **RED before implementation:** the new gated completion regression returned 200 instead of 409 against the actual handler. The selected new cases produced 7 expected failures and 1 pass: the session pointer did not exist, completed/unknown sessions allowed replacement, and webhook pointer assertions failed.
- **Initial GREEN:** after implementation and the local migration, the same selection passed all 8 cases.
- **Full billing check:** initially found two obsolete test assumptions: two filtered open lists per concurrent request, and a completed-list fixture conflicting with its still-open exact-session fixture. Updated concurrency coverage to require one create, exact-ID retrieval and identical returned URLs; retained completed-history reconciliation coverage using an existing customer without a pointer and asserted zero new creates. All 104 then-current focused tests passed.
- **Boundary RED/GREEN:** added bootstrap completion, lost-create-response recovery for open/complete sessions, the 23-hour fail-closed boundary, and completion winning expiration. Four passed immediately; the expiration race initially returned 500 rather than 409. Exact-session rereading corrected that response; all 5 boundary cases then passed.
- **Final focused command:** `npm test -- src/lib/billing.test.ts src/lib/stripe-prices.test.ts src/lib/webhooks.test.ts`: **3 files passed, 109 tests passed, zero skipped**, exit 0. Billing contributes 85 tests, including 13 added cases. The deterministic completion gate permits only the original session creation and blocks replacement. Recovery cases assert the reservation is already committed when create is called, reuse identical parameters/key, create only one remote mock session, and retrieve its current state before responding.
- `npm run typecheck`: passed, exit 0.
- `npm run lint -- --max-warnings=0 src/app/api/stripe/checkout/route.ts src/lib/billing.ts src/lib/billing.test.ts src/db/schema.ts`: passed, exit 0.
- `git diff --check` and `git diff --cached --check`: passed before commit. Pre-commit secret scan: no secrets found in the 7 staged files.
- Editor diagnostics: no errors in the four changed TypeScript files.

### Scoped Re-Review And Limits

Reviewed pending-session authority, status/price checks, atomic expiration versus completion, unfiltered bootstrap discovery, durable reservation commits and retries, webhook identity clearing, and additive migration scope. No remaining duplicate-session path was identified in this flow under the workspace lock and Stripe's idempotency/expiration contracts. No further fix wave followed this scoped re-review.

The ambiguous-success tests model the durable state left by a crash/persistence rollback; an actual process kill or database connection-loss injection was not run. No live Stripe payment, browser checkout, full application suite, or production build was repeated for this narrow task. The intentionally stale-reservation 409/reconciliation behavior is an operational limitation, not permission to automatically create a replacement. All application-created sessions use the reservation path; independent session creation outside this application is outside the workspace lock's guarantee.

The final-fix report is tracked from the previous implementation wave despite the `.superpowers/` ignore rule; its last section records the complete-branch review and final verification.

## Final Scoped Re-Review And Verification

- Scoped reviewer re-reviewed `d83a3a0..cc4d444` and approved: no blocking findings remain for the durable checkout reservation fix.
- After that review, ran the complete suite once more with explicit disposable local DB URLs, the test-only encryption key, dummy Stripe price IDs/secrets, and dummy OpenAI key: **62 files passed, 669 tests passed, zero skipped**.
- Final `npm run typecheck`, `npm run lint -- --max-warnings=0`, and production `npm run build` all passed with explicit local/test environment values.
- Final `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities; `npm run licenses -- --check`: 235 production packages compliant; `npm run scan:secrets -- --all`: no secrets in 302 files; `git diff --check` passed.
- No production migration, Stripe dashboard/API action, deployment, push, or live payment/tax flow was performed. The generated migrations were applied only to local disposable Postgres.