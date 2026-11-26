# Multiple schedules per project - design

## Intent

A project has one weekly schedule today, and that one schedule uses the project's single template and every enabled delivery channel. Teams want different output for different people from the same project: for example a customer update on Fridays by email and a technical digest on Mondays in Slack.

Audience is already a field on a template (with tone and instructions), so "different audiences" is solved by "different templates". A schedule therefore picks a template, a set of channels and a cadence.

Schedules also move out of the Settings card into their own project tab.

## Goals

- A project can have many schedules. Each has a name, template, weekdays, hour, timezone, period, channels and an on/off switch.
- A new Schedules tab on the project page lists, creates, edits, toggles and deletes schedules, and shows each one's last run.
- Runs of different schedules never collide, and each run keeps today's idempotency, retry and notification behavior.

## Non-goals

- No monthly or custom cron cadence. Cadence is a set of weekdays plus an hour.
- No migration of existing data: there are no schedules in use. `projects.schedule` is dropped.
- No change to how a single run generates or delivers a log.
- No change to the Vercel cron frequency (daily by default, hourly on Vercel Pro or a host cron). Hour precision is still limited by how often the endpoint is called.

## Anti-goals

- A schedule that silently sends to channels the user did not choose. An empty channel selection means "do not deliver".
- Two schedules producing duplicate logs or duplicate deliveries for the same run.

## Constraints

- Next.js 16 and Drizzle on Postgres (Neon). Follow the `handle()`, `parseBody()` and `ApiError` conventions in API routes.
- Plan gating stays on `limits.scheduling` (Pro and Ultra). Each scheduled run still consumes one generation of the owner's usage, so more schedules cost more usage.
- `deliverLog()` treats an empty `channelIds` as "all enabled channels". The scheduler must never call it with an empty list.
- Tests that touch the database use isolated owner ids and always pass `{ only: [...] }` to `runScheduled()`.

## Approaches considered

1. **A `project_schedules` table plus a `schedule_channels` join table (chosen).** Real foreign keys, per-schedule run keys and last-run lookups, and channel deletion cleans up automatically. Costs a migration and new routes.
2. A `schedules` JSON array on `projects`. Smallest migration, but channel ids would be unchecked, concurrent edits overwrite each other, and last-run lookups are awkward.
3. A schedule attached to each delivery channel. Rejected: a schedule needs one template and one log delivered to several channels.

## Design

### Data model (migration 0014)

- New table `project_schedules`:
  - `id` uuid pk, `projectId` fk to `projects` (cascade), `name` text, `template` text (a built-in id or custom template uuid, same soft reference as `projects.template`)
  - `weekdays` integer[] (values 0 to 6, at least one), `hour` int 0 to 23, `timezone` text, `periodDays` int (same bounds as today)
  - `enabled` boolean, `createdBy` text, `createdAt`, `updatedAt`
- New table `schedule_channels` with `scheduleId` fk (cascade) and `channelId` fk to `delivery_channels` (cascade), composite primary key.
- `scheduled_runs` is recreated with `scheduleId` (fk, cascade) replacing `projectId` in the primary key: `(scheduleId, slot)`. Existing rows are dropped; there is nothing to keep.
- Drop `projects.schedule`. The `ProjectSchedule` type goes away.
- `ship_logs.schedule_key` and `deliveries.schedule_key` keep their unique indexes. The key becomes `${scheduleId}:${slot}`.
- Deleting a custom template also resets any `project_schedules.template` that used it to the fallback template, in the same transaction as the existing project reset.

### Slots

`currentSlot()` takes `weekdays: number[]` instead of `dayOfWeek`. The slot is still the schedule's local date, due on any listed weekday from the chosen hour until midnight, so a late cron tick still runs the same day.

### Scheduler

- `runScheduled()` selects enabled schedules joined to non-archived projects, instead of projects.
- Claims, retries, stale-run recovery, the worker pool and the deadline are unchanged, but keyed by schedule id.
- `runProject()` becomes `runSchedule()`. It generates with `generateLog({ owner, project, period: { days: periodDays }, template: schedule.template, scheduleKey })`, where the owner is built from `schedule.createdBy`.
- Delivery runs only if the schedule has selected channels and the plan allows delivery. It calls `deliverLog(log, project.id, selectedChannelIds, scheduleKey)`. Disabled channels are skipped by `deliverLog()`; if all selected channels are disabled, the existing `NO_CHANNELS` handling records a note on the run.
- Plan check, error classification (skipped, transient retry, failed), the creator-membership check and notifications keep today's behavior. Notifications name the schedule and link to the Schedules tab.

### API

- `GET` and `POST /api/projects/[id]/schedules`, `PATCH` and `DELETE /api/projects/[id]/schedules/[scheduleId]`.
- `POST /api/projects/[id]/schedules/[scheduleId]/take-over` sets that schedule's `createdBy` to the caller and re-queues its newest skipped or failed run. The project-level take-over route is removed.
- The request body carries `name`, `template`, `weekdays`, `hour`, `timezone`, `periodDays`, `enabled` and `channelIds`. Validation: the template exists for the owner, every channel belongs to the project, a name is required, and at most `MAX_SCHEDULES = 10` per project.
- Enabling a schedule, or creating an enabled one, calls `requirePlanFeature(ownerId, "scheduling")`. `schedule` is removed from `updateProjectSchema` and the project PATCH route.
- Managing schedules is admin-only, the same as channels (my call: schedules act on stored credentials and send to external channels). Any member can view them.

### UI

- The project page gets a Schedules tab between Delivery and Settings. The Schedule card, `ScheduleValues`, `DEFAULT_SCHEDULE`, and the `schedulingAllowed`, `lastRun` and `canTakeOver` props are removed from `ProjectForm`.
- The tab lists schedules as rows or cards: name, weekdays and hour with timezone, period, template label, selected channels, an enabled toggle and the last run status. An add or edit form uses the existing field components (day chips, hour select, timezone input with "Use mine", period, template select, channel checkboxes).
- Locked state for plans without scheduling and a "run as me" action for admins on schedules created by someone else, as in the old card.
- If the project has no channels, the form says so and links to the Delivery tab; a schedule without channels is still valid and only generates logs.

### Docs and tests

- Update docs/architecture.md, docs/services.md (the cron section), docs/troubleshooting.md and CHANGELOG.md.
- Rewrite scheduler.test.ts, schedule.test.ts and the schedule parts of validation.test.ts, project-form.test.tsx and teams.test.ts for the new model. Add tests for two schedules on the same day, channel selection, empty channels not delivering, template deletion resetting schedules, and the new routes' auth and plan gating.

## Clarifications

- A new schedule starts with no channels selected. Channels are never auto-selected, and adding a channel later does not add it to existing schedules. A schedule with no channels (including one whose channels were all deleted) generates logs only, and the list shows "No channels: log only".
- A schedule whose plan lapses is skipped with the existing "requires the Pro plan" note, as today. If only delivery is unavailable, the log is still generated and not delivered.
- Quota exhaustion mid-tick keeps the existing classification: `LIMIT_REACHED` is a skipped run that notifies the schedule's creator. Other schedules keep their own state.
- Take-over is admin-only and needs no plan check. A creator who left an organization is still handled by the existing `CREATOR_LEFT` skip, which take-over resolves.
- The fallback template is `FALLBACK_TEMPLATE` in src/lib/templates.ts. PATCH accepts partial bodies, so omitting `template` keeps the stored one.
- Archived projects' schedules do not run and resume normally on unarchive. A run is only due on a matching local date, so there is no catch-up.
- The migration is hand-written where drizzle-kit would prompt; the old `projectId:slot` keys can stay because nothing is in use.

## Left to the builder

- Exact form layout and copy, the tab's component structure, and how last-run data is queried for the list.
- Default values for a new schedule (suggestion: Friday 09:00, the user's timezone, 7 days, enabled).
- Whether log titles should include the schedule name.
- The choice of Drizzle column type for `weekdays` (integer array or bitmask).
