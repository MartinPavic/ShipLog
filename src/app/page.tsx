import Link from "next/link";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { UpgradeButton } from "@/components/upgrade-button";
import { siteConfig } from "@/config/site";
import { features } from "@/env";
import { planHighlights, type Plan } from "@/lib/plans";

function PlanCard({ plan, name, price, highlighted }: { plan: Plan; name: string; price: React.ReactNode; highlighted?: boolean }) {
  return (
    <div className={`flex w-72 flex-col rounded-lg border p-6 ${highlighted ? "border-primary" : ""}`}>
      <div className="mb-1 font-semibold">{name}</div>
      <div className="mb-3 text-2xl font-bold">{price}</div>
      <ul className="mb-6 space-y-1 text-sm text-muted-foreground">
        {planHighlights(plan).map((line) => (
          <li key={line}>• {line}</li>
        ))}
      </ul>
      <div className="mt-auto">
        <Show when="signed-out">
          <SignInButton mode="modal">
            <Button variant={highlighted ? "default" : "outline"} className="w-full">
              {highlighted ? "Upgrade to Pro" : "Get started"}
            </Button>
          </SignInButton>
        </Show>
        <Show when="signed-in">
          {highlighted ? (
            <UpgradeButton />
          ) : (
            <Link href="/dashboard">
              <Button variant="outline" className="w-full">
                Go to Dashboard
              </Button>
            </Link>
          )}
        </Show>
      </div>
    </div>
  );
}

export default function Home() {
  const { currency, pro } = siteConfig.pricing;
  const showPricing = features().billing;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link href="/" className="text-lg">
            <Brand />
          </Link>
          <div className="flex items-center gap-4">
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
        <section className="container mx-auto px-4 py-20 text-center md:py-28">
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
        </section>

        <section className="border-t bg-muted/30">
          <div className="container mx-auto grid gap-8 px-4 py-16 md:grid-cols-3">
            {siteConfig.features.map((feature) => (
              <div key={feature.title} className="space-y-2">
                <h2 className="text-lg font-semibold">{feature.title}</h2>
                <p className="text-sm text-muted-foreground">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        {showPricing && (
          <section className="container mx-auto px-4 py-16 text-center">
            <h2 className="mb-4 text-2xl font-bold">Simple pricing</h2>
            <p className="mb-8 text-muted-foreground">Free to try. Pro unlocks the full history, managed AI and automation.</p>
            <div className="flex flex-col items-stretch justify-center gap-6 text-left sm:flex-row">
              <PlanCard plan="free" name="Free" price={`${currency}0`} />
              <PlanCard
                plan="pro"
                name="Pro"
                highlighted
                price={
                  <>
                    {currency}
                    {pro.price}
                    <span className="text-sm font-normal">/{pro.interval}</span>
                  </>
                }
              />
            </div>
          </section>
        )}

        <section className="container mx-auto max-w-2xl px-4 py-16">
          <h2 className="mb-6 text-center text-2xl font-bold">Questions</h2>
          <div className="divide-y rounded-lg border">
            {siteConfig.faq.map((item) => (
              <details key={item.q} className="group p-4">
                <summary className="cursor-pointer font-medium">{item.q}</summary>
                <p className="mt-2 text-sm text-muted-foreground">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t py-6 text-center text-sm text-muted-foreground">
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
