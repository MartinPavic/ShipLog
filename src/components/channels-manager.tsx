"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UpgradeButton } from "@/components/upgrade-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/client-api";

export type ChannelView = { id: string; kind: "slack" | "discord" | "email"; enabled: boolean; hint: string };

const KIND_ITEMS = { slack: "Slack", discord: "Discord", email: "Email" };
const KIND_LABEL: Record<ChannelView["kind"], string> = KIND_ITEMS;

export function ChannelsManager({
  projectId,
  initialChannels,
  canManage,
  deliveryAllowed,
  emailConfigured,
}: {
  projectId: string;
  initialChannels: ChannelView[];
  canManage: boolean;
  deliveryAllowed: boolean;
  emailConfigured: boolean;
}) {
  const router = useRouter();
  const [channels, setChannels] = useState(initialChannels);
  const [kind, setKind] = useState<ChannelView["kind"]>("slack");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [recipients, setRecipients] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

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

  const add = () =>
    run("add", async () => {
      const body =
        kind === "email"
          ? { kind, recipients: recipients.split(/[\s,;]+/).filter(Boolean) }
          : { kind, webhookUrl: webhookUrl.trim() };
      const { channel } = await apiRequest<{ channel: ChannelView }>(`/api/projects/${projectId}/channels`, "POST", body);
      setChannels((prev) => [...prev, channel]);
      setWebhookUrl("");
      setRecipients("");
      return "Channel added";
    });

  const toggle = (c: ChannelView) =>
    run(c.id, async () => {
      const { channel } = await apiRequest<{ channel: ChannelView }>(`/api/projects/${projectId}/channels/${c.id}`, "PATCH", {
        enabled: !c.enabled,
      });
      setChannels((prev) => prev.map((x) => (x.id === c.id ? channel : x)));
    });

  const remove = (c: ChannelView) =>
    run(c.id, async () => {
      if (!window.confirm(`Remove this ${KIND_LABEL[c.kind]} channel?`)) return;
      await apiRequest(`/api/projects/${projectId}/channels/${c.id}`, "DELETE");
      setChannels((prev) => prev.filter((x) => x.id !== c.id));
      return "Channel removed";
    });

  const test = (c: ChannelView) =>
    run(c.id, async () => {
      await apiRequest(`/api/projects/${projectId}/channels/${c.id}/test`, "POST");
      return `Test message sent to ${KIND_LABEL[c.kind]}`;
    });

  const canAdd = kind === "email" ? recipients.trim().length > 0 : webhookUrl.trim().length > 0;

  return (
    <div className="space-y-6">
      {!deliveryAllowed && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm text-muted-foreground">
              Delivery to Slack, Discord and email is a Pro feature.
            </p>
            <UpgradeButton />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Delivery channels</CardTitle>
          <CardDescription>Where ship logs can be sent, manually or after each scheduled run.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {channels.length === 0 && <p className="text-sm text-muted-foreground">No channels yet.</p>}
          {channels.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {KIND_LABEL[c.kind]}
                  {!c.enabled && <span className="ml-2 text-xs text-muted-foreground">(paused)</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">{c.hint}</p>
              </div>
              {canManage && (
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={busy === c.id || !deliveryAllowed} onClick={() => test(c)}>
                    Send test
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === c.id} onClick={() => toggle(c)}>
                    {c.enabled ? "Pause" : "Resume"}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === c.id} onClick={() => remove(c)}>
                    Remove
                  </Button>
                </div>
              )}
            </div>
          ))}
          {note && <p className={`text-sm ${note.error ? "text-danger" : "text-muted-foreground"}`}>{note.text}</p>}
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a channel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={kind} items={KIND_ITEMS} onValueChange={(v) => v && setKind(v as ChannelView["kind"])}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="slack">Slack</SelectItem>
                  <SelectItem value="discord">Discord</SelectItem>
                  <SelectItem value="email" disabled={!emailConfigured}>
                    Email{emailConfigured ? "" : " (not configured)"}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {kind === "email" ? (
              <div className="space-y-2">
                <Label htmlFor="recipients">Recipients</Label>
                <Textarea
                  id="recipients"
                  placeholder="alice@example.com, bob@example.com"
                  value={recipients}
                  onChange={(e) => setRecipients(e.target.value)}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="webhook">Webhook URL</Label>
                <Input
                  id="webhook"
                  type="password"
                  autoComplete="off"
                  placeholder={
                    kind === "slack" ? "https://hooks.slack.com/services/…" : "https://discord.com/api/webhooks/…"
                  }
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Stored encrypted. Only the last four characters are shown afterwards.
                </p>
              </div>
            )}
            <Button disabled={busy === "add" || !canAdd || !deliveryAllowed} onClick={add}>
              {busy === "add" ? "Adding..." : "Add channel"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">Only organization admins can change delivery channels.</p>
      )}
    </div>
  );
}
