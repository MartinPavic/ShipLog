"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { UpgradeButton } from "@/components/upgrade-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError, apiRequest } from "@/lib/client-api";
import { streamGeneration } from "@/lib/client-generate";
import { formatDate, formatDateTime } from "@/lib/format";

type LogView = {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  status: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
};
type VersionView = { id: string; content: string; createdAt: string };

export function LogViewer({
  log,
  versions,
  projectId,
}: {
  log: LogView;
  versions: VersionView[];
  projectId: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(log.title);
  const [content, setContent] = useState(log.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [limitReached, setLimitReached] = useState(false);
  const [streaming, setStreaming] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setLimitReached(false);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLimitReached(err instanceof ApiClientError && err.code === "LIMIT_REACHED");
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      await apiRequest(`/api/logs/${log.id}`, "PATCH", { title, content });
      setEditing(false);
      router.refresh();
    });

  const togglePin = () =>
    run(async () => {
      await apiRequest(`/api/logs/${log.id}`, "PATCH", { pinned: !log.pinned });
      router.refresh();
    });

  const regenerate = () =>
    run(async () => {
      if (!window.confirm("Regenerate this log? The current text is kept in version history.")) return;
      setStreaming("");
      try {
        const result = await streamGeneration(projectId, { regenerateLogId: log.id }, setStreaming);
        setContent(result.content);
      } finally {
        setStreaming(null);
      }
      router.refresh();
    });

  const remove = () =>
    run(async () => {
      if (!window.confirm("Delete this log permanently?")) return;
      await apiRequest(`/api/logs/${log.id}`, "DELETE");
      router.push(`/dashboard/projects/${projectId}?tab=history`);
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          {editing ? (
            <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
          ) : (
            <CardTitle className="flex flex-wrap items-center gap-2">
              {log.title}
              {log.pinned && <Badge variant="secondary">Pinned</Badge>}
              {log.status === "generating" && <Badge variant="secondary">Generating</Badge>}
              {log.status === "failed" && <Badge variant="destructive">Failed</Badge>}
            </CardTitle>
          )}
          <p className="text-sm text-muted-foreground">
            {formatDate(log.periodStart)} – {formatDate(log.periodEnd)} · generated {formatDateTime(log.createdAt)}
          </p>
          <div className="flex flex-wrap gap-2">
            {editing ? (
              <>
                <Button size="sm" disabled={busy || !title.trim()} onClick={save}>
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setTitle(log.title);
                    setContent(log.content);
                  }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={togglePin}>
                  {log.pinned ? "Unpin" : "Pin"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(log.content)}>
                  Copy Markdown
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={regenerate}>
                  Regenerate
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={remove}>
                  Delete
                </Button>
              </>
            )}
          </div>
          {error && (
            <div className="space-y-2">
              <p className="text-sm text-red-500">{error}</p>
              {limitReached && <UpgradeButton />}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {editing ? (
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-80 font-mono"
              aria-label="Content"
            />
          ) : (
            <Markdown>{streaming ?? (log.content || "_Empty_")}</Markdown>
          )}
        </CardContent>
      </Card>

      {versions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Version history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {versions.map((v) => (
              <details key={v.id} className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm">{formatDateTime(v.createdAt)}</summary>
                <pre className="mt-3 whitespace-pre-wrap text-xs text-muted-foreground">{v.content}</pre>
              </details>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
