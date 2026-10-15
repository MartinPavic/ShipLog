"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TEMPLATES, TEMPLATE_IDS, type TemplateId } from "@/lib/ai/templates";
import { ApiClientError, apiRequest } from "@/lib/client-api";
import { WEEKDAYS } from "@/lib/schedule";

export type ScheduleValues = {
  enabled: boolean;
  dayOfWeek: number;
  hour: number;
  timezone: string;
  periodDays: number;
  autoDeliver: boolean;
};

export const DEFAULT_SCHEDULE: ScheduleValues = {
  enabled: false,
  dayOfWeek: 1,
  hour: 9,
  timezone: "UTC",
  periodDays: 7,
  autoDeliver: false,
};

export type ProjectFormValues = {
  name: string;
  description: string;
  repos: { fullName: string; branch?: string }[];
  template: TemplateId;
  tone: string;
  audience: string;
  customPrompt: string;
  defaultPeriodDays: number;
  isPublicChangelog: boolean;
  schedule: ScheduleValues;
};

const EMPTY: ProjectFormValues = {
  name: "",
  description: "",
  repos: [],
  template: "weekly_update",
  tone: "",
  audience: "",
  customPrompt: "",
  defaultPeriodDays: 7,
  isPublicChangelog: false,
  schedule: DEFAULT_SCHEDULE,
};

type RepoSummary = { fullName: string; private: boolean; description: string | null };
type Repo = ProjectFormValues["repos"][number];

const TEMPLATE_ITEMS = Object.fromEntries(TEMPLATE_IDS.map((id) => [id, TEMPLATES[id].label]));
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

function RepoPicker({ value, onChange }: { value: Repo[]; onChange: (repos: Repo[]) => void }) {
  const [available, setAvailable] = useState<RepoSummary[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(1);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [manual, setManual] = useState("");

  const selected = new Set(value.map((r) => r.fullName.toLowerCase()));
  const add = (fullName: string) => {
    if (!selected.has(fullName.toLowerCase())) onChange([...value, { fullName }]);
  };

  async function loadMore() {
    if (!nextPage) return;
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest<{ repos: RepoSummary[]; nextPage: number | null }>(
        `/api/github/repos?page=${nextPage}&per_page=50`,
        "GET"
      );
      setAvailable((prev) => [...prev, ...data.repos]);
      setNextPage(data.nextPage);
      setLoaded(true);
    } catch (err) {
      setError(
        err instanceof ApiClientError && err.code === "NO_GITHUB"
          ? "Connect GitHub in Settings to browse your repositories, or add them by name below."
          : err instanceof Error
            ? err.message
            : "Could not load repositories"
      );
    } finally {
      setLoading(false);
    }
  }

  const visible = available.filter((r) => r.fullName.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <ul className="space-y-2">
          {value.map((repo, i) => (
            <li key={repo.fullName} className="flex items-center gap-2">
              <span className="flex-1 truncate text-sm font-medium">{repo.fullName}</span>
              <Input
                className="w-36"
                placeholder="branch (optional)"
                aria-label={`Branch for ${repo.fullName}`}
                value={repo.branch ?? ""}
                onChange={(e) =>
                  onChange(value.map((r, j) => (j === i ? { ...r, branch: e.target.value || undefined } : r)))
                }
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(value.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Input
          placeholder="owner/repo"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (REPO_RE.test(manual.trim())) {
                add(manual.trim());
                setManual("");
              }
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={!REPO_RE.test(manual.trim())}
          onClick={() => {
            add(manual.trim());
            setManual("");
          }}
        >
          Add
        </Button>
      </div>

      {!loaded && (
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={loadMore}>
          {loading ? "Loading..." : "Browse my GitHub repositories"}
        </Button>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {loaded && (
        <div className="space-y-2 rounded-lg border p-3">
          <Input placeholder="Filter repositories" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {visible.map((repo) => (
              <li key={repo.fullName}>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(repo.fullName.toLowerCase())}
                    onChange={(e) =>
                      e.target.checked
                        ? add(repo.fullName)
                        : onChange(value.filter((r) => r.fullName.toLowerCase() !== repo.fullName.toLowerCase()))
                    }
                  />
                  <span className="truncate">{repo.fullName}</span>
                  {repo.private && <span className="text-xs text-muted-foreground">private</span>}
                </label>
              </li>
            ))}
            {visible.length === 0 && <li className="text-sm text-muted-foreground">No matches</li>}
          </ul>
          {nextPage && (
            <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={loadMore}>
              {loading ? "Loading..." : "Load more"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

const WEEKDAY_ITEMS = Object.fromEntries(WEEKDAYS.map((d, i) => [String(i), d]));
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const HOUR_ITEMS = Object.fromEntries(HOURS.map((h) => [String(h), `${String(h).padStart(2, "0")}:00`]));

function timezones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

type LastRun = { slot: string; status: string; error: string | null } | null;

function ScheduleCard({
  value,
  onChange,
  allowed,
  lastRun,
  takeOver,
}: {
  value: ScheduleValues;
  onChange: (value: ScheduleValues) => void;
  allowed: boolean;
  lastRun: LastRun;
  takeOver: { projectId: string } | null;
}) {
  const router = useRouter();
  const [taking, setTaking] = useState(false);
  const [takeError, setTakeError] = useState("");
  const set = <K extends keyof ScheduleValues>(key: K, v: ScheduleValues[K]) => onChange({ ...value, [key]: v });
  const locked = !allowed && !value.enabled;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Schedule</CardTitle>
        <CardDescription>
          Generate a ship log automatically every week, using the connections of whoever created the project.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {locked && <p className="text-sm text-muted-foreground">Scheduled logs are a Pro feature.</p>}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.enabled}
            disabled={locked}
            onChange={(e) => set("enabled", e.target.checked)}
          />
          Generate automatically
        </label>

        {value.enabled && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Day</Label>
                <Select
                  value={String(value.dayOfWeek)}
                  items={WEEKDAY_ITEMS}
                  onValueChange={(v) => v && set("dayOfWeek", Number(v))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((d, i) => (
                      <SelectItem key={d} value={String(i)}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>From</Label>
                <Select
                  value={String(value.hour)}
                  items={HOUR_ITEMS}
                  onValueChange={(v) => v && set("hour", Number(v))}
                >
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-timezone">Timezone</Label>
              <div className="flex gap-2">
                <Input
                  id="schedule-timezone"
                  list="schedule-timezones"
                  value={value.timezone}
                  onChange={(e) => set("timezone", e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => set("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone)}
                >
                  Use mine
                </Button>
              </div>
              <datalist id="schedule-timezones">
                {timezones().map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">
                Runs at the first opportunity from the chosen hour (checked hourly), once per week.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-days">Period (days)</Label>
              <Input
                id="schedule-days"
                type="number"
                min={1}
                max={90}
                className="w-32"
                value={value.periodDays}
                onChange={(e) => set("periodDays", Number(e.target.value))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.autoDeliver}
                onChange={(e) => set("autoDeliver", e.target.checked)}
              />
              Send to the project&apos;s delivery channels
            </label>
          </>
        )}

        {lastRun && (
          <p className="text-sm text-muted-foreground">
            Last scheduled run ({lastRun.slot}): <strong>{lastRun.status}</strong>
            {lastRun.error ? ` — ${lastRun.error}` : ""}
          </p>
        )}

        {takeOver && (
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm text-muted-foreground">
              Scheduled runs use the GitHub connection of the person who created this project.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={taking}
              onClick={async () => {
                setTaking(true);
                setTakeError("");
                try {
                  await apiRequest(`/api/projects/${takeOver.projectId}/take-over`, "POST");
                  router.refresh();
                } catch (err) {
                  setTakeError(err instanceof Error ? err.message : "Something went wrong");
                } finally {
                  setTaking(false);
                }
              }}
            >
              Run scheduled logs as me
            </Button>
            {takeError && <p className="text-sm text-red-500">{takeError}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type Props =
  | { mode: "create" }
  | {
      mode: "edit";
      projectId: string;
      initial: ProjectFormValues;
      schedulingAllowed: boolean;
      lastRun: LastRun;
      canTakeOver: boolean;
    };

export function ProjectForm(props: Props) {
  const router = useRouter();
  const [values, setValues] = useState<ProjectFormValues>(props.mode === "edit" ? props.initial : EMPTY);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const set = <K extends keyof ProjectFormValues>(key: K, value: ProjectFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      if (props.mode === "create") {
        const { schedule: _schedule, ...createValues } = values;
        void _schedule;
        const { project } = await apiRequest<{ project: { id: string } }>("/api/projects", "POST", createValues);
        router.push(`/dashboard/projects/${project.id}`);
        return;
      }
      await apiRequest(`/api/projects/${props.projectId}`, "PATCH", values);
      setMessage({ text: "Project saved", error: false });
      router.refresh();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Something went wrong", error: true });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{props.mode === "create" ? "New project" : "Project settings"}</CardTitle>
          <CardDescription>
            A project groups the repositories that go into one ship log.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" required maxLength={80} value={values.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              maxLength={500}
              value={values.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Repositories</Label>
            <RepoPicker value={values.repos} onChange={(repos) => set("repos", repos)} />
            <p className="text-xs text-muted-foreground">
              Leave empty to use your most recently pushed repositories.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Generation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Template</Label>
            <Select
              value={values.template}
              items={TEMPLATE_ITEMS}
              onValueChange={(v) => v && set("template", v as TemplateId)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATE_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {TEMPLATES[id].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{TEMPLATES[values.template].description}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tone">Tone (optional)</Label>
              <Input
                id="tone"
                maxLength={100}
                placeholder="e.g. upbeat, concise"
                value={values.tone}
                onChange={(e) => set("tone", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="audience">Audience (optional)</Label>
              <Input
                id="audience"
                maxLength={200}
                placeholder="e.g. non-technical stakeholders"
                value={values.audience}
                onChange={(e) => set("audience", e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="customPrompt">Custom instructions (optional)</Label>
            <Textarea
              id="customPrompt"
              maxLength={1000}
              value={values.customPrompt}
              onChange={(e) => set("customPrompt", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="days">Default period (days)</Label>
            <Input
              id="days"
              type="number"
              min={1}
              max={90}
              className="w-32"
              value={values.defaultPeriodDays}
              onChange={(e) => set("defaultPeriodDays", Number(e.target.value))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.isPublicChangelog}
              onChange={(e) => set("isPublicChangelog", e.target.checked)}
            />
            Publish a public changelog for this project
          </label>
        </CardContent>
      </Card>

      {props.mode === "edit" && (
        <ScheduleCard
          value={values.schedule}
          onChange={(schedule) => set("schedule", schedule)}
          allowed={props.schedulingAllowed}
          lastRun={props.lastRun}
          takeOver={props.canTakeOver ? { projectId: props.projectId } : null}
        />
      )}

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={loading || !values.name.trim()}>
          {loading ? "Saving..." : props.mode === "create" ? "Create project" : "Save changes"}
        </Button>
        {message && (
          <p className={`text-sm ${message.error ? "text-red-500" : "text-muted-foreground"}`}>{message.text}</p>
        )}
      </div>
    </form>
  );
}
