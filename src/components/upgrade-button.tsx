"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/client-api";

function RedirectButton({
  endpoint,
  label,
  variant,
}: {
  endpoint: string;
  label: string;
  variant?: "default" | "outline";
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function go() {
    setLoading(true);
    setError("");
    try {
      const { url } = await apiRequest<{ url: string | null }>(endpoint, "POST");
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
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

export function UpgradeButton() {
  return <RedirectButton endpoint="/api/stripe/checkout" label="Upgrade to Pro — €9/mo" />;
}

export function ManageBillingButton() {
  return <RedirectButton endpoint="/api/stripe/portal" label="Manage billing" variant="outline" />;
}
