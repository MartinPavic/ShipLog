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
