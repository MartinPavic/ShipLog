"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { SourcePanel } from "@/components/source-panel";
import { UpgradeButton } from "@/components/upgrade-button";
import { UsageMeter } from "@/components/usage-meter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TEMPLATES, TEMPLATE_IDS, type TemplateId } from "@/lib/ai/templates";
import { streamGeneration, type GenerateRequest } from "@/lib/client-generate";
import { ApiClientError, apiRequest } from "@/lib/client-api";
import { asActivity, type Activity } from "@/lib/github-activity";

const TEMPLATE_ITEMS = Object.fromEntries(TEMPLATE_IDS.map((id) => [id, TEMPLATES[id].label]));
const PERIOD_ITEMS = { days: "Last N days", range: "Date range" };

type Result = { logId: string; title: string; content: string; activity: Activity | null };

export function ProjectGenerate({
  projectId,
  defaultDays,
  defaultTemplate,
  setupMessage,
  usage,
}: {
  projectId: string;
  defaultDays: number;
  defaultTemplate: TemplateId;
  setupMessage: string | null;
  usage: { used: number; limit: number | null };
}) {
  const router = useRouter();
  const [template, setTemplate] = useState<TemplateId>(defaultTemplate);
  const [mode, setMode] = useState<"days" | "range">("days");
  const [days, setDays] = useState(defaultDays);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [running, setRunning] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [limitReached, setLimitReached] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const periodValid = mode === "days" ? days >= 1 && days <= 90 : Boolean(from && to && from <= to);

  async function run(request: GenerateRequest) {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError("");
    setLimitReached(false);
    setResult(null);
    setText("");
    try {
      const { logId, content } = await streamGeneration(projectId, request, setText, controller.signal);
      const { log } = await apiRequest<{ log: { title: string; sourceSnapshot: unknown } }>(
        `/api/logs/${logId}`,
        "GET"
      );
      setResult({ logId, title: log.title, content, activity: asActivity(log.sourceSnapshot) });
    } catch (err) {
      if (controller.signal.aborted) {
        setError("Generation cancelled.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
        setLimitReached(err instanceof ApiClientError && err.code === "LIMIT_REACHED");
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
      router.refresh();
    }
  }

  const generate = () =>
    run({
      template,
      ...(mode === "days" ? { days } : { from, to }),
    });

  // Regenerating rewrites the same log in place, keeping its period and saving the old text as a version.
  const regenerate = (logId: string) => run({ template, regenerateLogId: logId });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <CardTitle>Generate a ship log</CardTitle>
          <UsageMeter used={usage.used} limit={usage.limit} />
        </CardHeader>
        <CardContent className="space-y-4">
          {setupMessage ? (
            <p className="text-sm text-muted-foreground">
              {setupMessage}{" "}
              <Link href="/dashboard/settings" className="underline">
                Open Settings
              </Link>
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Template</Label>
                  <Select
                    value={template}
                    items={TEMPLATE_ITEMS}
                    onValueChange={(v) => v && setTemplate(v as TemplateId)}
                    disabled={running}
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
                </div>
                <div className="space-y-2">
                  <Label>Period</Label>
                  <Select
                    value={mode}
                    items={PERIOD_ITEMS}
                    onValueChange={(v) => v && setMode(v as "days" | "range")}
                    disabled={running}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="days">Last N days</SelectItem>
                      <SelectItem value="range">Date range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {mode === "days" ? (
                <div className="space-y-2">
                  <Label htmlFor="period-days">Days (1–90)</Label>
                  <Input
                    id="period-days"
                    type="number"
                    min={1}
                    max={90}
                    className="w-32"
                    value={days}
                    disabled={running}
                    onChange={(e) => setDays(Number(e.target.value))}
                  />
                </div>
              ) : (
                <div className="flex flex-wrap gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="period-from">From</Label>
                    <Input id="period-from" type="date" max={today} value={from} disabled={running} onChange={(e) => setFrom(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="period-to">To</Label>
                    <Input id="period-to" type="date" max={today} value={to} disabled={running} onChange={(e) => setTo(e.target.value)} />
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={generate} disabled={running || !periodValid}>
                  {running ? "Generating..." : "Generate"}
                </Button>
                {running && (
                  <Button variant="outline" onClick={() => abortRef.current?.abort()}>
                    Cancel
                  </Button>
                )}
              </div>
            </>
          )}

          {error && (
            <div className="space-y-3">
              <p className="text-sm text-red-500">{error}</p>
              {limitReached && <UpgradeButton />}
            </div>
          )}
        </CardContent>
      </Card>

      {(running || result || text) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle>{result?.title ?? "Generating..."}</CardTitle>
            {result && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(result.content)}>
                  Copy
                </Button>
                <Button size="sm" variant="outline" disabled={running} onClick={() => regenerate(result.logId)}>
                  Regenerate
                </Button>
                <Link
                  href={`/dashboard/projects/${projectId}/logs/${result.logId}`}
                  className="self-center text-sm underline underline-offset-2"
                >
                  Open
                </Link>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <Markdown>{text || result?.content || "…"}</Markdown>
            {result?.activity && <SourcePanel activity={result.activity} />}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
