import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SentryCard } from "./settings-form";

const state = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  request: vi.fn(),
  refresh: vi.fn(),
  confirm: vi.fn(),
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

// useState order in SentryCard: organization, token, replacing, then useAction's loading and message.
const ORGANIZATION = 0;
const TOKEN = 1;
const REPLACING = 2;
const MESSAGE = 4;

const connected = { configured: true as const, organizationSlug: "acme", last4: "wxyz" };
const disconnected = { configured: false as const, organizationSlug: null, last4: null };
const SECRET = "sntryu_0123456789abcdef0123456789abcdef";

type Props = Record<string, unknown> & { children?: ReactNode };

function find(node: ReactNode, match: (props: Props) => boolean, found: Props[] = []) {
  if (Array.isArray(node)) node.forEach((child) => find(child, match, found));
  else if (isValidElement(node)) {
    const props = (node as ReactElement<Props>).props;
    if (match(props)) found.push(props);
    find(props.children, match, found);
  }
  return found;
}

function render(sentry: Parameters<typeof SentryCard>[0]["sentry"]) {
  state.cursor = 0;
  return renderToStaticMarkup(<SentryCard sentry={sentry} />);
}

function button(sentry: Parameters<typeof SentryCard>[0]["sentry"], label: string) {
  state.cursor = 0;
  const [found] = find(SentryCard({ sentry }), (props) => props.children === label);
  return found as { onClick?: () => unknown; disabled?: boolean } | undefined;
}

beforeEach(() => {
  state.values = [];
  vi.clearAllMocks();
  state.request.mockResolvedValue({});
  state.confirm.mockReturnValue(true);
  vi.stubGlobal("window", { confirm: state.confirm });
});

describe("SentryCard", () => {
  it("offers organization and token inputs when Sentry is not connected", () => {
    const html = render(disconnected);
    expect(html).toContain("Sentry");
    expect(html).toContain("project:read");
    expect(html).toContain("event:read");
    expect(html).toContain('id="sentryOrganization"');
    expect(html).toMatch(/<input[^>]*id="sentryToken"[^>]*type="password"|<input[^>]*type="password"[^>]*id="sentryToken"/);
    expect(button(disconnected, "Connect Sentry")?.disabled).toBe(true);
    expect(button(disconnected, "Disconnect")).toBeUndefined();
  });

  it("shows only the organization and last four characters once connected", () => {
    const html = render(connected);
    expect(html).toContain("acme");
    expect(html).toContain("wxyz");
    expect(html).not.toContain('id="sentryToken"');
    expect(button(connected, "Replace")).toBeDefined();
    expect(button(connected, "Disconnect")).toBeDefined();
  });

  it("connects with the trimmed organization and token and clears the token afterwards", async () => {
    state.values[ORGANIZATION] = "  acme  ";
    state.values[TOKEN] = SECRET;
    await button(disconnected, "Connect Sentry")?.onClick?.();
    expect(state.request).toHaveBeenCalledWith("/api/settings/sentry", "PUT", { organizationSlug: "acme", token: SECRET });
    expect(state.values[TOKEN]).toBe("");
    expect(state.values[MESSAGE]).toEqual({ text: "Sentry connected", error: false });
    expect(state.refresh).toHaveBeenCalled();
  });

  it("replaces an existing connection through the same form with the current organization prefilled", async () => {
    state.values[REPLACING] = true;
    const html = render(connected);
    expect(html).toContain('id="sentryToken"');
    expect(html).toContain('value="acme"');
    expect(html).not.toContain("wxyz");

    state.values[TOKEN] = SECRET;
    await button(connected, "Replace connection")?.onClick?.();
    expect(state.request).toHaveBeenCalledWith("/api/settings/sentry", "PUT", { organizationSlug: "acme", token: SECRET });
    expect(state.values[REPLACING]).toBe(false);
  });

  it("surfaces a rejected connection without clearing the typed token", async () => {
    state.values[ORGANIZATION] = "acme";
    state.values[TOKEN] = SECRET;
    state.request.mockRejectedValue(new Error("Sentry rejected the token."));
    await button(disconnected, "Connect Sentry")?.onClick?.();
    expect(state.values[MESSAGE]).toEqual({ text: "Sentry rejected the token.", error: true });
    expect(state.values[TOKEN]).toBe(SECRET);
  });

  it("disconnects after confirmation and says project selections are kept", async () => {
    await button(connected, "Disconnect")?.onClick?.();
    expect(state.confirm).toHaveBeenCalled();
    expect(state.request).toHaveBeenCalledWith("/api/settings/sentry", "DELETE");
    expect(state.values[MESSAGE]).toEqual({ text: "Sentry disconnected. Saved project selections are kept.", error: false });
  });

  it("does not disconnect when the confirmation is declined", async () => {
    state.confirm.mockReturnValue(false);
    await button(connected, "Disconnect")?.onClick?.();
    expect(state.request).not.toHaveBeenCalled();
  });
});
