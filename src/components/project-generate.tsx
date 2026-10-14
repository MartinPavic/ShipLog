"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { UpgradeButton } from "@/components/upgrade-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiClientError, apiRequest } from "@/lib/client-api";

type Generated = { id: string; title: string; content: string };

export function ProjectGenerate({
  projectId,
  defaultDays,
  setupMessage,
}: {
  projectId: string;
  defaultDays: number;
  setupMessage: string | null;
}) {
  const router = useRouter();
  const [days, setDays] = useState(defaultDays);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [limitReached, setLimitReached] = useState(false);
  const [result, setResult] = useState<Generated | null>(null);

  async function generate() {
    setLoading(true);
    setError("");
    setLimitReached(false);
    setResult(null);
    try {
      const { log } = await apiRequest<{ log: Generated }>(`/api/projects/${projectId}/generate`, "POST", { days });
      setResult(log);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLimitReached(err instanceof ApiClientError && err.code === "LIMIT_REACHED");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Generate a ship log</CardTitle>
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
              <div className="space-y-2">
                <Label htmlFor="period">Period (days)</Label>
                <Input
                  id="period"
                  type="number"
                  min={1}
                  max={90}
                  className="w-32"
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                />
              </div>
              <Button onClick={generate} disabled={loading || days < 1 || days > 90}>
                {loading ? "Generating..." : "Generate"}
              </Button>
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

      {result && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{result.title}</CardTitle>
            <Link
              href={`/dashboard/projects/${projectId}/logs/${result.id}`}
              className="text-sm underline underline-offset-2"
            >
              Open
            </Link>
          </CardHeader>
          <CardContent>
            <Markdown>{result.content}</Markdown>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
