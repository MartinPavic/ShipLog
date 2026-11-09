"use client";

import { useState } from "react";
import { paidPriceLabel } from "@/config/site";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/client-api";
import type { AiMode, Plan } from "@/lib/plans";

type CheckoutVariant = { tier: Exclude<Plan, "free">; aiMode: AiMode };

function RedirectButton({
  endpoint,
  label,
  variant,
  body,
}: {
  endpoint: string;
  label: string;
  variant?: "default" | "outline";
  body?: unknown;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function go() {
    setLoading(true);
    setError("");
    try {
      const { url } = await apiRequest<{ url: string | null }>(endpoint, "POST", body);
      if (url) window.location.href = url;
      else setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={go} disabled={loading} variant={variant}>
        {loading ? "Redirecting..." : label}
      </Button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

export function UpgradeButton() {
  return (
    <RedirectButton
      endpoint="/api/stripe/checkout"
      label={`Upgrade to Pro — ${paidPriceLabel("pro", "byok")}`}
      body={{ tier: "pro", aiMode: "byok" } satisfies CheckoutVariant}
    />
  );
}

export function UpgradeButtonForVariant({
  tier,
  aiMode,
  label,
  variant,
}: {
  tier: CheckoutVariant["tier"];
  aiMode: CheckoutVariant["aiMode"];
  label: string;
  variant?: "default" | "outline";
}) {
  return <RedirectButton endpoint="/api/stripe/checkout" label={label} body={{ tier, aiMode }} variant={variant} />;
}

export function ManageBillingButton() {
  return <RedirectButton endpoint="/api/stripe/portal" label="Manage billing" variant="outline" />;
}
