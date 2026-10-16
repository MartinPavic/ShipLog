# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com), and versions
follow [Semantic Versioning](https://semver.org).

## [Unreleased]

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
