import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/client-api";
import { ProjectForm, SentryProjectPicker, projectUpdateBody, type ProjectFormValues } from "./project-form";

const state = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  request: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh, push: state.push }) }));
vi.mock("@/lib/client-api", async (original) => ({
  ...(await original<typeof import("@/lib/client-api")>()),
  apiRequest: state.request,
}));

// useState order in SentryProjectPicker: available, loading, error, filter.
const AVAILABLE = 0;
const ERROR = 2;

const web = { id: "11", slug: "web", name: "Web App" };
const api = { id: "22", slug: "api", name: "API" };
const worker = { id: "33", slug: "worker", name: "Worker" };

type Props = Record<string, unknown> & { children?: ReactNode };
type Clickable = { onClick?: () => unknown; onChange?: (event: { target: { checked: boolean } }) => void; disabled?: boolean; checked?: boolean };

function find(node: ReactNode, match: (props: Props) => boolean, found: Props[] = []) {
  if (Array.isArray(node)) node.forEach((child) => find(child, match, found));
  else if (isValidElement(node)) {
    const props = (node as ReactElement<Props>).props;
    if (match(props)) found.push(props);
    find(props.children, match, found);
  }
  return found;
}

type PickerProps = Parameters<typeof SentryProjectPicker>[0];
function picker(overrides: Partial<PickerProps> = {}) {
  state.cursor = 0;
  const props: PickerProps = { value: [], onChange: vi.fn(), connected: true, ...overrides };
  return { props, html: renderToStaticMarkup(<SentryProjectPicker {...props} />), tree: () => { state.cursor = 0; return SentryProjectPicker(props); } };
}
const control = (tree: ReactNode, match: (props: Props) => boolean) => find(tree, match) as unknown as Clickable[];

beforeEach(() => {
  state.values = [];
  vi.clearAllMocks();
});

describe("SentryProjectPicker", () => {
  it("browses the connected workspace's Sentry projects", async () => {
    state.request.mockResolvedValue({ projects: [web, api] });
    const { tree } = picker();
    const [browse] = control(tree(), (props) => props.children === "Browse Sentry projects");
    await browse.onClick?.();
    expect(state.request).toHaveBeenCalledWith("/api/sentry/projects", "GET");
    expect(state.values[AVAILABLE]).toEqual([web, api]);

    const html = picker().html;
    expect(html).toContain("Web App");
    expect(html).toContain("API");
  });

  it("selects and deselects several projects as id, slug and name records", () => {
    state.values[AVAILABLE] = [web, api, worker];
    const { props, tree } = picker({ value: [web] });
    const boxes = control(tree(), (p) => p.type === "checkbox");
    expect(boxes.map((box) => box.checked)).toEqual([true, false, false]);

    boxes[1].onChange?.({ target: { checked: true } });
    expect(props.onChange).toHaveBeenLastCalledWith([web, api]);
    boxes[0].onChange?.({ target: { checked: false } });
    expect(props.onChange).toHaveBeenLastCalledWith([]);
  });

  it("stops offering more than 20 selections", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ id: String(100 + i), slug: `p${i}`, name: `P${i}` }));
    state.values[AVAILABLE] = many;
    const { tree } = picker({ value: many.slice(0, 20) });
    const boxes = control(tree(), (p) => p.type === "checkbox");
    expect(boxes.slice(0, 20).every((box) => !box.disabled)).toBe(true);
    expect(boxes[20].disabled).toBe(true);
  });

  it("shows saved selections with a remove control", () => {
    const { props, html, tree } = picker({ value: [web, api] });
    expect(html).toContain("Web App");
    expect(html).toContain("web");
    const [remove] = control(tree(), (p) => p["aria-label"] === "Remove API");
    remove.onClick?.();
    expect(props.onChange).toHaveBeenCalledWith([web]);
  });

  it("hides browsing without a connection but keeps saved selections and explains how to reconnect", () => {
    const { html, tree } = picker({ value: [web], connected: false });
    expect(html).toContain("Web App");
    expect(html).toContain("Sentry is not connected");
    expect(html).toContain("kept");
    expect(control(tree(), (p) => p.children === "Browse Sentry projects")).toHaveLength(0);
    expect(control(tree(), (p) => String(p["aria-label"] ?? "").startsWith("Remove "))).toHaveLength(0);
  });

  it("offers clear-all while disconnected so selections can be removed without Sentry access", () => {
    const { props, tree } = picker({ value: [web, api], connected: false });
    const [clear] = control(tree(), (p) => p.children === "Clear all");
    expect(clear).toBeDefined();
    clear.onClick?.();
    expect(props.onChange).toHaveBeenCalledWith([]);
  });

  it("explains that Sentry is not connected when nothing is selected", () => {
    const { html } = picker({ connected: false });
    expect(html).toContain("Sentry is not connected");
    expect(html).not.toContain("Browse Sentry projects");
  });

  it("flags a saved selection that Sentry no longer lists", () => {
    state.values[AVAILABLE] = [api];
    const { html } = picker({ value: [web, api] });
    expect(html).toContain("no longer available");
    expect(html).toContain("Web App");
  });

  it("shows the API error when browsing fails", async () => {
    state.request.mockRejectedValue(new ApiClientError("Sentry is temporarily unavailable. Try again shortly.", "SENTRY_UNAVAILABLE"));
    const { tree } = picker();
    const [browse] = control(tree(), (props) => props.children === "Browse Sentry projects");
    await browse.onClick?.();
    expect(state.values[ERROR]).toBe("Sentry is temporarily unavailable. Try again shortly.");
    expect(picker().html).toContain("Sentry is temporarily unavailable. Try again shortly.");
  });
});

const values: ProjectFormValues = {
  name: "Site",
  description: "",
  repos: [],
  sentryProjects: [web, api],
  template: "weekly_update",
  defaultPeriodDays: 7,
  isPublicChangelog: false,
};

describe("project update payload", () => {
  it("omits an unchanged Sentry selection so it is retained without contacting Sentry", () => {
    expect(projectUpdateBody(values, values)).not.toHaveProperty("sentryProjects");
    expect(projectUpdateBody({ ...values, name: "Renamed" }, values)).toMatchObject({ name: "Renamed" });
  });

  it("sends the selection when it was changed or cleared", () => {
    expect(projectUpdateBody({ ...values, sentryProjects: [web, api, worker] }, values).sentryProjects).toEqual([web, api, worker]);
    expect(projectUpdateBody({ ...values, sentryProjects: [] }, values).sentryProjects).toEqual([]);
    expect(projectUpdateBody({ ...values, sentryProjects: [api, web] }, values).sentryProjects).toEqual([api, web]);
  });
});

describe("ProjectForm Sentry section", () => {
  const templates = [{ id: "weekly_update", label: "Weekly update", description: "d", builtIn: true }];
  const edit = (sentryConnected: boolean) => {
    state.cursor = 0;
    return renderToStaticMarkup(
      <ProjectForm
        mode="edit"
        templates={templates as never}
        projectId="p1"
        initial={values}
        sentryConnected={sentryConnected}
      />
    );
  };

  it("restores saved selections in edit mode", () => {
    const html = edit(true);
    expect(html).toContain("Sentry projects");
    expect(html).toContain("Web App");
    expect(html).toContain("API");
    expect(html).toContain("Browse Sentry projects");
  });

  it("keeps saved selections visible but not browsable after Sentry is disconnected", () => {
    const html = edit(false);
    expect(html).toContain("Web App");
    expect(html).toContain("Sentry is not connected");
    expect(html).not.toContain("Browse Sentry projects");
  });

  it("offers the selector when creating a project", () => {
    state.cursor = 0;
    const html = renderToStaticMarkup(<ProjectForm mode="create" templates={templates as never} sentryConnected />);
    expect(html).toContain("Sentry projects");
    expect(html).toContain("Browse Sentry projects");
  });
});
