import Link from "next/link";
import { Brand } from "@/components/brand";
import { siteConfig } from "@/config/site";

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  const { legal } = siteConfig;
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="container mx-auto flex h-14 items-center px-4">
          <Link href="/">
            <Brand />
          </Link>
        </div>
      </header>
      <main className="container mx-auto max-w-3xl space-y-6 px-4 py-12">
        {!legal.reviewed && (
          <p role="note" className="rounded-lg border border-yellow-600/40 bg-yellow-500/10 p-4 text-sm">
            <strong>Template, not legal advice.</strong> Replace this text with your own {title.toLowerCase()}, reviewed by
            a lawyer, then set <code>legal.reviewed</code> to <code>true</code> in <code>src/config/site.ts</code> to
            remove this notice.
          </p>
        )}
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="text-sm text-muted-foreground">Last updated: {legal.lastUpdated}</p>
        <div className="space-y-6 text-sm leading-relaxed [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
          {children}
        </div>
      </main>
    </div>
  );
}
