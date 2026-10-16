import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { siteConfig } from "@/config/site";
import { Markdown } from "@/components/markdown";
import { SharePasswordGate } from "@/components/share-password-gate";
import { formatDate } from "@/lib/format";
import { getSharedLog } from "@/lib/public";
import { ACCESS_COOKIE, verifyAccess } from "@/lib/share";

export const metadata: Metadata = {
  title: "Shared log",
  robots: { index: false, follow: false },
};

export default async function SharedLogPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const log = await getSharedLog(token);
  if (!log) notFound();

  if (log.passwordHash) {
    const cookie = (await cookies()).get(ACCESS_COOKIE)?.value;
    if (!verifyAccess(cookie, token, log.passwordHash)) {
      return (
        <main className="container mx-auto px-4 py-16">
          <SharePasswordGate token={token} />
        </main>
      );
    }
  }

  return (
    <main className="container mx-auto max-w-3xl space-y-6 px-4 py-12">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">{log.projectName}</p>
        <h1 className="text-2xl font-bold">{log.title}</h1>
        <p className="text-sm text-muted-foreground">
          {formatDate(log.periodStart)} – {formatDate(log.periodEnd)}
        </p>
      </header>
      <Markdown>{log.content}</Markdown>
      {siteConfig.publicFooter && (
        <footer className="border-t pt-6 text-xs text-muted-foreground">Made with {siteConfig.name}</footer>
      )}
    </main>
  );
}
