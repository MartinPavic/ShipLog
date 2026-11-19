# Teams Delivery and Sentry Report Input

## Intent

Add Microsoft Teams as a report delivery destination, then add Sentry issues as an optional input to generated reports. This extends ShipLog's current project-level Slack/Discord/email delivery and GitHub/GitLab activity sources.

## Goals

- Let project admins configure a Microsoft Teams Workflows webhook and use it for test, manual, and scheduled delivery.
- Store webhook URLs encrypted and show only a safe hint, following existing channel behavior.
- Let workspace admins connect Sentry with a read-only token scoped to `project:read` and `event:read` where Sentry permits token scopes.
- Let each ShipLog project select one or more Sentry projects from the connected organization.
- Include a bounded, date-filtered summary of Sentry issues active during the report window: title, severity, event count within that window, current status at generation time, project, and issue link.
- Preserve existing reports and behavior when no Sentry source is configured.

## Non-goals

- Linear or Jira integrations.
- Sentry alert delivery, Sentry webhooks, or sending data from ShipLog into Sentry.
- A Microsoft Teams OAuth app or in-app team/channel picker.
- Sentry OAuth, event payloads, stack traces, user data, or unrestricted issue history.
- Self-hosted Sentry support in the first version; use Sentry's hosted API.

## Approaches

- **Teams Workflows webhook (selected):** Project admins paste a channel-specific workflow URL. This matches the existing webhook channel model and avoids a Teams app and OAuth lifecycle. The workflow is owned by its creator, so setup guidance should recommend adding a co-owner.
- **Teams OAuth app (not selected):** ShipLog connects to Microsoft and selects a channel in-app. Better setup UX, but requires app registration, permissions, consent, and token management.
- **Sentry read-only token (selected):** A workspace admin enters a token in Settings; ShipLog encrypts it and uses it to list and fetch issues for the selected Sentry projects. This avoids operating an OAuth application and gives admins direct control over access.
- **Sentry public OAuth integration (not selected):** Cleaner authorization and revocation for end users, but requires registering and maintaining a Sentry public integration and OAuth token lifecycle.

## Proposed behavior

### Phase 1: Microsoft Teams delivery

Add `teams` as a project delivery channel using a Microsoft Workflows webhook URL. Reuse channel creation, encryption, safe URL hint, enable/pause, remove, test, manual delivery, and scheduled delivery. Send a concise report payload compatible with Workflows, with the report title and Markdown content. Bound the payload to Teams' documented message limit and return actionable errors for failed or uncertain delivery. Validate HTTPS URLs against supported Microsoft Workflows host/path patterns; reject redirects and retain request timeouts.

### Phase 2: Sentry report input

Add workspace-level Sentry connection settings for one organization and a read-only token. Verify credentials and list accessible projects; store the token encrypted, never return it, and allow admins to replace or disconnect it. Add a multi-select Sentry project source to each ShipLog project, storing stable Sentry project identifiers. During generation, query issues with activity inside the report's time window and selected projects, with a fixed result/page budget; report event counts for that same window and the current issue status at fetch time. Normalize selected fields into a bounded Sentry activity section in the AI prompt and stored source snapshot. Sentry supplements GitHub/GitLab activity and does not enable Sentry-only reports in this version. If no Sentry projects are selected, preserve current generation behavior. If configured Sentry access fails or a selected project is no longer accessible, fail generation with a clear provider error rather than silently presenting an incomplete report. Disconnecting a Sentry connection retains project selections; reconnecting or replacing the token does not silently erase project configuration.

## Constraints and safety

- Follow the existing workspace `ownerId` boundary, admin permissions, encrypted-secret storage, Zod validation, timeout, and bounded-pagination patterns.
- Use Sentry's read-only `project:read` and `event:read` scopes and its `start`/`end` issue-query filters; don't use lifetime event totals as the report-window count.
- Keep tokens and webhook URLs server-side; never include them in logs, client props, or error messages.
- Restrict Sentry API calls to the hosted Sentry API. Do not accept arbitrary API base URLs.
- Microsoft's legacy Office 365 connector webhooks were retired in May 2026; use Workflows webhook URLs, not legacy connector URLs.
- Add database migrations for new Sentry connection/source data and update setup/configuration documentation.

## Acceptance

- Teams test, manual, and scheduled deliveries succeed through a Workflows webhook; invalid URLs and delivery failures are safely handled.
- Sentry connection can be verified, replaced, and disconnected without exposing the token.
- Selecting Sentry projects adds only bounded, date-relevant issue summaries to a report; leaving them unselected changes no existing behavior.
- Tests cover access control, secret handling, source normalization/budgets, provider failures, and both manual and scheduled delivery paths.

Implementation order: Teams delivery first, then Sentry report input. Detailed schema/API/UI choices and exact provider limits remain for the implementation plan unless they change the scope above.
