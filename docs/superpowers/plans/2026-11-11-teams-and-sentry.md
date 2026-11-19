# Microsoft Teams and Sentry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Microsoft Teams Workflows as a project delivery channel, then add optional Sentry issue context to reports generated from repository activity.

**Architecture:** Extend the existing encrypted project-channel pipeline for Teams. Add a workspace-owned encrypted Sentry token and organization, selected Sentry project references on projects, a bounded Sentry API adapter, and a separate Sentry section in the AI prompt/source snapshot; repository activity remains required.

**Tech Stack:** Next.js 16 App Router, TypeScript, React 19, Postgres/Drizzle, `fetch`, AES-GCM helpers, Zod, Vitest.

**Spec:** [Teams Delivery and Sentry Report Input](../specs/2026-11-11-teams-and-sentry-design.md).

## Global Constraints

- Implement Microsoft Teams delivery first; implement Sentry report input second.
- Use a channel-specific Microsoft Teams Workflows webhook. Do not use retired Office 365 connector webhooks or add a Teams OAuth app.
- Use one workspace-level Sentry organization and a read-only token; request only `project:read` and `event:read` access where Sentry permits token scopes.
- Sentry supplements GitHub/GitLab activity and does not enable Sentry-only reports.
- Sentry issues must have activity in the report window; window event counts must not be presented as lifetime counts.
- Keep tokens and webhook URLs encrypted and server-side; never include them in logs, client props, or error messages.
- Restrict Sentry requests to Sentry's hosted API. Use request timeouts, bounded pagination/concurrency, and reject redirects.
- Preserve Sentry project selections when a connection is disconnected or replaced; preserve historical logs and source snapshots.
- Do not add a dependency for either integration; use existing `fetch`, Drizzle, encryption, validation, and UI patterns.
- Run DB-backed tests and migrations only against a disposable local PostgreSQL database; explicitly set test `DATABASE_URL` values so `.env.local` cannot redirect tests to Neon.
- Preserve pre-existing user changes, including `release/config.json`; do not run migrations against Neon, commit, or push without explicit authorization.

## Review Focus

- **Teams URL SSRF:** accept documented HTTPS Workflows URLs while rejecting arbitrary hosts, credentials, unexpected ports, and malformed paths; test in `src/lib/webhooks.test.ts` and `src/lib/validation.test.ts`.
- **Teams secret exposure:** webhook query signatures remain encrypted and never appear in channel hints, API responses, logs, or delivery errors; test in `src/lib/delivery.test.ts`.
- **Sentry tenant/credential isolation:** only workspace admins change the token; all members may only use the workspace connection; test owner/admin isolation and safe responses in `src/lib/sentry-settings.test.ts` and route tests.
- **Sentry bounded and truthful counts:** issue candidates and issue-event pages are restricted to the selected projects and report window; if the page cap is reached, represent the count as a lower bound instead of an exact total; test in `src/lib/sentry.test.ts`.
- **Sentry disconnect and upstream failure:** disconnect retains project selections, while auth, access, timeout, malformed-response, or inaccessible-selected-project failures never produce a silently incomplete report; test settings and generation paths.

---

## Phase 1: Microsoft Teams Delivery

### Task 1: Teams Channel Validation, Persistence, and Delivery

**Files:** Modify `src/db/schema.ts`, `src/lib/webhooks.ts`, `src/lib/webhooks.test.ts`, `src/lib/validation.ts`, `src/lib/validation.test.ts`, `src/lib/delivery.ts`, `src/lib/delivery.test.ts`, and `src/components/channels-manager.tsx` for the widened client channel type/label only. No database migration is expected because the channel kind is stored as plain text.

**Interfaces:** Extend `ChannelKind` and the `delivery_channels.kind` enum with `"teams"`. Extend `ChannelConfig` with `{ webhookUrl: string }` for Teams, matching Slack/Discord storage. Add the Teams URL to the webhook validator allow-list and expose it through `createChannelSchema`. Keep `sendMessage(kind, config, message)` as the sender interface.

- [x] **Step 1: Write failing tests** for accepted documented Teams Workflows URLs on `*.logic.azure.com` with non-root paths and a non-empty `sig`; rejected non-HTTPS, credentials, arbitrary hosts, root paths, missing signatures, and non-default ports; creation validation; encrypted storage and safe hints; Teams payload title/body and truncation; HTTP failure mapping, redirect rejection, timeout, and uncertain delivery.
- [x] **Step 2: Run the focused tests** `npm test -- src/lib/webhooks.test.ts src/lib/validation.test.ts src/lib/delivery.test.ts` with both database URLs explicitly pointed at disposable local PostgreSQL. Expect failures for the new channel kind and sender.
- [x] **Step 3: Implement Teams channel support** in validation, schema types, webhook validation, `createChannel`, `updateChannel`, `toPublic`, and `sendMessage`. Use the Microsoft Workflows JSON payload, keep signature query parameters encrypted, and apply the existing timeout/redirect policy. Choose conservative message truncation below the documented 28 KB limit. Widen only the `ChannelView` type and label map in `src/components/channels-manager.tsx`; the selectable UI is Task 2.
- [x] **Step 4: Verify migration necessity** with `npm run db:generate` and inspect the PostgreSQL column type: `delivery_channels.kind` is plain `text`, so expect no schema changes and do not create an empty/custom migration.
- [x] **Step 5: Rerun focused tests** against disposable PostgreSQL; expect all Teams, Slack, and Discord delivery tests to pass.

### Task 2: Teams Channel UI, Delivery Coverage, and Setup Docs

**Files:** Modify `src/components/channels-manager.tsx`, `src/components/deliver-panel.tsx`, `src/lib/plans.ts`, `src/lib/plans.test.ts`, `src/config/site.ts`, `src/app/landing.test.tsx`, `src/lib/delivery.test.ts`, `README.md`, `docs/services.md`, `docs/configuration.md`, `docs/architecture.md`, `docs/customization.md`, `docs/upgrading.md`, and `scripts/docs.test.ts`; add `src/components/channels-manager.test.tsx` and `src/components/deliver-panel.test.tsx`.

**Interfaces:** Add `teams` to the client `ChannelView` kind, channel labels, and manual-send result/history labels. Reuse webhook URL entry, masked display, add/test/pause/remove actions, and the existing delivery API contract; no new API route or environment variable is needed.

- [x] **Step 1: Add failing UI/docs/copy tests** in `src/components/channels-manager.test.tsx`, `src/components/deliver-panel.test.tsx`, `src/lib/plans.test.ts`, `src/app/landing.test.tsx`, and `scripts/docs.test.ts` asserting Teams appears as a webhook channel with a Teams-specific URL hint, appears by its friendly label in manual-send results/history, paid-plan copy and landing-page copy include Microsoft Teams, and setup instructions create a Workflows webhook and recommend a co-owner.
- [x] **Step 2: Run the focused UI/docs tests** and confirm they fail because Teams is absent.
- [x] **Step 3: Add the Teams option** to `ChannelsManager`, use a Teams-specific placeholder/help text, and keep it behind the existing delivery entitlement/admin checks. Add the Teams label to `DeliverPanel` so result and history entries display “Microsoft Teams” rather than the raw kind string. Update paid-plan delivery labels and the landing feature copy to include Microsoft Teams.
- [x] **Step 4: Document setup** using Microsoft Teams Workflows, the channel-specific webhook URL, workflow ownership/co-owner caveat, channel message limits, and the fact that legacy Office 365 connector webhooks are retired. Clarify that Microsoft Teams delivery is distinct from ShipLog's existing Clerk Organizations feature flag. In the customization guide, identify the type-only enum annotation on the plain-text column in `src/db/schema.ts` separately from the `ChannelKind` union in `src/lib/delivery.ts`, plus `isAllowedWebhook`, validation, sender, and form as extension points; state that no SQL migration is required. Do not document connector URLs as supported.
- [x] **Step 5: Verify** with `npm test -- src/components/channels-manager.test.tsx src/components/deliver-panel.test.tsx src/lib/plans.test.ts src/app/landing.test.tsx src/lib/delivery.test.ts scripts/docs.test.ts`, `npx eslint src/components/channels-manager.tsx src/components/channels-manager.test.tsx src/components/deliver-panel.tsx src/components/deliver-panel.test.tsx src/lib/plans.ts src/lib/plans.test.ts src/config/site.ts src/app/landing.test.tsx`, and `git diff --check`.

### Task 3: Verify Teams Through Every Delivery Path

**Files:** Modify `src/lib/delivery.test.ts`, `src/lib/scheduler.test.ts`, and `src/app/dashboard/projects/[id]/logs/[logId]` delivery tests only if a missing user-visible contract requires it.

**Interfaces:** No new interface. Manual and scheduled delivery continue through `deliverLog`; Teams uses the existing `DeliveryResult` statuses and history model.

- [x] **Step 1: Add regression tests** proving Teams test-send, manual send, and scheduled send call the stubbed Workflows endpoint and record sent/failed/unknown results correctly.
- [x] **Step 2: Run the focused delivery and scheduler tests** with disposable DB URLs; expect them to pass because Task 1 added Teams to the existing generic delivery channel model. A failure identifies a real integration gap.
- [x] **Step 3: Fix only demonstrated integration gaps** in the existing delivery path; do not add a separate Teams send pipeline or force production changes when shared code already satisfies the contract.
- [x] **Step 4: Rerun delivery and scheduler tests**; verify existing Slack/Discord/email behavior remains unchanged.

## Phase 2: Sentry Report Input

### Task 4: Sentry Connection and Project Source Data

**Files:** Modify `src/db/schema.ts`, `src/lib/validation.ts`, `src/lib/validation.test.ts`, `src/lib/projects.ts`, `src/lib/projects.test.ts`; add `src/lib/sentry-settings.ts`, `src/lib/sentry-settings.test.ts`, `src/app/api/settings/sentry/route.ts`, and `src/app/api/sentry/projects/route.ts`; generate Drizzle migration and metadata.

**Interfaces:** Add a `sentryConnections` table keyed by `ownerId` with `organizationSlug`, `encryptedToken`, and `updatedAt`. Add `sentryProjects: { id: string; slug: string; name: string }[]` to project persistence and create/update validation (default `[]`, bounded to 20). Export `getSentryConnection(ownerId)`, `saveSentryConnection(ownerId, organizationSlug, token)`, `deleteSentryConnection(ownerId)`, and `listSentryProjects(ownerId)`. Settings responses expose only `{ configured, organizationSlug, last4 }`; the project list returns only safe project summaries.

- [x] **Step 1: Write failing unit/API/database tests** for organization slug and token validation; Sentry project slugs beginning with `_` or `-`; project pages where one malformed row or an overlong name must not block valid project summaries; credential verification; admin-only save/delete; encrypted token at rest; no token in responses/errors; workspace isolation; project pagination and an explicit error if the fixed page budget is exhausted while another cursor remains; preserving selected project IDs on disconnect/replacement; and bounded/valid `sentryProjects` input.
- [x] **Step 2: Run the focused tests** with disposable local PostgreSQL URLs; confirm the missing storage/routes behavior fails.
- [x] **Step 3: Implement schema, validation, and settings helpers.** Verify token/org by listing projects through fixed `https://sentry.io/api/0/` paths with bearer auth and `project:read` permission; use the existing `encrypt`, `decrypt`, `last4`, `requireAdmin`, and `handle` patterns. Parse Sentry project rows individually so a malformed row is excluded rather than invalidating valid project summaries; normalize/truncate display names to the client schema's bound. Deleting the connection must not mutate project selections.
- [x] **Step 4: Implement settings and project-list routes.** Require admin for connection mutations; require authenticated workspace membership for reading project names. Map 401/403/404, rate limits, timeouts, malformed upstream payloads, and page-budget exhaustion to safe actionable errors. Never accept an API base URL from the client; never silently return a partial project list when another cursor remains beyond the page cap.
- [x] **Step 5: Generate and inspect the migration** for the connection table and project JSON column/default; apply only to disposable PostgreSQL.
- [x] **Step 6: Rerun focused validation, settings, route, and project tests**; expect all to pass.

### Task 5: Sentry Settings and Per-Project Selection UI

**Files:** Modify `src/lib/settings.ts`, `src/app/dashboard/settings/page.tsx`, `src/components/settings-form.tsx`, `src/components/project-form.tsx`, `src/app/dashboard/projects/[id]/page.tsx`, `src/app/api/projects/route.ts`, `src/app/api/projects/[id]/route.ts`, and `src/app/dashboard/settings-page.test.tsx`; add `src/components/project-form.test.tsx` and route tests where absent.

**Interfaces:** Add Sentry status to setup data without exposing the token. Add an admin-only `SentryCard` with connect/replace/disconnect. Extend `ProjectFormValues` and API project payloads with `sentryProjects`; fetch selectable summaries from `GET /api/sentry/projects` and persist selected `{ id, slug, name }` values through existing project create/update routes. Both project create and update routes must resolve submitted IDs against the connected workspace's accessible Sentry project list and persist canonical records, never trust submitted slug/name fields.

- [x] **Step 1: Add failing component/API tests** for admin versus member controls, safe configured state including unreadable/corrupt encrypted token recovery, replace/disconnect flow, browse and select multiple Sentry projects, saving/restoring project selections across edit mode, rejection/canonicalization of IDs, slugs, or names not matching the connected workspace's accessible Sentry projects on both create and update, and a shared Sentry project-list rate limit for project list/create/update actions.
- [x] **Step 2: Run the focused settings/project tests** and observe missing Sentry controls and serialization.
- [x] **Step 3: Add the settings card and project selector** using existing form/select/card patterns. Show the read-only token requirements as `project:read` and `event:read`. If encrypted token decryption fails, return a safe configured status with no token/last4 so an admin can still replace or disconnect it. Hide project browsing when no Sentry connection exists, but retain saved selections on disconnect and render a reconnect/access error if a selected project is unavailable.
- [x] **Step 4: Pass `sentryProjects` through project load/create/update** without changing repository behavior or legacy project records. In both POST and PATCH routes, perform cheap plan-limit and resource-ownership checks before upstream calls where possible; then reconcile submitted IDs against `listSentryProjects(ownerId)` and persist API-derived `{id, slug, name}` values; reject inaccessible IDs and ignore client-provided slug/name values. Enforce the shared `sentry-projects:${ownerId}` rate limit of 120 requests per hour before each non-empty reconciliation; empty/omitted selections must not call or consume this upstream-call limit.
- [x] **Step 5: Rerun focused tests and `npx eslint <modified files>`**; verify no token reaches client props.

### Task 6: Bounded Sentry Issue Adapter

**Files:** Add `src/lib/sentry.ts`, `src/lib/sentry-api.ts`, and `src/lib/sentry.test.ts`; modify `src/lib/sentry-settings.ts` and `src/lib/sentry-settings.test.ts` to use the shared transport and test parity.

**Interfaces:** Export `fetchSentryActivity(connection, projects, since, until): Promise<SentryActivity>`, with `SentryActivity = { issues: SentryIssue[] }` and each issue containing only `{ id, title, level, status, eventCount, countCapped, projectId, projectName, url, lastSeen }`. Keep the shape bounded, and make `formatSentryActivity` state that it shows at most the 25 most frequent candidates so the prompt never implies an exhaustive list. Use a fixed Sentry API origin; accept project identifiers from saved project selections only. Add `formatSentryActivity(activity: SentryActivity): string` for prompt serialization. Add a shared low-level `sentry-api.ts` page transport used by both settings and issue adapters so fixed origin, redirect rejection, per-request timeout, response parsing, and cursor validation have one implementation.

- [x] **Step 1: Add failing adapter/transport tests** for filtered organization issue queries (`project`, `start`, `end`, `query=`), normalized fields/status, per-issue event queries with the same `start`/`end`, bounded issue count with explicit “up to 25 most frequent” formatting, page and concurrency caps, truthful lower-bound counts when the event-page cap is reached, malformed payloads, and 401/403/404/429/5xx/timeout/redirect handling. Add a shared-transport test proving settings and issue adapters use the same fixed-host/redirect/cursor/timeout behavior. Cover title/project-name separator injection, response-body timeouts, event-fetch failure cancellation, and an overall 45-second deadline.
- [x] **Step 2: Run `npm test -- src/lib/sentry.test.ts`**; confirm the adapter is missing.
- [x] **Step 3: Implement shared transport and adapter.** Centralize fixed-origin Sentry page requests and safe cursor extraction in `src/lib/sentry-api.ts`, then use it from both `sentry-settings.ts` and `sentry.ts`; retain the settings-specific status/error messages through caller mapping. Give each `fetchSentryActivity` invocation an overall 45-second deadline; keep the per-request 10-second timeout, abort in-flight requests after failure/deadline, and fail the whole fetch (never return partial data). Use `/organizations/{org}/issues/` to find issues active in the range and `/organizations/{org}/issues/{issueId}/events/` to count only events in that range. Sentry's issue `count` is lifetime data: do not use it as the report-window count. If the event page cap is reached, set `countCapped` and represent the value as a lower bound in formatted prompt text. Always state that at most the 25 most frequent issues are listed. Ignore event payload details beyond counting rows. Treat both issue title and project name as untrusted text; serialize or normalize so newlines cannot create fake prompt records.
- [x] **Step 4: Rerun adapter tests**; expect all fixtures to pass with no external Sentry calls.

### Task 7: Sentry Generation, Source Snapshot, and Prompt

**Files:** Modify `src/lib/generation.ts`, `src/lib/ai/templates.ts`, `src/lib/ai/templates.test.ts`, `src/lib/generation.test.ts`, `src/lib/scheduler.test.ts`, and source display/parser code/tests only if it reads snapshot data.

**Interfaces:** Persist `{ ...activity, sentry?: SentryActivity }` in `sourceSnapshot`, retaining top-level repository `Activity` fields and compatibility with historical snapshots. Extend `buildUserPrompt(ctx, activityText, start, end, sentryText?)` so prompts label repository and Sentry context separately. `prepare()` calls `fetchSentryActivity(connection, project.sentryProjects, period.start, period.end)` only when `project.sentryProjects` is nonempty and after resolving the workspace token.

- [x] **Step 1: Add failing tests** proving no Sentry requests/prompts occur without selected projects; selected-project issues appear in the prompt and saved source snapshot; only selected IDs and report-window events are included; Sentry auth/access/timeout or unavailable-selected-project errors fail generation with a provider-safe message; historical snapshots still parse; scheduled generation uses the same workspace Sentry connection.
- [x] **Step 2: Run focused template, generation, and scheduler tests** with all database URLs pointed at disposable local PostgreSQL; observe the missing Sentry source/prompt behavior.
- [x] **Step 3: Implement generation integration.** Preserve the existing GitHub/GitLab requirement and empty-repository-activity rejection. Store repository activity unchanged and add optional normalized Sentry issue data alongside it. Keep Sentry issue data bounded and treat it as untrusted input in the AI prompt; update the system prompt to ignore instructions embedded in issue titles/metadata.
- [x] **Step 4: Rerun focused generation/template/scheduler tests** against disposable PostgreSQL; expect unchanged behavior when Sentry is unconfigured and correct Sentry behavior when selected.

### Task 8: Documentation and Full Verification

**Files:** Modify `README.md`, `docs/services.md`, `docs/configuration.md`, `docs/architecture.md`, `docs/upgrading.md`, `docs/troubleshooting.md`, `scripts/docs.test.ts`, `CHANGELOG.md`, `src/lib/sentry-settings.ts`, `src/lib/sentry-settings.test.ts`, `src/lib/sentry.ts`, `src/lib/sentry.test.ts`, `src/lib/scheduler.ts`, `src/lib/scheduler.test.ts`, `src/lib/generation.ts`, `src/lib/generation.test.ts`, `src/lib/delivery.ts`, `src/lib/delivery.test.ts`, and `src/components/channels-manager.tsx`.

**Interfaces:** Document Teams as a paid delivery channel under existing delivery limits. Document Sentry token setup, organization slug, `project:read` and `event:read` permissions, workspace admin ownership, selected-project behavior, report-window issue/count semantics, disconnect retention, and troubleshooting. No new deployment environment variable is introduced.

- [x] **Step 1: Add failing tests** for Workflows setup requiring trigger auth “Anyone”, Teams-specific 401/403 remediation, Sentry token verification requiring both read scopes, inaccessible Sentry projects, project names in unavailable errors, and correct UI/status/configuration copy. Preserve the existing generation-time selected-project validation, usage-refund and scheduler-notification regressions.
- [x] **Step 2: Implement the verified setup/error behavior.** During Sentry connection save, verify both `project:read` and `event:read` with read-only requests before storing the token. Use safe actionable scope-specific errors. For Teams Workflows, docs must instruct trigger authentication “Anyone” (ShipLog does not send bearer auth), and Teams 401/403 errors must say so. Use Microsoft Teams consistently in user-facing delivery messages and URL help. Include a selected project name in `SENTRY_PROJECT_UNAVAILABLE`, clarify organizations over 1,000 projects aren't supported yet, correct member-status copy, and ensure Teams URL-help copy reflects host-only masking.
- [x] **Step 3: Update documentation and changelog** to match shipped behavior; do not imply OAuth, Sentry alert delivery, self-hosted Sentry, or Sentry-only reports. Use an accurate personal token/internal integration setup with both read scopes, separate trigger authentication from the Workflows channel-post action, explain the 24 KB ShipLog payload budget and ownership in the Microsoft tenant, and document unavailable-project remediation and report-period counts.
- [x] **Step 4: Run all tests** against disposable local PostgreSQL with `DATABASE_URL` and `DATABASE_URL_UNPOOLED` explicitly set, and unset leaked `BILLING_ENABLED`, `OPENAI_API_KEY`, and `AI_PROVIDER`. Never allow `.env.local`/Neon to be used.
- [x] **Step 5: Run `npm run typecheck`, `npm run lint`, `npm run build`, `npm run scan:secrets -- --all`, and `git diff --check`.** Review migrations, generated metadata, secret handling, and the final diff. Do not execute migrations against the configured Neon database.

## Implementation Notes

- Use Microsoft’s current Workflows webhook URL shape and payload documentation when writing exact URL fixtures; workflow webhook URLs may include secret query parameters, which must be encrypted and never included in hints or logs.
- Sentry's organization issue listing supports project and ISO `start`/`end` filters. The issue's `count` field is not a report-window count; use the per-issue events endpoint with the same range and treat a reached page cap as a lower bound.
- Sentry project selections contain only stable ID, slug, and display name. On generation, verify IDs remain accessible through the connected organization; fail clearly instead of silently omitting unavailable sources.
- Automated tests must stub all Microsoft and Sentry requests. Database-backed suites use isolated `test_` owner IDs and clean up fixture rows.
