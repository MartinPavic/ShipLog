"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KIND_LABEL, type ChannelView } from "@/components/channels-manager";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { templateLabel, type TemplateView } from "@/lib/ai/templates";
import { apiRequest } from "@/lib/client-api";
import { WEEKDAYS } from "@/lib/schedule";

export type ScheduleView = {
  id: string;
  name: string;
  template: string;
  weekdays: number[];
  hour: number;
  timezone: string;
  periodDays: number;
  enabled: boolean;
  createdBy: string;
  channelIds: string[];
  lastRun: { slot: string; status: string; error: string | null } | null;
};

type Draft = {
  id: string | null;
  name: string;
  template: string;
  weekdays: number[];
  hour: number;
  timezone: string;
  periodDays: number;
  channelIds: string[];
};

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const HOUR_ITEMS = Object.fromEntries(HOURS.map((h) => [String(h), `${String(h).padStart(2, "0")}:00`]));
const SHORT_DAYS = WEEKDAYS.map((d) => d.slice(0, 3));

function timezones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

const cadence = (s: ScheduleView) =>
  `${s.weekdays.map((d) => SHORT_DAYS[d]).join(", ")} ${HOUR_ITEMS[String(s.hour)]} ${s.timezone}`;

export function SchedulesManager({
  projectId,
  initialSchedules,
  channels,
  templates,
  defaultTemplate,
  canManage,
  schedulingAllowed,
  currentUserId,
}: {
  projectId: string;
  initialSchedules: ScheduleView[];
  channels: ChannelView[];
  templates: TemplateView[];
  defaultTemplate: string;
  canManage: boolean;
  schedulingAllowed: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [schedules, setSchedules] = useState(initialSchedules);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const templateItems = Object.fromEntries(templates.map((t) => [t.id, t.label]));
  const base = `/api/projects/${projectId}/schedules`;

  async function run(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setNote(null);
    try {
      const text = await fn();
      if (text) setNote({ text, error: false });
      router.refresh();
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : "Something went wrong", error: true });
    } finally {
      setBusy(null);
    }
  }

  const startNew = () =>
    setDraft({
      id: null,
      name: "",
      template: defaultTemplate,
      weekdays: [5],
      hour: 9,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      periodDays: 7,
      channelIds: [],
    });

  const startEdit = (s: ScheduleView) =>
    setDraft({
      id: s.id,
      name: s.name,
      template: s.template,
      weekdays: s.weekdays,
      hour: s.hour,
      timezone: s.timezone,
      periodDays: s.periodDays,
      channelIds: s.channelIds,
    });

  const save = (d: Draft) =>
    run("save", async () => {
      const fields = {
        name: d.name.trim(),
        template: d.template,
        weekdays: [...d.weekdays].sort((a, b) => a - b),
        hour: d.hour,
        timezone: d.timezone,
        periodDays: d.periodDays,
        channelIds: d.channelIds,
      };
      if (d.id) {
        const { schedule } = await apiRequest<{ schedule: ScheduleView }>(`${base}/${d.id}`, "PATCH", fields);
        setSchedules((prev) => prev.map((x) => (x.id === d.id ? { ...x, ...schedule } : x)));
      } else {
        const { schedule } = await apiRequest<{ schedule: ScheduleView }>(base, "POST", { ...fields, enabled: true });
        setSchedules((prev) => [...prev, { ...schedule, lastRun: null }]);
      }
      setDraft(null);
    });

  const toggle = (s: ScheduleView) =>
    run(s.id, async () => {
      const { schedule } = await apiRequest<{ schedule: ScheduleView }>(`${base}/${s.id}`, "PATCH", { enabled: !s.enabled });
      setSchedules((prev) => prev.map((x) => (x.id === s.id ? { ...x, ...schedule } : x)));
    });

  const remove = (s: ScheduleView) =>
    run(s.id, async () => {
      if (!window.confirm(`Delete the schedule "${s.name}"?`)) return;
      await apiRequest(`${base}/${s.id}`, "DELETE");
      setSchedules((prev) => prev.filter((x) => x.id !== s.id));
      return "Schedule deleted";
    });

  const takeOver = (s: ScheduleView) =>
    run(s.id, async () => {
      await apiRequest(`${base}/${s.id}/take-over`, "POST");
      setSchedules((prev) => prev.map((x) => (x.id === s.id ? { ...x, createdBy: currentUserId } : x)));
      return "This schedule now runs with your connections";
    });

  const channelSummary = (s: ScheduleView) => {
    const selected = channels.filter((c) => s.channelIds.includes(c.id));
    if (selected.length === 0) return "No channels: log only";
    return selected.map((c) => `${KIND_LABEL[c.kind]}${c.enabled ? "" : " (paused)"}`).join(", ");
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => draft && setDraft({ ...draft, [key]: value });
  const toggleDay = (day: number) => {
    if (!draft) return;
    const on = draft.weekdays.includes(day);
    if (on && draft.weekdays.length === 1) return;
    set("weekdays", on ? draft.weekdays.filter((d) => d !== day) : [...draft.weekdays, day].sort((a, b) => a - b));
  };
  const toggleChannel = (id: string) => {
    if (!draft) return;
    set("channelIds", draft.channelIds.includes(id) ? draft.channelIds.filter((c) => c !== id) : [...draft.channelIds, id]);
  };

  return (
    <div className="space-y-6">
      {!schedulingAllowed && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Scheduled logs are a Pro feature.</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Schedules</CardTitle>
            <CardDescription>
              Generate ship logs automatically. Each schedule has its own template, days and delivery channels, and runs
              with the connections of whoever created it.
            </CardDescription>
          </div>
          {canManage && !draft && schedules.length > 0 && (
            <Button disabled={!schedulingAllowed} onClick={startNew}>
              Add schedule
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {schedules.length === 0 && !draft && (
            <div className="space-y-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">No schedules yet.</p>
              {canManage && (
                <Button size="lg" disabled={!schedulingAllowed} onClick={startNew}>
                  Add your first schedule
                </Button>
              )}
            </div>
          )}
          {schedules.map((s) => (
            <div key={s.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.enabled ? s.name : `${s.name} (paused)`}</p>
                  <p className="text-xs text-muted-foreground">
                    <span>{cadence(s)}</span> · <span>{`${s.periodDays} ${s.periodDays === 1 ? "day" : "days"}`}</span> ·{" "}
                    <span>{templateLabel(templates, s.template)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{channelSummary(s)}</p>
                </div>
                {canManage && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" disabled={busy === s.id} onClick={() => startEdit(s)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === s.id || (!s.enabled && !schedulingAllowed)}
                      onClick={() => toggle(s)}
                    >
                      {s.enabled ? "Pause" : "Resume"}
                    </Button>
                    {s.createdBy !== currentUserId && (
                      <Button size="sm" variant="ghost" disabled={busy === s.id} onClick={() => takeOver(s)}>
                        Run as me
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" disabled={busy === s.id} onClick={() => remove(s)}>
                      Delete
                    </Button>
                  </div>
                )}
              </div>
              {s.lastRun && (
                <p className="text-xs text-muted-foreground">
                  {`Last run (${s.lastRun.slot}): `}
                  <strong>{s.lastRun.status}</strong>
                  {s.lastRun.error ? ` — ${s.lastRun.error}` : ""}
                </p>
              )}
            </div>
          ))}
          {note && <p className={`text-sm ${note.error ? "text-danger" : "text-muted-foreground"}`}>{note.text}</p>}
        </CardContent>
      </Card>

      {canManage && draft && (
        <Card>
          <CardHeader>
            <CardTitle>{draft.id ? "Edit schedule" : "New schedule"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="schedule-name">Name</Label>
              <Input id="schedule-name" maxLength={60} value={draft.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Template</Label>
              <Select value={draft.template} items={templateItems} onValueChange={(v) => v && set("template", v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Days</Label>
              <div className="flex flex-wrap gap-2">
                {SHORT_DAYS.map((day, i) => (
                  <Button
                    key={day}
                    size="sm"
                    variant={draft.weekdays.includes(i) ? "default" : "outline"}
                    onClick={() => toggleDay(i)}
                  >
                    {day}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>From</Label>
                <Select value={String(draft.hour)} items={HOUR_ITEMS} onValueChange={(v) => v && set("hour", Number(v))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOURS.map((h) => (
                      <SelectItem key={h} value={String(h)}>
                        {HOUR_ITEMS[String(h)]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-days">Period (days)</Label>
                <Input
                  id="schedule-days"
                  type="number"
                  min={1}
                  max={90}
                  className="w-32"
                  value={draft.periodDays}
                  onChange={(e) => set("periodDays", Number(e.target.value))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-timezone">Timezone</Label>
              <div className="flex gap-2">
                <Input
                  id="schedule-timezone"
                  list="schedule-timezones"
                  value={draft.timezone}
                  onChange={(e) => set("timezone", e.target.value)}
                />
                <Button onClick={() => set("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone)} variant="outline">
                  Use mine
                </Button>
              </div>
              <datalist id="schedule-timezones">
                {timezones().map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">
                Runs at the first opportunity from the chosen hour (checked by the cron job), once on each chosen day.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Send to</Label>
              {channels.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This project has no delivery channels yet. Add one in the{" "}
                  <Link href={`/dashboard/projects/${projectId}?tab=delivery`} className="underline">
                    Delivery tab
                  </Link>
                  , or leave it empty to only generate logs.
                </p>
              ) : (
                <>
                  {channels.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.channelIds.includes(c.id)}
                        onChange={() => toggleChannel(c.id)}
                      />
                      <span>{`${KIND_LABEL[c.kind]}${c.enabled ? "" : " (paused)"}`}</span>
                      <span className="truncate text-xs text-muted-foreground">{c.hint}</span>
                    </label>
                  ))}
                  <p className="text-xs text-muted-foreground">Leave all unchecked to only generate logs.</p>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button disabled={busy === "save" || !draft.name.trim()} onClick={() => save(draft)}>
                Save schedule
              </Button>
              <Button variant="outline" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
