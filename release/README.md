# Selling the source on Gumroad

Seller-only notes. This folder is never included in the buyer's zip (`scripts/package-release.ts` leaves out `release/`).
Nothing here is legal advice: have the license and the Terms and Privacy templates reviewed by a lawyer before the first sale.

## One-time setup

1. Fill in `release/config.json`: licensor name, licensing email, governing law. The packaging script refuses to run with
   the `REPLACE ME` placeholders (only `--allow-placeholders` dry runs may skip this).
2. Have a lawyer review `release/LICENSE.md`. It is written as a single-developer, single-end-product license:
   buyers may build and sell a SaaS on top, but may not resell or redistribute the source or ship it as a boilerplate.
3. Add your own strings to `forbiddenStrings` in `release/config.json` (name, hosted project ids, internal domains). The
   scan fails the release if any appear in a file that would ship.
4. Rotate every development key you ever put in `.env.local` (Clerk, Stripe, GitHub OAuth, Resend, OpenAI, Neon). The
   scan also looks for the exact values currently in your `.env.local`, but rotating is the real protection.
5. Decide and write down the refund policy (see "Listing" below).

## Cutting a release

```bash
# 1. Prepare
#    - package.json version is the release version (npm version X.Y.Z --no-git-tag-version)
#    - CHANGELOG.md has "## [X.Y.Z] - YYYY-MM-DD" (not "unreleased")
npm run typecheck && npm run lint && npm test && npm run build
npm run licenses            # refresh THIRD_PARTY_NOTICES.md if dependencies changed
git add -A && git commit -m "Release X.Y.Z" && git tag vX.Y.Z

# 2. Package: refuses unless HEAD is tagged vX.Y.Z
npm run release
```

`npm run release` builds `dist/<slug>-X.Y.Z.zip` from the tagged commit only (never the working tree) and then:

- leaves out `.env*` (except `.env.example`), `.git`, `.next`, `node_modules`, `PLAN.md`, `release/`, the packaging
  tooling and the migration script for the original hosted installation;
- adds `LICENSE.md` (filled from `release/LICENSE.md`) and `VERSION`, and removes the seller-only npm scripts;
- scans every shipped text file for credentials (Stripe, GitHub, AWS, Slack, OpenAI/Anthropic, Resend, Clerk, private keys,
  database URLs with passwords), for the values in your `.env.local`, for your forbidden strings, and for the product name
  hardcoded in source files instead of coming from `src/config/site.ts`;
- zips with a stable file order and timestamps, so the same commit always gives the same bytes, and writes
  `<zip>.sha256`;
- unpacks the zip into a temp directory with only dummy environment variables and runs `npm ci`, type check, lint, tests,
  build, `npm run setup -- --check --production` and the license check.

Dry runs: `--staged` packages whatever is staged in git (to try the packaging before committing), `--allow-untagged` and
`--allow-placeholders` relax the tag and config checks. A dry-run zip must never be sold. `--skip-smoke` skips the slow
install and build step.

Verify the download after uploading: `shasum -a 256 -c <zip>.sha256`.

## Before the first sale

- [ ] **Fresh-machine test.** In a new directory, with only the zip and its docs, and brand-new Clerk, Neon, GitHub OAuth
      and (test-mode) Stripe accounts: follow `docs/getting-started.md` and the service setup. Write down every place you
      got stuck and fix the docs or `scripts/setup.ts`. Repeat until it works without help.
- [ ] **Flags-off run.** Start with `BILLING_ENABLED=false`, `MANAGED_AI_ENABLED=false`, `TEAMS_ENABLED=false`,
      `SCHEDULING_ENABLED=false`, `DELIVERY_ENABLED=false` and confirm the UI shows none of those features.
- [ ] **Rebrand test.** Change only `src/config/site.ts` and the logo. `src/app/rebrand.test.tsx` already checks the pages,
      but click through the dashboard once.
- [ ] `npm audit --omit=dev` is clean; `THIRD_PARTY_NOTICES.md` is current; the zip listing has no `.env`, `.git`, `.next`.
- [ ] **Test purchase** with a 100% discount code: download, check the checksum, read the post-purchase message, follow its links.
- [ ] A live read-only demo: a separate deployment with `AI_PROVIDER=mock`, billing off, and `npm run seed` data. Do not
      point it at your production database.

## Listing

**Positioning.** Generic boilerplates are a crowded market. Sell this as a finished micro-SaaS (an AI changelog and
status-update product) that a buyer can rebrand and launch, not as "a Next.js starter".

**Title.** ShipLog: AI changelog and status-update SaaS, source code (Next.js, Clerk, Stripe, Postgres)

**Short description.** Launch your own AI-powered "ship log" product: GitHub activity in, polished weekly updates,
changelogs and client reports out. Auth, teams, billing, scheduling and delivery included.

**Description (outline).**

1. What it is, with a screenshot of the finished product.
2. What the end product does (copy the feature list from `README.md`).
3. What you get: full Next.js 16 source, Drizzle migrations, setup and seed scripts, documentation, CI workflow, license
   and third-party notices, free updates for v1.x.
4. What you need: Node 22.12+, and accounts at Clerk, Neon and GitHub (all have free tiers), plus optional Stripe, Resend and an
   OpenAI key. Everything optional can be switched off with a feature flag.
5. How fast you can run it: `npm install`, `npm run setup`, `npm run dev`.
6. License summary: one developer, one end product, build and sell a SaaS on top, no resale or redistribution of the source.
7. Support policy (below) and refund policy.

**What is not included.** Hosting, third-party service accounts, legal documents (the Terms and Privacy pages are templates
you must replace), design customization, and per-seat billing, GitLab/Bitbucket support, or server-side PDF generation.

**Price.** Test a launch price in the $79 to $149 range and adjust on evidence.

**Media.** A cover image, four or five screenshots, and a 60 to 90 second demo video. Capture them from a demo-mode
instance with seeded data so no real repositories or names appear. Suggested shots: landing page, dashboard, a project's
history, a log being generated (streaming), a shared log page, the delivery and scheduling settings, pricing.

**Refund policy.** Source code is hard to give back. Decide before you list: common options are a short refund window for
"it does not run following the docs" only, or no refunds with a clear pre-purchase description and a live demo. State it
in the listing.

**Support policy (example, edit to what you can keep).** Support by email or GitHub issues for installation and bugs in the
delivered code, response within 3 business days; not included: help with third-party accounts, custom features, or
debugging your own changes.

**Post-purchase message (template).**

> Thanks for buying. Download the zip from this page and check it with the `.sha256` file if you like.
> Start with `docs/getting-started.md`: `npm install`, `npm run setup`, `npm run dev`.
> Your license is in `LICENSE.md` (one developer, one end product).
> Updates for v1.x are free: you will be emailed when a new version is uploaded.
> Questions: <your support address>. Please include your OS, Node version, and the output of `npm run setup -- --check`.

**License keys.** Gumroad can issue license keys and send a "ping" to a URL on each sale. Keys can gate updates or support
but cannot protect the code itself, which is delivered as a zip. Check Gumroad's current documentation before relying on
either feature.

## After launch

- **Releases.** Semantic version tags, an entry in `CHANGELOG.md`, `npm run release`, upload the new zip to the product, and
  email buyers through Gumroad. Breaking changes and required migrations must be called out in the changelog.
- **Support load.** Buyers will use different Clerk, Stripe, Neon and GitHub setups. Improve `docs/` and
  `npm run setup -- --check` whenever the same question comes twice.
- **Risk.** Once delivered the zip can be shared. The license and good updates are the only real protection.
- **Deferred:** private-repository invite automation.

## Launch checklist (not code)

- [ ] Gumroad direct link in your own channels. Gumroad's fee is currently 10% plus $0.50 per direct sale and 30% for
      sales through Discover (verify current terms), so drive your own traffic.
- [ ] Indie Hackers post, an X thread with the demo video, r/SaaS, Product Hunt.
- [ ] Reply to every question in the first week; turn answers into docs.

## Your own hosted instance

Keep it fully separate from what buyers receive and from development:

- its own Stripe account or mode, Clerk instance, Neon project and GitHub OAuth app;
- real Terms of Service and Privacy Policy live on the site;
- decide on Stripe Tax for your own subscriptions (Gumroad is merchant of record for the code sale only; tax on your hosted
  subscriptions remains your responsibility);
- an `ENCRYPTION_KEY` that exists nowhere else, backed up.
