import Link from "next/link";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { Brand } from "@/components/brand";
import { ShipWheel } from "@/components/nautical/ship-wheel";
import { WaveDivider } from "@/components/nautical/wave-divider";
import { PricingSection } from "@/components/pricing-section";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { features } from "@/env";

export default function Home() {
  const showPricing = features().billing;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b-2 border-double border-brass/60 bg-sidebar">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link href="/" className="text-lg">
            <Brand />
          </Link>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <Show when="signed-out">
              <SignInButton mode="modal">
                <Button variant="ghost" size="sm">
                  Sign in
                </Button>
              </SignInButton>
            </Show>
            <Show when="signed-in">
              <Link href="/dashboard">
                <Button variant="ghost" size="sm">
                  Dashboard
                </Button>
              </Link>
              <UserButton />
            </Show>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden">
          <ShipWheel className="pointer-events-none absolute -right-16 -top-16 size-80 text-brass opacity-15 md:right-8 md:size-[28rem]" />
          <div className="container relative mx-auto px-4 py-20 text-center md:py-28">
            <p className="mb-4 text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">Entry no. 1</p>
            <h1 className="mx-auto mb-6 max-w-3xl text-4xl font-bold tracking-tight md:text-5xl">
              {siteConfig.tagline}
              <br />
              <span className="text-muted-foreground">{siteConfig.taglineMuted}</span>
            </h1>
            <p className="mx-auto mb-10 max-w-2xl text-lg text-muted-foreground md:text-xl">{siteConfig.description}</p>
            <Show when="signed-out">
              <SignInButton mode="modal">
                <Button size="lg" className="px-8 text-base">
                  Get started free
                </Button>
              </SignInButton>
            </Show>
            <Show when="signed-in">
              <Link href="/dashboard">
                <Button size="lg" className="px-8 text-base">
                  Go to Dashboard
                </Button>
              </Link>
            </Show>
          </div>
        </section>

        <section aria-labelledby="sample-reports-title" className="container mx-auto max-w-6xl px-4 py-14 md:py-18">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-5">
            <div className="max-w-2xl">
              <p className="mb-2 text-xs font-medium uppercase tracking-widest text-brass">One source, different audiences</p>
              <h2 id="sample-reports-title" className="text-2xl font-bold md:text-3xl">
                A week of work, two useful updates
              </h2>
            </div>
            <p className="text-sm text-muted-foreground">Fictional sample activity</p>
          </div>

          <div className="mb-5 flex flex-wrap gap-x-5 gap-y-1 border-y py-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Billing Portal</span>
            <span>Invoice history redesign</span>
            <span>CSV invoice export</span>
            <span>Duplicate notification fix</span>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <article className="space-y-4 border-l-2 border-brass/70 py-2 pl-5 pr-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">For clients</p>
                <h3 className="mt-1 text-xl font-semibold">Client report</h3>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                Billing is easier to manage. Customers can find past invoices, export them for their records, and avoid
                duplicate payment notices.
              </p>
              <ul className="space-y-2 text-sm">
                <li>• A clearer invoice history makes previous charges easier to review.</li>
                <li>• CSV exports simplify bookkeeping and reconciliation.</li>
              </ul>
            </article>

            <article className="space-y-4 border-l-2 border-teal-700/70 py-2 pl-5 pr-2 dark:border-teal-300/70">
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">For your team</p>
                <h3 className="mt-1 text-xl font-semibold">Weekly update</h3>
              </div>
              <ul className="space-y-2 text-sm">
                <li><strong>Shipped:</strong> redesigned invoice history and added CSV export.</li>
                <li><strong>Fixed:</strong> duplicate payment notifications.</li>
              </ul>
              <p className="text-sm leading-6 text-muted-foreground">
                A concise internal summary keeps the team aligned on changes without forwarding raw commit messages.
              </p>
            </article>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">Sample content only. No repository is connected.</p>
        </section>

        <WaveDivider className="text-secondary" />
        <section className="bg-secondary">
          <div className="container mx-auto grid gap-8 px-4 py-10 md:grid-cols-3">
            {siteConfig.features.map((feature, i) => (
              <div key={feature.title} className="ledger space-y-2 rounded-md bg-card p-6">
                <p className="text-xs font-medium uppercase tracking-widest text-brass">Day {i + 1}</p>
                <h2 className="text-lg font-semibold">{feature.title}</h2>
                <p className="text-sm text-muted-foreground">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>
        <WaveDivider flip className="text-secondary" />

        {showPricing && <PricingSection />}

        <section className="container mx-auto max-w-2xl px-4 py-16">
          <h2 className="mb-6 text-center text-2xl font-bold">Questions</h2>
          <div className="divide-y rounded-md border bg-card">
            {siteConfig.faq.map((item) => (
              <details key={item.q} className="group p-4">
                <summary className="cursor-pointer font-medium">{item.q}</summary>
                <p className="mt-2 text-sm text-muted-foreground">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t-2 border-double border-brass/60 py-6 text-center text-sm text-muted-foreground">
        <nav className="mb-2 flex justify-center gap-4">
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <a href={`mailto:${siteConfig.supportEmail}`} className="hover:text-foreground">
            Contact
          </a>
        </nav>
        <p>© {new Date().getFullYear()} {siteConfig.legal.companyName}</p>
      </footer>
    </div>
  );
}
