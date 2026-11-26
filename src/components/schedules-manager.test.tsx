import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelView } from "./channels-manager";
import { SchedulesManager, type ScheduleView } from "./schedules-manager";

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

// useState order in SchedulesManager: schedules, draft, busy, note.
const SCHEDULES = 0;
const DRAFT = 1;
const NOTE = 3;

const slack: ChannelView = { id: "c1", kind: "slack", enabled: true, hint: "hooks.slack.com/…" };
const email: ChannelView = { id: "c2", kind: "email", enabled: false, hint: "a@example.com" };
const templates = [
  { id: "weekly_update", label: "Weekly update", description: "d", builtIn: true },
  { id: "client_report", label: "Client report", description: "d", builtIn: true },
];
const customer: ScheduleView = {
  id: "s1",
  name: "Customer update",
  template: "client_report",
  weekdays: [5],
  hour: 9,
  timezone: "Europe/Zagreb",
  periodDays: 7,
  enabled: true,
  createdBy: "u1",
  channelIds: ["c1"],
  lastRun: null,
};
const digest: ScheduleView = { ...customer, id: "s2", name: "Eng digest", weekdays: [1, 3], channelIds: [], enabled: false };
const draft = { id: null, name: "  New one ", template: "client_report", weekdays: [5], hour: 9, timezone: "UTC", periodDays: 7, channelIds: [] as string[] };

const props = {
  projectId: "alpha",
  initialSchedules: [customer],
  channels: [slack, email],
  templates: templates as never,
  defaultTemplate: "weekly_update",
  canManage: true,
  schedulingAllowed: true,
  currentUserId: "u1",
};

function render(overrides: Partial<ComponentProps<typeof SchedulesManager>> = {}) {
  state.cursor = 0;
  return renderToStaticMarkup(<SchedulesManager {...props} {...overrides} />);
}

beforeEach(() => {
  state.values = [];
  state.buttons = {};
  vi.clearAllMocks();
  state.request.mockResolvedValue({ schedule: customer });
  vi.stubGlobal("window", { confirm: () => true });
});

describe("SchedulesManager list", () => {
  it("shows each schedule's cadence, period, template and channels", () => {
    const html = render({ initialSchedules: [customer, digest] });
    expect(html).toContain("Customer update");
    expect(html).toContain("Fri 09:00 Europe/Zagreb");
    expect(html).toContain("Mon, Wed 09:00 Europe/Zagreb");
    expect(html).toContain("7 days");
    expect(html).toContain("Client report");
    expect(html).toContain("Slack");
    expect(html).toContain("No channels: log only");
    expect(html).toContain("(paused)");
  });

  it("marks selected channels that are paused", () => {
    expect(render({ initialSchedules: [{ ...customer, channelIds: ["c2"] }] })).toContain("Email (paused)");
  });

  it("shows the last run", () => {
    const html = render({ initialSchedules: [{ ...customer, lastRun: { slot: "2026-10-14", status: "skipped", error: "No activity" } }] });
    expect(html).toContain("Last run (2026-10-14)");
    expect(html).toContain("skipped");
    expect(html).toContain("No activity");
  });

  it("shows an empty state with a first-schedule button", () => {
    const html = render({ initialSchedules: [] });
    expect(html).toContain("No schedules yet.");
    expect(html).toContain("Add your first schedule");
  });

  it("hides every management action from non-admins", () => {
    const html = render({ canManage: false, currentUserId: "u2", initialSchedules: [customer, digest] });
    for (const action of [">Add schedule<", ">Edit<", ">Delete<", ">Pause<", ">Resume<", ">Run as me<", "Add your first schedule"]) {
      expect(html).not.toContain(action);
    }
    expect(html).toContain("Customer update");
  });

  it("shows the Pro notice and disables adding when scheduling isn't allowed", () => {
    const html = render({ schedulingAllowed: false });
    expect(html).toContain("Scheduled logs are a Pro feature.");
    expect(html).toMatch(/<button disabled="">Add schedule<\/button>/);
  });

  it("offers take-over only on schedules created by someone else", () => {
    expect(render({ currentUserId: "u1" })).not.toContain(">Run as me<");
    expect(render({ currentUserId: "u2" })).toContain(">Run as me<");
  });
});

describe("SchedulesManager form", () => {
  it("points to the Delivery tab when the project has no channels", () => {
    state.values[DRAFT] = draft;
    const html = render({ channels: [] });
    expect(html).toContain("/dashboard/projects/alpha?tab=delivery");
  });

  it("lists channels to pick from and explains the empty selection", () => {
    state.values[DRAFT] = draft;
    const html = render();
    expect(html).toContain("Slack");
    expect(html).toContain("Leave all unchecked to only generate logs.");
  });

  it("posts a new schedule with trimmed name, sorted weekdays and enabled", async () => {
    state.values[DRAFT] = { ...draft, weekdays: [5, 1], channelIds: ["c1"] };
    render();
    await state.buttons["Save schedule"]?.();
    expect(state.request).toHaveBeenCalledWith("/api/projects/alpha/schedules", "POST", {
      name: "New one",
      template: "client_report",
      weekdays: [1, 5],
      hour: 9,
      timezone: "UTC",
      periodDays: 7,
      enabled: true,
      channelIds: ["c1"],
    });
    expect(state.refresh).toHaveBeenCalled();
    expect(state.values[DRAFT]).toBeNull();
  });

  it("patches an existing schedule without touching its enabled flag", async () => {
    state.values[DRAFT] = { ...draft, id: "s1", name: "Renamed", channelIds: [] };
    render();
    await state.buttons["Save schedule"]?.();
    expect(state.request).toHaveBeenCalledWith("/api/projects/alpha/schedules/s1", "PATCH", {
      name: "Renamed",
      template: "client_report",
      weekdays: [5],
      hour: 9,
      timezone: "UTC",
      periodDays: 7,
      channelIds: [],
    });
  });

  it("toggles weekdays but keeps at least one selected", () => {
    state.values[DRAFT] = draft;
    render();
    state.buttons["Mon"]?.();
    expect((state.values[DRAFT] as typeof draft).weekdays).toEqual([1, 5]);
    render();
    state.buttons["Fri"]?.();
    expect((state.values[DRAFT] as typeof draft).weekdays).toEqual([1]);
    render();
    state.buttons["Mon"]?.();
    expect((state.values[DRAFT] as typeof draft).weekdays).toEqual([1]);
  });

  it("starts a new schedule from the project's default template with Friday 09:00 and no channels", () => {
    render({ initialSchedules: [] });
    state.buttons["Add your first schedule"]?.();
    expect(state.values[DRAFT]).toMatchObject({
      id: null,
      name: "",
      template: "weekly_update",
      weekdays: [5],
      hour: 9,
      periodDays: 7,
      channelIds: [],
    });
  });

  it("shows the API error and keeps the form open", async () => {
    state.values[DRAFT] = draft;
    state.request.mockRejectedValue(new Error("A project can have at most 10 schedules."));
    render();
    await state.buttons["Save schedule"]?.();
    expect(state.values[NOTE]).toEqual({ text: "A project can have at most 10 schedules.", error: true });
    expect(state.values[DRAFT]).not.toBeNull();
  });
});

describe("SchedulesManager actions", () => {
  it("pauses and resumes a schedule", async () => {
    state.request.mockResolvedValue({ schedule: { ...customer, enabled: false } });
    render();
    await state.buttons["Pause"]?.();
    expect(state.request).toHaveBeenCalledWith("/api/projects/alpha/schedules/s1", "PATCH", { enabled: false });
    expect((state.values[SCHEDULES] as ScheduleView[])[0].enabled).toBe(false);
  });

  it("deletes after confirmation", async () => {
    state.request.mockResolvedValue({});
    render();
    await state.buttons["Delete"]?.();
    expect(state.request).toHaveBeenCalledWith("/api/projects/alpha/schedules/s1", "DELETE");
    expect(state.values[SCHEDULES]).toEqual([]);
  });

  it("does not delete when the confirmation is declined", async () => {
    vi.stubGlobal("window", { confirm: () => false });
    render();
    await state.buttons["Delete"]?.();
    expect(state.request).not.toHaveBeenCalled();
  });

  it("takes a schedule over", async () => {
    state.request.mockResolvedValue({ success: true });
    render({ currentUserId: "u2" });
    await state.buttons["Run as me"]?.();
    expect(state.request).toHaveBeenCalledWith("/api/projects/alpha/schedules/s1/take-over", "POST");
    expect((state.values[SCHEDULES] as ScheduleView[])[0].createdBy).toBe("u2");
  });
});
