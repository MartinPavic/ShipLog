# Three-Tier Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Free/Pro billing with Free, Pro, and Ultra tiers, each paid tier offered as a BYOK or Managed AI subscription with VAT-inclusive monthly prices and server-enforced entitlements.

**Architecture:** Stripe price IDs map to a validated `{ tier, aiMode }` entitlement. Store tier and mode on the workspace billing account; derive limits from that state. Enforce AI mode before generation, use the existing workspace-scoped managed/BYOK monthly counters, and retain project/log data on downgrade. The landing page uses three cards and one shared BYOK/Managed AI selector; checkout and webhooks resolve variants on the server.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle/Postgres, Stripe SDK, React 19, Vitest.

**Spec:** [Three-tier pricing design](../specs/2026-11-09-three-tier-pricing-design.md)

## Global Constraints

- Free stays at 1 project, 5 BYOK generations per UTC calendar month, and 10 newest logs per project; managed AI and paid features are unavailable.
- Pro BYOK is €12/month: 5 projects, 50 BYOK generations/month, 0 managed generations.
- Pro Managed AI is €19/month: 5 projects, 0 BYOK generations, 50 managed generations/month.
- Ultra BYOK is €22/month: unlimited projects and BYOK generations, 0 managed generations.
- Ultra Managed AI is €29/month: unlimited projects, 0 BYOK generations, 200 managed generations/month.
- All listed prices include VAT; Stripe must use inclusive prices and automatic tax calculation, not add VAT on top.
- Both paid tiers retain full history, scheduling, delivery, PDF export, and teams. AI mode is fixed by the subscription variant.
- No automatic fallback, overages, or silent mode change when a monthly allowance is reached.
- Usage is workspace-scoped and resets on UTC calendar-month boundaries.
- Downgrades preserve projects and logs; enforce lower project limits only when creating new projects.
- Price IDs are server configuration; never accept arbitrary client-supplied Stripe price IDs.
- Stripe webhooks are authoritative for entitlements; no entitlement is granted from a checkout redirect.
- Tests and migrations use disposable local Postgres only. Never run against `.env.local`/Neon. No Stripe price creation, portal setup, production migration, or deployment without explicit authorization.
- Preserve unrelated worktree changes, including `release/config.json`.

## Review Focus

- **Unknown or mixed Stripe subscription prices:** grant no paid entitlement; cover in the Stripe price resolver/webhook task.
- **Paid BYOK workspace with no AI key:** fail with a BYOK-specific actionable error instead of falling back to managed AI; cover in AI access tests.
- **Managed plan with a saved BYOK key:** use the managed key and managed counter only; cover in AI access and usage meter tests.
- **Quota reached or UTC month changes:** reject without fallback and reset at the existing `YYYY-MM` UTC boundary; cover in usage tests.
- **Downgrade while projects/logs exceed new limits:** keep all existing data and block only additional project creation; cover in plan/project tests.

---

### Task 1: Tier Entitlements, Stripe Price Mapping, and Schema

**Files:** Modify `src/db/schema.ts`, `src/lib/plans.ts`, `src/lib/plans.test.ts`, `src/lib/feature-flags.test.ts`; add `src/lib/stripe-prices.ts` and `src/lib/stripe-prices.test.ts`; generate Drizzle migration and metadata.

**Interfaces:**
- `Plan = "free" | "pro" | "ultra"`.
- `AiMode = "byok" | "managed"`; `billing_accounts.ai_mode` is nullable for Free.
- `StripeVariant = { tier: Exclude<Plan, "free">; aiMode: AiMode }`.
- `stripePriceFor(variant): string` resolves only one of four configured environment IDs; `entitlementForStripePrice(priceId): StripeVariant | null` maps configured IDs and returns null for unknown IDs.
- `PlanLimits` contains `maxProjects`, both generation caps, and current feature booleans. `limitsFor(plan, ownerId, aiMode?)` accepts an optional mode for existing direct callers; `getPlanLimits(ownerId)` returns `{ plan, aiMode, limits }` from the persisted billing account.

- [x] **Step 1: Write failing mapping and plan-limit tests.** Assert the exact four mappings and caps above; Free is unchanged; all paid variants have the current paid feature booleans; unknown price maps to null; billing-off stays unlimited subject to feature flags.
- [x] **Step 2: Run the focused tests and verify failure.** Run `npm test -- src/lib/plans.test.ts src/lib/feature-flags.test.ts src/lib/stripe-prices.test.ts` (the new file may initially be unresolved).
- [x] **Step 3: Add tier/mode schema and plan limits.** Extend the billing plan enum/type with Ultra and add nullable `ai_mode`. Define `limitsFor(plan, ownerId, aiMode?)`: Free unchanged; Pro BYOK `{ projects: 5, byok: 50, managed: 0 }`; Pro Managed `{ projects: 5, byok: 0, managed: 50 }`; Ultra BYOK `{ projects: Infinity, byok: Infinity, managed: 0 }`; Ultra Managed `{ projects: Infinity, byok: 0, managed: 200 }`. Paid feature booleans stay enabled subject to flags.
- [x] **Step 4: Add server-only Stripe price mapping and four environment variables.** Read `STRIPE_PRICE_PRO_BYOK_ID`, `STRIPE_PRICE_PRO_MANAGED_ID`, `STRIPE_PRICE_ULTRA_BYOK_ID`, and `STRIPE_PRICE_ULTRA_MANAGED_ID`; detect missing/duplicate configured IDs and fail closed rather than mapping ambiguously. Export `stripePriceFor(variant)` and `entitlementForStripePrice(priceId)` from `src/lib/stripe-prices.ts`.
- [x] **Step 5: Generate the additive migration and apply it only to disposable local Postgres.** Keep Drizzle SQL/journal/snapshot generated. Verify existing Free rows keep their plan and null mode.
- [x] **Step 6: Rerun focused tests and typecheck.** Expected: mapping, limits, and existing feature-flag tests pass.

### Task 2: Enforce AI Mode and Allowances

**Files:** Modify `src/lib/ai/access.ts`, `src/lib/ai/access.test.ts`, `src/lib/usage.ts`, `src/lib/usage.test.ts`, `src/lib/generation.ts`, and relevant generation/settings tests.

**Interfaces:** `resolveAiAccess(ownerId)` chooses the billing account's fixed mode: Free/paid BYOK requires the workspace key; paid Managed uses only the configured server key. `getUsageMeter(ownerId)` reports the selected mode and that mode's allowance. Existing `reserveGeneration(ownerId, kind, limits)` remains the atomic counter boundary.

- [x] **Step 1: Write failing AI resolution tests.** Cover Free BYOK, Pro/Ultra BYOK using the workspace key, Managed plans using the server key even when a workspace key exists, missing BYOK key, unavailable managed key, and demo mode.
- [x] **Step 2: Write failing usage tests.** Assert exact Pro/Ultra caps, workspace-shared usage, no cross-mode fallback when a cap is reached, and UTC month rollover.
- [x] **Step 3: Run the focused AI/usage tests and verify failure.** Run the named access and usage test files against disposable local Postgres where required.
- [x] **Step 4: Implement mode-locked AI selection and mode-aware error copy.** Keep mock mode deterministic while preserving the selected usage kind semantics used by tests.
- [x] **Step 5: Implement selected-mode usage meter and exact limits.** `getUsageMeter` uses persisted `aiMode` rather than presence of a saved key. Reuse the current separate `managed`/`byok` counters and reservation transaction; do not add a new counter dimension.
- [x] **Step 6: Verify generation and usage tests.** A Pro BYOK keyless workspace must get `NO_AI_KEY`; managed mode without server AI configuration must fail clearly; limit exhaustion must return `LIMIT_REACHED` without fallback.

### Task 3: Checkout Variants and Stripe Webhooks

**Files:** Modify `src/app/api/stripe/checkout/route.ts`, `src/lib/billing.ts`, billing tests, `src/lib/stripe.ts`, and Stripe route tests.

**Interfaces:** Checkout body is `{ tier: "pro" | "ultra", aiMode: "byok" | "managed" }`. The route calls `stripePriceFor` server-side. Webhook processing resolves the current subscription item's configured price with `entitlementForStripePrice` and stores plan plus mode. Unknown prices receive Free/no mode.

- [x] **Step 1: Write failing checkout tests.** Cover all four valid variants resolving to the correct configured price, invalid/missing variants, admin-only checkout, and an existing active subscription being directed to portal rather than creating a second subscription.
- [x] **Step 2: Write failing webhook tests.** Cover all four price IDs, updates that switch tier/mode, unknown price, cancellation, payment failure, duplicate events, and stale/out-of-order subscription events.
- [x] **Step 3: Run billing/route tests and verify failure.** Use mocked Stripe SDK responses only; do not call Stripe APIs.
- [x] **Step 4: Implement checkout variant parsing and server price resolution.** Enable Stripe automatic tax on Checkout; prices are configured as tax-inclusive. Preserve one active subscription per workspace.
- [x] **Step 5: Implement webhook price-to-entitlement updates.** Require exactly one recognized ShipLog recurring price item; zero, multiple, old single-price, or unknown prices map to Free/null mode. On subscription updated/deleted events, retrieve the current subscription snapshot before applying it so older event payloads cannot restore stale tier/mode. Preserve idempotent event claims and existing replaced-subscription checks.
- [x] **Step 6: Verify billing tests.** Confirm checkout success alone grants no entitlement and all webhook state is deterministic.

### Task 4: Three-Card Pricing UI and Variant Checkout

**Files:** Modify `src/app/page.tsx`, `src/app/landing.test.tsx`, `src/config/site.ts` if shared copy needs updating, and checkout button/component tests or add focused pricing component tests.

**Interfaces:** Render Free, Pro, Ultra cards. A shared segmented selector has `BYOK` and `Managed AI` values. It switches Pro/Ultra displayed prices, mode-specific allowance copy, and checkout request variant. Free remains independent of the selector.

- [x] **Step 1: Write failing render/interaction tests.** Assert three cards, VAT-inclusive prices €12/€19 and €22/€29, selector labels, exact caps, mode-specific feature copy, and checkout payloads for both paid cards.
- [x] **Step 2: Run focused landing/pricing tests and verify failure.** Keep existing landing/rebrand/plan-highlights tests in scope.
- [x] **Step 3: Implement the three-card layout and BYOK/Managed selector.** Preserve current page design system and show VAT-inclusive pricing without adding tax language that implies VAT on top. The selector controls both paid cards; Free is unchanged.
- [x] **Step 4: Update checkout CTA behavior.** Signed-in admins POST the selected tier/mode; signed-out users authenticate before checkout. Keep non-admin and active-subscription outcomes clear.
- [x] **Step 5: Rerun landing and pricing tests.** Verify billing-off hides pricing and no UI path can submit a price ID.

### Task 5: Billing Status and Subscription Management UI

**Files:** Modify `src/app/dashboard/settings/page.tsx`, `src/components/upgrade-button.tsx`, `src/components/upgrade-button.test.tsx` if present (otherwise add a focused test), relevant dashboard/billing UI tests, and `src/lib/settings.ts`.

**Interfaces:** Safe settings status exposes `{ plan, aiMode, usage: { used, limit } }` for current workspace; no Stripe secrets or price IDs are returned. Billing card labels Free/Pro/Ultra and shows the active AI mode/allowance. `Manage billing` continues to use the customer portal.

- [x] **Step 1: Write failing billing-status tests.** Cover Free, Pro/Ultra BYOK, Pro/Ultra Managed, missing managed key warning, and billing-off behavior.
- [x] **Step 2: Run focused settings/dashboard tests and verify failure.**
- [x] **Step 3: Implement safe status loading and UI copy.** Show tier, locked AI mode, and mode-specific usage; explain that BYOK requires a workspace key and Managed AI ignores any saved workspace key. Explain that changing mode is done through subscription management. Preserve admin-only billing controls.
- [x] **Step 4: Verify settings/dashboard tests and typecheck.**

### Task 6: Environment, Documentation, and Full Verification

**Files:** Modify `src/env.ts`, environment tests, `.env.example`, `scripts/setup.ts`, `docs/configuration.md`, `docs/services.md`, `docs/getting-started.md`, `docs/troubleshooting.md`, `docs/upgrading.md`, `CHANGELOG.md`, `README.md`, and pricing plan progress checkboxes.

- [x] **Step 1: Add failing environment/setup/docs tests.** Require the four Stripe price IDs when billing is enabled; permit billing-off without any Stripe IDs; ensure setup and docs mention all IDs and the VAT-inclusive four-variant price model.
- [x] **Step 2: Implement four-price environment validation and guided setup.** Ensure no single `STRIPE_PRICE_ID` remains required or documented; update setup prompts and manual steps.
- [x] **Step 3: Document Stripe Dashboard work.** State four monthly recurring inclusive-tax prices, Stripe Tax activation/registrations, billing-portal configuration for all four prices, and local secret variable names. Do not create/configure Stripe products in a live account.
- [x] **Step 4: Run focused tests, then full verification against disposable local Postgres.** Run `npm run typecheck`, `npm run lint -- --max-warnings=0`, `DATABASE_URL=<local disposable Postgres> npm test`, `DATABASE_URL=<local> DATABASE_URL_UNPOOLED=<local> npm run build`, `npm audit --omit=dev --audit-level=high`, `npm run licenses -- --check`, and `git diff --check`.
- [x] **Step 5: Review complete diff and migration.** Confirm project/log retention on downgrade, old single price ID grants no tier, VAT-inclusive displayed prices, no leaked price secrets, and unrelated worktree changes remain untouched.

## Rollout Notes

- Create/configure four Stripe monthly Prices with tax behavior `inclusive`, enable Stripe Tax automatic tax in Checkout, configure tax registrations, and allow all four Prices in the customer portal before deployment. This external Stripe setup is manual and requires explicit authorization.
- Set all four price-ID environment variables in the deployment and update webhook configuration before enabling billing for the new version.
- Apply the generated migration only to an approved target database. No production migration is included in implementation without explicit authorization.
- No subscribers exist, so no subscription migration or grandfathering is planned.
