"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { TemplateView } from "@/lib/ai/templates";
import { apiRequest } from "@/lib/client-api";

type Draft = { id: string | null; name: string; description: string; instructions: string };

const EMPTY: Draft = { id: null, name: "", description: "", instructions: "" };
const PLACEHOLDER =
  "e.g. Write a short monthly update for our customers. Start with the biggest improvement, then list smaller ones as bullets. Explain each change in plain language and what it means for the reader.";

export function TemplatesManager({
  initialTemplates,
  canDelete,
}: {
  initialTemplates: TemplateView[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initialTemplates);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const builtIn = templates.filter((t) => t.builtIn);
  const custom = templates.filter((t) => !t.builtIn);

  function open(next: Draft) {
    setDraft(next);
    setNote(null);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

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

  const save = () =>
    run("save", async () => {
      if (!draft) return;
      const body = { name: draft.name, description: draft.description, instructions: draft.instructions };
      if (draft.id) {
        const { template } = await apiRequest<{ template: TemplateView }>(`/api/templates/${draft.id}`, "PATCH", body);
        setTemplates((prev) => prev.map((t) => (t.id === template.id ? template : t)));
      } else {
        const { template } = await apiRequest<{ template: TemplateView }>("/api/templates", "POST", body);
        setTemplates((prev) => [...prev, template]);
      }
      setDraft(null);
      return "Template saved";
    });

  const remove = (t: TemplateView) =>
    run(t.id, async () => {
      if (!window.confirm(`Delete "${t.label}"? Projects using it switch to Weekly update. Existing logs are kept.`)) return;
      await apiRequest(`/api/templates/${t.id}`, "DELETE");
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
      if (draft?.id === t.id) setDraft(null);
      return "Template deleted";
    });

  const canSave = draft && draft.name.trim().length > 0 && draft.instructions.trim().length >= 20;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>Your templates</CardTitle>
            <CardDescription>Instructions that tell the AI how to write a log. Pick them per project or per run.</CardDescription>
          </div>
          <Button onClick={() => open(EMPTY)} disabled={draft?.id === null}>
            New template
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {custom.length === 0 && (
            <p className="text-sm text-muted-foreground">No custom templates yet. Create one, or duplicate a built-in below.</p>
          )}
          {custom.map((t) => (
            <div key={t.id} className="flex flex-wrap items-start gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium">{t.label}</p>
                {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                <p className="line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">{t.instructions}</p>
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === t.id}
                  onClick={() => open({ id: t.id, name: t.label, description: t.description, instructions: t.instructions })}
                >
                  Edit
                </Button>
                {canDelete && (
                  <Button size="sm" variant="ghost" disabled={busy === t.id} onClick={() => remove(t)}>
                    Delete
                  </Button>
                )}
              </div>
            </div>
          ))}
          {note && <p className={`text-sm ${note.error ? "text-danger" : "text-muted-foreground"}`}>{note.text}</p>}
        </CardContent>
      </Card>

      {draft && (
        <div ref={formRef}>
          <Card>
            <CardHeader>
              <CardTitle>{draft.id ? "Edit template" : "New template"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="template-name">Name</Label>
                <Input
                  id="template-name"
                  maxLength={60}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-description">Description (optional)</Label>
                <Input
                  id="template-description"
                  maxLength={200}
                  placeholder="Shown when choosing a template"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-instructions">Instructions</Label>
                <Textarea
                  id="template-instructions"
                  className="min-h-44"
                  maxLength={3000}
                  placeholder={PLACEHOLDER}
                  value={draft.instructions}
                  onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Describe the structure, length and wording you want. The project&apos;s tone, audience and extra
                  instructions are added on top, and the AI is always told to write in plain language and never to
                  invent facts.
                </p>
              </div>
              <div className="flex gap-2">
                <Button disabled={busy === "save" || !canSave} onClick={save}>
                  {busy === "save" ? "Saving..." : "Save template"}
                </Button>
                <Button variant="ghost" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Built-in templates</CardTitle>
          <CardDescription>These can&apos;t be changed, but you can duplicate one and edit the copy.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {builtIn.map((t) => (
            <div key={t.id} className="flex flex-wrap items-start gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {t.label} <Badge variant="secondary">Built-in</Badge>
                </p>
                <p className="text-xs text-muted-foreground">{t.description}</p>
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Show instructions</summary>
                  <p className="mt-1 whitespace-pre-wrap">{t.instructions}</p>
                </details>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  open({ id: null, name: `${t.label} (copy)`, description: t.description, instructions: t.instructions })
                }
              >
                Duplicate
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
