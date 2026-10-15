"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UpgradeButton } from "@/components/upgrade-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/client-api";
import { formatDateTime } from "@/lib/format";

type Channel = { id: string; kind: string; hint: string };
type HistoryItem = { id: string; kind: string; status: string; error: string | null; sentAt: string };
type Result = { channelId: string; kind: string; status: "sent" | "failed"; error: string | null };

const LABEL: Record<string, string> = { slack: "Slack", discord: "Discord", email: "Email" };

export function DeliverPanel({
  logId,
  projectId,
  channels,
  history,
  allowed,
}: {
  logId: string;
  projectId: string;
  channels: Channel[];
  history: HistoryItem[];
  allowed: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(channels.map((c) => c.id)));
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState("");

  async function send() {
    setBusy(true);
    setError("");
    setResults(null);
    try {
      const data = await apiRequest<{ results: Result[] }>(`/api/logs/${logId}/deliver`, "POST", {
        channelIds: [...selected],
      });
      setResults(data.results);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Send</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!allowed ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Delivery to Slack, Discord and email is a Pro feature.</p>
            <UpgradeButton />
          </div>
        ) : channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No channels yet.{" "}
            <Link href={`/dashboard/projects/${projectId}?tab=delivery`} className="underline underline-offset-2">
              Add one in the Delivery tab
            </Link>
            .
          </p>
        ) : (
          <>
            <ul className="space-y-1">
              {channels.map((c) => (
                <li key={c.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(c.id);
                        else next.delete(c.id);
                        setSelected(next);
                      }}
                    />
                    {LABEL[c.kind] ?? c.kind} <span className="text-xs text-muted-foreground">{c.hint}</span>
                  </label>
                </li>
              ))}
            </ul>
            <Button disabled={busy || selected.size === 0} onClick={send}>
              {busy ? "Sending..." : "Send now"}
            </Button>
          </>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}
        {results && (
          <ul className="space-y-1 text-sm">
            {results.map((r) => (
              <li key={r.channelId} className={r.status === "sent" ? "text-muted-foreground" : "text-red-500"}>
                {LABEL[r.kind] ?? r.kind}: {r.status === "sent" ? "sent" : `failed — ${r.error}`}
              </li>
            ))}
          </ul>
        )}

        {history.length > 0 && (
          <div className="space-y-1 border-t pt-4">
            <h3 className="text-sm font-medium">History</h3>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {history.map((h) => (
                <li key={h.id}>
                  {formatDateTime(h.sentAt)} · {LABEL[h.kind] ?? h.kind} ·{" "}
                  <span className={h.status === "failed" ? "text-red-500" : ""}>
                    {h.status}
                    {h.error ? ` — ${h.error}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
