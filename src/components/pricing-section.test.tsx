import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pricingSectionContent } from "@/lib/plans";
import { PricingSection } from "@/components/pricing-section";

const state = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  auth: "signed-in" as "signed-in" | "signed-out",
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

vi.mock("@clerk/nextjs", () => ({
  Show: ({ when, children }: { when: string; children: ReactNode }) => (when === state.auth ? children : null),
  SignInButton: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/lib/client-api", () => ({
  apiRequest: state.apiRequest,
  ApiClientError: class extends Error {},
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, type, variant, size, className }: ComponentProps<"button"> & { variant?: string; size?: string }) => {
    if (typeof children === "string") state.buttons[children] = onClick as (() => void | Promise<void>) | undefined;
    return (
      <button disabled={disabled} type={type} data-variant={variant} data-size={size} className={className}>
        {children}
      </button>
    );
  },
}));

function render(auth: "signed-in" | "signed-out", managedAiEnabled = true) {
  state.cursor = 0;
  state.auth = auth;
  state.buttons = {};
  const content = pricingSectionContent({ billing: true, managedAi: managedAiEnabled, teams: true, scheduling: true, delivery: true });
  return renderToStaticMarkup(<PricingSection content={content} />);
}

beforeEach(() => {
  state.values = [];
  state.auth = "signed-in";
  state.buttons = {};
  state.apiRequest.mockReset();
  state.apiRequest.mockResolvedValue({ url: null });
});

describe("PricingSection", () => {
  it("switches paid prices and exact caps when selecting Managed AI", () => {
    const byok = render("signed-in", true);
    expect(byok).toContain("Upgrade to Pro — €12/mo");
    expect(byok).toContain("Upgrade to Ultra — €22/mo");
    expect(byok).toContain("50 generations / month with your own AI key");
    expect(byok).toContain("Unlimited generations with your own AI key");

    state.buttons["Managed AI"]?.();
    const managed = render("signed-in", true);
    expect(managed).toContain("Upgrade to Pro — €19/mo");
    expect(managed).toContain("Upgrade to Ultra — €29/mo");
    expect(managed).toContain("50 managed-AI generations / month");
    expect(managed).toContain("200 managed-AI generations / month");
  });

  it("posts tier and aiMode checkout payloads for both paid cards with no price id", async () => {
    render("signed-in", true);

    await state.buttons["Upgrade to Pro — €12/mo"]?.();
    await state.buttons["Upgrade to Ultra — €22/mo"]?.();

    state.buttons["Managed AI"]?.();
    render("signed-in", true);

    await state.buttons["Upgrade to Pro — €19/mo"]?.();
    await state.buttons["Upgrade to Ultra — €29/mo"]?.();

    expect(state.apiRequest).toHaveBeenNthCalledWith(1, "/api/stripe/checkout", "POST", { tier: "pro", aiMode: "byok" });
    expect(state.apiRequest).toHaveBeenNthCalledWith(2, "/api/stripe/checkout", "POST", { tier: "ultra", aiMode: "byok" });
    expect(state.apiRequest).toHaveBeenNthCalledWith(3, "/api/stripe/checkout", "POST", { tier: "pro", aiMode: "managed" });
    expect(state.apiRequest).toHaveBeenNthCalledWith(4, "/api/stripe/checkout", "POST", { tier: "ultra", aiMode: "managed" });
  });

  it("hides the selector and forces BYOK pricing when managed AI is disabled", () => {
    const out = render("signed-in", false);
    expect(out).not.toContain("Managed AI");
    expect(out).not.toContain("BYOK");
    expect(out).toContain("Upgrade to Pro — €12/mo");
    expect(out).toContain("Upgrade to Ultra — €22/mo");
    expect(out).not.toContain("€19/mo");
    expect(out).not.toContain("€29/mo");
  });
});
