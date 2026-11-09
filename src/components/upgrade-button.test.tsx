import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManageBillingButton, UpgradeButton, UpgradeButtonForVariant } from "@/components/upgrade-button";

const state = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  buttons: {} as Record<string, (() => void | Promise<void>) | undefined>,
  apiRequest: vi.fn(),
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (value: unknown) => {
      state.values[index] = typeof value === "function" ? value(state.values[index]) : value;
    }];
  },
}));

vi.mock("@/config/site", () => ({
  paidPriceLabel: () => "€12/mo",
}));

vi.mock("@/lib/client-api", () => ({
  apiRequest: state.apiRequest,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, variant }: ComponentProps<"button"> & { variant?: string }) => {
    if (typeof children === "string") state.buttons[children] = onClick as (() => void | Promise<void>) | undefined;
    return (
      <button disabled={disabled} data-variant={variant}>
        {children}
      </button>
    );
  },
}));

function render(node: React.ReactNode) {
  state.cursor = 0;
  state.buttons = {};
  return renderToStaticMarkup(node);
}

beforeEach(() => {
  state.values = [];
  state.cursor = 0;
  state.buttons = {};
  state.apiRequest.mockReset();
  state.apiRequest.mockResolvedValue({ url: null });
});

describe("UpgradeButton", () => {
  it("uses the default BYOK checkout payload for generic upgrade entry points", async () => {
    render(<UpgradeButton />);
    await state.buttons["Upgrade to Pro — €12/mo"]?.();

    expect(state.apiRequest).toHaveBeenCalledWith("/api/stripe/checkout", "POST", { tier: "pro", aiMode: "byok" });
  });

  it("posts explicit tier and mode for pricing-card variants", async () => {
    render(<UpgradeButtonForVariant tier="ultra" aiMode="managed" label="Choose Ultra" />);
    await state.buttons["Choose Ultra"]?.();

    expect(state.apiRequest).toHaveBeenCalledWith("/api/stripe/checkout", "POST", { tier: "ultra", aiMode: "managed" });
  });

  it("keeps billing-portal redirects unchanged", async () => {
    render(<ManageBillingButton />);
    await state.buttons["Manage billing"]?.();

    expect(state.apiRequest).toHaveBeenCalledWith("/api/stripe/portal", "POST", undefined);
  });
});
