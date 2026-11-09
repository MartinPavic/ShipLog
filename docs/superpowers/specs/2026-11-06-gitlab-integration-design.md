# GitLab Integration Design

## Intent

Let teams using GitLab.com or a publicly reachable self-managed GitLab instance generate the same reports ShipLog currently makes from GitHub. Workspace admins configure the instance's OAuth application; each member authorizes their own GitLab account. Projects can combine GitHub and GitLab repositories so one report can cover mixed engineering work.

## Goals

- Support GitLab.com and one self-managed GitLab instance per workspace.
- Let an organization admin configure the workspace's GitLab base URL, OAuth client ID, and client secret. Personal-workspace owners configure their own.
- Let each member connect/disconnect a personal GitLab account against that workspace configuration.
- Browse and manually add GitLab repositories to projects alongside GitHub repositories.
- Normalize GitLab commits, merged merge requests, closed issues, releases, links, authors, and change summaries into the existing provider-neutral `Activity` used by generation, source review, snapshots, and exports.
- Keep existing GitHub connections and stored project repositories working without user changes.
- Refresh expiring GitLab access tokens safely and retain the rotated refresh token.

## Non-goals

- GitLab CI pipelines, deployments, wiki activity, comments, or group-wide service accounts.
- GitLab self-managed hosts reachable only over a private VPN or private network from the hosted ShipLog service.
- More than one GitLab instance per workspace in the first version.
- Replacing or migrating GitHub OAuth, connections, APIs, or existing GitHub repositories.
- Using GitLab Personal Access Tokens as an alternative to OAuth.

## Approaches

1. **Workspace OAuth configuration plus member OAuth connections, with provider-tagged project repositories. Selected.** Admins register one OAuth app on GitLab.com or their self-managed instance and enter its base URL/client ID/client secret in ShipLog. Members authorize individually. Repositories carry a provider tag, defaulting to GitHub for legacy data. This supports mixed projects and tenant-owned instances without operator preconfiguration; setup is more involved and security boundaries need careful tests.
2. **Operator-preconfigured GitLab instances. Not selected.** Simpler for ShipLog, but contradicts the requirement that each company admin connects its own self-managed instance and prevents independent customer setup.
3. **Personal access tokens. Not selected.** Easier to implement for multiple hosts, but departs from the agreed OAuth approach and leaves users responsible for manually scoped, expiring credential management.

## User Experience

- Settings gains a GitLab section. A workspace admin enters an HTTPS instance URL, OAuth application ID, and secret; the secret is write-only after save and encrypted at rest. GitLab.com is the default URL but still uses an app registration. Admins can update or remove the configuration. Members can see whether the workspace is configured and connect/disconnect their own GitLab account.
- The project repository picker has GitHub and GitLab source choices. Each selected repository visibly identifies its provider. GitHub browsing and manual entry retain their current behavior. GitLab browsing uses the member's connection; manual GitLab paths resolve against the configured workspace instance.
- Generation, source activity, scheduled runs, and delivery continue to use the same normalized activity and log workflow.
- GitHub-only users see no required new setup and retain current behavior.

## Data And Interfaces

- Extend a repository reference with `provider: "github" | "gitlab"`; absence means GitHub. For GitLab, `fullName` is the project path, and the workspace's single configured instance supplies its base URL.
- Add one GitLab instance configuration per workspace (`ownerId`, normalized base URL, client ID, encrypted client secret, timestamps).
- Add GitLab member connections keyed by workspace and user, storing login, encrypted access token, encrypted rotating refresh token, expiry, scopes, and timestamps.
- Keep GitHub connections in their existing table and API. Add GitLab-specific connect/callback/disconnect/repository routes and workspace-admin configuration endpoints.
- Manual generation uses the initiating member's GitLab connection. Scheduled generation uses the project creator's connection, matching current GitHub behavior. If that member cannot access any selected repository, fail the run with a clear provider-specific access error; do not silently omit the repository.
- Keep `Activity`, `RepoActivity`, and generated log APIs provider-neutral. Map GitLab merge requests to the existing pull-request activity shape, retaining GitLab URLs and IID display values.

## Security And Operational Constraints

- Instance URLs must be HTTPS, have no embedded credentials, query, or fragment, and be normalized before storage. Reject localhost, link-local, and private IP destinations for the hosted service. Disable redirects on token and API requests, enforce timeouts, and call only the exact configured host and its derived API/OAuth paths. This intentionally excludes VPN-only/private-network hosts.
- Only a workspace admin can save/replace/remove instance OAuth credentials. Store the client secret and user tokens with the existing AES-GCM helper; never return secrets to the browser. Restrict GitLab connections and repositories by both workspace and user.
- Use state bound to the initiating user/workspace for OAuth callbacks. Request only the read scopes needed for user identity, projects, commits, merge requests, issues, releases, and diffs.
- Serialize token refresh per connection because GitLab rotates and invalidates refresh tokens. Persist the new access token, refresh token, and expiry atomically; concurrent requests must not reuse an invalidated refresh token.
- Set explicit pagination, response/item limits, timeouts, and safe error mapping. Treat GitLab activity fields and diffs as untrusted prompt input, as with GitHub.
- A configured instance URL cannot change while projects in that workspace reference GitLab repositories, unless the admin removes or migrates those references first. Removing the integration requires disconnecting member connections and removing GitLab project references; warn before destructive cleanup. Historical generated logs, versions, and source snapshots are retained.
- Changing the configured OAuth client ID or secret disconnects all member GitLab connections for that workspace and requires members to authorize again. This avoids attempting token refresh with credentials that may no longer own the grants.
- No third-party SDK dependency is required; use the existing `fetch`, validation, encryption, rate-limit, and activity-normalization patterns.

## Verification

- Unit tests cover URL normalization/rejection, OAuth state and callback failures, token response validation, refresh-token rotation and concurrent refresh, GitLab API pagination/error/timeout handling, and mapping edge cases.
- Database tests cover admin-only instance config, workspace/user isolation, encrypted-at-rest credentials, instance-change guards, concurrent refresh persistence, mixed-provider project CRUD, and cascade/cleanup behavior.
- Generation tests cover mixed GitHub/GitLab activity flowing through one normalized prompt and persisted source snapshot.
- Existing GitHub, generation, scheduling, teams, dashboard, and release tests remain green; legacy repo JSON without a provider continues to behave as GitHub.
- Update setup/service/configuration/architecture docs, README feature description, environment/config tests if needed, migration snapshots, and release/license checks.

## Decisions Left To The Builder

- Exact GitLab API pagination parameters and endpoints, verified against current official API docs during implementation.
- Whether GitLab OAuth uses `read_api` alone or also `read_user`; choose the narrowest scopes that support selected endpoints and account display.
- Exact table/column names, URL canonicalization, and response normalization details, while preserving the contracts above.
- Public-DNS validation and redirect protection must be implemented in a way that resists SSRF and DNS rebinding without adding network access to arbitrary private hosts.

## Builder-Check Resolutions

- Connection selection and inaccessible repositories: use the initiating member for manual runs and project creator for scheduled runs, matching GitHub; fail clearly if that identity lacks access.
- Integration removal: preserve historical reports and source snapshots; require repo references and member connections to be removed before deleting workspace instance configuration.
- OAuth credential replacement: disconnect all workspace members and require reauthorization when client ID or secret changes.