"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { apiRequest } from "@/lib/client-api";
import { AI_PROVIDERS, DEFAULT_MODELS, PROVIDER_LABELS, type AiProvider } from "@/lib/ai/models";

function useAction() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function run(fn: () => Promise<string>) {
    setLoading(true);
    setMessage(null);
    try {
      setMessage({ text: await fn(), error: false });
      router.refresh();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Something went wrong", error: true });
    } finally {
      setLoading(false);
    }
  }

  return { loading, message, run };
}

function Feedback({ message }: { message: { text: string; error: boolean } | null }) {
  if (!message) return null;
  return (
    <p className={`text-sm ${message.error ? "text-red-500" : "text-muted-foreground"}`}>
      {message.text}
    </p>
  );
}

const GITHUB_NOTICES: Record<string, { text: string; error: boolean }> = {
  connected: { text: "GitHub connected.", error: false },
  denied: { text: "GitHub access was denied.", error: true },
  invalid_state: { text: "The GitHub sign-in expired. Please try again.", error: true },
  error: { text: "Could not complete the GitHub connection. Please try again.", error: true },
  not_configured: {
    text: "GitHub OAuth is not configured on this server (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET).",
    error: true,
  },
};

export function GithubCard({ login, notice }: { login: string | null; notice: string | null }) {
  const { loading, message, run } = useAction();
  const shown = message ?? (notice && Object.hasOwn(GITHUB_NOTICES, notice) ? GITHUB_NOTICES[notice] : null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>GitHub</CardTitle>
        <CardDescription>
          ShipLog reads commits, pull requests, issues and releases from your repositories.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {login && (
          <p className="text-sm">
            Connected as <strong>{login}</strong>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <a href="/api/github/connect" className={buttonVariants({ variant: login ? "outline" : "default" })}>
            {login ? "Reconnect" : "Connect GitHub"}
          </a>
          {login && (
            <Button
              variant="ghost"
              disabled={loading}
              onClick={() =>
                run(async () => {
                  await apiRequest("/api/github/disconnect", "DELETE");
                  return "GitHub disconnected";
                })
              }
            >
              Disconnect
            </Button>
          )}
          <Feedback message={shown} />
        </div>
      </CardContent>
    </Card>
  );
}

type AiStatus = { provider: AiProvider; last4: string; model: string | null } | null;

export function AiCard({ ai, canManage }: { ai: AiStatus; canManage: boolean }) {
  const [provider, setProvider] = useState<AiProvider>(ai?.provider ?? "openai");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(ai?.model ?? "");
  const [replacing, setReplacing] = useState(false);
  const { loading, message, run } = useAction();

  const keyStored = Boolean(ai) && provider === ai?.provider;
  const showKeyInput = !keyStored || replacing;

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Provider</CardTitle>
        <CardDescription>
          Your key is encrypted at rest and only used to generate ship logs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Provider</Label>
          <Select
            value={provider}
            items={PROVIDER_LABELS}
            onValueChange={(v) => v && setProvider(v as AiProvider)}
            disabled={!canManage}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_PROVIDERS.map((p) => (
                <SelectItem key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="aiApiKey">API Key</Label>
          {showKeyInput ? (
            <Input
              id="aiApiKey"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              disabled={!canManage}
            />
          ) : (
            <div className="flex items-center gap-3">
              <Input id="aiApiKey" value={`••••••••${ai?.last4}`} readOnly disabled />
              {canManage && (
                <Button type="button" variant="outline" onClick={() => setReplacing(true)}>
                  Replace
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="aiModel">Model (optional)</Label>
          <Input
            id="aiModel"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={DEFAULT_MODELS[provider]}
            disabled={!canManage}
          />
        </div>

        {canManage ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={loading || (showKeyInput && !apiKey.trim())}
              onClick={() =>
                run(async () => {
                  await apiRequest("/api/settings/ai", "PUT", {
                    provider,
                    ...(apiKey.trim() ? { apiKey } : {}),
                    ...(model.trim() ? { model } : {}),
                  });
                  setApiKey("");
                  setReplacing(false);
                  return "AI settings saved";
                })
              }
            >
              {loading ? "Saving..." : "Save"}
            </Button>
            {ai && (
              <Button
                variant="ghost"
                disabled={loading}
                onClick={() =>
                  run(async () => {
                    await apiRequest("/api/settings/ai", "DELETE");
                    setModel("");
                    return "API key removed";
                  })
                }
              >
                Remove key
              </Button>
            )}
            <Feedback message={message} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Only organization admins can change AI credentials.</p>
        )}
      </CardContent>
    </Card>
  );
}
