import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelsManager, type ChannelView } from "./channels-manager";

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
vi.mock("@/lib/client-api", () => ({ apiRequest: state.request }));
vi.mock("@/components/upgrade-button", () => ({ UpgradeButton: () => <button>Upgrade</button> }));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled }: ComponentProps<"button">) => {
    if (typeof children === "string") state.buttons[children] = onClick as (() => void | Promise<void>) | undefined;
    return <button disabled={disabled}>{children}</button>;
  },
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => <span data-value={value}>{children}</span>,
}));

// useState order in ChannelsManager: channels, kind, webhookUrl, recipients, adding, busy, note.
const KIND = 1;
const WEBHOOK_URL = 2;
const ADDING = 4;

const teamsChannel: ChannelView = { id: "c1", kind: "teams", enabled: true, hint: "prod-12.westus.logic.azure.com/…" };
const props = { projectId: "alpha", initialChannels: [] as ChannelView[], canManage: true, deliveryAllowed: true, emailConfigured: true };

function render(overrides: Partial<ComponentProps<typeof ChannelsManager>> = {}) {
  state.cursor = 0;
  return renderToStaticMarkup(<ChannelsManager {...props} {...overrides} />);
}

beforeEach(() => {
  state.values = [];
  state.buttons = {};
  vi.clearAllMocks();
  state.request.mockResolvedValue({ channel: teamsChannel });
  vi.stubGlobal("window", { confirm: () => true });
});

describe("ChannelsManager Teams channel", () => {
  it("offers Microsoft Teams as a webhook channel type", () => {
    state.values[ADDING] = true;
    expect(render()).toContain('<span data-value="teams">Microsoft Teams</span>');
  });

  it("shows a Teams-specific URL placeholder and Workflows help, masked like other webhooks", () => {
    state.values[ADDING] = true;
    state.values[KIND] = "teams";
    const html = render();
    expect(html).toContain('placeholder="https://….logic.azure.com:443/…"');
    expect(html).toContain("Workflows");
    expect(html).toContain('type="password"');
    expect(html).not.toContain("hooks.slack.com");
  });

  it("lists an existing Teams channel by its friendly label and keeps the channel actions", () => {
    const html = render({ initialChannels: [teamsChannel] });
    expect(html).toContain("Microsoft Teams");
    expect(html).toContain("prod-12.westus.logic.azure.com/…");
    for (const action of ["Send test", "Pause", "Remove"]) expect(html).toContain(action);
  });

  it("posts the trimmed Teams webhook to the channels API", async () => {
    state.values[ADDING] = true;
    state.values[KIND] = "teams";
    state.values[WEBHOOK_URL] = "  https://prod-12.westus.logic.azure.com:443/workflows/abc  ";
    render();
    await state.buttons["Add channel"]?.();
    expect(state.request).toHaveBeenCalledWith("/api/projects/alpha/channels", "POST", {
      kind: "teams",
      webhookUrl: "https://prod-12.westus.logic.azure.com:443/workflows/abc",
    });
  });

  it("names Microsoft Teams in the test confirmation", async () => {
    state.request.mockResolvedValue({});
    render({ initialChannels: [teamsChannel] });
    await state.buttons["Send test"]?.();
    expect(state.request).toHaveBeenCalledWith("/api/projects/alpha/channels/c1/test", "POST");
    expect(state.values.at(-1)).toEqual({ text: "Test message sent to Microsoft Teams", error: false });
  });

  it("keeps Teams behind the delivery entitlement and admin checks", () => {
    state.values[ADDING] = true;
    const locked = render({ deliveryAllowed: false, initialChannels: [teamsChannel] });
    expect(locked).toContain("Delivery to Slack, Discord, Microsoft Teams and email is a Pro feature.");
    expect(locked).toMatch(/<button disabled="">Add channel<\/button>/);
    expect(render({ canManage: false })).not.toContain("Microsoft Teams</span>");
  });
});
