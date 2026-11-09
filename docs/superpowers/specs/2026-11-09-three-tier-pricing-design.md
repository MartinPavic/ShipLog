# Three-Tier Pricing Design

## Intent

Replace the current Free/Pro offer with Free, Pro, and Ultra, while making the lower BYOK price explicit and keeping managed-AI costs bounded. The page should communicate three tiers, not five unrelated products, and checkout must grant exactly the tier and AI mode selected.

## Goals

- Keep Free unchanged: 1 project, 5 own-key generations per UTC calendar month, and the 10 newest logs per project; managed AI and Pro features remain unavailable.
- Offer four paid price variants:

  | Tier and mode | Price / month | Projects | BYOK generations / UTC month | Managed-AI generations / UTC month |
  | --- | ---: | ---: | ---: | ---: |
  | Pro, BYOK | €12 | 5 | 50 | 0 |
  | Pro, Managed AI | €19 | 5 | 0 | 50 |
  | Ultra, BYOK | €22 | Unlimited | Unlimited | 0 |
  | Ultra, Managed AI | €29 | Unlimited | 0 | 200 |

- The advertised euro prices are VAT-inclusive. Applicable VAT is calculated and collected by Stripe within the displayed amount; do not add VAT on top of these prices at checkout.

- Retain the current paid feature set for both Pro and Ultra: full log history, scheduling, delivery, PDF export, teams, and managed-AI availability only for a managed-AI price variant.
- Show three pricing cards (Free, Pro, Ultra). A BYOK/Managed AI selector on the paid cards changes the displayed price and checkout variant.
- Make Stripe subscription prices the source of truth for both tier and AI mode; do not trust a client-submitted price ID.
- Preserve existing project and log data through upgrade/downgrade. A downgrade never deletes or hides projects/logs; creation of additional projects is blocked until under the new cap.
- No customer migration or grandfathering is required because the product has no existing subscribers.

## Non-Goals

- Annual billing, coupons, trials, usage add-ons, seat-based billing, pay-as-you-go overages, or custom enterprise plans.
- Automatically moving customers between BYOK and Managed AI when a generation limit is reached.
- Changing the existing feature-flag behavior or the Free organization restrictions.

## Approaches

1. **Three tier cards with a BYOK/Managed AI selector (selected).** Each paid tier has two prices; selection determines a server-validated Stripe price and the corresponding entitlement. This matches the requested tier model while making the AI-cost tradeoff clear.
2. **Five distinct cards.** Show Free, Pro BYOK, Pro Managed, Ultra BYOK, and Ultra Managed separately. This makes every price visible simultaneously but turns a simple three-tier offer into a crowded five-choice comparison.
3. **Managed-AI add-on.** Sell a single Pro/Ultra subscription and add managed AI separately. This is flexible but departs from the agreed paired prices and adds subscription-item/upgrade complexity.

## Billing And Entitlement Behavior

- Billing account state records tier (`free`, `pro`, `ultra`) and paid AI mode (`byok`, `managed`); Free has no paid mode. The webhook derives both only from configured Stripe price IDs found in the active subscription items.
- Configure four Stripe recurring prices with inclusive tax behavior and Stripe Tax automatic tax enabled for Checkout. Checkout receives only an allowed tier/mode pair and resolves the price ID server-side. The Stripe account must have the applicable tax registrations and customer tax settings configured before launch.
- BYOK mode uses the workspace's stored API key and never falls back to the server's managed key. If no own key is configured, generation fails with an instruction to add one in Settings.
- Managed mode uses the server's configured AI key and never falls back to a workspace key. If managed AI is disabled/unconfigured, generation fails clearly; own-key users can change to a BYOK subscription through Stripe billing management.
- Usage caps follow the selected source's existing usage counter (`byok` or `managed`) and workspace scope. Counters reset on UTC calendar-month boundaries, matching existing usage accounting. A limit reached blocks generation until reset or a subscription change; there are no overages or silent mode switches.
- An active managed subscription's price variant grants the Pro/Ultra managed allowance. An own-key plan grants its BYOK allowance only. Switching from managed to BYOK or vice versa is a subscription price change, not a local AI setting.
- Stripe subscription update/delete webhooks map the current subscription price to tier and mode. Canceled, unpaid, past-due, or unknown-price subscriptions do not receive paid entitlements; existing past-due behavior remains Free unless changed by a separate request.
- The customer billing portal is configured to allow changes among the four paid prices and cancellation. Stripe's configured proration/effective-date behavior applies; application data is never deleted on downgrade.
- With billing disabled, retain the current unlimited behavior and feature-flag restrictions; checkout and webhook billing endpoints remain disabled.

## UI And Configuration

- Landing page: keep three plan cards, show Pro/Ultra prices based on a segmented BYOK/Managed AI selector, and list generation caps and project limits. The selected variant is sent to checkout.
- Dashboard/settings: show Free/Pro/Ultra plus the active AI mode and its allowance; keep the existing customer-portal entry point for changes and cancellation.
- Replace the single `STRIPE_PRICE_ID` with four explicit price variables, for example `STRIPE_PRICE_PRO_BYOK_ID`, `STRIPE_PRICE_PRO_MANAGED_ID`, `STRIPE_PRICE_ULTRA_BYOK_ID`, and `STRIPE_PRICE_ULTRA_MANAGED_ID`. Update environment validation, `.env.example`, setup prompts, deployment/configuration docs, release notes, and billing tests.
- Do not perform Stripe product/price creation, portal configuration, database migrations, or production deployment without explicit authorization. Document the required Stripe dashboard setup.

## Data And Compatibility

- Extend the billing account schema for Ultra and the paid AI mode; generate an additive Drizzle migration. Existing Free rows stay Free. There are no subscribers to backfill or grandfather.
- Keep usage counters keyed by workspace, UTC month, and usage kind. Existing Free BYOK usage retains its semantics.
- Stripe events remain idempotent. Validate subscription item price IDs and avoid granting any entitlement for an unknown price.
- Billing status exposed to UI should use tier/mode, not infer all paid states as a single Pro plan.

## Security And Operational Constraints

- Only workspace admins can start checkout or manage subscriptions.
- Checkout accepts an enum for tier/mode, not arbitrary price identifiers or amounts.
- Webhooks are the authority for entitlements; checkout success redirects do not grant paid access.
- Never expose secret keys or Stripe credentials in the client response.
- No live Stripe API calls or production database operations during automated tests.

## Verification

- Unit tests cover tier/mode-to-price resolution, unknown prices, plan limits, AI-mode enforcement, and UTC month usage boundaries.
- Route tests cover checkout variant validation, active-subscription conflict/reuse, and admin-only checkout.
- Webhook tests cover all four prices, subscription updates between variants, cancellation, payment failure, duplicate/out-of-order events, and unknown prices.
- UI tests cover three cards, selector-driven prices/allowances, billing status, and billing-off behavior.
- Existing Free and project/log retention behavior remains unchanged; downgrades do not delete data and block only new projects beyond the cap.
- Run tests only against disposable local Postgres, then typecheck, lint, production build, dependency audit, license check, and diff review.

## Decisions Left To The Builder

- Exact environment variable names and shared helpers for Stripe price-to-entitlement mapping, following current project conventions.
- Exact short copy for describing the BYOK/Managed AI selector and quota exhaustion, without implying overage or automatic fallback.
- The app supports one active workspace subscription; Stripe portal configuration must preserve that contract.

## Builder-Check Resolutions

- BYOK/managed mode is locked by the chosen subscription variant. BYOK plans never fall back to managed AI; managed plans never fall back to a workspace key.
- Pro's 50 and Ultra's 200 generation limits apply to the selected mode's usage counter. Limits are workspace-scoped and reset on UTC calendar months, matching the existing counter model.
- Reaching a managed allowance blocks further managed generation until reset or plan/mode change; there is no silent BYOK fallback or overage.
- Downgrades retain all existing projects/logs; only new project creation is blocked until active project count is below the lower limit.
- Stripe portal price changes and proration follow the configured Stripe portal behavior. Configure the portal for all four price variants before launch.
- No subscribers exist, so no legacy-price migration is needed. A configured old single price ID must not grant an entitlement after the new price mapping is deployed.