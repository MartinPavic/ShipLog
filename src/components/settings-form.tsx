"use client";

import { siteConfig } from "@/config/site";
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
    <p className={`text-sm ${message.error ? "text-danger" : "text-muted-foreground"}`}>
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
          {siteConfig.name} reads commits, pull requests, issues and releases from your repositories.
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

const GITLAB_NOTICES: Record<string, { text: string; error: boolean }> = {
  connected: { text: "GitLab connected.", error: false },
  denied: { text: "GitLab access was denied.", error: true },
  invalid_state: { text: "The GitLab sign-in expired. Please try again.", error: true },
  error: { text: "Could not complete the GitLab connection. Please try again.", error: true },
  not_configured: { text: "Ask a workspace admin to configure GitLab first.", error: true },
};

type GitLabInstanceStatus = { baseUrl: string; clientId: string; configured: true } | null;

export function GitLabCard({
  instance,
  username,
  notice,
  canManage,
}: {
  instance: GitLabInstanceStatus;
  username: string | null;
  notice: string | null;
  canManage: boolean;
}) {
  const [baseUrl, setBaseUrl] = useState(instance?.baseUrl ?? "");
  const [clientId, setClientId] = useState(instance?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const { loading, message, run } = useAction();
  const shown = message ?? (notice && Object.hasOwn(GITLAB_NOTICES, notice) ? GITLAB_NOTICES[notice] : null);

  async function saveConfiguration() {
    const replacingCredentials = Boolean(instance && (clientSecret || clientId !== instance.clientId || baseUrl !== instance.baseUrl));
    if (replacingCredentials && !window.confirm("Replacing GitLab OAuth credentials will disconnect every workspace member. Continue?")) return;
    await run(async () => {
      await apiRequest("/api/gitlab/config", "PUT", {
        baseUrl,
        clientId,
        ...(clientSecret ? { clientSecret } : {}),
      });
      setClientSecret("");
      return "GitLab settings saved";
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>GitLab</CardTitle>
        <CardDescription>
          Configure GitLab.com or a publicly reachable self-managed instance. Each member connects their own account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canManage ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="gitlabBaseUrl">GitLab instance URL</Label>
              <Input id="gitlabBaseUrl" type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://gitlab.com" disabled={loading} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gitlabClientId">OAuth application ID</Label>
              <Input id="gitlabClientId" value={clientId} onChange={(event) => setClientId(event.target.value)} autoComplete="off" disabled={loading} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gitlabClientSecret">OAuth application secret</Label>
              <Input
                id="gitlabClientSecret"
                type="password"
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                autoComplete="new-password"
                placeholder={instance ? "Leave blank to keep current secret" : "Client secret"}
                required={!instance || clientId !== instance.clientId || baseUrl !== instance.baseUrl}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">The secret is encrypted at rest and never shown again.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={loading || !baseUrl.trim() || !clientId.trim() || (!instance && !clientSecret)} onClick={saveConfiguration}>
                {loading ? "Saving..." : instance ? "Save GitLab settings" : "Configure GitLab"}
              </Button>
              {instance && (
                <Button
                  variant="ghost"
                  disabled={loading}
                  onClick={() => {
                    if (!window.confirm("Remove the GitLab instance configuration? Existing GitLab projects must be removed first.")) return;
                    void run(async () => {
                      await apiRequest("/api/gitlab/config", "DELETE");
                      setBaseUrl("");
                      setClientId("");
                      return "GitLab instance removed";
                    });
                  }}
                >
                  Remove instance
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Only workspace admins can configure the GitLab OAuth application.</p>
        )}

        {instance && (
          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            {username ? <p className="text-sm">Connected as <strong>{username}</strong></p> : <p className="text-sm text-muted-foreground">Your GitLab account is not connected.</p>}
            <a href="/api/gitlab/connect" className={buttonVariants({ variant: username ? "outline" : "default" })}>
              {username ? "Reconnect GitLab" : "Connect GitLab"}
            </a>
            {username && (
              <Button
                variant="ghost"
                disabled={loading}
                onClick={() => void run(async () => {
                  await apiRequest("/api/gitlab/disconnect", "DELETE");
                  return "GitLab disconnected";
                })}
              >
                Disconnect account
              </Button>
            )}
          </div>
        )}
        <Feedback message={shown} />
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
