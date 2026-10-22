"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/client-api";

export function ArchiveProjectButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function archive() {
    if (!window.confirm("Archive this project? Its logs are kept but it disappears from your list.")) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/api/projects/${projectId}`, "DELETE");
      router.push("/dashboard/projects");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" disabled={busy} onClick={archive}>
        {busy ? "Archiving..." : "Archive project"}
      </Button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
