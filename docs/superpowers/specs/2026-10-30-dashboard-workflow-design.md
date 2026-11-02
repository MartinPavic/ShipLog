# Dashboard Workflow Design

Approved in conversation on 2026-10-30 after reviewing an interactive mockup.

## Intent

Help product owners and project managers at subscribing companies turn engineering activity into reports for clients or internal teams. Improve the existing workflow before adding reporting features.

## Approaches

1. Improve the core workflow: expose project selection during generation and make review and sharing the next step. Selected for its low setup cost and reuse of existing capabilities.
2. Add team approvals: useful for mandatory sign-off, but adds coordination that has not been validated with customers. Deferred.
3. Build a recurring reporting hub: stronger automation visibility, but substantially more configuration and operational scope. Deferred.

## Approved Behavior

- Show Quick Generate before recent reports, with compact account and usage information last.
- Keep onboarding, setup blockers, checkout feedback, and billing controls visible when relevant.
- Always show a labeled project field inside Quick Generate, even with one project.
- Default to the remembered project when it belongs to the available projects; otherwise use the first available project.
- Switching projects loads that project's generation defaults and remembers the selection for subsequent visits.
- Remove the header project selector. Preserve organization switching, account controls, navigation, and theme controls.
- Replace the generated result's generic Open link with Review and share, linking to the existing report page.
- Give successful recent reports the same explicit action; preserve real generating and failed states.
- Preserve empty-project, setup, cancellation, failure, quota, billing, and feature-flag behavior.

## Constraints And Non-goals

- Reuse existing components and visual conventions; the mockup is a layout reference, not production behavior.
- No new dependencies, integrations, database changes, approval statuses, or visual rebrand.
- Do not overwrite pre-existing changes to release/config.json or commit temporary preview session data.
- Do not run database-writing tests against an unverified shared environment.

## Builder Decisions

Use the existing active_project cookie for Quick Generate selection. Keep the report-page generator compatible while making the dashboard generator compact. Add database-independent regression tests using the repository's existing Vitest and server-rendering conventions.