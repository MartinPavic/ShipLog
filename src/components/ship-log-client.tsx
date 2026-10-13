"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ApiClientError, apiRequest } from "@/lib/client-api";
import { UpgradeButton } from "./upgrade-button";

interface ShipLog {
  id: string;
  createdAt: string;
  content: string;
  title: string;
}

export function ShipLogClient({ initialLogs }: { initialLogs: ShipLog[] }) {
  const [repo, setRepo] = useState(""); // e.g. "username/repo" or leave empty for all
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [logs, setLogs] = useState<ShipLog[]>(initialLogs);
  const [error, setError] = useState("");
  const [limitReached, setLimitReached] = useState(false);

  async function generate() {
    setLoading(true);
    setError("");
    setLimitReached(false);
    setResult("");

    try {
      const data = await apiRequest<{ content: string; log: ShipLog }>(
        "/api/ship-log/generate",
        "POST",
        { repo: repo.trim() || null, days }
      );

      setResult(data.content);
      setLogs((prev) => [data.log, ...prev].slice(0, 10)); // keep last 10
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLimitReached(err instanceof ApiClientError && err.code === "LIMIT_REACHED");
    } finally {
      setLoading(false);
    }
  }

  function copyToClipboard() {
    navigator.clipboard.writeText(result);
  }

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Generate new Ship Log</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="repo">Repository (optional)</Label>
            <Input
              id="repo"
              placeholder="owner/repo — leave empty for all recent activity"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="days">Period (days)</Label>
            <Input
              id="days"
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </div>

          <Button onClick={generate} disabled={loading}>
            {loading ? "Generating..." : "Generate Ship Log"}
          </Button>

          {error && (
            <div className="space-y-3">
              <p className="text-sm text-red-500">{error}</p>
              {limitReached && <UpgradeButton />}
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Generated Log</CardTitle>
            <Button variant="outline" size="sm" onClick={copyToClipboard}>
              Copy
            </Button>
          </CardHeader>
          <CardContent>
            <Textarea
              value={result}
              readOnly
              className="min-h-[280px] font-mono text-sm"
            />
          </CardContent>
        </Card>
      )}

      {logs.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Recent logs</h2>
          <div className="space-y-3">
            {logs.map((log) => (
              <Card key={log.id}>
                <CardHeader className="py-3">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{log.title}</span>
                    <span className="text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <pre className="text-sm whitespace-pre-wrap text-muted-foreground line-clamp-4">
                    {log.content}
                  </pre>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}