# Task 3 Report - Checkout Variants and Stripe Webhooks

Date: 2026-11-09
Branch: pricing/three-tier
Base commit: 9765fe3

## RED Evidence

Command:

DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:63028/postgres' DATABASE_URL_UNPOOLED='postgresql://postgres:postgres@127.0.0.1:63028/postgres' ENCRYPTION_KEY='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' STRIPE_PRICE_PRO_BYOK_ID='price_pro_byok_test' STRIPE_PRICE_PRO_MANAGED_ID='price_pro_managed_test' STRIPE_PRICE_ULTRA_BYOK_ID='price_ultra_byok_test' STRIPE_PRICE_ULTRA_MANAGED_ID='price_ultra_managed_test' STRIPE_PRICE_ID='price_legacy_single_test' npm test -- src/lib/billing.test.ts

Observed failures:

- Test Files: 1 failed
- Tests: 21 failed, 24 passed
- Representative failures proving missing implementation:
  - expected retrieve to be called for customer.subscription.updated events (0 calls)
  - expected free/null for unknown/legacy/missing/multiple price-item entitlements but received paid plan
  - checkout variant tests failed (server-side variant->price mapping absent)
  - conflict test expected typed portal-directed conflict code

## GREEN Evidence

Command:

DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:63028/postgres' DATABASE_URL_UNPOOLED='postgresql://postgres:postgres@127.0.0.1:63028/postgres' ENCRYPTION_KEY='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' STRIPE_PRICE_PRO_BYOK_ID='price_pro_byok_test' STRIPE_PRICE_PRO_MANAGED_ID='price_pro_managed_test' STRIPE_PRICE_ULTRA_BYOK_ID='price_ultra_byok_test' STRIPE_PRICE_ULTRA_MANAGED_ID='price_ultra_managed_test' STRIPE_PRICE_ID='price_legacy_single_test' npm test -- src/lib/billing.test.ts

Output:

- Test Files: 1 passed (1)
- Tests: 45 passed (45)
- Duration: 740ms

Typecheck command:

DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:63028/postgres' DATABASE_URL_UNPOOLED='postgresql://postgres:postgres@127.0.0.1:63028/postgres' ENCRYPTION_KEY='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' STRIPE_PRICE_PRO_BYOK_ID='price_pro_byok_test' STRIPE_PRICE_PRO_MANAGED_ID='price_pro_managed_test' STRIPE_PRICE_ULTRA_BYOK_ID='price_ultra_byok_test' STRIPE_PRICE_ULTRA_MANAGED_ID='price_ultra_managed_test' STRIPE_PRICE_ID='price_legacy_single_test' npm run typecheck

Output:

- tsc --noEmit passed

## Implemented Scope

- Checkout route now accepts only tier/mode enum body and resolves Stripe price server-side.
- Checkout route now blocks active/trialing subscriptions with typed 409 conflict directing users to portal.
- Checkout route now enables Stripe automatic tax on session creation.
- Webhook entitlement mapping now derives plan+aiMode from configured recurring subscription price IDs.
- Webhooks now map unknown/missing/multiple/legacy prices and non-active statuses to free/null mode.
- customer.subscription.updated/deleted processing now retrieves current Stripe subscription snapshot before applying.
- Existing idempotent claim flow and replaced-subscription guard remain intact.

## Commit

Task changes and this report are committed together on branch pricing/three-tier.

---

## Task 3 Review-Fix Round (2026-11-09)

Scope: reviewer Important 1 and Important 2, plus two minor webhook-staleness correctness fixes in the same path.

### RED Evidence

Command:

`DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:63028/postgres' DATABASE_URL_UNPOOLED='postgresql://postgres:postgres@127.0.0.1:63028/postgres' ENCRYPTION_KEY='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' STRIPE_PRICE_PRO_BYOK_ID='price_pro_byok_test' STRIPE_PRICE_PRO_MANAGED_ID='price_pro_managed_test' STRIPE_PRICE_ULTRA_BYOK_ID='price_ultra_byok_test' STRIPE_PRICE_ULTRA_MANAGED_ID='price_ultra_managed_test' STRIPE_PRICE_ID='price_legacy_single_test' npm test -- src/lib/billing.test.ts`

Failing tests before implementation:

- `authorizes before body validation and price resolution` (got `400`, expected `403`)
- `blocks owners with an existing non-terminal past_due|unpaid|paused|incomplete subscription...` (got `200`, expected `409`)
- `does not demote from a stale payment_failed event when Stripe shows the subscription is recovered`
- `does not let stale checkout completion overwrite an existing live subscription id`

Initial RED run summary:

- Test Files: `1 failed`
- Tests: `7 failed`, `46 passed`

### GREEN Evidence

Focused tests command:

`DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:63028/postgres' DATABASE_URL_UNPOOLED='postgresql://postgres:postgres@127.0.0.1:63028/postgres' ENCRYPTION_KEY='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' STRIPE_PRICE_PRO_BYOK_ID='price_pro_byok_test' STRIPE_PRICE_PRO_MANAGED_ID='price_pro_managed_test' STRIPE_PRICE_ULTRA_BYOK_ID='price_ultra_byok_test' STRIPE_PRICE_ULTRA_MANAGED_ID='price_ultra_managed_test' STRIPE_PRICE_ID='price_legacy_single_test' npm test -- src/lib/billing.test.ts`

Output:

- Test Files: `1 passed`
- Tests: `53 passed`

Typecheck command:

`DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:63028/postgres' DATABASE_URL_UNPOOLED='postgresql://postgres:postgres@127.0.0.1:63028/postgres' ENCRYPTION_KEY='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' STRIPE_PRICE_PRO_BYOK_ID='price_pro_byok_test' STRIPE_PRICE_PRO_MANAGED_ID='price_pro_managed_test' STRIPE_PRICE_ULTRA_BYOK_ID='price_ultra_byok_test' STRIPE_PRICE_ULTRA_MANAGED_ID='price_ultra_managed_test' STRIPE_PRICE_ID='price_legacy_single_test' npm run typecheck`

Output:

- `tsc --noEmit` passed

### Fixes Applied

- Checkout route now authorizes via `requireAdmin()` before request body parsing and Stripe price resolution.
- Checkout route now blocks second checkout when a workspace already has a non-terminal existing subscription identity (`stripeSubscriptionId` present and status not `canceled`/`incomplete_expired`), while preserving active/trialing block behavior.
- `checkout.session.completed` processing now protects an existing live subscription id from stale checkout-completion events for a different, older subscription.
- `invoice.payment_failed` now fetches the current Stripe subscription snapshot before applying account state, preventing stale failures from demoting already-recovered subscriptions.

### Fix Commit

- Code/test fix commit SHA: `0735d4c`
