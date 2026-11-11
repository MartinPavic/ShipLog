import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliverPanel } from "./deliver-panel";

const state = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  buttons: {} as Record<string, (() => void | Promise<void>) | undefined>,
  request: vi.fn(),
  refresh: vi.fn(),
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: ComponentProps<"a">) => <a href={href}>{children}</a> }));
vi.mock("@/lib/client-api", () => ({ apiRequest: state.request }));
vi.mock("@/lib/format", () => ({ formatDateTime: () => "Nov 11, 10:00" }));
vi.mock("@/components/upgrade-button", () => ({ UpgradeButton: () => <button>Upgrade</button> }));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled }: ComponentProps<"button">) => {
    if (typeof children === "string") state.buttons[children] = onClick as (() => void | Promise<void>) | undefined;
    return <button disabled={disabled}>{children}</button>;
  },
}));

// useState order in DeliverPanel: selected, busy, results, error.
const RESULTS = 2;

const props = {
  logId: "log-1",
  projectId: "alpha",
  channels: [{ id: "c1", kind: "teams", hint: "prod-12.westus.logic.azure.com/…" }],
  history: [{ id: "h1", kind: "teams", status: "sent", error: null, sentAt: "2026-11-11T10:00:00Z" }],
  allowed: true,
};

function render(overrides: Partial<ComponentProps<typeof DeliverPanel>> = {}) {
  state.cursor = 0;
  return renderToStaticMarkup(<DeliverPanel {...props} {...overrides} />);
}

beforeEach(() => {
  state.values = [];
  state.buttons = {};
  vi.clearAllMocks();
});

describe("DeliverPanel Teams channel", () => {
  it("labels Teams channels and history as Microsoft Teams, not the raw kind", () => {
    const html = render();
    expect(html).toContain("Microsoft Teams");
    expect(html).not.toMatch(/>\s*teams\s*</);
    expect(html).not.toContain("· teams ·");
  });

  it("labels Teams in manual-send results", () => {
    state.values[RESULTS] = [
      { channelId: "c1", kind: "teams", status: "sent", error: null },
      { channelId: "c2", kind: "teams", status: "unknown", error: "Could not confirm delivery to Teams." },
    ];
    const html = render();
    expect(html).toContain("Microsoft Teams: sent");
    expect(html).toContain("Microsoft Teams: not retried — Could not confirm delivery to Teams.");
  });

  it("sends the selected Teams channel through the existing delivery API", async () => {
    state.request.mockResolvedValue({ results: [] });
    render();
    await state.buttons["Send now"]?.();
    expect(state.request).toHaveBeenCalledWith("/api/logs/log-1/deliver", "POST", { channelIds: ["c1"] });
  });

  it("mentions Teams in the Pro upsell", () => {
    expect(render({ allowed: false })).toContain("Delivery to Slack, Discord, Microsoft Teams and email is a Pro feature.");
  });
});
