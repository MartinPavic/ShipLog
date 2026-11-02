import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectGenerate } from "./project-generate";

const state = vi.hoisted(() => ({
  values: [] as unknown[], cursor: 0,
  buttons: {} as Record<string, (() => void | Promise<void>) | undefined>,
  stream: vi.fn(), request: vi.fn(), refresh: vi.fn(),
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
vi.mock("@/lib/client-generate", () => ({ streamGeneration: state.stream }));
vi.mock("@/lib/client-api", () => ({ apiRequest: state.request, ApiClientError: class extends Error {} }));
vi.mock("@/lib/github-activity", () => ({ asActivity: () => null }));
vi.mock("@/components/markdown", () => ({ Markdown: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/source-panel", () => ({ SourcePanel: () => null }));
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
  SelectItem: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

const props = {
  projectId: "alpha", defaultDays: 7, defaultTemplate: "weekly_update", templates: [],
  usage: { used: 3, limit: 50 }, setupMessage: null,
};
function render(overrides: Partial<ComponentProps<typeof ProjectGenerate>> = {}) {
  state.cursor = 0;
  return renderToStaticMarkup(<ProjectGenerate {...props} {...overrides} />);
}
beforeEach(() => {
  state.values = [];
  state.buttons = {};
  vi.clearAllMocks();
  state.stream.mockResolvedValue({ logId: "log-1", content: "Weekly progress" });
  state.request.mockResolvedValue({ log: { title: "Alpha update", sourceSnapshot: null } });
});

describe("ProjectGenerate", () => {
  it("keeps the existing project-page presentation by default", () => {
    const html = render();
    expect(html).toContain("Generate a ship log");
    expect(html).toContain("3 / 50 generations this month");
    expect(html).toContain('data-slot="card"');
  });

  it("embeds the project field without a duplicate card, heading, or quota meter", () => {
    const html = render({ projectField: <label>Project picker</label> });
    expect(html).toContain("Project picker");
    expect(html).not.toContain("Generate a ship log");
    expect(html).not.toContain("generations this month");
    expect(html).not.toContain('data-slot="card"');
    expect(html.indexOf("Project picker")).toBeLessThan(html.indexOf("Template"));
  });

  it("offers review and share after successful generation without changing the generation contract", async () => {
    render();
    await state.buttons.Generate?.();
    const html = render();
    expect(state.stream).toHaveBeenCalledWith("alpha", { template: "weekly_update", days: 7 }, expect.any(Function), expect.any(AbortSignal));
    expect(html).toContain("Review and share");
    expect(html).toContain('href="/dashboard/projects/alpha/logs/log-1"');
    expect(html).toContain("Copy");
    expect(html).toContain("Regenerate");
    expect(state.refresh).toHaveBeenCalledOnce();
  });

  it("preserves setup blockers and errors without offering a successful report action", async () => {
    expect(render({ setupMessage: "Connect GitHub first." })).toContain("Open Settings");
    state.stream.mockRejectedValue(new Error("GitHub unavailable"));
    render();
    await state.buttons.Generate?.();
    const html = render();
    expect(html).toContain("GitHub unavailable");
    expect(html).not.toContain("Review and share");
  });
});