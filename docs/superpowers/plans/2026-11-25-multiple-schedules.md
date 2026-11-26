# Multiple Schedules per Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project can have many independent schedules, each with its own template, weekdays, hour, timezone, period, channels and creator, managed in a new Schedules tab.

**Architecture:** New `project_schedules` and `schedule_channels` tables replace the `projects.schedule` JSON. `scheduled_runs` is keyed by `(scheduleId, slot)` and log/delivery idempotency keys become `${scheduleId}:${slot}`. `runScheduled()` iterates schedules; a schedule delivers only to its selected channels. CRUD lives in `src/lib/schedules.ts` with admin-only routes under `/api/projects/[id]/schedules`.

**Tech Stack:** Next.js 16 (App Router), Drizzle ORM on Postgres (Neon), zod, vitest, React 19 client components.

**Spec:** `docs/superpowers/specs/2026-11-25-multiple-schedules-design.md`

## Global Constraints

- Cadence is a set of weekdays (0 = Sunday ... 6 = Saturday, at least one) plus an hour 0-23 in an IANA timezone. A run is due on a listed local weekday from the hour until local midnight; the slot is the local date (`YYYY-MM-DD`).
- `MAX_SCHEDULES = 10` per project. Schedule name is required, at most 60 characters. `periodDays` keeps `periodDaysSchema` (1-90). Channel selection is at most 10 ids, all belonging to the project.
- An empty channel selection means "generate only". `deliverLog()` treats an empty `channelIds` as "all enabled channels", so the scheduler must never call it without a non-empty list.
- Creating or enabling a schedule needs `requirePlanFeature(ownerId, "scheduling")`. Managing schedules (POST, PATCH, DELETE, take-over) is `requireAdmin()`; GET is `getOwner()`.
- Runs use the schedule's `createdBy` as the acting user. Error classification (skipped, retry, failed), the creator-membership check, the 3-attempt retry and the stale-run recovery behave as in the current `scheduler.ts`.
- Dropping `projects.schedule` and recreating `scheduled_runs` is intentional: no schedules or runs exist. The migration (`drizzle/0014_*`) must `DROP TABLE "scheduled_runs"` and `CREATE TABLE` it again, with no ALTER and no data copy.
- Plan constraint from the repo: DB-backed tests must run against a disposable Postgres, never the Neon in `.env.local`. Setup (from repo notes): `docker run -d --name shiplog-test -p 55432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=shiplog_test postgres:17`, then in every command prefix `DATABASE_URL=postgres://postgres:postgres@localhost:55432/shiplog_test DATABASE_URL_UNPOOLED=postgres://postgres:postgres@localhost:55432/shiplog_test`. This plan writes that prefix as `$TESTDB`.
- DB tests use isolated `test_*` owner ids, clean up in `afterAll`, and call `runScheduled()` only with `{ only: [...] }`.
- Do not commit. The repo owner commits manually; each task ends with a `git status` checkpoint.
- Verification for every task: `npm run typecheck`, `npm run lint`, and the task's tests; the last task runs the whole suite and `npm run build`.

## Review Focus

1. Two schedules of one project are both due on the same day: both run, each with its own template and log, with no key collision (Task 3).
2. A schedule with no channels, with all channels disabled, or whose channel was deleted: it must not deliver to the project's other channels; with no usable channels the run is still `done` (Task 3).
3. Channel ids from another project in a create or update body are rejected, never linked (Tasks 3 and 4).
4. A schedule of an archived project does not run; a disabled schedule does not run (Task 3).
5. A custom template deleted while a schedule uses it: the schedule falls back to the default template and keeps running (Task 5).

---

### Task 1: Slot logic takes a weekday set

**Files:**
- Modify: `src/lib/schedule.ts`
- Modify: `src/lib/scheduler.ts` (one call site only, removed again in Task 3)
- Test: `src/lib/schedule.test.ts`

**Interfaces:**
- Produces: `currentSlot(schedule: { enabled: boolean; weekdays: number[]; hour: number; timezone: string }, now: Date): string | null`.

- [ ] **Step 1: Update the tests.** In `schedule.test.ts` change `base` to `{ enabled: true, weekdays: [3], hour: 9, timezone: "UTC" }` and the DST case to `weekdays: [0]`. Add:
  - `"is due on any listed weekday"`: with `weekdays: [1, 3]`, `currentSlot(.., 2026-10-12T12:00Z)` (Monday) is `"2026-10-12"`, Tuesday `2026-10-13` is `null`, Wednesday `2026-10-14` is `"2026-10-14"`.
  - `"is never due with no weekdays"`: `weekdays: []` gives `null`.
- [ ] **Step 2: Run** `npx vitest run src/lib/schedule.test.ts`. Expected: FAIL (type or wrong results).
- [ ] **Step 3: Implement.** Replace `dayOfWeek: number` with `weekdays: number[]` in the `Schedule` type and test `!schedule.weekdays.includes(weekday)` instead of the equality check.
- [ ] **Step 4: Keep `scheduler.ts` compiling.** At its one `currentSlot(p.schedule, now)` call pass `{ ...p.schedule, weekdays: [p.schedule.dayOfWeek] }`.
- [ ] **Step 5: Run** `npx vitest run src/lib/schedule.test.ts` (PASS), then `npm run typecheck`.
- [ ] **Step 6: Checkpoint:** `git status`.

---

### Task 2: Remove schedule editing from the project API and form

**Files:**
- Modify: `src/lib/validation.ts`, `src/lib/validation.test.ts`
- Modify: `src/app/api/projects/[id]/route.ts`
- Modify: `src/components/project-form.tsx`, `src/components/project-form.test.tsx`
- Modify: `src/app/dashboard/projects/[id]/page.tsx`

**Interfaces:**
- Produces: `updateProjectSchema = z.object(projectFields).partial()` (no `schedule` key); `ProjectForm` edit props are `{ mode: "edit"; projectId; initial }` plus `templates` and `sentryConnected`; `ProjectFormValues` has no `schedule`.

The old column and scheduler keep working until Task 3; this task only removes the ways to edit them.

- [ ] **Step 1: Write the failing test** in `validation.test.ts`: replace the `scheduleSchema` describe with `"updateProjectSchema ignores a schedule"`, asserting `updateProjectSchema.parse({ name: "x", schedule: { enabled: true } })` has no `schedule` property (same style as the existing "does not accept project-level tone" test).
- [ ] **Step 2: Run** `npx vitest run src/lib/validation.test.ts`. Expected: FAIL (schedule still parsed).
- [ ] **Step 3: Implement.**
  - `validation.ts`: delete `scheduleSchema`; `updateProjectSchema = z.object(projectFields).partial()`; drop the `isValidTimezone` import only if unused (Task 3 reuses it).
  - `projects/[id]/route.ts`: delete the `patch.schedule` plan check and the unused `requirePlanFeature` import.
  - `project-form.tsx`: delete `ScheduleCard`, `ScheduleValues`, `DEFAULT_SCHEDULE`, `LastRun`, `WEEKDAY_ITEMS`, `HOURS`, `HOUR_ITEMS`, `timezones()`, the `WEEKDAYS` import, `schedule` from `ProjectFormValues` and `EMPTY`, the `_schedule` destructure in `submit`, and the `schedulingAllowed`, `lastRun`, `canTakeOver` props. Remove now-unused imports. Keep a note of the deleted `ScheduleCard` markup for Task 6 (it is in the diff).
  - `page.tsx`: remove the `DEFAULT_SCHEDULE` and `getLastRun` imports, the `lastRun` variable, and the removed props and `schedule` initial value.
  - `project-form.test.tsx`: remove `DEFAULT_SCHEDULE`, `schedule`, and the three removed props from its fixtures.
- [ ] **Step 4: Run** `npx vitest run src/lib/validation.test.ts src/components/project-form.test.tsx` (PASS), `npm run typecheck`, `npm run lint`.
- [ ] **Step 5: Checkpoint:** `git status`.

---

### Task 3: Schedule data model, store and scheduler

**Files:**
- Modify: `src/db/schema.ts`; Create: `drizzle/0014_*.sql` and `drizzle/meta/0014_snapshot.json` (generated), `drizzle/meta/_journal.json` (generated)
- Create: `src/lib/schedules.ts`, `src/lib/schedules.test.ts`
- Modify: `src/lib/validation.ts`, `src/lib/validation.test.ts`
- Modify: `src/lib/scheduler.ts`, `src/lib/scheduler.test.ts`, `src/lib/notify.ts`
- Modify: `src/lib/projects.ts` (delete `takeOverProject` and the `scheduledRuns` import)
- Delete: `src/app/api/projects/[id]/take-over/route.ts`
- Create: `src/app/api/projects/[id]/schedules/[scheduleId]/take-over/route.ts`
- Modify: `src/lib/teams.test.ts` (organization scheduling tests and the role test that calls the old take-over route)

**Interfaces:**
- Produces (schema): `projectSchedules` (`id` uuid pk, `projectId` uuid fk cascade, `name`, `template`, `weekdays` integer[] not null, `hour`, `timezone`, `periodDays`, `enabled` default true, `createdBy`, `createdAt`, `updatedAt`, index on `projectId`); `scheduleChannels` (`scheduleId` fk cascade, `channelId` fk to `deliveryChannels` cascade, composite pk); `scheduledRuns` keyed `(scheduleId, slot)`. `projects.schedule` and the `ProjectSchedule` jsonb type are removed.
- Produces (validation): `scheduleInputSchema` (create: `name`, `template: templateIdSchema`, `weekdays` as a non-empty array of ints 0-6 transformed to sorted unique, `hour`, `timezone` via `isValidTimezone`, `periodDays`, `enabled` default `true`, `channelIds` array of `uuidSchema` max 10 default `[]`), `updateScheduleSchema` (the same fields without defaults, `.partial()`, refined to not be empty), type `ScheduleInput`.
- Produces (`src/lib/schedules.ts`):
  - `type ProjectSchedule = typeof projectSchedules.$inferSelect & { channelIds: string[] }`
  - `MAX_SCHEDULES = 10`
  - `listSchedules(projectId: string): Promise<ProjectSchedule[]>` (oldest first)
  - `requireSchedule(projectId: string, scheduleId: string): Promise<ProjectSchedule>` (404 `NOT_FOUND`)
  - `createSchedule(owner: Owner, projectId: string, input: ScheduleInput): Promise<ProjectSchedule>`
  - `updateSchedule(owner: Owner, projectId: string, scheduleId: string, patch: Partial<ScheduleInput>): Promise<ProjectSchedule>`
  - `deleteSchedule(projectId: string, scheduleId: string): Promise<void>`
  - `takeOverSchedule(projectId: string, scheduleId: string, userId: string): Promise<ProjectSchedule>`
  - `getLastRuns(scheduleIds: string[]): Promise<Map<string, { slot: string; status: string; error: string | null }>>`
- Produces (scheduler): `runScheduled(now?: Date, opts?: { deadlineMs?: number; only?: string[] }): Promise<SchedulerSummary>` where `only` is now a list of **schedule ids**; `claimSlot(scheduleId, slot, now?)`; `getLastRun` is removed (replaced by `getLastRuns`).
- Produces (notify): `notifyProjectCreator(userId, project: { id: string; name: string }, reason: string, scheduleName: string)`; subject `"<site>: scheduled log \"<scheduleName>\" for <project> was skipped"`, link `?tab=schedules`.
- Produces (route): `POST /api/projects/[id]/schedules/[scheduleId]/take-over` returns `{ success: true }`.

- [ ] **Step 1: Write failing validation tests** in `validation.test.ts` (describe `"scheduleInputSchema"`), using `valid = { name: "Customer update", template: "client_report", weekdays: [5], hour: 9, timezone: "Europe/Zagreb", periodDays: 7 }`:
  - parses `valid` with `enabled: true` and `channelIds: []` defaulted;
  - `weekdays: [5, 1, 5]` parses to `[1, 5]`;
  - rejects `weekdays: []`, `[7]`, `[-1]`, `hour: 24`, `timezone: "Mars/Base"`, `periodDays: 0`, empty or 61-character `name`, 11 channel ids, a non-uuid channel id;
  - `updateScheduleSchema.parse({ hour: 10 })` equals `{ hour: 10 }` (nothing defaulted in) and `updateScheduleSchema.safeParse({}).success` is `false`.
- [ ] **Step 2: Run** `npx vitest run src/lib/validation.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the schemas** in `validation.ts`. Define the fields once without defaults; build the create schema by adding the `enabled` and `channelIds` defaults, the update schema with `.partial().refine(...)` (same pattern as `updateTemplateSchema`). Run the tests: PASS.
- [ ] **Step 4: Schema and migration.** Edit `schema.ts` as above, then `$TESTDB npm run db:generate -- --name multiple_schedules`. If drizzle-kit asks whether a column was created or renamed, always choose create (never rename). Edit the generated SQL so `scheduled_runs` is `DROP TABLE` then `CREATE TABLE` (no ALTER), and it creates both new tables and drops `projects.schedule`. Apply: `$TESTDB npm run db:migrate`. Expected: exit 0; `psql`-free check: `$TESTDB npx tsx -e "import('./src/db').then(async m=>{console.log(await m.getDb().execute('select count(*) from project_schedules'));process.exit(0)})"` prints a count of 0.
- [ ] **Step 5: Write failing store tests** in `schedules.test.ts` (`describe.skipIf(!process.env.DATABASE_URL)`, isolated `test_o_*`/`test_u_*` ids, projects via `createProject`, channels inserted into `deliveryChannels` with encrypted config as in `scheduler.test.ts`). Cases:
  - `createSchedule` stores fields and returns `channelIds`; `listSchedules` returns oldest first;
  - the 11th schedule on a project throws `ApiError` 400 `VALIDATION`, and another project is unaffected;
  - an unknown custom template id throws 404 `NOT_FOUND`;
  - a `channelIds` entry from another project throws 400 `VALIDATION` on create and update, and nothing is linked;
  - `updateSchedule` with `channelIds: [a]` replaces the previous set; a patch without `channelIds` leaves it alone;
  - deleting a channel removes it from every schedule's `channelIds`;
  - `deleteSchedule` removes the row and its `scheduled_runs`;
  - `takeOverSchedule` changes `createdBy` and sets the newest `skipped` or `failed` run of that schedule to `{ status: "retry", attempts: 0, error: null }` but leaves a `done` run and other schedules' runs alone;
  - `getLastRuns` returns the run with the greatest slot per schedule and omits schedules with no runs.
- [ ] **Step 6: Run** `$TESTDB npx vitest run src/lib/schedules.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 7: Implement `schedules.ts`.** Follow `createChannel` in `delivery.ts`: take `pg_advisory_xact_lock(hashtext('schedules:' + projectId))` inside a transaction for the cap check, throw `new ApiError(400, "A project can have at most 10 schedules.", "VALIDATION")`. Validate the template with `requireTemplate(owner.ownerId, input.template)` and the channels with one query on `deliveryChannels` filtered by `projectId`. Replace channels by delete-then-insert on `scheduleChannels` in the same transaction. Set `createdBy: owner.userId` on create. `takeOverSchedule` mirrors the old `takeOverProject` re-queue but filters on `scheduleId`. Run the store tests: PASS.
- [ ] **Step 8: Rewrite the scheduler tests first.** In `scheduler.test.ts` keep the mocks and `stubFetch`. Replace the fixture so `setup()` creates the project as now, then calls `createSchedule(owner, project.id, { name: "Weekly", template: "weekly_update", weekdays: [3], hour: 9, timezone: "UTC", periodDays: 7, enabled: true, channelIds: [channel.id] })` (channel selected unless `opts.channel === false`, i.e. "no channels"), applying `opts.schedule` overrides; add `scheduleId` to `Fx`. Change `run()` to `runScheduled(now, { only: [fx.scheduleId] })`, `runRow()` to key on `scheduledRuns.scheduleId`, and the expected scheduleKey strings to `${fx.scheduleId}:${SLOT}`. Port every existing test with these meaning-preserving edits:
  - `autoDeliver: false` becomes a schedule with `channelIds: []`; `autoDeliver: true` becomes one with the channel selected;
  - `schedule: { enabled: false }` and the weekday and hour cases stay as `opts.schedule` overrides;
  - emails now expect the subject to contain the schedule name `Weekly`.
- [ ] **Step 9: Add new scheduler tests** (same file):
  - `"runs two due schedules of one project once each, with their own templates"`: a second schedule on the same project and weekday with `template: "changelog"`; one `runScheduled(WEDNESDAY, { only: [a, b] })` returns `{ generated: 2 }`; two ship logs exist whose `scheduleKey` values are `${a}:${SLOT}` and `${b}:${SLOT}` and whose `template` values are `weekly_update` and `changelog`; a second call returns `generated: 0`.
  - `"delivers each schedule only to its own channels"`: two channels (Slack and Teams), schedule A selects Slack, schedule B selects Teams; after the run, exactly one Slack call and one Teams call, and `deliveries` has one row per channel linked to the matching log.
  - `"does not deliver when the schedule has no channels, even if the project has enabled channels"`: no Slack call, run `done`, `error` null.
  - `"records a note, not a failure, when every selected channel is paused"`: channel `enabled: false`; run `done`, `error` contains `"No enabled delivery channels"`, log exists.
  - `"ignores schedules of archived projects"`: set `projects.archivedAt`; `runScheduled` returns `{ due: 0 }` for that schedule.
  - `"acts as the schedule's creator"`: a schedule whose `createdBy` is a second user with their own GitHub connection makes GitHub calls with that user's token.
- [ ] **Step 10: Run** `$TESTDB npx vitest run src/lib/scheduler.test.ts`. Expected: FAIL (old scheduler).
- [ ] **Step 11: Rewrite `scheduler.ts`.** Candidates are enabled `projectSchedules` joined to non-archived `projects` (with `channelIds` loaded for them in one query); apply `only` to schedule ids. `claimSlot`, `finishRun`, `saveRunLog`, retry selection and the worker pool keep their logic but key on `scheduleId`. `runProject` becomes `runSchedule(schedule, project, slot, attempt, existingLogId)`: owner built from `schedule.createdBy`, membership check on `schedule.createdBy`, `scheduleKey = \`${schedule.id}:${slot}\``, `generateLog({ owner, project, period: { days: schedule.periodDays }, template: schedule.template, scheduleKey })`, delivery only when `schedule.channelIds.length > 0 && limits.delivery`, passing `schedule.channelIds`. Skip notifications call `notifyProjectCreator(schedule.createdBy, project, message, schedule.name)`. Remove `getLastRun`. Update `notify.ts` per the interface.
- [ ] **Step 12: Port the organization tests.** In `teams.test.ts` `scheduledProject()` becomes `scheduledSchedule()` returning `{ project, schedule }` (schedule with `weekdays: [3]`, hour 9, UTC, no channels, `createdBy: admin.userId`); `run`, `row` and `logCount` key on `schedule.id`; the take-over step posts to the new route with `ctx` params `{ id: project.id, scheduleId: schedule.id }` and then asserts `requireSchedule(...)`'s `createdBy` is `newAdmin.userId`. The role test at the old `take-over` import now expects a member to get 403 from the new route. Add a role assertion that a member gets 403 from `POST /api/projects/[id]/schedules/[scheduleId]/take-over`.
- [ ] **Step 13: Implement the take-over route** with `requireAdmin()`, `requireProject`, `requireSchedule`, then `takeOverSchedule(project.id, scheduleId, owner.userId)`; delete the old route and `takeOverProject`.
- [ ] **Step 14: Run** `$TESTDB npx vitest run src/lib/schedules.test.ts src/lib/scheduler.test.ts src/lib/teams.test.ts src/lib/validation.test.ts` (all PASS), then `npm run typecheck` and `npm run lint`.
- [ ] **Step 15: Checkpoint:** `git status`; confirm `drizzle/0014_*` and its meta files are present.

---

### Task 4: Schedule API routes

**Files:**
- Create: `src/app/api/projects/[id]/schedules/route.ts`, `src/app/api/projects/[id]/schedules/[scheduleId]/route.ts`
- Test: `src/lib/schedule-routes.test.ts`

**Interfaces:**
- Consumes: `listSchedules`, `createSchedule`, `updateSchedule`, `deleteSchedule`, `requireSchedule`, `scheduleInputSchema`, `updateScheduleSchema` (Task 3).
- Produces: `GET /api/projects/[id]/schedules` returns `{ schedules: ProjectSchedule[] }`; `POST` returns 201 `{ schedule }`; `PATCH /api/projects/[id]/schedules/[scheduleId]` returns `{ schedule }`; `DELETE` returns `{ success: true }`.

- [ ] **Step 1: Write failing route tests** in `schedule-routes.test.ts` (mock `@/lib/owner` as in `delivery.test.ts`, including `requireAdmin`; DB-backed, isolated ids, Pro plan row). Cases:
  - member: `GET` 200, `POST`, `PATCH`, `DELETE` each 403;
  - admin `POST` creates (201) and the body's `schedule.channelIds` matches; `GET` lists it;
  - admin `POST` on a free plan with `enabled: true` returns 403 (`LIMIT_REACHED` or the plan-feature code used by `requirePlanFeature`) and creates nothing; the same body with `enabled: false` returns 201;
  - `PATCH { enabled: true }` on a free plan returns 403, while `PATCH { name: "Renamed" }` succeeds;
  - `PATCH` with a channel id from another project returns 400; `PATCH` of a schedule belonging to another project returns 404;
  - `DELETE` then `GET` no longer lists it; an invalid body (`weekdays: []`) returns 400.
- [ ] **Step 2: Run** `$TESTDB npx vitest run src/lib/schedule-routes.test.ts`. Expected: FAIL (routes missing).
- [ ] **Step 3: Implement the routes** using `handle()`, `parseBody()`, the ctx shapes from `channels/route.ts`, and `requirePlanFeature(owner.ownerId, "scheduling")` on POST when `input.enabled` and on PATCH when `patch.enabled === true`.
- [ ] **Step 4: Run** the new test (PASS), `npm run typecheck`, `npm run lint`.
- [ ] **Step 5: Checkpoint:** `git status`.

---

### Task 5: Template deletion resets schedules

**Files:**
- Modify: `src/lib/templates.ts`
- Test: `src/lib/templates.test.ts` (extend; create it if no DB-backed template test exists)

**Interfaces:**
- Consumes: `projectSchedules` (Task 3).
- Produces: `deleteTemplate(ownerId, id)` also resets `project_schedules.template` to `"weekly_update"` for schedules of that owner's projects that used the template.

- [ ] **Step 1: Write the failing test** `"deleting a custom template resets schedules that used it"`: create a custom template and two schedules on a project (one using it, one using `changelog`); call `deleteTemplate`; the first schedule's `template` is `"weekly_update"`, the second still `"changelog"`; a schedule of another owner using a different custom template is untouched.
- [ ] **Step 2: Run** `$TESTDB npx vitest run src/lib/templates.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** In the existing `deleteTemplate` transaction add an update on `projectSchedules` restricted to schedules whose `projectId` is in `select id from projects where owner_id = <ownerId>` and whose `template = id`.
- [ ] **Step 4: Run** the test (PASS) and `npm run typecheck`.
- [ ] **Step 5: Checkpoint:** `git status`.

---

### Task 6: Schedules tab

**Files:**
- Create: `src/components/schedules-manager.tsx`, `src/components/schedules-manager.test.tsx`
- Modify: `src/app/dashboard/projects/[id]/page.tsx`

**Interfaces:**
- Consumes: the Task 4 routes, `ChannelView` from `channels-manager.tsx`, `TemplateView`, `WEEKDAYS` from `src/lib/schedule.ts`, `apiRequest`.
- Produces: `type ScheduleView = { id: string; name: string; template: string; weekdays: number[]; hour: number; timezone: string; periodDays: number; enabled: boolean; createdBy: string; channelIds: string[]; lastRun: { slot: string; status: string; error: string | null } | null }` and
  `SchedulesManager(props: { projectId: string; initialSchedules: ScheduleView[]; channels: ChannelView[]; templates: TemplateView[]; defaultTemplate: string; canManage: boolean; schedulingAllowed: boolean; currentUserId: string })`.

- [ ] **Step 1: Write failing component tests** (same static-markup and mocked `useState` approach as `channels-manager.test.tsx`; render with `renderToStaticMarkup`). Cases:
  - lists each schedule with its name, `"Fri 09:00"`-style weekdays and hour with timezone, period, template label, and channel kinds; a schedule with no usable channels shows `"No channels: log only"`;
  - shows the last run status and error text when present;
  - `canManage: false` renders no add, edit, delete, toggle or take-over buttons;
  - `schedulingAllowed: false` shows the Pro notice and disables the add button;
  - empty state shows `"No schedules yet."` with an add button when `canManage`;
  - when the project has no channels the form note links to `?tab=delivery`;
  - the take-over button appears only when `canManage` and `createdBy !== currentUserId`;
  - saving a new schedule sends `POST /api/projects/alpha/schedules` with `{ name, template: defaultTemplate, weekdays: [5], hour: 9, timezone, periodDays: 7, enabled: true, channelIds: [] }` by default; toggling sends `PATCH` with `{ enabled }`; delete asks `window.confirm` then `DELETE`; each success calls `router.refresh()`.
- [ ] **Step 2: Run** `npx vitest run src/components/schedules-manager.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement `SchedulesManager`.** Layout: a card with the list (rows with enabled toggle, Edit, Delete, and "Run as me" take-over) and an add/edit card. Form fields: name, template select (items map as in `ProjectForm`), weekday toggle chips (at least one must stay selected), hour select, timezone input with datalist and "Use mine", period input (1-90), channel checkboxes (disabled channels labelled "(paused)"). Reuse the deleted `ScheduleCard` markup and its `HOURS`, `HOUR_ITEMS`, `timezones()` helpers from the Task 2 diff. New schedule defaults: Friday, 09:00, the browser timezone, 7 days, enabled, no channels, `defaultTemplate`. Errors show inline in `text-danger` like `ChannelsManager`; a note explains that a schedule without channels only generates logs. Run the tests: PASS.
- [ ] **Step 4: Wire the tab in `page.tsx`.** Add `{ id: "schedules", label: "Schedules" }` between Delivery and Settings in `TABS`. For that tab, load `listSchedules(project.id)`, `getLastRuns(ids)`, `listChannels(project.id)`, and render `SchedulesManager` with `canManage={isAdmin(owner)}`, `schedulingAllowed={limits.scheduling}`, `currentUserId={owner.userId}`, `defaultTemplate={project.template}`.
- [ ] **Step 5: Run** `npx vitest run src/components src/app` (PASS), `npm run typecheck`, `npm run lint`.
- [ ] **Step 6: Manual check.** Start `npm run dev` against the disposable DB and Clerk dev keys if available; on a project's Schedules tab create two schedules, toggle one, delete one, and confirm the rows update. If the environment cannot sign in, say so in the report rather than claiming this was verified.
- [ ] **Step 7: Checkpoint:** `git status`.

---

### Task 7: Docs, changelog and full verification

**Files:**
- Modify: `docs/architecture.md`, `docs/services.md`, `docs/troubleshooting.md`, `CHANGELOG.md`, `PLAN.md` (only if it still describes the single project schedule as current behavior; otherwise leave)
- Check: `scripts/docs.test.ts`

- [ ] **Step 1: Update docs.**
  - `architecture.md`: `projects` row no longer lists the schedule; add `project_schedules` and `schedule_channels`; `scheduled_runs` is one row per schedule and slot; the generation paragraph says scheduled runs use the schedule creator's connections.
  - `services.md` (cron section): schedules are per project, set on the Schedules tab, due on their chosen weekdays from their hour, each schedule delivers only to its channels, and the daily-cron caveat applies to all schedules.
  - `troubleshooting.md` ("Scheduled logs never run"): point to the Schedules tab and the per-schedule "Run as me" take-over.
  - `CHANGELOG.md` under `[Unreleased]`: one entry for multiple schedules per project (each with its own template, weekdays, channels) in a new Schedules tab, and that the project-level schedule settings and take-over route were replaced.
- [ ] **Step 2: Run the full suite** `$TESTDB npm test`. Expected: all pass (`scripts/docs.test.ts` included).
- [ ] **Step 3: Run** `npm run typecheck`, `npm run lint`, and `$TESTDB npm run build`. Expected: no errors. If the build needs env vars, use the dummy-env approach from the repo notes and say so.
- [ ] **Step 4: Verify the DB left clean:** `rate_limits`, `usage_counters` and `project_schedules` contain no `test_*` rows.
- [ ] **Step 5: Final checkpoint:** `git status` and `git diff --stat`; report changed files, test counts, and anything not run. Stop the disposable container: `docker rm -f shiplog-test`.
