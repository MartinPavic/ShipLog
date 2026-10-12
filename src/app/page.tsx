import Link from "next/link";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { UpgradeButton } from "@/components/upgrade-button";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <span className="font-semibold text-lg">ShipLog</span>
          <div className="flex items-center gap-4">
            <Show when="signed-out">
              <SignInButton mode="modal">
                <Button variant="ghost" size="sm">Sign in</Button>
              </SignInButton>
            </Show>
            <Show when="signed-in">
              <Link href="/dashboard">
                <Button variant="ghost" size="sm">Dashboard</Button>
              </Link>
              <UserButton afterSignOutUrl="/" />
            </Show>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <section className="container mx-auto px-4 py-20 md:py-28 text-center">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-6 max-w-3xl mx-auto">
            Stop writing weekly updates.
            <br />
            <span className="text-muted-foreground">Generate them from your commits.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
            ShipLog turns your GitHub activity into clean, professional progress reports in seconds.
            Perfect for indie hackers, solo founders, and small teams.
          </p>

          <Show when="signed-out">
            <SignInButton mode="modal">
              <Button size="lg" className="text-base px-8">
                Get started free
              </Button>
            </SignInButton>
          </Show>
          <Show when="signed-in">
            <Link href="/dashboard/ship-log">
              <Button size="lg" className="text-base px-8">
                Generate a Ship Log
              </Button>
            </Link>
          </Show>
        </section>

        {/* Features */}
        <section className="border-t bg-muted/30">
          <div className="container mx-auto px-4 py-16 grid md:grid-cols-3 gap-8">
            <div className="space-y-2">
              <h3 className="font-semibold text-lg">Connect GitHub</h3>
              <p className="text-muted-foreground text-sm">
                Paste a personal access token. We only read your commits — nothing else.
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold text-lg">AI writes the report</h3>
              <p className="text-muted-foreground text-sm">
                Your own OpenAI, Anthropic or Grok key turns raw commits into a clear weekly update.
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold text-lg">Copy & ship</h3>
              <p className="text-muted-foreground text-sm">
                One click to copy a polished progress report for investors, team or Twitter.
              </p>
            </div>
          </div>
        </section>

        {/* Pricing teaser */}
        {/* Pricing */}
        <section className="container mx-auto px-4 py-16 text-center">
          <h2 className="text-2xl font-bold mb-4">Simple pricing</h2>
          <p className="text-muted-foreground mb-8">
            Free to try. Pro unlocks unlimited generations and history.
          </p>

          <div className="inline-flex flex-col sm:flex-row gap-6 text-left justify-center">
            {/* Free plan */}
            <div className="border rounded-lg p-6 w-64">
              <div className="font-semibold mb-1">Free</div>
              <div className="text-2xl font-bold mb-3">€0</div>
              <ul className="text-sm text-muted-foreground space-y-1 mb-6">
                <li>• 5 generations / month</li>
                <li>• Basic history</li>
              </ul>
              <Show when="signed-out">
                <SignInButton mode="modal">
                  <Button variant="outline" className="w-full">
                    Get started
                  </Button>
                </SignInButton>
              </Show>
              <Show when="signed-in">
                <Link href="/dashboard">
                  <Button variant="outline" className="w-full">
                    Go to Dashboard
                  </Button>
                </Link>
              </Show>
            </div>

            {/* Pro plan */}
            <div className="border rounded-lg p-6 w-64 border-primary relative">
              <div className="font-semibold mb-1">Pro</div>
              <div className="text-2xl font-bold mb-3">
                €9<span className="text-sm font-normal">/mo</span>
              </div>
              <ul className="text-sm text-muted-foreground space-y-1 mb-6">
                <li>• Unlimited generations</li>
                <li>• Full history</li>
                <li>• Priority support</li>
              </ul>

              <Show when="signed-out">
                <SignInButton mode="modal">
                  <Button className="w-full">Upgrade to Pro</Button>
                </SignInButton>
              </Show>

              <Show when="signed-in">
                <UpgradeButton />
              </Show>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-6 text-center text-sm text-muted-foreground">
        ShipLog — built for builders who hate writing status updates.
      </footer>
    </div>
  );
}