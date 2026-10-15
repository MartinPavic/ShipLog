import Link from "next/link";
import { Check, Circle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OnboardingStep } from "@/lib/dashboard";

export function OnboardingChecklist({ steps, next }: { steps: OnboardingStep[]; next: OnboardingStep | null }) {
  const done = steps.filter((s) => s.done).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Get started</CardTitle>
        <CardDescription>
          {done} of {steps.length} steps done
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-4">
          {steps.map((step) => (
            <li key={step.id} className="flex gap-3">
              <span
                aria-hidden
                className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${
                  step.done ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {step.done ? <Check className="size-3" /> : <Circle className="size-2" />}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className={`text-sm font-medium ${step.done ? "text-muted-foreground line-through" : ""}`}>
                  {step.title}
                  <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
                </p>
                {!step.done && <p className="text-sm text-muted-foreground">{step.description}</p>}
                {next?.id === step.id && (
                  <Link href={step.href} className={buttonVariants({ size: "sm" })}>
                    {step.title}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
