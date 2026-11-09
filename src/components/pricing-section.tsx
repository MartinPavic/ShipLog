"use client";

import Link from "next/link";
import { Show, SignInButton } from "@clerk/nextjs";
import { useMemo, useState } from "react";
import { UpgradeButtonForVariant } from "@/components/upgrade-button";
import { Button } from "@/components/ui/button";
import { siteConfig, type PaidAiMode, type PricingSectionContent } from "@/config/site";

function PlanCard({
  name,
  price,
  interval,
  highlights,
  highlighted,
  cta,
}: {
  name: string;
  price: string;
  interval: string;
  highlights: string[];
  highlighted?: boolean;
  cta: React.ReactNode;
}) {
  return (
    <div className={`flex w-72 flex-col rounded-md border bg-card p-6 ${highlighted ? "border-brass shadow-md" : ""}`}>
      <div className="mb-1 font-semibold">{name}</div>
      <div className="mb-3 text-2xl font-bold">
        {price}
        <span className="text-sm font-normal">/{interval}</span>
      </div>
      <ul className="mb-6 space-y-1 text-sm text-muted-foreground">
        {highlights.map((line) => (
          <li key={line}>• {line}</li>
        ))}
      </ul>
      <div className="mt-auto">{cta}</div>
    </div>
  );
}

const MODE_OPTIONS: Array<{ mode: PaidAiMode; label: string }> = [
  { mode: "byok", label: "BYOK" },
  { mode: "managed", label: "Managed AI" },
];

export function PricingSection({ content }: { content: PricingSectionContent }) {
  const [mode, setMode] = useState<PaidAiMode>("byok");
  const { currency, interval, vatInclusiveLabel } = siteConfig.pricing;
  const paid = useMemo(
    () => (mode === "managed" && content.managed ? content.managed : content.byok),
    [content.byok, content.managed, mode]
  );
  const modeOptions = content.managed ? MODE_OPTIONS : MODE_OPTIONS.filter((option) => option.mode === "byok");

  return (
    <section className="container mx-auto px-4 py-16 text-center">
      <h2 className="mb-3 text-2xl font-bold">Simple pricing</h2>
      <p className="mb-3 text-muted-foreground">{content.summary}</p>
      <p className="mb-8 text-sm text-muted-foreground">{vatInclusiveLabel}</p>

      {content.managed && (
        <div className="mb-8 inline-flex items-center gap-2 rounded-md border bg-card p-1" role="group" aria-label="AI mode">
          {modeOptions.map((option) => (
            <Button
              key={option.mode}
              type="button"
              size="sm"
              variant={mode === option.mode ? "default" : "outline"}
              aria-pressed={mode === option.mode}
              onClick={() => setMode(option.mode)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-col items-stretch justify-center gap-6 text-left sm:flex-row">
        <PlanCard
          name="Free"
          price={`${currency}0`}
          interval={interval}
          highlights={content.freeHighlights}
          cta={
            <>
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
            </>
          }
        />

        <PlanCard
          name="Pro"
          price={`${currency}${paid.pro.price}`}
          interval={interval}
          highlights={paid.pro.highlights}
          highlighted
          cta={
            <>
              <Show when="signed-out">
                <SignInButton mode="modal">
                  <Button className="w-full">Choose Pro</Button>
                </SignInButton>
              </Show>
              <Show when="signed-in">
                <UpgradeButtonForVariant
                  tier={paid.pro.checkout.tier}
                  aiMode={paid.pro.checkout.aiMode}
                  label={`Upgrade to Pro — ${currency}${paid.pro.price}/${interval}`}
                />
              </Show>
            </>
          }
        />

        <PlanCard
          name="Ultra"
          price={`${currency}${paid.ultra.price}`}
          interval={interval}
          highlights={paid.ultra.highlights}
          cta={
            <>
              <Show when="signed-out">
                <SignInButton mode="modal">
                  <Button variant="outline" className="w-full">
                    Choose Ultra
                  </Button>
                </SignInButton>
              </Show>
              <Show when="signed-in">
                <UpgradeButtonForVariant
                  tier={paid.ultra.checkout.tier}
                  aiMode={paid.ultra.checkout.aiMode}
                  label={`Upgrade to Ultra — ${currency}${paid.ultra.price}/${interval}`}
                  variant="outline"
                />
              </Show>
            </>
          }
        />
      </div>

      <Show when="signed-in">
        <div className="mt-6 text-sm text-muted-foreground">
          Manage plan changes from <Link href="/dashboard/settings" className="underline underline-offset-4">Settings</Link>.
        </div>
      </Show>
    </section>
  );
}