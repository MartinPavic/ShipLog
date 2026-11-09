# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com), and versions
follow [Semantic Versioning](https://semver.org).

## [Unreleased]

### Added

- GitLab.com and public HTTPS self-managed GitLab support, including per-workspace OAuth configuration, personal member
  connections, mixed GitHub/GitLab projects and normalized activity generation. Requires `npm run db:migrate`; existing
  untagged project repositories remain GitHub.
- Templates page: create, edit and delete your own generation templates, or duplicate a built-in one. Custom templates
  can be chosen per project and per run. Requires running `npm run db:migrate` (new `custom_templates` table).

### Changed

- Billing configuration now requires four Stripe price IDs when `BILLING_ENABLED=true`: `STRIPE_PRICE_PRO_BYOK_ID`,
  `STRIPE_PRICE_PRO_MANAGED_ID`, `STRIPE_PRICE_ULTRA_BYOK_ID`, and `STRIPE_PRICE_ULTRA_MANAGED_ID`. The legacy
  single-price variable is no longer used by setup, validation, CI defaults, or release smoke checks.
- Billing docs and setup now describe the three-tier offer (Free, Pro, Ultra), VAT-inclusive display prices, Stripe Tax
  automatic tax plus tax registrations, and customer-portal switching across all four paid prices.

- Ship logs describe what changed in plain language instead of repeating commit titles. The model now also receives full
  commit messages, longer pull request descriptions and, for the newest pull requests and commits, the changed file names
  and short excerpts of added code. The Privacy template mentions this.
- Captain's-log redesign: parchment, ink and brass theme with a dark mode toggle, serif headings, ship's wheel logo and
  favicon, wave dividers on the landing page, themed Clerk sign-in/up, Open Graph image and emails.
- Status colors use `--success`, `--warning` and `--danger` tokens; a few empty states and the 404 got nautical copy.

## [1.0.0] - unreleased

First release.

### Added

- Projects with repositories, templates, tone, audience and custom instructions.
- GitHub OAuth, with activity from commits, merged pull requests, closed issues and releases.
- Streaming AI generation with OpenAI, Anthropic and Grok (own key) and managed AI on Pro; an offline demo provider.
- Log history with search, pinning, editing with version history and regeneration.
- Read-only share links (optional password) and a public changelog; Markdown, HTML and Slack exports; PDF through the
  browser's print dialog.
- Delivery to Slack, Discord and email, and weekly scheduled logs.
- Teams with Clerk Organizations, admin and member roles, and flat per-organization billing.
- Stripe subscriptions with a customer portal and idempotent webhooks.
- Feature flags (`BILLING_ENABLED`, `MANAGED_AI_ENABLED`, `TEAMS_ENABLED`, `SCHEDULING_ENABLED`, `DELIVERY_ENABLED`)
  and environment validation at startup.
- Branding and copy in `src/config/site.ts`, a landing page, and Terms and Privacy templates.
- `npm run setup` (guided setup and environment check), `npm run seed` (demo data), `npm run licenses`.
- Documentation, CI workflow and third-party notices.
