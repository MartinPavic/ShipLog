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

type Props =
  | { mode: "create" }
  | { mode: "edit"; projectId: string; initial: ProjectFormValues };

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
        const { project } = await apiRequest<{ project: { id: string } }>("/api/projects", "POST", values);
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
