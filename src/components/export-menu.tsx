"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "cn";

export function ExportMenu({
  logId,
  projectId,
  pdfAllowed,
}: {
  logId: string;
  projectId: string;
  pdfAllowed: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const endpoint = (format: string, download = false) =>
    `/api/logs/${logId}/export?format=${format}${download ? "&download=1" : ""}`;

  async function copy(format: "markdown" | "html" | "slack", label: string) {
    try {
      const res = await fetch(endpoint(format));
      if (!res.ok) throw new Error("Export failed");
      await navigator.clipboard.writeText(await res.text());
      setNote({ text: `Copied as ${label}`, error: false });
    } catch {
      setNote({ text: "Could not copy. Try again.", error: true });
    }
    setTimeout(() => setNote(null), 2500);
  }

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Export
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-52">
          <DropdownMenuItem onClick={() => copy("markdown", "Markdown")}>Copy as Markdown</DropdownMenuItem>
          <DropdownMenuItem onClick={() => copy("html", "HTML")}>Copy as HTML</DropdownMenuItem>
          <DropdownMenuItem onClick={() => copy("slack", "Slack")}>Copy for Slack</DropdownMenuItem>
          <DropdownMenuItem onClick={() => window.location.assign(endpoint("markdown", true))}>
            Download .md
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!pdfAllowed}
            onClick={() => router.push(`/dashboard/projects/${projectId}/logs/${logId}/print`)}
          >
            {pdfAllowed ? "Save as PDF" : "Save as PDF (Pro)"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {note && (
        <span role="status" className={`text-xs ${note.error ? "text-red-500" : "text-muted-foreground"}`}>
          {note.text}
        </span>
      )}
    </div>
  );
}

export function PrintButton() {
  return <Button onClick={() => window.print()}>Print / Save as PDF</Button>;
}
