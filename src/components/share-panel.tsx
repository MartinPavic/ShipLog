"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/client-api";

type ShareState = { shareToken: string | null; url: string | null; hasPassword: boolean };

export function SharePanel({
  logId,
  initial,
  changelog,
}: {
  logId: string;
  initial: { url: string | null; hasPassword: boolean };
  changelog: { enabled: boolean; published: boolean; pageUrl: string | null };
}) {
  const router = useRouter();
  const [share, setShare] = useState<ShareState>({ shareToken: null, ...initial });
  const [published, setPublished] = useState(changelog.published);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  async function run(fn: () => Promise<string | void>) {
    setBusy(true);
    setNote(null);
    try {
      const text = await fn();
      if (text) setNote({ text, error: false });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : "Something went wrong", error: true });
    } finally {
      setBusy(false);
    }
  }

  const update = (body: { password?: string | null; rotate?: boolean }, message: string) =>
    run(async () => {
      setShare(await apiRequest<ShareState>(`/api/logs/${logId}/share`, "POST", body));
      setPassword("");
      return message;
    });

  const sharing = Boolean(share.url);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Share</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          {!sharing ? (
            <>
              <p className="text-sm text-muted-foreground">
                Create a read-only link. Anyone with the link can view this log; it is hidden from search engines.
              </p>
              <Input
                type="password"
                autoComplete="off"
                placeholder="Password (optional, min 6 characters)"
                aria-label="Link password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button
                disabled={busy || (password.length > 0 && password.length < 6)}
                onClick={() => update(password ? { password } : {}, "Share link created")}
              >
                Create share link
              </Button>
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <Input readOnly value={share.url ?? ""} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
                <Button
                  variant="outline"
                  onClick={async () => {
                    await navigator.clipboard.writeText(share.url ?? "");
                    setNote({ text: "Link copied", error: false });
                  }}
                >
                  Copy
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                {share.hasPassword ? "Protected by a password." : "No password: anyone with the link can view."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Input
                  type="password"
                  autoComplete="off"
                  className="w-56"
                  placeholder={share.hasPassword ? "New password" : "Add a password"}
                  aria-label="New password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={busy || password.length < 6}
                  onClick={() => update({ password }, "Password saved")}
                >
                  {share.hasPassword ? "Change password" : "Set password"}
                </Button>
                {share.hasPassword && (
                  <Button variant="ghost" disabled={busy} onClick={() => update({ password: null }, "Password removed")}>
                    Remove password
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("Create a new link? The current link stops working.")) {
                      void update({ rotate: true }, "New link created");
                    }
                  }}
                >
                  Rotate link
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      setShare(await apiRequest<ShareState>(`/api/logs/${logId}/share`, "DELETE"));
                      return "Sharing stopped";
                    })
                  }
                >
                  Stop sharing
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-medium">Public changelog</h3>
          {!changelog.enabled ? (
            <p className="text-sm text-muted-foreground">
              Turn on the public changelog in this project&apos;s settings to publish logs there.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await apiRequest(`/api/logs/${logId}`, "PATCH", { published: !published });
                    setPublished(!published);
                    router.refresh();
                    return published ? "Removed from the changelog" : "Published to the changelog";
                  })
                }
              >
                {published ? "Unpublish" : "Publish to changelog"}
              </Button>
              {changelog.pageUrl && (
                <a href={changelog.pageUrl} target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-2">
                  View changelog
                </a>
              )}
            </div>
          )}
        </div>

        {note && <p className={`text-sm ${note.error ? "text-danger" : "text-muted-foreground"}`}>{note.text}</p>}
      </CardContent>
    </Card>
  );
}
