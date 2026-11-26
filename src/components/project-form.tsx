"use client";

import { useState } from "react";
import Link from "next/link";
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
import type { SentryProjectRef } from "@/db/schema";
import { type TemplateView } from "@/lib/ai/templates";
import { ApiClientError, apiRequest } from "@/lib/client-api";

export type ProjectFormValues = {
  name: string;
  description: string;
  repos: { provider?: "github" | "gitlab"; fullName: string; branch?: string }[];
  sentryProjects: SentryProjectRef[];
  template: string;
  defaultPeriodDays: number;
  isPublicChangelog: boolean;
};

const EMPTY: ProjectFormValues = {
  name: "",
  description: "",
  repos: [],
  sentryProjects: [],
  template: "weekly_update",
  defaultPeriodDays: 7,
  isPublicChangelog: false,
};

type RepoSummary = { fullName: string; private: boolean; description: string | null };
type Repo = ProjectFormValues["repos"][number];

const repoKey = (repo: Repo) => `${repo.provider ?? "github"}:${repo.fullName.toLowerCase()}`;

function RepoPicker({ value, onChange }: { value: Repo[]; onChange: (repos: Repo[]) => void }) {
  const [provider, setProvider] = useState<"github" | "gitlab">("github");
  const [available, setAvailable] = useState<RepoSummary[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(1);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [manual, setManual] = useState("");

  const selected = new Set(value.map(repoKey));
  const manualValid = provider === "github"
    ? /^[\w.-]+\/[\w.-]+$/.test(manual.trim())
    : /^[\w.-]+(?:\/[\w.-]+)+$/.test(manual.trim()) && manual.trim().split("/").every((segment) => segment !== "." && segment !== "..");
  const add = (fullName: string) => {
    const repo = { provider, fullName };
    if (!selected.has(repoKey(repo))) onChange([...value, repo]);
  };

  function changeProvider(nextProvider: "github" | "gitlab") {
    setProvider(nextProvider);
    setAvailable([]);
    setNextPage(1);
    setLoaded(false);
    setError("");
    setFilter("");
  }

  async function loadMore() {
    if (!nextPage) return;
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest<{ repos: RepoSummary[]; nextPage: number | null }>(
        `/api/${provider}/repos?page=${nextPage}&per_page=50`,
        "GET"
      );
      setAvailable((prev) => [...prev, ...data.repos]);
      setNextPage(data.nextPage);
      setLoaded(true);
    } catch (err) {
      setError(
        err instanceof ApiClientError && (err.code === "NO_GITHUB" || err.code === "NO_GITLAB")
          ? `Connect ${provider === "github" ? "GitHub" : "GitLab"} in Settings to browse your repositories, or add them by name below.`
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
            <li key={repoKey(repo)} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-xs text-muted-foreground">{repo.provider ?? "github"}</span>
              <span className="flex-1 truncate text-sm font-medium">{repo.fullName}</span>
              <Input
                className="w-36"
                placeholder="branch (optional)"
                aria-label={`Branch for ${repo.fullName} on ${repo.provider ?? "GitHub"}`}
                value={repo.branch ?? ""}
                onChange={(e) =>
                  onChange(value.map((r, j) => (j === i ? { ...r, branch: e.target.value || undefined } : r)))
                }
              />
              <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${repo.fullName}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_auto]">
        <Select
          value={provider}
          items={{ github: "GitHub", gitlab: "GitLab" }}
          onValueChange={(value) => value && changeProvider(value as "github" | "gitlab")}
        >
          <SelectTrigger aria-label="Repository provider">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="github">GitHub</SelectItem>
            <SelectItem value="gitlab">GitLab</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder={provider === "github" ? "owner/repo" : "group/subgroup/project"}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (manualValid) {
                add(manual.trim());
                setManual("");
              }
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={!manualValid}
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
          {loading ? "Loading..." : `Browse my ${provider === "github" ? "GitHub" : "GitLab"} repositories`}
        </Button>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}

      {loaded && (
        <div className="space-y-2 rounded-lg border p-3">
          <Input placeholder="Filter repositories" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {visible.map((repo) => (
              <li key={repo.fullName}>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(repoKey({ provider, fullName: repo.fullName }))}
                    onChange={(e) =>
                      e.target.checked
                        ? add(repo.fullName)
                        : onChange(value.filter((r) => repoKey(r) !== repoKey({ provider, fullName: repo.fullName })))
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

const MAX_SENTRY_PROJECTS = 20;

export function SentryProjectPicker({
  value,
  onChange,
  connected,
}: {
  value: SentryProjectRef[];
  onChange: (projects: SentryProjectRef[]) => void;
  connected: boolean;
}) {
  const [available, setAvailable] = useState<SentryProjectRef[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  const selected = new Set(value.map((project) => project.id));
  const atLimit = value.length >= MAX_SENTRY_PROJECTS;
  const listed = new Set((available ?? []).map((project) => project.id));
  const unavailable = available ? value.filter((project) => !listed.has(project.id)) : [];
  const visible = (available ?? []).filter((project) =>
    `${project.name} ${project.slug}`.toLowerCase().includes(filter.trim().toLowerCase())
  );

  async function browse() {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest<{ projects: SentryProjectRef[] }>("/api/sentry/projects", "GET");
      setAvailable(data.projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Sentry projects");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <ul className="space-y-2">
          {value.map((project) => (
            <li key={project.id} className="flex items-center gap-2">
              <span className="flex-1 truncate text-sm font-medium">{project.name}</span>
              <span className="text-xs text-muted-foreground">{project.slug}</span>
              {connected && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${project.name}`}
                  onClick={() => onChange(value.filter((item) => item.id !== project.id))}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!connected && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Sentry is not connected for this workspace. A workspace admin can connect it in Settings.
            {value.length > 0 ? " Saved selections are kept." : ""}
          </p>
          {value.length > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={() => onChange([])}>
              Clear all
            </Button>
          )}
        </div>
      )}

      {connected && unavailable.length > 0 && (
        <p className="text-sm text-danger">
          {unavailable.map((project) => project.name).join(", ")}{" "}
          {unavailable.length === 1 ? "is" : "are"} no longer available from Sentry. Remove{" "}
          {unavailable.length === 1 ? "it" : "them"} or ask a workspace admin to reconnect Sentry in Settings.
        </p>
      )}

      {connected && !available && (
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={browse}>
          {loading ? "Loading..." : "Browse Sentry projects"}
        </Button>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}

      {connected && available && (
        <div className="space-y-2 rounded-lg border p-3">
          <Input placeholder="Filter Sentry projects" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {visible.map((project) => (
              <li key={project.id}>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(project.id)}
                    disabled={!selected.has(project.id) && atLimit}
                    onChange={(e) =>
                      onChange(e.target.checked ? [...value, project] : value.filter((item) => item.id !== project.id))
                    }
                  />
                  <span className="truncate">{project.name}</span>
                  <span className="text-xs text-muted-foreground">{project.slug}</span>
                </label>
              </li>
            ))}
            {visible.length === 0 && <li className="text-sm text-muted-foreground">No matches</li>}
          </ul>
          {atLimit && <p className="text-xs text-muted-foreground">You can link up to {MAX_SENTRY_PROJECTS} Sentry projects.</p>}
        </div>
      )}
    </div>
  );
}

// An unchanged selection is left out so saving other fields never needs a live Sentry connection.
export function projectUpdateBody(
  values: ProjectFormValues,
  initial: ProjectFormValues
): Omit<ProjectFormValues, "sentryProjects"> & { sentryProjects?: SentryProjectRef[] } {
  const unchanged =
    values.sentryProjects.length === initial.sentryProjects.length &&
    values.sentryProjects.every((project, i) => project.id === initial.sentryProjects[i].id);
  if (!unchanged) return values;
  const { sentryProjects: _kept, ...rest } = values;
  void _kept;
  return rest;
}

type Props = (
  | { mode: "create" }
  | {
      mode: "edit";
      projectId: string;
      initial: ProjectFormValues;
    }
) & { templates: TemplateView[]; sentryConnected: boolean };

export function ProjectForm(props: Props) {
  const router = useRouter();
  const templateItems = Object.fromEntries(props.templates.map((t) => [t.id, t.label]));
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
        const { project } = await apiRequest<{ project: { id: string } }>("/api/projects", "POST", values);
        router.push(`/dashboard/projects/${project.id}`);
        return;
      }
      const { project } = await apiRequest<{ project: { sentryProjects: SentryProjectRef[] } }>(
        `/api/projects/${props.projectId}`,
        "PATCH",
        projectUpdateBody(values, props.initial)
      );
      set("sentryProjects", project.sentryProjects);
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
          <div className="space-y-2">
            <Label>Sentry projects (optional)</Label>
            <SentryProjectPicker
              value={values.sentryProjects}
              onChange={(sentryProjects) => set("sentryProjects", sentryProjects)}
              connected={props.sentryConnected}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Generation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Default template</Label>
            <Select
              value={values.template}
              items={templateItems}
              onValueChange={(v) => v && set("template", v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {props.templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {props.templates.find((t) => t.id === values.template)?.description}{" "}
              <Link href="/dashboard/templates" className="underline">
                Manage templates
              </Link>
            </p>
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

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={loading || !values.name.trim()}>
          {loading ? "Saving..." : props.mode === "create" ? "Create project" : "Save changes"}
        </Button>
        {message && (
          <p className={`text-sm ${message.error ? "text-danger" : "text-muted-foreground"}`}>{message.text}</p>
        )}
      </div>
    </form>
  );
}
