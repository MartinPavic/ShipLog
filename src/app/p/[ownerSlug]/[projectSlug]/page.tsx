import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { siteConfig } from "@/config/site";
import { Markdown } from "@/components/markdown";
import { ShipWheel } from "@/components/nautical/ship-wheel";
import { ThemeToggle } from "@/components/theme-toggle";
import { formatDate } from "@/lib/format";
import { getPublicChangelog } from "@/lib/public";

type Params = { ownerSlug: string; projectSlug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { ownerSlug, projectSlug } = await params;
  const changelog = await getPublicChangelog(ownerSlug, projectSlug, 1);
  return changelog
    ? { title: `${changelog.project.name} changelog`, description: changelog.project.description ?? undefined }
    : { title: "Changelog", robots: { index: false } };
}

export default async function PublicChangelogPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { ownerSlug, projectSlug } = await params;
  const page = Math.min(Math.max(Number((await searchParams).page) || 1, 1), 1000);
  const changelog = await getPublicChangelog(ownerSlug, projectSlug, page);
  if (!changelog) notFound();

  const { project, entries, pages } = changelog;
  const base = `/p/${ownerSlug}/${projectSlug}`;

  return (
    <main className="container mx-auto max-w-3xl space-y-10 px-4 py-12">
      <header className="flex items-start justify-between gap-4 border-b-2 border-double border-brass/60 pb-6">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            <ShipWheel className="size-4 text-brass" />
            Ship&apos;s log
          </p>
          <h1 className="text-3xl font-bold">{project.name}</h1>
          {project.description && <p className="text-muted-foreground">{project.description}</p>}
        </div>
        <ThemeToggle />
      </header>

      {entries.length === 0 && <p className="text-muted-foreground">No entries in the log yet.</p>}

      {entries.map((entry) => (
        <article key={entry.id} id={entry.id} className="space-y-3 border-t border-dashed pt-6">
          <header>
            <h2 className="text-xl font-semibold">{entry.title}</h2>
            {entry.publishedAt && <p className="text-sm text-muted-foreground">{formatDate(entry.publishedAt)}</p>}
          </header>
          <Markdown>{entry.content}</Markdown>
        </article>
      ))}

      {pages > 1 && (
        <nav className="flex items-center justify-between border-t pt-6 text-sm">
          {page > 1 ? (
            <Link href={`${base}?page=${page - 1}`} className="underline underline-offset-2">
              Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={`${base}?page=${page + 1}`} className="underline underline-offset-2">
              Older
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      {siteConfig.publicFooter && <footer className="text-xs text-muted-foreground">Made with {siteConfig.name}</footer>}
    </main>
  );
}
